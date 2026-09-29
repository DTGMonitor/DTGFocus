-- Migration 001: the availability-summary RPCs, in the repo.
--
-- WHY THIS FILE EXISTS
-- --------------------
-- get_downtime_summary and get_downtime_per_day are the entire calculation
-- behind components/Radars/AvailabilitySummaryPage.jsx — the two availability
-- gauges, the per-radar bars and all three line charts are reshapes of their
-- output. Until now they existed only in the Supabase dashboard: no history,
-- no review, and no way to tell which version produced a number a client is
-- asking about.
--
-- Idempotent. Safe to run repeatedly.
--
-- WHAT CHANGED FROM THE DASHBOARD VERSION
-- ---------------------------------------
-- 1. THE WINDOW IS THE SITE'S CALENDAR, NOT UTC.
--    The page sends plain calendar dates ('2026-07-21'). The old functions let
--    those cast to UTC midnight, so for Hidden Valley (Pacific/Port_Moresby,
--    UTC+10) a filter of "21 July" actually began at 10:00 site-local and the
--    first ten hours of the site's own 21 July fell outside the window. Each
--    radar's bounds are now built on ITS OWN site clock.
--
-- 2. THE END DATE IS INCLUDED, BUT THE FUTURE IS NOT.
--    The old upper bound was `end_date` itself — midnight at the START of the
--    last day — so the day the analyst picked as the end was excluded, while
--    the page's DURATION card counted it (`endOf("day")`). The bound is now
--    `end_date + 1 day` at site-local midnight, clamped to now(): picking
--    today as the end means "up to this moment", not "up to tonight", so hours
--    that have not happened yet are never counted as available. Availability
--    figures shift slightly against the old ones because the denominator grows
--    by up to a day per radar; that is the correction, not a regression.
--
-- 3. OVERLAPPING RECORDS ARE MERGED.
--    One outage is often logged twice — once under the wall folder being
--    retired and once under its replacement — because a folder changeover and
--    an outage tend to happen together. Summing raw durations counted those
--    hours twice (SSR778XT: ~21 h over Jul-Sep 2026). Intervals are now merged
--    per radar per reason before they are summed, matching the `mergeOverlaps`
--    path that utils/reportAvailability.js already takes for the report.
--
--    Overlap ACROSS reasons is still counted twice: the output carries one row
--    per reason, so there is nowhere to put an hour that two reasons share.
--    A Connection and a Maintenance record covering the same hour both keep it.
--
-- 4. REVERSED RECORDS ARE DROPPED EXPLICITLY.
--    A record with `to` < `from` (a mis-typed date, or a close-and-reopen that
--    stamped an earlier time onto an older record) used to survive into the
--    arithmetic and was only neutralised at the end — by a `case` in the
--    summary, and by an empty generate_series in the per-day. It is now
--    rejected at the join, where it is visible. Migration 002 stops new ones
--    reaching the table at all.
--
-- WHAT DID NOT CHANGE
-- -------------------
-- The access rule, the output columns and the reason grouping. Both functions
-- stay SECURITY INVOKER and keep the same `user_sites` gate (admins see every
-- site, everyone else sees the sites they are on), so RLS and role behaviour
-- are exactly as before. Callers need no change: the page already sends ISO
-- calendar dates.
--
-- get_longest_downtime, the third RPC this page calls, gets the same treatment
-- in migration 003.

-- ---------------------------------------------------------------------------
-- 0) Drop the old definitions.
--
-- Both functions change their argument types (the summary took timestamptz),
-- and CREATE OR REPLACE cannot do that — it would leave a second overload and
-- PostgREST would refuse to choose between them. Dropping by name covers every
-- signature that may be deployed, whatever this database currently holds.
-- ---------------------------------------------------------------------------
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('get_downtime_summary', 'get_downtime_per_day')
  loop
    execute format('drop function if exists %s', fn.signature);
  end loop;
end $$;

-- A NOTE ON QUALIFICATION
-- -----------------------
-- RETURNS TABLE declares OUT parameters, and inside the body a bare name that
-- matches both one of them and a column ("reason", "site_id", "radar_id") is
-- rejected as ambiguous. Every reference below is table-qualified for that
-- reason, including in GROUP BY and ORDER BY, where the habit is easiest to
-- lose.

-- ---------------------------------------------------------------------------
-- 1) get_downtime_summary — one row per radar per reason, plus the radar's
--    in-service hours, for the KPI cards, the pie and the per-radar bars.
-- ---------------------------------------------------------------------------
create function public.get_downtime_summary(
  start_date date,
  end_date   date,
  radar_ids  bigint[]
)
returns table (
  site_id         bigint,
  site_name       text,
  radar_id        bigint,
  radar_number    text,
  reason          text,
  reason_group    text,
  total_hours     double precision,
  effective_hours double precision
)
language sql
stable
security invoker
set search_path = public
as $function$
with radar_lifecycle as (
  select
    r.id           as radar_id,
    r.radar_number as radar_number,
    c.id           as site_id,
    c.site_name    as site_name,
    -- A site with no timezone would otherwise be read on the server's clock.
    coalesce(c.timezone, 'UTC') as timezone,
    min(rwf.commenced_at) as commissioned_at,
    -- A folder still live has no end; 'infinity' lets the window do the
    -- clamping instead of baking a window bound into the lifecycle.
    max(coalesce(rwf.decommissioned_at, 'infinity'::timestamptz)) as decommissioned_at
  from radars r
  join clients c on c.id = r.site_id
  join radar_wall_folders rwf on rwf.radar_id = r.id
  where (radar_ids is null or r.id = any(radar_ids))
    and exists (
      select 1
      from user_sites us
      where us.user_id = auth.uid()
        and (us.role = 'admin' or us.site_id = c.id)
    )
  group by r.id, r.radar_number, c.id, c.site_name, c.timezone
),

