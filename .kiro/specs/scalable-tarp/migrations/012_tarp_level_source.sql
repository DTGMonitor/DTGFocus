-- Migration 012: whose number is the TARP level?
--
-- Every site so far reads its level off the DEFORMATION row. A progressive
-- trend is TARP 4 because the trend is progressive; an alarm is a separate row
-- that can demand a phone call, but it never changes the number.
--
-- PTVI is the other way round. Its bands are displacement and velocity
-- thresholds — LEVEL 1 is 0-100 mm or <5 mm/day, LEVEL 4 is >100 mm/day — so
-- the alarm says how fast the slope is moving and the deformation type says
-- what shape the trend is. Those are orthogonal, and the level follows the
-- alarm: a progressive trend that raised an ORANGE alarm is TARP 3, not TARP 4.
-- With no alarm at all no threshold was breached, so the record carries no TARP
-- trigger and reports as an observation.
--
-- Expressed as one document-level setting, because it is a property of how a
-- client wrote their chart and not of any single row:
--
--   tarp_level_source = 'trigger'  -- the DTG standard, and every existing site
--   tarp_level_source = 'alarm'    -- PTVI
--
-- The alarm rows themselves need no new columns: config/tarpDocument.ts already
-- knows them as the rows with requires_alarm = true and no def_type, and it is
-- their `colour` that the fired alarm is matched against.
--
-- Idempotent DDL. Safe to run repeatedly. Existing rows default to 'trigger',
-- so no site changes behaviour until someone sets it.

-- ---------------------------------------------------------------------------
-- 1) The column.
-- ---------------------------------------------------------------------------
ALTER TABLE tarp_documents
  ADD COLUMN IF NOT EXISTS tarp_level_source text NOT NULL DEFAULT 'trigger';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tarp_documents_level_source_chk'
  ) THEN
    ALTER TABLE tarp_documents
      ADD CONSTRAINT tarp_documents_level_source_chk
      CHECK (tarp_level_source IN ('trigger', 'alarm'));
  END IF;
END $$;

COMMENT ON COLUMN tarp_documents.tarp_level_source IS
  '''trigger'' (default): the deformation row decides the TARP level. '
  '''alarm'': the alarm row that fired decides it, matched on colour, and a '
  'record with no alarm carries no TARP trigger. See config/tarpPolicy.ts.';

-- ---------------------------------------------------------------------------
-- 2) Carry it through tarp_save_revision.
--
--    Unchanged from 011 apart from the one document column.
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
    tarp_level_source, created_by
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
    COALESCE(NULLIF(p_document ->> 'tarp_level_source', ''), v_old.tarp_level_source),
    NULLIF(p_document ->> 'created_by', '')::uuid
  ) RETURNING id INTO v_new_id;

  INSERT INTO tarp_triggers (
    document_id, sort_order, parameter, risk_rating, band_label, trigger_label,
    colour, description, day_shift, night_shift, comments, extra_note,
    def_type, tarp_level, requires_alarm, severity_bracket,
    subject_label, subject_label_alarm,
    response_method, response_notice
  )
  SELECT
    v_new_id,
    COALESCE((t ->> 'sort_order')::integer, ordinality::integer),
    NULLIF(t ->> 'parameter', ''),
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

-- ---------------------------------------------------------------------------
-- 3) Carry it through the two bootstraps.
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
    tarp_level_source, created_by
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
    v_src.tarp_level_source,
    p_created_by
  ) RETURNING id INTO v_doc_id;

  INSERT INTO tarp_triggers (
    document_id, sort_order, parameter, risk_rating, band_label, trigger_label,
    colour, description, day_shift, night_shift, comments, extra_note,
    def_type, tarp_level, requires_alarm, severity_bracket,
    subject_label, subject_label_alarm,
    response_method, response_notice
  )
  SELECT
    v_doc_id, sort_order, parameter, risk_rating, band_label, trigger_label,
    colour, description, day_shift, night_shift, comments, extra_note,
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

