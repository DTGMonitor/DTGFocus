-- Migration 019: the hourly rainfall threshold is the gauge's RATE, not an
-- hourly accumulation.
--
-- Supersedes the hourly half of migration 018, which read
-- "Intensitas hujan per jam (hourly) >20 mm/jam" as 20 mm accumulated within a
-- clock hour and thresholded weather_rain_hourly accordingly. The site reads it
-- as the gauge's own rain rate, and the site's reading governs: this is their
-- TARP, and the number means what they use it to mean. The column is renamed so
-- it stops claiming otherwise.
--
-- The NUMBER does not change. 20 mm/jam is 20 mm/jam; what changed is which
-- series it is compared against.
--
-- WHAT THIS MAKES THE ALARM MORE SENSITIVE TO, stated so nobody has to rediscover
-- it from a false alarm: `rain_rate_mmh` is INSTANTANEOUS. A two-minute cloudburst
-- reports 60 mm/h and fires this trigger on roughly 2 mm of actual rain. That is
-- the intended behaviour now — a burst that intense is worth a look at a wet
-- slope even when little falls in total — but it does mean the trigger says
-- "it is raining hard right now", not "a lot of rain has fallen". The daily
-- threshold is what answers the second question.
--
-- To keep that from becoming a popup per reading, the ALARM WINDOW is still the
-- clock hour: the peak rate within an hour raises ONE event, signed once. See
-- utils/rainfallTarp.ts and the fog spec's migration 008.
--
-- Idempotent. Safe to run repeatedly in the Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- 1) Rename, if 018 has been applied and 019 has not.
--
-- Guarded on the catalog rather than written as a plain ALTER, so this is
-- runnable whatever order the two migrations reached the database in — including
-- on an instance where 018 never ran and the column has to be created outright.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'tarp_triggers'
       AND column_name = 'rain_hourly_mm'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'tarp_triggers'
       AND column_name = 'rain_rate_mmh'
  ) THEN
    ALTER TABLE tarp_triggers RENAME COLUMN rain_hourly_mm TO rain_rate_mmh;
    RAISE NOTICE 'tarp_triggers.rain_hourly_mm renamed to rain_rate_mmh.';
  END IF;
END $$;

ALTER TABLE tarp_triggers
  ADD COLUMN IF NOT EXISTS rain_rate_mmh numeric(6,2),
  ADD COLUMN IF NOT EXISTS rain_daily_mm numeric(6,2);

COMMENT ON COLUMN tarp_triggers.rain_rate_mmh IS
  'Instantaneous rain RATE (mm/h) above which this row triggers, exclusive. '
  'Compared against weather_readings.rain_rate_mmh — the gauge''s own rate '
  'column, the vendor''s "Rain Rate" — and NOT against an hourly accumulation. '
  'The peak rate within a clock hour raises one event. Null = this site alarms '
  'on no rate threshold.';

COMMENT ON COLUMN tarp_triggers.rain_daily_mm IS
  'Daily rainfall total (mm) above which this row triggers, exclusive. The '
  'station''s own calendar-day accumulator, via weather_rain_daily. Null = '
  'this site alarms on no daily threshold.';

-- ---------------------------------------------------------------------------
-- 2) Sorowako (PTVI), unchanged in value.
--
-- Re-stated rather than assumed: on an instance where 018 ran, this is a no-op,
-- and on one where it did not, this migration stands alone.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_doc_id  bigint;
  v_updated integer;
BEGIN
  SELECT d.id INTO v_doc_id
    FROM tarp_documents d
    JOIN clients c ON c.id = d.site_id
   WHERE c.site_name ILIKE '%sorowako%' AND d.status = 'active'
   LIMIT 1;

  IF v_doc_id IS NULL THEN
    RAISE NOTICE 'Sorowako rainfall thresholds skipped: no active TARP document.';
    RETURN;
  END IF;

  UPDATE tarp_triggers
     SET rain_rate_mmh = 20,
         rain_daily_mm = 100
   WHERE document_id = v_doc_id
     AND def_type = 'Rainfall Event';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RAISE NOTICE
      'Sorowako has no ''Rainfall Event'' row on document % — thresholds not set.',
      v_doc_id;
  ELSE
    RAISE NOTICE
      'Sorowako rainfall thresholds set on document %: rate >20 mm/jam, daily >100 mm/hari.',
      v_doc_id;
  END IF;
END $$;