-- The filter's calendar days, read on each site's own clock. `end_date + 1`
-- makes the end day inclusive: "21 Jul to 30 Sep" ends at the site-local
-- midnight opening 1 Oct, which is where the page's endOf("day") already
-- pointed.
windowed as (
  select
    rl.*,
    (start_date::timestamp at time zone rl.timezone) as win_start,
    -- ...but never past the present: a radar cannot have been available for
    -- hours that have not happened yet. An end date of today therefore runs to
    -- now, not to tonight's midnight, and a window wholly in the past is
    -- unaffected.
    least(
      (end_date + 1)::timestamp at time zone rl.timezone,
      now()
    ) as win_end
  from radar_lifecycle rl
),

-- What each radar was actually on the hook for inside the window. A radar that
-- commenced halfway through is not charged for the half it did not exist.
in_service as (
  select
    w.*,
    greatest(w.commissioned_at, w.win_start) as eff_start,
    least(w.decommissioned_at, w.win_end)    as eff_end
  from windowed w
  where w.commissioned_at   < w.win_end
    and w.decommissioned_at > w.win_start
),

-- Every downtime record on every one of the radar's wall folders, clipped to
-- the radar's in-service window.
clipped as (
  select
    s.site_id,
    s.site_name,
    s.radar_id,
    s.radar_number,
    dr.reason,
    greatest(dr."from", s.eff_start)               as dt_from,
    least(coalesce(dr."to", s.eff_end), s.eff_end) as dt_to
  from in_service s
  join radar_wall_folders rwf on rwf.radar_id = s.radar_id
  join downtime_records dr    on dr.wallfolder = rwf.id
  where dr."from" < s.eff_end
    and coalesce(dr."to", s.eff_end) > s.eff_start
    -- A reversed record describes no span of time. Dropped here, where it is
    -- visible, rather than silently arriving at 0 hours further down.
    and (dr."to" is null or dr."to" >= dr."from")
),

valid as (
  select cl.* from clipped cl where cl.dt_to > cl.dt_from
),

-- Gaps and islands: mark every record that starts after everything before it
-- has ended. Those marks are the starts of the merged intervals.
ordered as (
  select
    v.*,
    max(v.dt_to) over (
      partition by v.radar_id, v.reason
      order by v.dt_from, v.dt_to
      rows between unbounded preceding and 1 preceding
    ) as prev_max_to
  from valid v
),

islanded as (
  select
    o.*,
    sum(case when o.prev_max_to is null or o.dt_from > o.prev_max_to then 1 else 0 end) over (
      partition by o.radar_id, o.reason
      order by o.dt_from, o.dt_to
      rows unbounded preceding
    ) as island_id
  from ordered o
),

merged as (
  select
    i.radar_id,
    i.reason,
    i.island_id,
    min(i.dt_from) as dt_from,
    max(i.dt_to)   as dt_to
  from islanded i
  group by i.radar_id, i.reason, i.island_id
),

totals as (
  select
    m.radar_id,
    m.reason,
    sum(extract(epoch from (m.dt_to - m.dt_from)) / 3600.0) as total_hours
  from merged m
  group by m.radar_id, m.reason
)

-- LEFT JOIN, so a radar that was up for the whole window still returns a row.
-- The page needs it: that row carries effective_hours, which is what the KPI
-- cards divide by, and its "No Downtime" reason is filtered out of the pie.
select
  s.site_id,
  s.site_name,
  s.radar_id,
  s.radar_number,
  coalesce(t.reason, 'No Downtime') as reason,
  case
    when t.reason in ('Connection', 'PMP Issue') then 'Monitoring'
    when t.reason is not null                    then 'Radar Issue'
    else 'None'
  end as reason_group,
  coalesce(t.total_hours, 0)::double precision as total_hours,
  (extract(epoch from (s.eff_end - s.eff_start)) / 3600.0)::double precision as effective_hours
from in_service s
left join totals t on t.radar_id = s.radar_id
order by s.site_name, s.radar_number, coalesce(t.reason, 'No Downtime');
$function$;

