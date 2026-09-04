-- Migration 015: give Hidden Valley its alarm slot back.
--
-- A DTG subject has two slots and they answer different questions:
--
--   [BRACKET]  <alarm prefix>  <token>       <finding> on <sensor>
--              which alarm      what severity
--              fired            it is reported at
--
-- Telfer keeps both, so the two facts never compete:
--
--   [CRITICAL] Orange Alarms - TARP Trigger 4: Progressive Deformation Trend on R01 - Telfer
--
-- Migration 008 set Hidden Valley to alarm_prefix_style = 'none', reasoning
-- that "the token already says Alarm". That is circular — the token only said
-- "Alarm" because the same migration had just turned the prefix off. With one
-- slot for two facts, every wording since has had to lose one of them:
-- '{Colour} Alarm:' lost which alarm fired, and naming the alarm would lose the
-- band. Neither is fixable inside one slot.
--
-- So: give the slot back. Hidden Valley's token goes back to being purely the
-- severity statement — "Red Notification" is their way of writing "TARP Trigger
-- 4" and belongs in exactly that position — and the alarm goes back to the
-- prefix, as at every other site.
--
--   [CRITICAL] Orange Alarms - Red Notification: Progressive Deformation Trend on R01 - Hidden Valley
--
-- subject_label_template_alarm goes NULL rather than being reworded: with the
-- alarm out of the token there is nothing left for a second template to say,
-- and resolveSubjectLabel falls through to subject_label_template. One wording
-- per site instead of two.
--
-- Also adds 'if-different' to alarm_prefix_style, for the one wart this leaves:
-- a red alarm on a red band reads "Red Alarms - Red Notification:", which is
-- accurate but says red twice. 'if-different' drops the prefix when the alarm
-- and the band are the same colour and keeps it when they differ — the case
-- that carries news. It is NOT applied to any site here; set it from the TARP
-- tab once you have looked at real subjects, since on most charts the plain
-- 'regions' answer reads fine.
--
-- Idempotent. Safe to run repeatedly in the Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- 1) Widen the constraint before anything can be set to the new value.
-- ---------------------------------------------------------------------------
ALTER TABLE tarp_documents
  DROP CONSTRAINT IF EXISTS tarp_documents_alarm_prefix_style_chk;

ALTER TABLE tarp_documents
  ADD CONSTRAINT tarp_documents_alarm_prefix_style_chk
  CHECK (alarm_prefix_style IN ('regions', 'none', 'if-different'));

COMMENT ON COLUMN tarp_documents.alarm_prefix_style IS
  'Whether the subject opens with "Red and Orange Alarms - ". '
  '''regions'' (default): always. ''none'': never. '
  '''if-different'': only when the alarm that fired is a different colour from '
  'the band the matched row sits in, for charts whose token already names a '
  'colour. See resolveAlarmPrefixStyle in config/tarpPolicy.ts.';

-- ---------------------------------------------------------------------------
-- 2) Hidden Valley — the alarm moves out of the token and back to the prefix.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_doc_id  bigint;
  v_style   text;
  v_alarm   text;
BEGIN
  SELECT d.id, d.alarm_prefix_style, d.subject_label_template_alarm
    INTO v_doc_id, v_style, v_alarm
    FROM tarp_documents d
    JOIN clients c ON c.id = d.site_id
   WHERE c.site_name ILIKE '%hidden valley%' AND d.status = 'active'
   LIMIT 1;

  IF v_doc_id IS NULL THEN
    RAISE NOTICE 'Hidden Valley alarm slot skipped: no active TARP document.';
    RETURN;
  END IF;

  -- Only undo the exact arrangement migration 008 left. A document someone has
  -- since worded deliberately is left alone and reported rather than rewritten.
  IF v_style IS DISTINCT FROM 'none'
     OR v_alarm IS DISTINCT FROM '{Colour} Alarm:' THEN
    RAISE NOTICE
      'Hidden Valley left alone on document %: expected (none, ''{Colour} Alarm:''), found (%, %)',
      v_doc_id, v_style, COALESCE(quote_literal(v_alarm), 'NULL');
    RETURN;
  END IF;

  UPDATE tarp_documents
     SET alarm_prefix_style           = 'regions',
         subject_label_template_alarm = NULL
   WHERE id = v_doc_id;

  RAISE NOTICE
    'Hidden Valley: alarm returned to the prefix, one subject wording on document %', v_doc_id;
END $$;
