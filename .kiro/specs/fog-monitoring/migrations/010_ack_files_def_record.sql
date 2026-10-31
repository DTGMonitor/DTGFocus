-- Migration 010: acknowledging a rainfall trigger files the Rainfall Event
-- record too, at the site's own TARP level.
--
-- WHAT WAS MISSING
-- ----------------
-- Acknowledging wrote a work_log entry and nothing else. The work log is where a
-- shift's ACTIONS are recorded; `def_records` is where the site's REPORTABLE
-- EVENTS live — it is what the deformation boards, the failure history, the
-- daily report and the risk ranking all read. A rainfall event that passed the
-- site's TARP threshold is a reportable event, so an acknowledgement that filed
-- only a work-log entry left the event out of every report that matters.
--
-- Operators were papering over it by hand: def_records id 1283 was typed in at
-- 12:30 UTC on 2026-10-31 with `start` set to 11:59 — the exact instant the
-- gauge read 20.4 mm/h, the crossing the popup was alarming on. Two people
-- entering the same event twice is the shape of a missing write.
--
-- AND IT CAME OUT BLANK. That hand-typed record carries tarp_level '' rather
-- than 'TARP 2'. Sorowako's document sets tarp_level_source = 'alarm', so
-- config/tarpPolicy.ts asks the fired ALARM's colour for the level, and a
-- rainfall event has no alarm — see section 3, because that is a separate defect
-- in the deformation form and this migration does not fix it. What it does do is
-- put the level beyond doubt HERE: the label is passed in from the rainfall row
-- that actually fired, the row whose own tarp_level is 2.
--
-- WHY IN THIS FUNCTION AND NOT A SECOND CLIENT INSERT
-- ---------------------------------------------------
-- The same reason 007 gives for the work log, and it now covers three things:
-- the acknowledgement, the work-log entry and the event records either all exist
-- or none do. A client that inserted the records separately could silence the
-- popup and then fail, leaving an acknowledged event with no record of it — and
-- the popup would not come back, because the ack row is what suppresses it.
--
-- ONE RECORD PER WALL FOLDER, AND WHICH FOLDERS
-- ---------------------------------------------
-- `def_records` is only ever read by `wallfolder_id` — every board, tab and
-- report filters on it — so a record with a null folder is a record nobody can
-- see. Rainfall is not a folder-shaped event, though: it falls on the whole
-- site. So one record is filed per wall folder the site is still monitoring.
--
-- "Still monitoring" is read from DURABLE fields: the folder is not
-- decommissioned, the radar is not decommissioned, and the folder is not an
-- Archive. It is deliberately NOT read from `radar_wall_folders.type`, which
-- looks like a classification and is in fact the folder's live connection state
-- — 'Live', 'Link Down', 'Lost Connection', 'Archive' — flipping minute to
-- minute as comms come and go. Folder 96 at Sorowako read 'Live' and then 'Lost
-- Connection' within minutes of each other while this was being written. Filing
-- only against 'Live' folders would mean filing nothing during a comms outage,
-- and comms outages correlate with heavy rain (wet radome, refractivity) — the
-- alarm would go quietest exactly when it had the most to say.
--
-- An ARCHIVE folder is excluded because it is a closed book: records are kept
-- there, not added. A site with no eligible folder files no record, and the
-- function says so in `def_record_count` rather than failing — the work-log
-- entry still stands, and a site monitored through no folder at all is a
-- configuration to fix, not an acknowledgement to refuse.
--
-- Idempotent. Safe to run repeatedly in the Supabase SQL Editor.
-- REQUIRES 009 (or at least its CHECK constraint) to have been applied.

-- ---------------------------------------------------------------------------
-- 1) What the acknowledgement filed.
--
-- An array rather than a join table: the ack row is already exactly one row per
-- event, so the only thing a join table would buy is a foreign key — and the
-- cost of not having one is stated here rather than enforced. If somebody
-- deletes a def_record by hand, the id left behind points at nothing. That is
-- tolerable because this column is a RECEIPT, read to answer "what did signing
-- this actually write", and never joined back to drive behaviour.
-- ---------------------------------------------------------------------------
ALTER TABLE rainfall_tarp_acks
  ADD COLUMN IF NOT EXISTS def_record_ids bigint[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN rainfall_tarp_acks.def_record_ids IS
  'The def_records rows this acknowledgement filed — one per monitored wall '
  'folder at the site. A receipt, not a foreign key: nothing joins back through '
  'it, and an id here may point at a record since deleted by hand. Empty means '
  'the site had no eligible folder when it was signed.';

-- ---------------------------------------------------------------------------
-- 2) The function.
--
-- DROPPED rather than replaced: the return type gains a column, and
-- CREATE OR REPLACE cannot change a function's return type. Dropping also
-- removes the 11-argument signature, which matters — adding parameters would
-- otherwise leave TWO overloads live, and PostgREST would resolve a call by
-- whichever argument names it was handed. Exactly one of these exists at a time.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS acknowledge_rainfall_tarp(
  bigint, text, timestamptz, numeric, numeric, integer, text, integer, text, text, text
);