CREATE OR REPLACE FUNCTION tarp_create_from_import(
  p_site_id    bigint,
  p_document   jsonb DEFAULT '{}'::jsonb,
  p_triggers   jsonb DEFAULT '[]'::jsonb,
  p_contacts   jsonb DEFAULT '[]'::jsonb,
  p_created_by uuid  DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_doc_id    bigint;
  v_site_name text;
BEGIN
  SELECT site_name INTO v_site_name FROM clients WHERE id = p_site_id;
  IF v_site_name IS NULL THEN
    RAISE EXCEPTION 'Site % not found', p_site_id;
  END IF;

  IF EXISTS (SELECT 1 FROM tarp_documents WHERE site_id = p_site_id AND status = 'active') THEN
    RAISE EXCEPTION 'Site % already has an active TARP document — amend it and publish a new version instead', v_site_name;
  END IF;

  IF jsonb_array_length(COALESCE(p_triggers, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'The imported file produced no trigger rows';
  END IF;

  INSERT INTO tarp_documents (
    site_id, heading, title, response_owner, version, status, effective_from,
    footer_note, escalation_note, distribution_raw,
    default_response_method, deescalation_response_method, deescalation_notice,
    subject_label_template, subject_label_template_alarm, alarm_prefix_style,
    tarp_level_source, created_by
  ) VALUES (
    p_site_id,
    COALESCE(NULLIF(p_document ->> 'heading', ''), v_site_name),
    COALESCE(NULLIF(p_document ->> 'title', ''),
             'Radar - Trigger Action Response Plan Chart'),
    COALESCE(NULLIF(p_document ->> 'response_owner', ''),
             'Primary Trigger Response - DTG Engineer'),
    COALESCE((SELECT MAX(version) FROM tarp_documents WHERE site_id = p_site_id), 0) + 1,
    'active',
    COALESCE((p_document ->> 'effective_from')::date, CURRENT_DATE),
    NULLIF(p_document ->> 'footer_note', ''),
    NULLIF(p_document ->> 'escalation_note', ''),
    NULLIF(p_document ->> 'distribution_raw', ''),
    COALESCE(NULLIF(p_document ->> 'default_response_method', ''), 'call'),
    COALESCE(NULLIF(p_document ->> 'deescalation_response_method', ''), 'call'),
    NULLIF(p_document ->> 'deescalation_notice', ''),
    COALESCE(NULLIF(p_document ->> 'subject_label_template', ''), 'TARP Trigger {level}:'),
    NULLIF(p_document ->> 'subject_label_template_alarm', ''),
    COALESCE(NULLIF(p_document ->> 'alarm_prefix_style', ''), 'regions'),
    COALESCE(NULLIF(p_document ->> 'tarp_level_source', ''), 'trigger'),
    p_created_by
  ) RETURNING id INTO v_doc_id;

  INSERT INTO tarp_triggers (
    document_id, sort_order, parameter, risk_rating, band_label, trigger_label,
    colour, description, day_shift, night_shift, comments, extra_note,
    def_type, tarp_level, requires_alarm, severity_bracket,
    subject_label, subject_label_alarm,
    response_method, response_notice
  )
  SELECT
    v_doc_id,
    COALESCE((t ->> 'sort_order')::integer, ordinality::integer),
    NULLIF(t ->> 'parameter', ''),
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
  FROM jsonb_array_elements(p_triggers) WITH ORDINALITY AS x(t, ordinality);

  INSERT INTO tarp_contacts (document_id, kind, sort_order, name, role, phone, email)
  SELECT
    v_doc_id,
    COALESCE(NULLIF(c ->> 'kind', ''), 'escalation'),
    COALESCE((c ->> 'sort_order')::integer, ordinality::integer),
    NULLIF(c ->> 'name', ''),
    NULLIF(c ->> 'role', ''),
    NULLIF(c ->> 'phone', ''),
    NULLIF(c ->> 'email', '')
  FROM jsonb_array_elements(COALESCE(p_contacts, '[]'::jsonb)) WITH ORDINALITY AS x(c, ordinality);

  INSERT INTO tarp_revisions (
    document_id, seq, site_label, version_no, approval_date,
    modified_date, sections_modified, remark
  ) VALUES (
    v_doc_id, 1, v_site_name,
    (SELECT version FROM tarp_documents WHERE id = v_doc_id),
    CURRENT_DATE, CURRENT_DATE,
    'All parts',
    COALESCE(
      NULLIF(p_document ->> 'import_remark', ''),
      'Imported from the site''s own TARP file. NOT YET AGREED WITH SITE — '
      || 'a spreadsheet cannot state which rows drive an email, so confirm the '
      || 'deformation type, TARP level and response on every row before relying on it.'
    )
  );

  RETURN v_doc_id;
END;
$$;
