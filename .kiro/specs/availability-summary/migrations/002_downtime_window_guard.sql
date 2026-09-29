-- Migration 002: a downtime record cannot end before it begins.
--
-- WHY
-- ---
-- Eight records in this table have `to` earlier than `from`. They come from the
-- close-and-reopen flows: when a sensor switches from one failure to another,
-- the open record is closed with the NEW record's start time (SensorDetail's
-- "Scenario 1", SiteWideStatusModal's `plan.closeIds`). Type a start earlier
-- than the open record's own start — or mis-type its date — and the older
-- record silently becomes reversed. Nothing in the UI objected, and nothing in
-- the availability figures showed it: the RPCs drop such a record, so the
-- outage it describes disappears from the numbers entirely.
--
-- The application now refuses these writes (utils/downtimeWindow.ts, wired into
-- all three flows). This constraint is the backstop for anything that writes to
-- the table without going through them — the SQL editor, a script, a future
-- flow that forgets.
--
-- NOT VALID, DELIBERATELY
-- -----------------------
-- Existing rows are NOT checked. Six historical reversed records remain in the
-- table (ids 6, 163, 292, 312, 329, 357 — Telfer, IBP and BIB, Aug 2025 to
-- May 2026) and are being reviewed against site records rather than guessed at.
-- A validating constraint would refuse to be created at all while they exist.
-- NOT VALID still enforces the rule on every INSERT and UPDATE from here on,
-- which is the point.
--
-- Once those six are corrected, run:
--
--     alter table public.downtime_records
--       validate constraint downtime_records_window_not_reversed;
--
-- which re-checks the existing rows and, from then on, lets the planner trust
-- the constraint.
--
-- Idempotent. Safe to run repeatedly.

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'downtime_records_window_not_reversed'
      and conrelid = 'public.downtime_records'::regclass
  ) then
    alter table public.downtime_records
      add constraint downtime_records_window_not_reversed
      -- An open record (`to` is null) is fine: it has not ended yet.
      check ("to" is null or "to" >= "from")
      not valid;
  end if;
end $$;
