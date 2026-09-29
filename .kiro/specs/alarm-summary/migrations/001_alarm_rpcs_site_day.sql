-- Migration 001: the alarm-summary RPCs read the SITE's calendar day.
--
-- The five functions behind components/Radars/AlarmSummaryPage.jsx — the KPI
-- cards, the radar/reason/region charts, and the two per-day line charts.
-- Captured here from the Supabase dashboard, where they had no history, and
-- corrected. Idempotent; safe to run repeatedly.
--
-- THE TWO BUGS
-- ------------
-- 1. THE LAST DAY OF THE FILTER COUNTED FOR NOTHING.
--    Every function bounded on the raw parameter — `triggered_at < p_end_date`
--    in the three stats functions, `<= p_end_date` in the per-day ones — and
--    the page sent midnight for that day. So the end day contributed nothing
--    but the empty row the date grid drew for it, and a filter of one day
--    returned zero alarms:
--
--        12 Sep -> 12 Sep :   0 alarms
--        12 Sep -> 13 Sep :  52 alarms
--        13 Sep -> 15 Sep :  59      (the 15th's 330 are missing)
--        13 Sep -> 16 Sep : 389
--
--    Nothing looked broken, because the cards and the chart agreed with each
--    other — they were both a day short. The window is now closed on the end
--    day: `>= start` and `< (end + 1 day)`, both at site-local midnight.
--
-- 2. A "DAY" WAS A UTC DAY.
--    `ar.triggered_at::DATE` casts on the SERVER's clock, which is UTC. For
--    Hidden Valley (Pacific/Port_Moresby, UTC+10) that put the boundary at
--    10:00 site-local: an alarm at 09:50 on the 29th was filed under the 28th.
--    Measured over September, 69 of 69 Hidden Valley radar-days matched UTC
--    bucketing and only 11 matched the site's own days; 15 September read 330
--    where the site had 126.
--
--    Days are now cut at midnight on the site's clock, per radar — two radars
--    at different sites in one query each get their own boundaries. This is the
--    same rule the availability RPCs follow (see the availability-summary spec).
--
-- THE SIGNATURE CHANGES, DELIBERATELY
-- -----------------------------------
-- p_start_date and p_end_date become `date`. They always described calendar
-- days; typing them as timestamptz is what let the page send an instant —
-- midnight on the VIEWER's clock — so the same filter answered differently
-- depending on where the analyst was sitting (330 from a UTC browser, 186 from
-- Jakarta, 126 from Port Moresby, for one 15 September). A date cannot carry
-- that ambiguity. AlarmSummaryPage now sends plain 'YYYY-MM-DD'.
--
-- Deploy order does not matter: Postgres casts the old ISO-instant strings to
-- date, so the page keeps working between this migration and the page deploy.
--
-- WHAT DID NOT CHANGE
-- -------------------
-- Output columns, their names and order, the reason/radar filters, the radar
-- lifecycle grid (a radar still contributes only days it was in service), the
-- cumulative window, and SECURITY INVOKER — so RLS on alarm_records governs
-- who sees what, exactly as before. The unused `LEFT JOIN brand` in
-- get_radar_alarm_stats is dropped: nothing selected from it.

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'get_radar_alarm_stats',
        'get_reason_alarm_stats',
        'get_region_alarm_stats',
        'get_alarm_per_radar_per_day',
        'get_alarm_per_region_per_day'
      )
  loop
    execute format('drop function if exists %s', fn.signature);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 1) get_radar_alarm_stats — one row per radar, for the KPI card and the
--    "Alarms by Radar" chart.
--
-- Qualified throughout: RETURNS TABLE declares OUT parameters, and a bare
-- "radar_number" or "total_count" in the body would be ambiguous against them.
-- ---------------------------------------------------------------------------
create function public.get_radar_alarm_stats(
  p_start_date date,
  p_end_date   date,
  p_radars     bigint[],
  p_reasons    text[]
)
returns table (
  radar_number text,
  total_count  bigint,
  percentage   numeric
)
language sql
stable
security invoker
set search_path = public
as $function$
-- Each radar carries its own window, because each site keeps its own clock.
with radar_window as (
  select
    r.id           as radar_id,
    r.radar_number as radar_number,
    (p_start_date::timestamp     at time zone coalesce(c.timezone, 'UTC')) as win_start,
    ((p_end_date + 1)::timestamp at time zone coalesce(c.timezone, 'UTC')) as win_end
  from radars r
  join clients c on c.id = r.site_id
  where (p_radars is null or r.id = any(p_radars))
),
scoped as (
  select rw.radar_number, ar.id
  from radar_window rw
  join radar_wall_folders rwf on rwf.radar_id = rw.radar_id
  join alarm_regions arg      on arg.wallfolder = rwf.id
  join alarm_records ar       on ar.alarm_region = arg.id
  where ar.triggered_at >= rw.win_start
    and ar.triggered_at <  rw.win_end
    and (p_reasons is null or ar.reason = any(p_reasons))
)
select
  s.radar_number,
  count(s.id) as total_count,
  round((count(s.id) * 100.0 / nullif(sum(count(s.id)) over (), 0)), 2) as percentage