-- ---------------------------------------------------------------------------
-- 2) get_downtime_per_day — the same downtime, sliced into site-local days,
--    for the three line charts.
-- ---------------------------------------------------------------------------
create function public.get_downtime_per_day(
  start_date date,
  end_date   date,
  radar_ids  bigint[]
)
returns table (
  site_id        bigint,
  site_name      text,
  radar_id       bigint,
  radar_number   text,
  record_date    date,
  reason         text,
  reason_group   text,
  duration_hours double precision
)
language sql
stable
security invoker
set search_path = public
as $function$
with radar_lifecycle as (
  select
    r.id           as radar_id,
    r.radar_number as radar_number,
    c.id           as site_id,
    c.site_name    as site_name,
    coalesce(c.timezone, 'UTC') as timezone,
    min(rwf.commenced_at) as commissioned_at,
    max(coalesce(rwf.decommissioned_at, 'infinity'::timestamptz)) as decommissioned_at
  from radars r
  join clients c on c.id = r.site_id
  join radar_wall_folders rwf on rwf.radar_id = r.id
  where (radar_ids is null or r.id = any(radar_ids))
    and exists (
      select 1
      from user_sites us
      where us.user_id = auth.uid()
        and (us.role = 'admin' or us.site_id = c.id)
    )
  group by r.id, r.radar_number, c.id, c.site_name, c.timezone
),

windowed as (
  select
    rl.*,
    (start_date::timestamp at time zone rl.timezone) as win_start,
    -- ...but never past the present: a radar cannot have been available for
    -- hours that have not happened yet. An end date of today therefore runs to
    -- now, not to tonight's midnight, and a window wholly in the past is
    -- unaffected.
    least(
      (end_date + 1)::timestamp at time zone rl.timezone,
      now()
    ) as win_end
  from radar_lifecycle rl
),

in_service as (
  select
    w.*,
    greatest(w.commissioned_at, w.win_start) as eff_start,
    least(w.decommissioned_at, w.win_end)    as eff_end
  from windowed w
  where w.commissioned_at   < w.win_end
    and w.decommissioned_at > w.win_start
),

clipped as (
  select
    s.site_id,
    s.site_name,
    s.radar_id,
    s.radar_number,
    s.timezone,
    dr.reason,
    greatest(dr."from", s.eff_start)               as dt_from,
    least(coalesce(dr."to", s.eff_end), s.eff_end) as dt_to
  from in_service s
  join radar_wall_folders rwf on rwf.radar_id = s.radar_id
  join downtime_records dr    on dr.wallfolder = rwf.id
  where dr."from" < s.eff_end
    and coalesce(dr."to", s.eff_end) > s.eff_start
    and (dr."to" is null or dr."to" >= dr."from")
),

valid as (
  select cl.* from clipped cl where cl.dt_to > cl.dt_from
),

-- Merge BEFORE slicing, so a day that two duplicate records both cover is not
-- charged twice on the chart.
ordered as (
  select
    v.*,
    max(v.dt_to) over (
      partition by v.radar_id, v.reason
      order by v.dt_from, v.dt_to
      rows between unbounded preceding and 1 preceding
    ) as prev_max_to
  from valid v
),

islanded as (
  select
    o.*,
    sum(case when o.prev_max_to is null or o.dt_from > o.prev_max_to then 1 else 0 end) over (
      partition by o.radar_id, o.reason
      order by o.dt_from, o.dt_to
      rows unbounded preceding
    ) as island_id
  from ordered o
),

merged as (
  select
    i.site_id,
    i.site_name,
    i.radar_id,
    i.radar_number,
    i.timezone,
    i.reason,
    i.island_id,
    min(i.dt_from) as dt_from,
    max(i.dt_to)   as dt_to
  from islanded i
  group by i.site_id, i.site_name, i.radar_id, i.radar_number, i.timezone, i.reason, i.island_id
),

-- Onto the site's wall clock, where a "day" is a day the site recognises.
local_merged as (
  select
    m.*,
    (m.dt_from at time zone m.timezone) as local_from,
    (m.dt_to   at time zone m.timezone) as local_to
  from merged m
),

-- One row per calendar day the interval touches. Subtracting a microsecond
-- before truncating keeps an interval that ends exactly at midnight from
-- generating a trailing zero-length day.
sliced as (
  select
    lm.site_id,
    lm.site_name,
    lm.radar_id,
    lm.radar_number,
    lm.reason,
    g::date                                  as record_date,
    greatest(lm.local_from, g)               as slice_from,
    least(lm.local_to, g + interval '1 day') as slice_to
  from local_merged lm
  cross join lateral generate_series(
    date_trunc('day', lm.local_from),
    date_trunc('day', lm.local_to - interval '1 microsecond'),
    interval '1 day'
  ) g
)

select
  sl.site_id,
  sl.site_name,
  sl.radar_id,
  sl.radar_number,
  sl.record_date,
  coalesce(sl.reason, 'No Downtime') as reason,
  case
    when sl.reason in ('Connection', 'PMP Issue') then 'Monitoring'
    when sl.reason is not null                    then 'Radar Issue'
    else 'None'
  end as reason_group,
  sum(extract(epoch from (sl.slice_to - sl.slice_from)) / 3600.0)::double precision as duration_hours
from sliced sl
where sl.slice_to > sl.slice_from
group by sl.site_id, sl.site_name, sl.radar_id, sl.radar_number, sl.record_date, sl.reason
order by sl.site_name, sl.radar_number, sl.record_date, sl.reason;
$function$;