CREATE OR REPLACE FUNCTION acknowledge_rainfall_tarp(
  p_site_id         bigint,
  p_kind            text,
  p_bucket_start    timestamptz,
  p_threshold_mm    numeric,
  p_measured_mm     numeric,
  p_tarp_level      integer,
  p_band_label      text,
  p_subject_id      integer,
  p_location        text,
  p_action          text,
  p_notes           text,
  -- "TARP 2". `def_records.tarp_level` is TEXT and holds the label, not the
  -- number, so the label is composed by the caller through the same
  -- tarpLevelLabel() every deformation record goes through. Deriving
  -- 'TARP ' || p_tarp_level here would be a second implementation of it.
  p_tarp_label      text DEFAULT NULL,
  -- `def_records.location` is free text the engineer types. Rainfall covers the
  -- whole folder, so there is nothing to narrow it to.
  p_record_location text DEFAULT 'All Area'
)
RETURNS TABLE (
  ack_id               bigint,
  work_log_id          bigint,
  already_acknowledged boolean,
  def_record_count     integer
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_ack   bigint;
  v_log   bigint;
  v_defs  bigint[];
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'acknowledge_rainfall_tarp requires a signed-in user';
  END IF;

  -- `p_kind` is validated by rainfall_tarp_acks_kind_check on the INSERT below,
  -- which is the one place the vocabulary is written down. See 009.

  -- Already signed — by this operator on another tab, or by the other shift.
  -- Returned as a success carrying `already_acknowledged`, so the popup closes
  -- instead of showing an error for something that is in fact done. Nothing is
  -- filed a second time: one rainfall event, one work-log entry, one set of
  -- records. `def_record_count` reports what the FIRST signature filed, which is
  -- the honest answer to "what does this acknowledgement account for".
  SELECT a.id, a.work_log_id, coalesce(array_length(a.def_record_ids, 1), 0)
    INTO v_ack, v_log, v_count
    FROM rainfall_tarp_acks a
   WHERE a.site_id = p_site_id
     AND a.kind = p_kind
     AND a.bucket_start = p_bucket_start;

  IF FOUND THEN
    RETURN QUERY SELECT v_ack, v_log, true, v_count;
    RETURN;
  END IF;

  INSERT INTO work_log
    (created_at, subject, wallfolder, location, category, action, notes, type, submitted_by)
  VALUES
    (now(), p_subject_id,
     -- Rainfall is a site-wide condition, not something that happened to one
     -- wall folder. Left null rather than pinned to whichever folder happened
     -- to be open. The def_records below are the per-folder half of this.
     NULL,
     p_location, 'rainfall', p_action, p_notes, 'radar', auth.uid())
  RETURNING id INTO v_log;

  -- The reportable event, once per monitored folder. See the header for why the
  -- folder set is read from decommissioning and Archive rather than from `type`.
  --
  -- `start` is the EVENT's instant, not now(): the moment the rate crossed, or
  -- the start of the local day that over-ran. That is what puts the record on
  -- the timeline where the rain actually was.
  WITH filed AS (
    INSERT INTO def_records
      (created_at, wallfolder_id, location, def_type, tarp_level, isactive,
       start, detected_by, notes, properties)
    SELECT
      now(),
      f.id,
      coalesce(nullif(btrim(p_record_location), ''), 'All Area'),
      'Rainfall Event',
      coalesce(p_tarp_label, ''),
      'Yes',
      p_bucket_start,
      auth.uid(),
      p_notes,
      '{}'::jsonb
    FROM radar_wall_folders f
    JOIN radars r ON r.id = f.radar_id
    WHERE r.site_id = p_site_id
      AND r.decommissioned_at IS NULL
      AND f.decommissioned_at IS NULL
      AND coalesce(f.type, '') <> 'Archive'
    RETURNING id
  )
  SELECT coalesce(array_agg(id), '{}'::bigint[]) INTO v_defs FROM filed;

  -- A concurrent acknowledgement of the SAME event raises unique_violation here
  -- and rolls the work_log entry AND the def_records back with it. The client
  -- treats that as "already acknowledged" and refetches.
  INSERT INTO rainfall_tarp_acks
    (site_id, kind, bucket_start, threshold_mm, measured_mm, tarp_level,
     band_label, work_log_id, def_record_ids, acknowledged_by)
  VALUES
    (p_site_id, p_kind, p_bucket_start, p_threshold_mm, p_measured_mm,
     p_tarp_level, p_band_label, v_log, v_defs, auth.uid())
  RETURNING id INTO v_ack;

  RETURN QUERY
    SELECT v_ack, v_log, false, coalesce(array_length(v_defs, 1), 0);
END;
$fn$;

REVOKE ALL ON FUNCTION acknowledge_rainfall_tarp(
  bigint, text, timestamptz, numeric, numeric, integer, text, integer, text,
  text, text, text, text
) FROM public, anon;

GRANT EXECUTE ON FUNCTION acknowledge_rainfall_tarp(
  bigint, text, timestamptz, numeric, numeric, integer, text, integer, text,
  text, text, text, text
) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) NOT FIXED HERE: the hand-typed record's blank level.
--
-- config/tarpPolicy.ts governingRule() reads, for a document with
-- tarp_level_source = 'alarm':
--
--     if (!hasAlarm) return null;        // -> resolveTarpLevel() returns ''
--
-- Which is right for Sorowako's DEFORMATION rows — their levels ARE velocity
-- and displacement bands, so with no alarm no band was crossed. It is wrong for
-- the rainfall row, which the chart gives its own level (2) and marks
-- requires_alarm = false, because rain is measured by a gauge and no radar alarm
-- colour can decide how hard it rained. The same goes for the Failure row
-- (level 1, requires_alarm = false).
--
-- So a Rainfall Event typed into the deformation form at Sorowako still comes
-- out with tarp_level ''. The fix is one line in governingRule — defer to the
-- alarm row only for a type the chart itself gates on an alarm — but it moves
-- the level on CLIENT-FACING deformation records and email subjects for a live
-- site, which is not something to slip into a rainfall migration. Raised
-- separately.