from scoped s
group by s.radar_number;
$function$;

-- ---------------------------------------------------------------------------
-- 2) get_reason_alarm_stats — one row per reason and cause, with the alarm
--    priority split, for the cause pie and the priority bars.
-- ---------------------------------------------------------------------------
create function public.get_reason_alarm_stats(
  p_start_date date,
  p_end_date   date,
  p_radars     bigint[],
  p_reasons    text[]
)
returns table (
  reason      text,
  cause       text,
  red         bigint,
  orange      bigint,
  yellow      bigint,
  purple      bigint,
  blue        bigint,
  total_count bigint,
  percentage  numeric
)
language sql
stable
security invoker
set search_path = public
as $function$
with radar_window as (
  select
    r.id as radar_id,
    (p_start_date::timestamp     at time zone coalesce(c.timezone, 'UTC')) as win_start,
    ((p_end_date + 1)::timestamp at time zone coalesce(c.timezone, 'UTC')) as win_end
  from radars r
  join clients c on c.id = r.site_id
  where (p_radars is null or r.id = any(p_radars))
),
scoped as (
  select ar.id, ar.reason, ar.cause, arg.alarmtype
  from radar_window rw
  join radar_wall_folders rwf on rwf.radar_id = rw.radar_id
  join alarm_regions arg      on arg.wallfolder = rwf.id
  join alarm_records ar       on ar.alarm_region = arg.id
  where ar.triggered_at >= rw.win_start
    and ar.triggered_at <  rw.win_end
    and (p_reasons is null or ar.reason = any(p_reasons))
)
select
  s.reason,
  s.cause,
  count(s.id) filter (where s.alarmtype = 'Red')    as red,
  count(s.id) filter (where s.alarmtype = 'Orange') as orange,
  count(s.id) filter (where s.alarmtype = 'Yellow') as yellow,
  count(s.id) filter (where s.alarmtype = 'Purple') as purple,
  count(s.id) filter (where s.alarmtype = 'Blue')   as blue,
  count(s.id) as total_count,
  round((count(s.id) * 100.0 / nullif(sum(count(s.id)) over (), 0)), 2) as percentage
from scoped s
group by s.reason, s.cause
order by count(s.id) desc;
$function$;

-- ---------------------------------------------------------------------------
-- 3) get_region_alarm_stats — one row per alarm region, for the region bars.
-- ---------------------------------------------------------------------------
create function public.get_region_alarm_stats(
  p_start_date date,
  p_end_date   date,
  p_radars     bigint[],
  p_reasons    text[]
)
returns table (
  name        text,
  total_count bigint,
  percentage  numeric
)
language sql
stable
security invoker
set search_path = public
as $function$
with radar_window as (
  select
    r.id as radar_id,
    (p_start_date::timestamp     at time zone coalesce(c.timezone, 'UTC')) as win_start,
    ((p_end_date + 1)::timestamp at time zone coalesce(c.timezone, 'UTC')) as win_end
  from radars r
  join clients c on c.id = r.site_id
  where (p_radars is null or r.id = any(p_radars))
),
scoped as (
  select arg.name as region_name, ar.id
  from radar_window rw
  join radar_wall_folders rwf on rwf.radar_id = rw.radar_id
  join alarm_regions arg      on arg.wallfolder = rwf.id
  join alarm_records ar       on ar.alarm_region = arg.id
  where ar.triggered_at >= rw.win_start
    and ar.triggered_at <  rw.win_end
    and (p_reasons is null or ar.reason = any(p_reasons))
)
select
  s.region_name as name,
  count(s.id) as total_count,
  round((count(s.id) * 100.0 / nullif(sum(count(s.id)) over (), 0)), 2) as percentage
from scoped s
group by s.region_name;
$function$;

