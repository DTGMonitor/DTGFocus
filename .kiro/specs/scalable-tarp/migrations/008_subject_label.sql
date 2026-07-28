-- Migration 008: how a site's emails announce a TARP trigger.
--
-- Until now the subject line said "TARP Trigger 4:" because that string was a
-- literal in config/formConfig.ts. A TARP document could only choose the NUMBER
-- (tarp_level) and whether the token appeared at all (requires_alarm). Sites
-- that name their bands rather than number them could not be expressed:
--
--   Telfer         [CRITICAL] TARP Trigger 4: Progressive Deformation Trend on …
--   Leonora        as Telfer, but the token disappears without a genuine alarm
--   Hidden Valley  [CRITICAL] Red Alarm: …  /  [NOTIFICATION ONLY] Yellow Notification: …
--
-- The wording therefore becomes data on the document, with a per-row override:
--
--   subject_label_template        document default, no alarm
--   subject_label_template_alarm  document default, with an alarm (NULL = same)
--   tarp_triggers.subject_label / .subject_label_alarm   per-row override
--
-- Tokens, filled from the trigger row: {level} {colour} {Colour} {band}. A
-- template that asks for something the row has not got renders as nothing at
-- all, so a row with no tarp_level never emits "TARP Trigger :".
--
-- `alarm_prefix_style` controls the automatic "Red and Orange Alarms - " prefix
-- built from the selected alarm regions. A site whose own token already names
-- the alarm sets 'none' so the subject does not say it twice.
--
-- Defaults reproduce the current output exactly: existing sites need no data
-- change, and sites with no TARP document are untouched.
--
-- Idempotent. Safe to run repeatedly in the Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- 1) Columns
-- ---------------------------------------------------------------------------
ALTER TABLE tarp_documents
  ADD COLUMN IF NOT EXISTS subject_label_template text NOT NULL DEFAULT 'TARP Trigger {level}:',
  ADD COLUMN IF NOT EXISTS subject_label_template_alarm text,
  ADD COLUMN IF NOT EXISTS alarm_prefix_style text NOT NULL DEFAULT 'regions';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tarp_documents_alarm_prefix_style_chk'
  ) THEN
    ALTER TABLE tarp_documents
      ADD CONSTRAINT tarp_documents_alarm_prefix_style_chk
      CHECK (alarm_prefix_style IN ('regions', 'none'));
  END IF;
END $$;

ALTER TABLE tarp_triggers
  ADD COLUMN IF NOT EXISTS subject_label text,
  ADD COLUMN IF NOT EXISTS subject_label_alarm text;

COMMENT ON COLUMN tarp_documents.subject_label_template IS
  'Subject token wording, no alarm. Tokens: {level} {colour} {Colour} {band}.';
COMMENT ON COLUMN tarp_documents.subject_label_template_alarm IS
  'Subject token wording when an alarm accompanies the record. NULL = same as subject_label_template.';
COMMENT ON COLUMN tarp_documents.alarm_prefix_style IS
  'regions = prefix the subject with the selected alarm colours; none = the token already names the alarm.';
COMMENT ON COLUMN tarp_triggers.subject_label IS
  'Per-row override of the document template, no alarm. NULL = inherit.';
COMMENT ON COLUMN tarp_triggers.subject_label_alarm IS
  'Per-row override of the document template, with an alarm. NULL = inherit.';

-- ---------------------------------------------------------------------------
-- 2) Greatland Gold — Telfer, and Genesis Minerals — Leonora.
--
--    Both quote the TARP number. Leonora's alarm gating already lives in
--    requires_alarm and is unaffected. Set explicitly so the tab shows a
--    deliberate choice rather than an unreviewed default.
-- ---------------------------------------------------------------------------
UPDATE tarp_documents d
   SET subject_label_template = 'TARP Trigger {level}:',
       subject_label_template_alarm = NULL,
       alarm_prefix_style = 'regions'
  FROM clients c
 WHERE c.id = d.site_id
   AND d.status = 'active'
   AND (c.site_name ILIKE 'Leonora' OR c.site_name ILIKE '%telfer%');

