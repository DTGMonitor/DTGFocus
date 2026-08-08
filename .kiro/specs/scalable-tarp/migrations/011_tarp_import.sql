-- Migration 011: importing a client's own TARP workbook.
--
-- Until now a site's chart could only be stood up from the DTG standard
-- (007) or cloned from another site, then amended row by row. Sites that
-- arrive with an already-agreed TARP had to have it retyped, and the newer
-- Indonesian sites arrive in a DIFFERENT LAYOUT entirely: parameters down
-- the side, risk bands across the top, one trigger per cell —
--
--   PARAMETER      | N/A | Low            | Intermediate | Moderate | Extreme
--   Pola Deformasi |     | Indikasi ...   |              | Linear   | Progresif
--   Koneksi Data   | ... | Kontaminasi    | Pembaruan ...|          |
--
-- rather than the one-row-per-trigger layout the existing reference
-- workbooks use. utils/tarpImport.js reads both and normalises them onto
-- tarp_triggers; this migration supplies the two things it needs from the
-- database:
--
--   1) tarp_triggers.parameter — the matrix layout's row axis. Without it,
--      "which parameter is this a trigger for" is lost on import and cannot
--      be printed back out. NULL on every existing row, so the row-layout
--      sites are unaffected.
--
--   2) tarp_create_from_import(...) — stands a document up directly from a
--      parsed workbook, for a site that has none. The existing
--      tarp_save_revision already covers importing INTO a site that does:
--      the engineer loads the parsed rows into the draft and publishes,
--      so an import is versioned and audited exactly like a hand edit.
--
-- Idempotent DDL. Safe to run repeatedly.

-- ---------------------------------------------------------------------------
-- 1) The parameter column.
-- ---------------------------------------------------------------------------
ALTER TABLE tarp_triggers
  ADD COLUMN IF NOT EXISTS parameter text;

COMMENT ON COLUMN tarp_triggers.parameter IS
  'Matrix-layout charts group triggers by parameter (e.g. "Pola Deformasi", '
  '"Koneksi Data") with the risk bands as columns. NULL for the one-row-per-'
  'trigger layout, where the chart has no such axis.';

-- ---------------------------------------------------------------------------
-- 2) Carry `parameter` through tarp_save_revision.
--
--    Unchanged from 008 apart from the one trigger column.
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
-- 3) Carry `parameter` through tarp_clone_document.
--
--    Unchanged from 007 apart from the one trigger column and the 008
--    subject columns, which 007 predates and so silently dropped.
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

-- ---------------------------------------------------------------------------
-- 4) Stand a document up from a parsed workbook.
--
--    For a site with NO active document. Same refusal as the other two
--    bootstraps, so an import can never clobber a client-approved TARP —
--    a site that already has one imports through tarp_save_revision instead,
--    which supersedes rather than overwrites and leaves a revision row.
--
--    The trigger payload is the same shape tarp_save_revision takes, so the
--    client builds it once (utils/tarpImport.js) whichever path it takes.
-- ---------------------------------------------------------------------------
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
    created_by
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

-- If you enabled RLS in migration 001, also grant execute:
-- GRANT EXECUTE ON FUNCTION tarp_create_from_import(bigint, jsonb, jsonb, jsonb, uuid) TO authenticated;