-- ---------------------------------------------------------------------------
-- 4) get_alarm_per_radar_per_day — the per-radar line chart: one row per radar
--    per day it was in service, alarms counted on the site's calendar day.
-- ---------------------------------------------------------------------------
create function public.get_alarm_per_radar_per_day(
  p_start_date date,
  p_end_date   date,
  p_radars     bigint[],
  p_reasons    text[]
)
returns table (
  radar_number            text,
  alarm_date              date,
  daily_count             bigint,
  cumulative_count        bigint,
  awaiting_feedback_count bigint,
  modified_count          bigint,
  not_implemented_count   bigint
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
    coalesce(c.timezone, 'UTC') as timezone,
    min(rwf.commenced_at) as commissioned_at,
    -- A folder still live has no end; 'infinity' lets the grid do the clamping.
    max(coalesce(rwf.decommissioned_at, 'infinity'::timestamptz)) as decommissioned_at
  from radars r
  join clients c on c.id = r.site_id
  join radar_wall_folders rwf on rwf.radar_id = r.id
  where (p_radars is null or r.id = any(p_radars))
  group by r.id, r.radar_number, c.timezone
),
bounds as (
  select
    rl.radar_id,
    rl.radar_number,
    rl.timezone,
    (p_start_date::timestamp     at time zone rl.timezone) as win_start,
    ((p_end_date + 1)::timestamp at time zone rl.timezone) as win_end,
    -- The grid runs from the later of the filter start and the radar's first
    -- day in service...
    greatest(p_start_date, (rl.commissioned_at at time zone rl.timezone)::date) as first_day,
    -- ...to the earliest of the filter end, the radar's last day, and the
    -- site's today. A day that has not happened there yet is not drawn.
    least(
      p_end_date,
      (now() at time zone rl.timezone)::date,
      case
        when rl.decommissioned_at = 'infinity'::timestamptz then 'infinity'::date
        else (rl.decommissioned_at at time zone rl.timezone)::date
      end
    ) as last_day
  from radar_lifecycle rl
),
date_grid as (
  select
    b.radar_id,
    b.radar_number,
    g::date as event_date
  from bounds b
  cross join lateral generate_series(b.first_day, b.last_day, interval '1 day') g
),
actual_data as (
  select
    b.radar_id,
    (ar.triggered_at at time zone b.timezone)::date as event_date,
    count(ar.id) as daily_count
  from bounds b
  join radar_wall_folders rwf on rwf.radar_id = b.radar_id
  join alarm_regions arg      on arg.wallfolder = rwf.id
  join alarm_records ar       on ar.alarm_region = arg.id
  where ar.triggered_at >= b.win_start
    and ar.triggered_at <  b.win_end
    and (p_reasons is null or ar.reason = any(p_reasons))
  group by b.radar_id, (ar.triggered_at at time zone b.timezone)::date
),
improvement_data as (
  -- Recommendations are stamped with their own instant, so they are filed on
  -- the site's day too — otherwise a marker could sit on a different day from
  -- the alarm it belongs to.
  select
    b.radar_id,
    (ai.recommendation_submission at time zone b.timezone)::date as event_date,
    count(ai.id) filter (where ai.improvement_status = 'Awaiting Feedback') as awaiting_feedback_count,
    count(ai.id) filter (where ai.improvement_status = 'Modified')          as modified_count,
    count(ai.id) filter (where ai.improvement_status = 'Not Implemented')   as not_implemented_count
  from bounds b
  join radar_wall_folders rwf on rwf.radar_id = b.radar_id
  join alarm_regions arg      on arg.wallfolder = rwf.id
  join alarm_records ar       on ar.alarm_region = arg.id
  join alarm_improvement ai   on ai.alarm_record = ar.id
  where ai.recommendation_submission >= b.win_start
    and ai.recommendation_submission <  b.win_end
    and (p_reasons is null or ar.reason = any(p_reasons))
  group by b.radar_id, (ai.recommendation_submission at time zone b.timezone)::date
)
select
  dg.radar_number,
  dg.event_date as alarm_date,
  coalesce(ad.daily_count, 0) as daily_count,
  sum(coalesce(ad.daily_count, 0)) over (
    partition by dg.radar_number
    order by dg.event_date
    rows between unbounded preceding and current row
  )::bigint as cumulative_count,
  coalesce(imp.awaiting_feedback_count, 0) as awaiting_feedback_count,
  coalesce(imp.modified_count, 0)          as modified_count,
  coalesce(imp.not_implemented_count, 0)   as not_implemented_count
from date_grid dg
left join actual_data ad       on ad.radar_id  = dg.radar_id and ad.event_date  = dg.event_date
left join improvement_data imp on imp.radar_id = dg.radar_id and imp.event_date = dg.event_date
order by dg.radar_number, dg.event_date;
$function$;

