-- 001_alarm_improvement_region.sql
--
-- Gives `alarm_improvement` its own region link.
--
-- WHY
--
-- A DQP alarm row (parameter 20 "Alarm Configuration", 21 "Alarm Mask") moving
-- to a non-optimal status raises a recommendation. Until now that
-- recommendation could only be raised against an alarm that had already fired:
-- the modal offered the region+cause pairs found in `alarm_records` over the
-- last 12 hours, and the row it wrote was pinned to one `alarm_records.id`.
--
-- That is the wrong order of work. An alarm configuration problem is most often
-- noticed BEFORE the alarm it would have produced — a region whose mask is
-- wrong is a region that has not alarmed and should have. Requiring an
-- alarm_records row first meant an analyst either could not file the
-- recommendation at all, or logged a fictitious alarm to unblock the form.
--
-- So the recommendation is now raised against the REGION, which is what it was
-- always really about: `alarm_improvement.alarm_record` becomes optional and
-- `alarm_improvement.alarm_region` carries the scope.
--
-- WHY A NEW COLUMN IS NOT OPTIONAL
--
-- `alarm_improvement` has no wall-folder column. Every reader in the app —
-- SensorDetail's "→ Optimal" gate, useOpenImprovements, the Comprehensive
-- report, the client-facing RadarDetail banner — reaches a wall folder by
-- joining alarm_records!inner → alarm_regions. A row written with a null
-- `alarm_record` and nothing else would be invisible to all four: raised, saved,
-- and never shown to anyone again. The column below is what keeps those
-- readers working once the record link is gone.
--
-- `alarm_record` is KEPT, not dropped. Rows written before this migration are
-- the historical record of which alarm a recommendation answered, the
-- Comprehensive report still prints `alarm_records.cause` from it where it is
-- present, and a future caller that does have a specific alarm in hand should
-- still be able to say so.

begin;

alter table public.alarm_improvement
  add column if not exists alarm_region bigint
    references public.alarm_regions (id);

comment on column public.alarm_improvement.alarm_region is
  'The alarm region this recommendation was raised against. The scope for every '
  'reader. Backfilled from alarm_record for rows predating the region-first DQP '
  'flow; populated directly by new rows, which may have no alarm_record at all.';

-- Backfill: every existing row reaches a region through the alarm it answers,
-- so no row loses its scope when the readers switch to the new column. Rows
-- whose alarm_record is already null (there should be none) stay null and are
-- simply not in scope for any region, exactly as they are today.
update public.alarm_improvement ai
   set alarm_region = ar.alarm_region
  from public.alarm_records ar
 where ai.alarm_record = ar.id
   and ai.alarm_region is null;

-- Every reader filters on this column, always as `in (region ids)`.
create index if not exists alarm_improvement_alarm_region_idx
  on public.alarm_improvement (alarm_region);

commit;

-- Verify (expect 0 rows carrying an alarm_record but no region):
--
--   select count(*) from alarm_improvement
--    where alarm_record is not null and alarm_region is null;
--
-- Revert:
--
--   begin;
--   drop index if exists alarm_improvement_alarm_region_idx;
--   alter table public.alarm_improvement drop column if exists alarm_region;
--   commit;
--
--   NOTE: reverting ORPHANS any recommendation raised after this migration
--   against a region that had not alarmed — those rows have no alarm_record to
--   fall back on and will disappear from every list. Export them first:
--     select * from alarm_improvement where alarm_record is null;
