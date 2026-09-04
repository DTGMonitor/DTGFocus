-- Migration 016: one subject wording for every Hidden Valley row.
--
-- After 015 the chart still produced three different shapes:
--
--   Progressive   Red Alarms - Red Alarm Progressive Deformation Trend …
--   Linear        Red Alarms - Orange Alarm Linear Deformation Trend …
--   Blast event   Red Alarms - Yellow Notification: Blast Event …
--
-- Two faults, both invisible from the document settings:
--
-- 1) The four trend rows carry their own subject_label / subject_label_alarm.
--    A row override beats the document template (resolveSubjectLabel), so 015
--    never reached them: they kept saying "{Colour} Alarm" when an alarm fired
--    and dropped the colon the rest of the chart uses. Clearing the overrides
--    is the whole fix — the document already says what these rows should say.
--
-- 2) The token is built from {Colour}, so a row's colour is enough to name a
--    band. It is not: grey is a colour but not a band, and no Hidden Valley
--    chart has a grey row an operator could look up. That is what printed
--
--      [NOTIFICATION ONLY] Grey Notification: Failure Pattern Indication …
--
--    for a fall of ground. Switching the document to {band} answers it from the
--    BAND LABEL instead, which those rows correctly leave empty — and a token
--    that cannot be filled renders as nothing at all. The rows that do sit in a
--    band already carry the exact wording ("Red Notification", "Yellow
--    Notification"), so nothing else on the chart moves.
--
-- After this, every Hidden Valley row reads the same way, alarm or not:
--
--   [CRITICAL]          Red Alarms - Red Notification: Progressive Deformation Trend …
--   [MODERATE RISK]     Red Alarms - Orange Notification: Linear Deformation Trend …
--   [NOTIFICATION ONLY] Red Alarms - Yellow Notification: Blast Event …
--   [NOTIFICATION ONLY] Red Alarms - Failure Pattern Indication …
--
-- Idempotent. Safe to run repeatedly in the Supabase SQL Editor.

DO $$
DECLARE
  v_doc_id   bigint;
  v_cleared  integer;
  v_orphans  text;
BEGIN
  SELECT d.id INTO v_doc_id
    FROM tarp_documents d
    JOIN clients c ON c.id = d.site_id
   WHERE c.site_name ILIKE '%hidden valley%' AND d.status = 'active'
   LIMIT 1;

  IF v_doc_id IS NULL THEN
    RAISE NOTICE 'Hidden Valley wording skipped: no active TARP document.';
    RETURN;
  END IF;

  -- ---------------------------------------------------------------------
  -- Before switching to {band}, make sure the rows that need a token have
  -- one. A row that drives a deformation type AND sits in a band (carries a
  -- TARP level) but has no band_label would go silent — the one way this
  -- migration could quietly remove wording a client expects.
  -- ---------------------------------------------------------------------
  SELECT string_agg(trigger_label, ', ' ORDER BY sort_order) INTO v_orphans
    FROM tarp_triggers
   WHERE document_id = v_doc_id
     AND def_type IS NOT NULL
     AND tarp_level IS NOT NULL
     AND COALESCE(band_label, '') = '';

  IF v_orphans IS NOT NULL THEN
    RAISE EXCEPTION
      'Hidden Valley: these rows sit in a band but have no band label, so {band} would silence them: %. Set a band label on each, then re-run.',
      v_orphans;
  END IF;

  -- 1) Row overrides go, so the document template is the single statement of
  --    how this site's subjects read.
  UPDATE tarp_triggers
     SET subject_label = NULL,
         subject_label_alarm = NULL
   WHERE document_id = v_doc_id
     AND (subject_label IS NOT NULL OR subject_label_alarm IS NOT NULL);

  GET DIAGNOSTICS v_cleared = ROW_COUNT;

  -- 2) The band names itself. subject_label_template_alarm stays NULL (015):
  --    the alarm is in the prefix now, so one template covers both cases.
  UPDATE tarp_documents
     SET subject_label_template = '{band}:'
   WHERE id = v_doc_id;

  RAISE NOTICE
    'Hidden Valley: % row wording override(s) cleared, document % now names its bands via {band}',
    v_cleared, v_doc_id;
END $$;
