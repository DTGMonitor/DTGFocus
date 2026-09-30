-- Migration 018: the rainfall numbers a TARP row triggers on, as columns.
--
-- >>> THE HOURLY HALF OF THIS MIGRATION IS SUPERSEDED BY 019. <<<
-- It reads "Intensitas hujan per jam (hourly) >20 mm/jam" as 20 mm accumulated
-- within a clock hour, and section 2 below argues at length against using the
-- gauge's rate column. The site reads its own row the other way, and the site's
-- reading governs: 019 renames `rain_hourly_mm` to `rain_rate_mmh` and the alarm
-- thresholds the gauge's instantaneous rate. DO NOT take the reasoning below as
-- current — it is kept because this migration has been applied and the record of
-- what was done, and why it changed, is worth more than a tidy file. The value
-- (20) and the whole daily half are unaffected.
--
-- WHY COLUMNS AND NOT A PARSE OF THE DESCRIPTION
-- ----------------------------------------------
-- Sorowako's TARP already states its rainfall thresholds, in the row's own
-- printed wording:
--
--   "1. Intensitas hujan per jam (hourly) >20 mm/jam, atau
--    2. Intensitas hujan harian (daily) >100 mm/hari."
--
-- That string is what the chart prints and what the site signed, so it is
-- tempting to let the alarm read the numbers straight out of it. It is also
-- free text: a reworded row would silently stop alarming, and an alarm that
-- fails quietly when someone fixes a typo is worse than no alarm. The numbers
-- therefore get columns, and the description keeps printing.
--
-- THE COST OF THAT CHOICE, STATED PLAINLY: the two can now disagree. Nothing in
-- the database stops a description saying 20 mm/jam while the column says 25.
-- The popup mitigates it where it matters — it shows the threshold it fired on
-- AND quotes the row's description verbatim, side by side, so a drift is
-- visible to the operator at the moment they are asked to sign for it. If the
-- TARP tab ever gains editing for these fields, it should show them together
-- for the same reason.
--
-- NULL MEANS "THIS SITE HAS NO RAINFALL THRESHOLD", and that is the default for
-- every other site. Telfer (migration 009) and Hidden Valley (013) both carry a
-- 'Rainfall Event' row, but theirs is about SLOPE DISPLACEMENT following rain —
-- a back-analysis trigger with no rain gauge behind it. Neither site has a bound
-- weather station, and giving them a number here would invent a threshold
-- nobody agreed to. They keep nulls and never alarm.
--
-- Idempotent. Safe to run repeatedly in the Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- 1) The columns.
--
-- Thresholds are EXCLUSIVE: the TARP says ">20", so 20.0 mm in an hour is not
-- a trigger and 20.1 is. utils/rainfallTarp.ts compares the same way, and the
-- two must not drift.
--
-- Both are millimetres. The hourly one is an hourly TOTAL, not the station's
-- instantaneous "Rain Rate" — see the note on section 2.
-- ---------------------------------------------------------------------------
ALTER TABLE tarp_triggers
  ADD COLUMN IF NOT EXISTS rain_hourly_mm numeric(6,2),
  ADD COLUMN IF NOT EXISTS rain_daily_mm  numeric(6,2);

COMMENT ON COLUMN tarp_triggers.rain_hourly_mm IS
  'Hourly rainfall TOTAL (mm) above which this row triggers, exclusive. The '
  'hourly accumulation from weather_rain_hourly, NOT the station''s '
  'instantaneous rain rate. Null = this site alarms on no hourly threshold.';

COMMENT ON COLUMN tarp_triggers.rain_daily_mm IS
  'Daily rainfall total (mm) above which this row triggers, exclusive. The '
  'station''s own calendar-day accumulator, via weather_rain_daily. Null = '
  'this site alarms on no daily threshold.';

-- ---------------------------------------------------------------------------
-- 2) Sorowako (PTVI).
--
-- 20 mm/jam and 100 mm/hari, copied from the row's own description rather than
-- chosen here. Both are ACCUMULATIONS over a window, which is what "intensitas
-- hujan per jam" means and what the site's own rain records report.
--
-- The hourly figure is deliberately matched to weather_rain_hourly (deltas of
-- the daily accumulator, coverage-gated) and NOT to `rain_rate_mmh`. The
-- station's rate column is an instantaneous reading: a two-minute cloudburst
-- reports 60 mm/h and would fire this trigger on roughly 2 mm of rain. See the
-- header of migration 002 in the fog-monitoring spec — summing or thresholding
-- that column is the single easiest way to make rainfall wrong.
--
-- Matched on def_type, not on sort order or wording: this is the row the engine
-- already keys rainfall records off, so an alarm and an email quote the same
-- band by construction.
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
     SET rain_hourly_mm = 20,
         rain_daily_mm  = 100
   WHERE document_id = v_doc_id
     AND def_type = 'Rainfall Event';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    -- Deliberately NOT inserted. A rainfall row is a band the site signed for,
    -- and inventing one here would put a threshold on a chart nobody approved.
    RAISE NOTICE
      'Sorowako has no ''Rainfall Event'' row on document % — thresholds not set. '
      'Add the row from the TARP tab first, then re-run.', v_doc_id;
  ELSE
    RAISE NOTICE
      'Sorowako rainfall thresholds set on document %: >20 mm/jam, >100 mm/hari.',
      v_doc_id;
  END IF;
END $$;
