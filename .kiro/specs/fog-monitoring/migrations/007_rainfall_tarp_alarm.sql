-- Migration 007: acknowledgements for the rainfall TARP alarm.
--
-- WHAT THIS IS FOR
-- ----------------
-- A rainfall total crossing the site's TARP threshold raises a blocking popup in
-- the admin Radar shell. Acknowledging it has to be DURABLE and SHARED, which
-- localStorage cannot be:
--
--   * localStorage is per browser. The night shift would be re-alarmed on the
--     same hour the day shift already actioned, and neither would know.
--   * The acknowledgement is a record of a TARP response. It belongs in the
--     work log, and the work log is in the database.
--
-- ONE ROW PER EVENT, AND WHAT AN EVENT IS
-- ---------------------------------------
-- An event is (site, kind, bucket_start) — "the hour beginning 15:00 at
-- Sorowako", "the local day beginning 30 September at Sorowako". The unique
-- constraint on those three columns is what makes acknowledging idempotent: the
-- popup recomputes breaches from the rainfall series on every refresh, so
-- without it a page reload would ask for the same signature again and file a
-- second work-log entry for one rainfall event.
--
-- `bucket_start` is a real instant, the same one the API returns. The local hour
-- and local day it names are resolved in the STATION's timezone (Asia/Singapore
-- for ASBSAR1), which is where the accumulator's midnight reset actually
-- happens. Nothing here re-derives that; it stores what it was given.
--
-- A DAILY EVENT IS SIGNED ONCE, NOT PER ESCALATION. The daily accumulator keeps
-- climbing after it passes the threshold, so an acknowledgement at 101 mm stands
-- for the day even if it finishes at 180 mm. That is a real limitation and it is
-- the right default here: Sorowako's TARP has exactly ONE rainfall band, so a
-- second popup at 180 mm would ask for the response the operator has already
-- given. A site whose TARP graded rainfall into several bands would need an
-- event per band, not per day.
--
-- Idempotent. Safe to run repeatedly in the Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- 1) The table.
--
-- `threshold_mm` and `measured_mm` are stored on the row rather than looked up
-- later, for the same reason fog_assessments stores the constants it scored
-- under: the TARP can be revised, and a past acknowledgement has to keep saying
-- what was actually signed for. Re-reading today's threshold would silently
-- rewrite history.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rainfall_tarp_acks (
  id               bigserial PRIMARY KEY,
  site_id          bigint      NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  kind             text        NOT NULL CHECK (kind IN ('hourly', 'daily')),
  bucket_start     timestamptz NOT NULL,

  -- What the TARP said, and what the gauge said, at the moment of signing.
  threshold_mm     numeric(6,2) NOT NULL,
  measured_mm      numeric(6,2) NOT NULL,
  tarp_level       integer,
  band_label       text,

  -- The work-log entry this acknowledgement filed. NOT NULL: the log IS the
  -- acknowledgement, and a row here without one would be a signature with no
  -- record behind it. acknowledge_rainfall_tarp() writes both in one
  -- transaction, so this constraint can never be the thing that fails.
  work_log_id      bigint      NOT NULL REFERENCES work_log (id) ON DELETE CASCADE,

  acknowledged_by  uuid        NOT NULL DEFAULT auth.uid(),
  acknowledged_at  timestamptz NOT NULL DEFAULT now(),

  -- The event identity. See the header.
  UNIQUE (site_id, kind, bucket_start)
);

-- The popup's only read: recent events for the bound sites.
CREATE INDEX IF NOT EXISTS rainfall_tarp_acks_recent
  ON rainfall_tarp_acks (site_id, bucket_start DESC);

-- ---------------------------------------------------------------------------
-- 2) RLS.
--
-- Readable by every authenticated user, because that is the point: the whole
-- reason this is not localStorage is that the next shift must see it.
--
-- Writable only as yourself. The INSERT policy pins acknowledged_by to
-- auth.uid(), so an acknowledgement cannot be filed under someone else's name.
-- There is no UPDATE or DELETE policy: a TARP acknowledgement is not editable,
-- and the absence of a policy is how that is said. (The service role bypasses
-- RLS and can still correct a bad row.)
-- ---------------------------------------------------------------------------
ALTER TABLE rainfall_tarp_acks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rainfall_tarp_acks_read ON rainfall_tarp_acks;
CREATE POLICY rainfall_tarp_acks_read ON rainfall_tarp_acks
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS rainfall_tarp_acks_insert_self ON rainfall_tarp_acks;
CREATE POLICY rainfall_tarp_acks_insert_self ON rainfall_tarp_acks
  FOR INSERT TO authenticated WITH CHECK (acknowledged_by = auth.uid());

-- ---------------------------------------------------------------------------
-- 3) Acknowledging, as one transaction.
--
-- WHY A FUNCTION AND NOT TWO CLIENT INSERTS
-- -----------------------------------------
-- Every other work_log write in this codebase is deliberately NON-BLOCKING:
-- "if the log fails, we still consider the import a success" (AddAlarmForm,
-- BatchAlarmImport, AddDeformationForm). That is right for those — the alarm
-- record is the deliverable and the log is a courtesy.
--
-- Here it is inverted. The log IS the deliverable: acknowledging a TARP trigger
-- is a response that has to be on the record, and an acknowledgement that
-- silenced the popup without filing one would be the bug. Two client-side
-- inserts cannot promise that — the second can fail after the operator has been
-- told they are done. A function body is one transaction, so either both rows
-- exist or neither does, and a failure leaves the popup up.
--
-- SECURITY INVOKER, not DEFINER: the caller's own RLS applies to both tables, and
-- this function grants no privilege nobody had. It buys atomicity and identity,
-- not access.
--
-- The WORDING is composed by the caller, not here. utils/rainfallTarp.ts builds
-- the notes from the TARP row's own text and picks the subject id through
-- config/formConfig's getWorkLogDetails — the same mapping every other work-log
-- entry goes through. Restating that mapping in SQL would be a second opinion
-- that could drift.
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

  IF p_kind NOT IN ('hourly', 'daily') THEN
    RAISE EXCEPTION 'unknown rainfall event kind: %', p_kind;
  END IF;

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
