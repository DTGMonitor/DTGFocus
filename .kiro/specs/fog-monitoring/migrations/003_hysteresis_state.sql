-- Migration 003: persist the pre-hysteresis verdict.
--
-- WHY THIS EXISTS
-- ---------------
-- The spec requires that a verdict not flip on a single reading: two
-- consecutive readings must agree before the published state changes.
--
-- The scoring function is pure and holds no state between calls, so the damping
-- has to be driven from stored values. Doing it against the previous RAW
-- verdict rather than a rolling counter keeps it a function of exactly two
-- columns, and keeps a re-score reproducible:
--
--     published(t) = raw(t)            if raw(t) == published(t-1)
--                  = raw(t)            if raw(t) == raw(t-1)      <- second agreeing reading
--                  = published(t-1)    otherwise                   <- held
--
-- Without raw_verdict the second line is unrecoverable and the poller would
-- have to re-derive the previous reading's score on every cycle.
--
-- Idempotent. Safe to run repeatedly.

ALTER TABLE fog_assessments
  ADD COLUMN IF NOT EXISTS raw_verdict text,
  -- True when the damping suppressed a proposed change on this cycle. Kept for
  -- calibration: a threshold that produces long runs of held verdicts is a
  -- threshold sitting on top of the data's noise floor, which is exactly what
  -- a recalibration needs to see.
  ADD COLUMN IF NOT EXISTS hysteresis_held boolean NOT NULL DEFAULT false,
  -- |Δp| over the radiative window, hPa. Scored as part of the radiative
  -- precondition but not otherwise recoverable from the stored breakdown.
  ADD COLUMN IF NOT EXISTS pressure_delta_hpa double precision;

-- Same value set as `verdict`. Applied as a separate named constraint so the
-- CHECK on `verdict` in migration 001 stays untouched.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fog_assessments_raw_verdict_check'
  ) THEN
    ALTER TABLE fog_assessments
      ADD CONSTRAINT fog_assessments_raw_verdict_check
      CHECK (raw_verdict IS NULL OR raw_verdict IN (
        'FOG', 'FOG_LIKELY', 'AMBIGUOUS', 'NOT_FOG', 'NO_FOG', 'INSUFFICIENT_HISTORY'
      ));
  END IF;
END;
$$;
