-- Migration 008: the rate event is a CROSSING, not an hour.
--
-- Migration 007 created `rainfall_tarp_acks` with kind IN ('hourly', 'daily'),
-- when the hourly trigger was an accumulation inside a clock hour. Two things
-- have changed since, and this migration lands both:
--
--   1. The hourly threshold is the gauge's instantaneous RATE — see the
--      scalable-tarp spec's migration 019, which renames the column to
--      `rain_rate_mmh`.
--   2. The alarm is EDGE-TRIGGERED. An event is one CROSSING of that threshold:
--      it opens when the rate first rises past it and closes when the rate is
--      seen at or below it again. The clock hour has nothing to do with it.
--
-- So `kind` becomes ('rate', 'daily') and `bucket_start` carries, for a rate
-- event, THE INSTANT THE THRESHOLD WAS CROSSED. That instant is the event's
-- identity, and the unique constraint on (site_id, kind, bucket_start) is what
-- makes the rule hold across refreshes and across shifts:
--
--     rate:  0   10   20   21   22   24   19   21   30   40   0
--                         ^onset A --------^     ^onset B ----^
--
--   The crossing at 21 opens episode A and raises one alarm. 22 and 24 are the
--   same episode — same onset, same key, already signed, silent. 19 closes it.
--   The next 21 is a NEW crossing with a NEW onset, so a new key and a new
--   alarm. 30 and 40 are silent again. Two signatures from that sequence, not
--   nine, and the peak climbing from 21 to 40 never reopens what was signed.
--
-- This replaces the limitation 007 documented for the hourly case ("an hour
-- signed at a 21 mm/h peak stays signed if it later peaks at 60"). It is no
-- longer a limitation but the specified behaviour: the site is told once per
-- episode of heavy rain, and the escalation within an episode is one response,
-- not several. The DAILY note in 007 still stands as written — the accumulator
-- only climbs, so a day crosses once and cannot fall back through.
--
-- SAFE TO CHANGE THE CHECK because no acknowledgement has ever been written:
-- verified zero rows in rainfall_tarp_acks and zero work_log rows under category
-- 'rainfall' before this was authored. The DO block below refuses to run if that
-- is somehow untrue on the instance it meets, rather than silently orphaning
-- rows whose kind no longer passes the constraint.
--
-- Idempotent. Safe to run repeatedly in the Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- 1) kind: 'hourly' -> 'rate'.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_legacy bigint;
BEGIN
  SELECT count(*) INTO v_legacy
    FROM rainfall_tarp_acks
   WHERE kind NOT IN ('rate', 'daily');

  IF v_legacy > 0 THEN
    -- Deliberately fatal. An 'hourly' row was keyed on the start of a clock hour
    -- and a 'rate' row is keyed on a crossing instant, so they are not the same
    -- event under a different name and cannot be relabelled. Whoever meets this
    -- has real acknowledgements to decide about, and quietly rewriting or
    -- dropping them would destroy a TARP response record.
    RAISE EXCEPTION
      'rainfall_tarp_acks holds % row(s) with the legacy kind. These are hour '
      'buckets, not crossings, and cannot be relabelled automatically. Decide '
      'what to do with them (their work_log entries stand either way), then '
      're-run.', v_legacy;
  END IF;

  ALTER TABLE rainfall_tarp_acks DROP CONSTRAINT IF EXISTS rainfall_tarp_acks_kind_check;
  ALTER TABLE rainfall_tarp_acks
    ADD CONSTRAINT rainfall_tarp_acks_kind_check CHECK (kind IN ('rate', 'daily'));

  RAISE NOTICE 'rainfall_tarp_acks.kind now accepts (rate, daily).';
END $$;

-- ---------------------------------------------------------------------------
-- 2) What the columns hold.
--
-- `measured_mm` and `threshold_mm` carry two different QUANTITIES depending on
-- the row's `kind`:
--
--   kind = 'rate'   ->  mm/h. The PEAK rate reached during the crossing episode.
--   kind = 'daily'  ->  mm.   The day's accumulated total.
--
-- Overloading a column by a sibling column's value is not a shape to be proud
-- of. It is kept because the alternative — splitting into measured_mmh and
-- measured_mm, one of which is always null — trades one thing to remember for a
-- NOT NULL constraint nobody can express. What it costs is that a reader cannot
-- tell the unit from the column, so the unit is written down here instead of
-- being inferred.
-- ---------------------------------------------------------------------------
COMMENT ON TABLE rainfall_tarp_acks IS
  'One row per acknowledged rainfall TARP event. An event is '
  '(site_id, kind, bucket_start): for ''rate'', one CROSSING episode of the '
  'site''s rain-rate threshold, identified by the instant it crossed; for '
  '''daily'', the station''s local day whose accumulated total passed the daily '
  'threshold. Edge-triggered — a rate staying above, or climbing, does not '
  'produce a second event. Every row points at the work_log entry it filed: '
  'acknowledge_rainfall_tarp() writes both or neither.';

COMMENT ON COLUMN rainfall_tarp_acks.kind IS
  'Which threshold fired, and therefore which unit measured_mm and threshold_mm '
  'are in: ''rate'' = mm/h (peak of a crossing episode), ''daily'' = mm '
  '(accumulated day total).';

COMMENT ON COLUMN rainfall_tarp_acks.bucket_start IS
  'The event''s identity as an instant. For kind=''rate'', THE MOMENT THE RATE '
  'CROSSED the threshold from below — the onset reading, not an hour boundary. '
  'For kind=''daily'', the start of the station''s local day (Asia/Singapore for '
  'ASBSAR1, where the accumulator''s midnight reset happens). Stored as given, '
  'never re-derived here.';

COMMENT ON COLUMN rainfall_tarp_acks.measured_mm IS
  'What the gauge read at its worst during the event. mm/h for kind=''rate'' '
  '(the episode peak, which may be higher than the reading that crossed), mm for '
  'kind=''daily''. Stored rather than re-derived so a past acknowledgement keeps '
  'saying what was actually signed for after the readings are pruned at 90 days.';

COMMENT ON COLUMN rainfall_tarp_acks.threshold_mm IS
  'The site TARP threshold this event crossed, in the same unit as measured_mm. '
  'Stored rather than looked up later: the TARP can be revised, and re-reading '
  'today''s threshold would silently rewrite history.';
