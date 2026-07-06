-- Migration 004: idempotent — brings site_report_schedules to the final
-- multi-report-type schema regardless of which earlier migrations were applied.
-- Safe to run repeatedly. Run this ONE script in the Supabase SQL Editor if you
-- hit "[ReportScheduler] Failed to load schedules" (a missing-column error).

-- 1) Ensure all columns exist.
ALTER TABLE site_report_schedules
  ADD COLUMN IF NOT EXISTS report_type text NOT NULL DEFAULT 'radar',
  ADD COLUMN IF NOT EXISTS cadence     text NOT NULL DEFAULT 'daily',
  ADD COLUMN IF NOT EXISTS weekday     integer;

-- 2) Default report_type going forward is 'radar'.
ALTER TABLE site_report_schedules ALTER COLUMN report_type SET DEFAULT 'radar';

-- 3) Rename any legacy 'daily' report_type rows to 'radar'.
UPDATE site_report_schedules SET report_type = 'radar' WHERE report_type = 'daily';

-- 4) Ensure the primary key is the composite (site_id, report_type).
DO $$
DECLARE
  pk_cols text;
  pk_name text;
BEGIN
  SELECT string_agg(a.attname, ',' ORDER BY array_position(c.conkey, a.attnum)),
         c.conname
    INTO pk_cols, pk_name
  FROM pg_constraint c
  JOIN pg_attribute a
    ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE c.conrelid = 'site_report_schedules'::regclass
    AND c.contype = 'p'
  GROUP BY c.conname;

  IF pk_cols IS DISTINCT FROM 'site_id,report_type' THEN
    IF pk_name IS NOT NULL THEN
      EXECUTE 'ALTER TABLE site_report_schedules DROP CONSTRAINT ' || quote_ident(pk_name);
    END IF;
    ALTER TABLE site_report_schedules ADD PRIMARY KEY (site_id, report_type);
  END IF;
END $$;
