-- Migration 002: generalize site_report_schedules to support per-report-type
-- schedules with a cadence (adds the monthly InSAR bulletin reminder).
--
-- Before: PRIMARY KEY (site_id) — one daily schedule per site.
-- After:  PRIMARY KEY (site_id, report_type) — a schedule per (site, report type).
--         report_type: 'daily' | 'insar'   cadence: 'daily' | 'monthly'
--
-- Run this once in the Supabase SQL Editor. Existing rows become the site's
-- 'daily' schedule automatically via the column defaults.

ALTER TABLE site_report_schedules
  ADD COLUMN IF NOT EXISTS report_type text NOT NULL DEFAULT 'daily',
  ADD COLUMN IF NOT EXISTS cadence     text NOT NULL DEFAULT 'daily';

-- Repoint the primary key to (site_id, report_type) so a site can hold both a
-- daily and an InSAR schedule.
ALTER TABLE site_report_schedules
  DROP CONSTRAINT IF EXISTS site_report_schedules_pkey;

ALTER TABLE site_report_schedules
  ADD PRIMARY KEY (site_id, report_type);

-- The existing RLS policy ("Admins can manage schedules") continues to apply
-- unchanged. No data backfill is required — pre-existing rows default to
-- report_type = 'daily', cadence = 'daily'. InSAR schedules are created on
-- demand when an admin enables InSAR for a site in the dashboard.