-- ---------------------------------------------------------------------------
-- 5) get_alarm_per_region_per_day — the same, split by region name. Regions
--    are grouped by NAME across wall folders, as before, so an area keeps one
--    line through a folder changeover.
-- ---------------------------------------------------------------------------
create function public.get_alarm_per_region_per_day(
  p_start_date date,
  p_end_date   date,
  p_radars     bigint[],
  p_reasons    text[]
)
returns table (
  radar_number            text,
  region_name             text,
  alarm_date              date,
  daily_count             bigint,
  cumulative_count        bigint,
  awaiting_feedback_count bigint,
  modified_count          bigint,
  not_implemented_count   bigint
)
language sql
stable
security invoker
set search_path = public
as $function$
with region_lifecycle as (
  select
    arg.name       as region_name,
    r.id           as radar_id,
    r.radar_number as radar_number,
    coalesce(c.timezone, 'UTC') as timezone,
    min(rwf.commenced_at) as commissioned_at,
    max(coalesce(rwf.decommissioned_at, 'infinity'::timestamptz)) as decommissioned_at
  from alarm_regions arg
  join radar_wall_folders rwf on rwf.id = arg.wallfolder
  join radars r  on r.id = rwf.radar_id
  join clients c on c.id = r.site_id
  where (p_radars is null or r.id = any(p_radars))
  group by arg.name, r.id, r.radar_number, c.timezone
),
bounds as (
  select
    rl.region_name,
    rl.radar_id,
    rl.radar_number,
    rl.timezone,
    (p_start_date::timestamp     at time zone rl.timezone) as win_start,
    ((p_end_date + 1)::timestamp at time zone rl.timezone) as win_end,
    greatest(p_start_date, (rl.commissioned_at at time zone rl.timezone)::date) as first_day,
    least(
      p_end_date,
      (now() at time zone rl.timezone)::date,
      case
        when rl.decommissioned_at = 'infinity'::timestamptz then 'infinity'::date
        else (rl.decommissioned_at at time zone rl.timezone)::date
      end
    ) as last_day
  from region_lifecycle rl
),
date_grid as (
  select
    b.region_name,
    b.radar_id,
    b.radar_number,
    g::date as event_date
  from bounds b
  cross join lateral generate_series(b.first_day, b.last_day, interval '1 day') g
),
actual_data as (
  select
    arg.name as region_name,
    b.radar_id,
    (ar.triggered_at at time zone b.timezone)::date as event_date,
    count(ar.id) as daily_count
  from bounds b
  join radar_wall_folders rwf on rwf.radar_id = b.radar_id
  join alarm_regions arg      on arg.wallfolder = rwf.id and arg.name = b.region_name
  join alarm_records ar       on ar.alarm_region = arg.id
  where ar.triggered_at >= b.win_start
    and ar.triggered_at <  b.win_end
    and (p_reasons is null or ar.reason = any(p_reasons))
  group by arg.name, b.radar_id, (ar.triggered_at at time zone b.timezone)::date
),
improvement_data as (
  select
    arg.name as region_name,
    b.radar_id,
    (ai.recommendation_submission at time zone b.timezone)::date as event_date,
    count(ai.id) filter (where ai.improvement_status = 'Awaiting Feedback') as awaiting_feedback_count,
    count(ai.id) filter (where ai.improvement_status = 'Modified')          as modified_count,
    count(ai.id) filter (where ai.improvement_status = 'Not Implemented')   as not_implemented_count
  from bounds b
  join radar_wall_folders rwf on rwf.radar_id = b.radar_id
  join alarm_regions arg      on arg.wallfolder = rwf.id and arg.name = b.region_name
  join alarm_records ar       on ar.alarm_region = arg.id
  join alarm_improvement ai   on ai.alarm_record = ar.id
  where ai.recommendation_submission >= b.win_start
    and ai.recommendation_submission <  b.win_end
    and (p_reasons is null or ar.reason = any(p_reasons))
  group by arg.name, b.radar_id, (ai.recommendation_submission at time zone b.timezone)::date
)
select
  dg.radar_number,
  dg.region_name,
  dg.event_date as alarm_date,
  coalesce(ad.daily_count, 0) as daily_count,
  sum(coalesce(ad.daily_count, 0)) over (
    partition by dg.radar_number, dg.region_name
    order by dg.event_date
    rows between unbounded preceding and current row
  )::bigint as cumulative_count,
  coalesce(imp.awaiting_feedback_count, 0) as awaiting_feedback_count,
  coalesce(imp.modified_count, 0)          as modified_count,
  coalesce(imp.not_implemented_count, 0)   as not_implemented_count
from date_grid dg
left join actual_data ad
  on ad.radar_id = dg.radar_id and ad.region_name = dg.region_name and ad.event_date = dg.event_date
left join improvement_data imp
  on imp.radar_id = dg.radar_id and imp.region_name = dg.region_name and imp.event_date = dg.event_date
order by dg.radar_number, dg.region_name, dg.event_date;
$function$;
