-- Migration 003: get_longest_downtime, the last of the availability RPCs.
--
-- Completes migration 001, which captured the other two. Same treatment: the
-- window is read on the site's clock, the end date is inclusive but never runs
-- into the future, reversed records are rejected, and overlapping records are
-- merged before anything is measured.
--
-- Idempotent. Safe to run repeatedly.
--
-- WHAT CHANGED FROM THE DASHBOARD VERSION
-- ---------------------------------------
-- 1. AN OUTAGE THAT CROSSES THE WINDOW EDGE IS NO LONGER INVISIBLE.
--    The old filter was `dr."from"::date >= start_date AND dr."to"::date <=
--    end_date` — the record had to fit ENTIRELY inside the window. The longest
--    outage in a period is precisely the one most likely to start before it or
--    end after it, so the card was structurally biased against its own answer:
--    ask for August and a 12-day outage running 28 Jul to 9 Aug is not a
--    candidate at all, while a 30-hour one inside the month wins. Records are
--    now clipped to the window and judged on the part that falls inside it.
--
-- 2. AN ONGOING OUTAGE CAN NOW WIN.
--    `dr."to"::date <= end_date` is NULL — and therefore false — for a record
--    that has not been closed, so a link that has been down for a week could
--    never be the longest. An open record now runs to the end of the window,
--    exactly as it does in the other two functions.
--
-- 3. THE WINDOW IS THE SITE'S CALENDAR, NOT THE SERVER'S.
--    `dr."from"::date` casts a timestamptz to a date on the SERVER's clock.
--    For Hidden Valley (UTC+10) that put the boundary at 10:00 site-local.
--    Both bounds are now built in the site's own timezone, and the end date is
--    included (clamped to now(), since an outage cannot run into the future).
--
-- 4. IT IS THE LONGEST OUTAGE, NOT THE LONGEST ROW.
--    Overlapping records of the same reason are merged first, as in migration
--    001. Two rows describing one outage — the usual wall-folder changeover —
--    each looked shorter than the outage really was, and consecutive rows of
--    the same reason were never considered together at all. What is returned
--    now is the longest CONTINUOUS stretch of one kind of downtime, which is
--    also what the summary counts those hours as.
--
--    Consequence worth knowing: the answer can span several records, so the
--    times shown are the island's, not any single row's. To go back to
--    per-record behaviour, drop the `ordered`/`islanded`/`merged` CTEs and
--    select straight from `valid`.
--
-- 5. REVERSED RECORDS ARE REJECTED.
--    A record with `to` < `from` produced a negative interval. `ORDER BY ...
--    DESC` sorted it harmlessly last, so this one was latent rather than
--    wrong — but it is now rejected at the join with the others.
--
-- WHAT DID NOT CHANGE
-- -------------------
-- The signature, the output columns and their names and order, the
-- `user_sites` gate, SECURITY INVOKER, and the `YYYY-MM-DD HH:MM:SS` shape of
-- the two local-time strings the card prints. The page needs no change.

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_longest_downtime'
  loop
    execute format('drop function if exists %s', fn.signature);
  end loop;
end $$;

create function public.get_longest_downtime(
  start_date date,
  end_date   date,
  radar_ids  bigint[]
)
returns table (
  radar_number        text,
  reason              text,
  duration_hours      double precision,
  downtime_from_local text,
  downtime_to_local   text
)
language sql
stable
security invoker
set search_path = public
as $function$
-- Qualified throughout: RETURNS TABLE declares OUT parameters, and a bare
-- "reason" or "radar_number" in the body would be ambiguous against them.
with radar_lifecycle as (
  select
    r.id           as radar_id,
    r.radar_number as radar_number,
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
  group by r.id, r.radar_number, c.timezone
),

windowed as (
  select
    rl.*,
    (start_date::timestamp at time zone rl.timezone) as win_start,
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
    i.radar_number,
    i.timezone,
    i.reason,
    i.island_id,
    min(i.dt_from) as dt_from,
    max(i.dt_to)   as dt_to
  from islanded i
  group by i.radar_number, i.timezone, i.reason, i.island_id
)

select
  m.radar_number,
  m.reason,
  (extract(epoch from (m.dt_to - m.dt_from)) / 3600.0)::double precision as duration_hours,
  to_char(m.dt_from at time zone m.timezone, 'YYYY-MM-DD HH24:MI:SS')    as downtime_from_local,
  to_char(m.dt_to   at time zone m.timezone, 'YYYY-MM-DD HH24:MI:SS')    as downtime_to_local
from merged m
order by (m.dt_to - m.dt_from) desc, m.radar_number, m.reason
limit 1;
$function$;