-- ---------------------------------------------------------------------------
-- 3) Hidden Valley — names its bands instead of numbering them.
--
--    "Red Notification" without an alarm, "Red Alarm" with one. The colour is
--    the TARP band colour of the matched row (tarp_triggers.colour), NOT the
--    colour of whichever alarm region the engineer ticked — the no-alarm case
--    has no region to read, and the band colour is what the chart prints.
--
--    alarm_prefix_style = 'none' because the token already says "Alarm".
--
--    No gating: every row keeps its TARP level on the record whether or not an
--    alarm fired. Only the wording changes.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_doc_id bigint;
BEGIN
  SELECT d.id INTO v_doc_id
    FROM tarp_documents d
    JOIN clients c ON c.id = d.site_id
   WHERE c.site_name ILIKE '%hidden valley%' AND d.status = 'active'
   LIMIT 1;

  IF v_doc_id IS NULL THEN
    RAISE NOTICE 'Hidden Valley wording skipped: no active TARP document. Create one from the TARP tab, then re-run this migration.';
    RETURN;
  END IF;

  UPDATE tarp_documents
     SET subject_label_template       = '{Colour} Notification:',
         subject_label_template_alarm = '{Colour} Alarm:',
         alarm_prefix_style           = 'none'
   WHERE id = v_doc_id;

  -- The wording is only as good as the band colours, so make the gap loud
  -- rather than letting a row silently emit no token at all.
  IF EXISTS (
    SELECT 1 FROM tarp_triggers
     WHERE document_id = v_doc_id AND def_type IS NOT NULL AND colour IS NULL
  ) THEN
    RAISE WARNING 'Hidden Valley: % trigger row(s) drive a deformation type but have no colour — their subjects will quote no band. Set a colour on each.',
      (SELECT count(*) FROM tarp_triggers
        WHERE document_id = v_doc_id AND def_type IS NOT NULL AND colour IS NULL);
  END IF;

  RAISE NOTICE 'Hidden Valley subject wording set on document %', v_doc_id;
END $$;

-- ---------------------------------------------------------------------------
-- 4) Carry the new columns through tarp_clone_document.
--
--    Onboarding a second pit under the same corporate TARP must not quietly
--    revert its emails to the DTG numbering — that is precisely the drift this
--    migration exists to prevent. Unchanged from 007 apart from the copied
--    columns.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tarp_clone_document(
  p_source_document_id bigint,
  p_target_site_id     bigint,
  p_created_by         uuid DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_src         tarp_documents%ROWTYPE;
  v_doc_id      bigint;
  v_site_name   text;
  v_source_site text;
BEGIN
  SELECT * INTO v_src FROM tarp_documents WHERE id = p_source_document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source TARP document % not found', p_source_document_id;
  END IF;

  SELECT site_name INTO v_site_name FROM clients WHERE id = p_target_site_id;
  IF v_site_name IS NULL THEN
    RAISE EXCEPTION 'Target site % not found', p_target_site_id;
  END IF;

  IF EXISTS (SELECT 1 FROM tarp_documents WHERE site_id = p_target_site_id AND status = 'active') THEN
    RAISE EXCEPTION 'Site % already has an active TARP document', v_site_name;
  END IF;

  SELECT site_name INTO v_source_site FROM clients WHERE id = v_src.site_id;

  INSERT INTO tarp_documents (
    site_id, heading, title, response_owner, version, status, effective_from,
    footer_note, escalation_note, distribution_raw,
    default_response_method, deescalation_response_method, deescalation_notice,
    subject_label_template, subject_label_template_alarm, alarm_prefix_style,
    created_by
  ) VALUES (
    p_target_site_id,
    v_site_name,
    v_src.title,
    v_src.response_owner,
    COALESCE((SELECT MAX(version) FROM tarp_documents WHERE site_id = p_target_site_id), 0) + 1,
    'active',
    CURRENT_DATE,
    v_src.footer_note,
    v_src.escalation_note,
    v_src.distribution_raw,
    v_src.default_response_method,
    v_src.deescalation_response_method,
    v_src.deescalation_notice,
    v_src.subject_label_template,
    v_src.subject_label_template_alarm,
    v_src.alarm_prefix_style,
    p_created_by
  ) RETURNING id INTO v_doc_id;

  INSERT INTO tarp_triggers (
    document_id, sort_order, risk_rating, band_label, trigger_label, colour,
    description, day_shift, night_shift, comments, extra_note,
    def_type, tarp_level, requires_alarm, severity_bracket,
    subject_label, subject_label_alarm,
    response_method, response_notice
  )
  SELECT
    v_doc_id, sort_order, risk_rating, band_label, trigger_label, colour,
    description, day_shift, night_shift, comments, extra_note,
    def_type, tarp_level, requires_alarm, severity_bracket,
    subject_label, subject_label_alarm,
    response_method, response_notice
  FROM tarp_triggers WHERE document_id = p_source_document_id;

  INSERT INTO tarp_contacts (document_id, kind, sort_order, name, role, phone, email)
  SELECT v_doc_id, kind, sort_order, name, role, phone, email
  FROM tarp_contacts WHERE document_id = p_source_document_id;

  INSERT INTO tarp_revisions (
    document_id, seq, site_label, version_no, approval_date,
    modified_date, sections_modified, remark
  ) VALUES (
    v_doc_id, 1, v_site_name,
    (SELECT version FROM tarp_documents WHERE id = v_doc_id),
    CURRENT_DATE, CURRENT_DATE,
    'All parts',
    'Copied from the ' || COALESCE(v_source_site, 'source site') || ' TARP (v' || v_src.version ||
    '). NOT YET AGREED WITH SITE — confirm contacts, distribution list and every trigger row before relying on it.'
  );

  RETURN v_doc_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) Carry the new columns through tarp_save_revision.
