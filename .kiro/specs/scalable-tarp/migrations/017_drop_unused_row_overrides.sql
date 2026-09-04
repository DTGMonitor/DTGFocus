-- Migration 017: drop severity_bracket and response_notice.
--
-- Two per-row escape hatches that nothing has ever used.
--
--   severity_bracket   overrides [CRITICAL] / [MODERATE RISK]. No seed, no
--                      migration and no import has ever written it —
--                      utils/tarpImport.js hardcodes null. Reachable only from
--                      a collapsed "Advanced" section of the amend form, and
--                      exercised only by a unit test.
--
--   response_notice    custom wording for a row that departs from the site's
--                      normal response. Set exactly once, by migration 004 for
--                      Leonora's linear trend, and set straight back to NULL by
--                      005 when that turned out to describe a steady state
--                      rather than a de-escalation. NULL everywhere since.
--                      DEVIATION_WORDING in config/tarpDocument.ts already
--                      supplies a sentence per response method.
--
-- Both are the same shape of thing: a column that exists so a row COULD say
-- something no row has ever needed to say, while every engineer reading the
-- form has to decide whether it applies to them. The chart is easier to reason
-- about with them gone than with them empty.
--
-- If a row does turn out to need its own bracket later, subject_label already
-- proves the pattern and can be re-added deliberately.
--
-- REQUIRES the matching application change — components/admin/Radar/Tarp/
-- useTarpDocument.ts selects both columns by name, so run this only alongside
-- the deploy that stops asking for them.
--
-- Idempotent. Safe to run repeatedly in the Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- 1) Refuse to discard anything a client is actually relying on.
--
--    Both columns are expected to be NULL on every row. If they are not,
--    someone has worded a row since this was written, and that wording must be
--    read before it is dropped rather than after.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_rows text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'tarp_triggers'
       AND column_name = 'severity_bracket'
  ) THEN
    EXECUTE $q$
      SELECT string_agg(format('%s (doc %s): %L', trigger_label, document_id, severity_bracket),
                        E'\n  ' ORDER BY document_id, sort_order)
        FROM tarp_triggers WHERE COALESCE(severity_bracket, '') <> ''
    $q$ INTO v_rows;

    IF v_rows IS NOT NULL THEN
      RAISE EXCEPTION E'severity_bracket is in use and would be lost:\n  %\n\nRead these, decide what should replace them, then re-run.', v_rows;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'tarp_triggers'
       AND column_name = 'response_notice'
  ) THEN
    EXECUTE $q$
      SELECT string_agg(format('%s (doc %s): %L', trigger_label, document_id, response_notice),
                        E'\n  ' ORDER BY document_id, sort_order)
        FROM tarp_triggers WHERE COALESCE(response_notice, '') <> ''
    $q$ INTO v_rows;

    IF v_rows IS NOT NULL THEN
      RAISE EXCEPTION E'response_notice is in use and would be lost:\n  %\n\nRead these, decide what should replace them, then re-run.', v_rows;
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Redefine the three functions that name the columns.
--
--    Unchanged from migration 012 apart from the two columns. Redefined BEFORE
--    the drop so nothing references a column that is about to disappear.
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
    def_type, tarp_level, requires_alarm,
    subject_label, subject_label_alarm,
    response_method
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
    NULLIF(t ->> 'subject_label', ''),
    NULLIF(t ->> 'subject_label_alarm', ''),
    NULLIF(t ->> 'response_method', '')
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
    def_type, tarp_level, requires_alarm,
    subject_label, subject_label_alarm,
    response_method
  )
  SELECT
    v_doc_id, sort_order, parameter, risk_rating, band_label, trigger_label,
    colour, description, day_shift, night_shift, comments, extra_note,
    def_type, tarp_level, requires_alarm,
    subject_label, subject_label_alarm,
    response_method
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
    def_type, tarp_level, requires_alarm,
    subject_label, subject_label_alarm,
    response_method
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
    NULLIF(t ->> 'subject_label', ''),
    NULLIF(t ->> 'subject_label_alarm', ''),
    NULLIF(t ->> 'response_method', '')
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

-- ---------------------------------------------------------------------------
-- 3) The columns themselves.
-- ---------------------------------------------------------------------------
ALTER TABLE tarp_triggers DROP COLUMN IF EXISTS severity_bracket;
ALTER TABLE tarp_triggers DROP COLUMN IF EXISTS response_notice;
