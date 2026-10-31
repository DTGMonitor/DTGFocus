-- Migration 009: acknowledge_rainfall_tarp() still spoke the 'hourly' language.
--
-- Migration 008 renamed the rate event's kind from 'hourly' to 'rate' and moved
-- the CHECK constraint on `rainfall_tarp_acks.kind` with it. It did not move the
-- SAME LIST inside acknowledge_rainfall_tarp(), which 007 had written as a guard
-- clause in the function body. So the table accepted 'rate' and the only way to
-- write to the table refused it:
--
--     ERROR: unknown rainfall event kind: rate
--
-- Every rate acknowledgement at Sorowako failed on that line, and because the
-- function is the whole transaction, the popup correctly stayed up and no
-- work-log entry was filed. The alarm was not broken; signing for it was.
--
-- WHY THE GUARD IS GONE RATHER THAN CORRECTED
-- -------------------------------------------
-- The duplicate list is the defect, not the stale half of it. `kind` already has
-- a CHECK constraint, the INSERT below is inside this function, and the
-- constraint is what 008 maintains — so a bad kind is rejected either way, by the
-- table that defines the vocabulary. Restating the list here bought one thing: a
-- prettier message. It cost a second place to update, and that is exactly how it
-- failed. The constraint violation names the constraint and the value, which is
-- enough to find this file.
--
-- Nothing else about the function changes: same signature, same two inserts, same
-- SECURITY INVOKER, same already-acknowledged path. See 007 for why all of those
-- are the way they are.
--
-- Idempotent. Safe to run repeatedly in the Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- 1) The constraint, re-asserted.
--
-- 008 did this and this repeats it, deliberately: an instance that has 008 is
-- unchanged, and an instance that somehow does not gets the vocabulary the
-- function below assumes. Running 009 alone must leave a working system, because
-- whoever hits the error above will reach for the newest file.
--
-- The legacy-row guard is 008's, for 008's reason: an 'hourly' row was keyed on a
-- clock hour and a 'rate' row on a crossing instant, so they are different events
-- under one name and must not be relabelled behind somebody's back.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_legacy bigint;
BEGIN
  SELECT count(*) INTO v_legacy
    FROM rainfall_tarp_acks
   WHERE kind NOT IN ('rate', 'daily');

  IF v_legacy > 0 THEN
    RAISE EXCEPTION
      'rainfall_tarp_acks holds % row(s) with the legacy kind. These are hour '
      'buckets, not crossings, and cannot be relabelled automatically. Decide '
      'what to do with them (their work_log entries stand either way), then '
      're-run.', v_legacy;
  END IF;

  ALTER TABLE rainfall_tarp_acks DROP CONSTRAINT IF EXISTS rainfall_tarp_acks_kind_check;
  ALTER TABLE rainfall_tarp_acks
    ADD CONSTRAINT rainfall_tarp_acks_kind_check CHECK (kind IN ('rate', 'daily'));
END $$;

-- ---------------------------------------------------------------------------
-- 2) The function, without the duplicated vocabulary.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION acknowledge_rainfall_tarp(
  p_site_id      bigint,
  p_kind         text,
  p_bucket_start timestamptz,
  p_threshold_mm numeric,
  p_measured_mm  numeric,
  p_tarp_level   integer,
  p_band_label   text,
  p_subject_id   integer,
  p_location     text,
  p_action       text,
  p_notes        text
)
RETURNS TABLE (ack_id bigint, work_log_id bigint, already_acknowledged boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_ack bigint;
  v_log bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'acknowledge_rainfall_tarp requires a signed-in user';
  END IF;

  -- `p_kind` is validated by rainfall_tarp_acks_kind_check on the INSERT below,
  -- which is the one place the vocabulary is written down. See the header.

  -- Already signed — by this operator on another tab, or by the other shift.
  -- Returned as a success carrying `already_acknowledged`, so the popup closes
  -- instead of showing an error for something that is in fact done. No second
  -- work-log entry: one rainfall event, one record.
  SELECT a.id, a.work_log_id INTO v_ack, v_log
    FROM rainfall_tarp_acks a
   WHERE a.site_id = p_site_id
     AND a.kind = p_kind
     AND a.bucket_start = p_bucket_start;

  IF FOUND THEN
    RETURN QUERY SELECT v_ack, v_log, true;
    RETURN;
  END IF;

  INSERT INTO work_log
    (created_at, subject, wallfolder, location, category, action, notes, type, submitted_by)
  VALUES
    (now(), p_subject_id,
     -- Rainfall is a site-wide condition, not something that happened to one
     -- wall folder. Left null rather than pinned to whichever folder happened
     -- to be open.
     NULL,
     p_location, 'rainfall', p_action, p_notes, 'radar', auth.uid())
  RETURNING id INTO v_log;

  -- A concurrent acknowledgement of the SAME event raises unique_violation here
  -- and rolls the work_log insert back with it. The client treats that as
  -- "already acknowledged" and refetches.
  INSERT INTO rainfall_tarp_acks
    (site_id, kind, bucket_start, threshold_mm, measured_mm, tarp_level,
     band_label, work_log_id, acknowledged_by)
  VALUES
    (p_site_id, p_kind, p_bucket_start, p_threshold_mm, p_measured_mm,
     p_tarp_level, p_band_label, v_log, auth.uid())
  RETURNING id INTO v_ack;

  RETURN QUERY SELECT v_ack, v_log, false;
END;
$fn$;

REVOKE ALL ON FUNCTION acknowledge_rainfall_tarp(
  bigint, text, timestamptz, numeric, numeric, integer, text, integer, text, text, text
) FROM public, anon;

GRANT EXECUTE ON FUNCTION acknowledge_rainfall_tarp(
  bigint, text, timestamptz, numeric, numeric, integer, text, integer, text, text, text
) TO authenticated;