--
--    Unchanged from 005 apart from the three document columns and the two
--    trigger columns.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tarp_save_revision(
  p_document_id bigint,
  p_document    jsonb,
  p_triggers    jsonb,
  p_contacts    jsonb,
  p_revision    jsonb
) RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_old     tarp_documents%ROWTYPE;
  v_new_id  bigint;
  v_version integer;
  v_seq     integer;
BEGIN
  SELECT * INTO v_old FROM tarp_documents WHERE id = p_document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TARP document % not found', p_document_id;
  END IF;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
    FROM tarp_documents WHERE site_id = v_old.site_id;

  UPDATE tarp_documents
     SET status = 'superseded'
   WHERE site_id = v_old.site_id AND status = 'active';

  INSERT INTO tarp_documents (
    site_id, heading, title, response_owner, version, status, effective_from,
    footer_note, escalation_note, distribution_raw,
    default_response_method, deescalation_response_method, deescalation_notice,
    subject_label_template, subject_label_template_alarm, alarm_prefix_style,
    created_by
  ) VALUES (
    v_old.site_id,
    COALESCE(p_document ->> 'heading',          v_old.heading),
    COALESCE(p_document ->> 'title',            v_old.title),
    COALESCE(p_document ->> 'response_owner',   v_old.response_owner),
    v_version,
    'active',
    COALESCE((p_document ->> 'effective_from')::date, CURRENT_DATE),
    COALESCE(p_document ->> 'footer_note',      v_old.footer_note),
    COALESCE(p_document ->> 'escalation_note',  v_old.escalation_note),
    COALESCE(p_document ->> 'distribution_raw', v_old.distribution_raw),
    COALESCE(NULLIF(p_document ->> 'default_response_method', ''),      v_old.default_response_method),
    COALESCE(NULLIF(p_document ->> 'deescalation_response_method', ''), v_old.deescalation_response_method),
    COALESCE(p_document ->> 'deescalation_notice', v_old.deescalation_notice),
    COALESCE(NULLIF(p_document ->> 'subject_label_template', ''), v_old.subject_label_template),
    -- Blank clears the alarm variant back to "same as the no-alarm wording",
    -- so an engineer can undo an override without an admin.
    CASE
      WHEN p_document ? 'subject_label_template_alarm'
        THEN NULLIF(p_document ->> 'subject_label_template_alarm', '')
      ELSE v_old.subject_label_template_alarm
    END,
    COALESCE(NULLIF(p_document ->> 'alarm_prefix_style', ''), v_old.alarm_prefix_style),
    NULLIF(p_document ->> 'created_by', '')::uuid
  ) RETURNING id INTO v_new_id;

  INSERT INTO tarp_triggers (
    document_id, sort_order, risk_rating, band_label, trigger_label, colour,
    description, day_shift, night_shift, comments, extra_note,
    def_type, tarp_level, requires_alarm, severity_bracket,
    subject_label, subject_label_alarm,
    response_method, response_notice
  )
  SELECT
    v_new_id,
    COALESCE((t ->> 'sort_order')::integer, ordinality::integer),
    NULLIF(t ->> 'risk_rating', ''),
    NULLIF(t ->> 'band_label', ''),
    COALESCE(NULLIF(t ->> 'trigger_label', ''), 'Untitled trigger'),
    NULLIF(t ->> 'colour', ''),
    NULLIF(t ->> 'description', ''),
    NULLIF(t ->> 'day_shift', ''),
    NULLIF(t ->> 'night_shift', ''),
    COALESCE(t -> 'comments', '[]'::jsonb),
    NULLIF(t ->> 'extra_note', ''),
    NULLIF(t ->> 'def_type', ''),
    NULLIF(t ->> 'tarp_level', '')::smallint,
    COALESCE((t ->> 'requires_alarm')::boolean, false),
    NULLIF(t ->> 'severity_bracket', ''),
    NULLIF(t ->> 'subject_label', ''),
    NULLIF(t ->> 'subject_label_alarm', ''),
    NULLIF(t ->> 'response_method', ''),
    NULLIF(t ->> 'response_notice', '')
  FROM jsonb_array_elements(COALESCE(p_triggers, '[]'::jsonb)) WITH ORDINALITY AS x(t, ordinality);

  INSERT INTO tarp_contacts (document_id, kind, sort_order, name, role, phone, email)
  SELECT
    v_new_id,
    COALESCE(NULLIF(c ->> 'kind', ''), 'escalation'),
    COALESCE((c ->> 'sort_order')::integer, ordinality::integer),
    NULLIF(c ->> 'name', ''),
    NULLIF(c ->> 'role', ''),
    NULLIF(c ->> 'phone', ''),
    NULLIF(c ->> 'email', '')
  FROM jsonb_array_elements(COALESCE(p_contacts, '[]'::jsonb)) WITH ORDINALITY AS x(c, ordinality);

  INSERT INTO tarp_revisions (
    document_id, seq, site_label, version_no, approval_date, approved_by_site,
    site_role, approved_by_dtg, dtg_role, modified_date, sections_modified, remark
  )
  SELECT
    v_new_id, seq, site_label, version_no, approval_date, approved_by_site,
    site_role, approved_by_dtg, dtg_role, modified_date, sections_modified, remark
  FROM tarp_revisions
  WHERE document_id = p_document_id;

  SELECT COALESCE(MAX(seq), 0) + 1 INTO v_seq
    FROM tarp_revisions WHERE document_id = v_new_id;

  INSERT INTO tarp_revisions (
    document_id, seq, site_label, version_no, approval_date, approved_by_site,
    site_role, approved_by_dtg, dtg_role, modified_date, sections_modified, remark
  ) VALUES (
    v_new_id,
    v_seq,
    COALESCE(NULLIF(p_revision ->> 'site_label', ''),
             (SELECT site_name FROM clients WHERE id = v_old.site_id)),
    v_version,
    COALESCE((p_revision ->> 'approval_date')::date, CURRENT_DATE),
    NULLIF(p_revision ->> 'approved_by_site', ''),
    NULLIF(p_revision ->> 'site_role', ''),
    NULLIF(p_revision ->> 'approved_by_dtg', ''),
    NULLIF(p_revision ->> 'dtg_role', ''),
    COALESCE((p_revision ->> 'modified_date')::date, CURRENT_DATE),
    NULLIF(p_revision ->> 'sections_modified', ''),
    NULLIF(p_revision ->> 'remark', '')
  );

  RETURN v_new_id;
END;
$$;
