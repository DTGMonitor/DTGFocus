-- Migration 003: rename the sensor report type to 'radar', add a weekday column
-- for weekly cadences, and make 'radar' the default report_type.
--
-- Context: report_type now names WHAT the report is (radar, insar, vwp, prism,
-- rainfall, custom…), while cadence names HOW OFTEN (daily | weekly | monthly).
-- The original sensor report was stored as report_type = 'daily', which
-- conflated the two — this renames it to 'radar'.
--
-- Run once in the Supabase SQL Editor. Safe to run after migration 002.

-- 1) Rename existing sensor rows from the old 'daily' report_type to 'radar'.
--    (No-op if 002's default already produced 'daily' rows, or none exist.)
UPDATE site_report_schedules
  SET report_type = 'radar'
  WHERE report_type = 'daily';

-- 2) Change the column default so future radar rows default correctly.
ALTER TABLE site_report_schedules
  ALTER COLUMN report_type SET DEFAULT 'radar';

-- 3) Weekly cadence support: the due weekday (0 = Sunday .. 6 = Saturday).
--    Null for daily/monthly.
ALTER TABLE site_report_schedules
  ADD COLUMN IF NOT EXISTS weekday integer;

-- The primary key stays (site_id, report_type) and the existing RLS policy
-- ("Admins can manage schedules") continues to apply. No backfill needed —
-- bulletin schedules (insar/vwp/…) are created on demand when an admin enables
-- a report type for a site in the dashboard.
