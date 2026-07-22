-- Migration 004: make the required response method structural.
--
-- The DTG default response to a TARP trigger is a phone call. Some sites have
-- de-escalated specific rows to email only — Leonora moved a plain linear trend
-- from a call to an email in version 3 of their TARP.
--
-- Until now that lived only inside the free-text day_shift / night_shift cells,
-- where an engineer working at 2am has to read a paragraph to notice it. This
-- promotes it to a column so the UI can flag any row that DEVIATES from the
-- document's own default, both in the TARP tab and at the moment the engineer
-- is drafting the deformation email.
--
-- Idempotent. Safe to run repeatedly.

-- 1) Document-level default (what this site normally expects).
ALTER TABLE tarp_documents
  ADD COLUMN IF NOT EXISTS default_response_method text NOT NULL DEFAULT 'call';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tarp_documents_default_response_method_chk'
  ) THEN
    ALTER TABLE tarp_documents
      ADD CONSTRAINT tarp_documents_default_response_method_chk
      CHECK (default_response_method IN ('call', 'email', 'call_then_email', 'na'));
  END IF;
END $$;

-- 2) Per-row method. NULL means "follow the document default".
ALTER TABLE tarp_triggers
  ADD COLUMN IF NOT EXISTS response_method text,
  ADD COLUMN IF NOT EXISTS response_notice text;   -- optional custom wording

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tarp_triggers_response_method_chk'
  ) THEN
    ALTER TABLE tarp_triggers
      ADD CONSTRAINT tarp_triggers_response_method_chk
      CHECK (response_method IS NULL
             OR response_method IN ('call', 'email', 'call_then_email', 'na'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Backfill the two seeded reference documents.
-- ---------------------------------------------------------------------------

-- Genesis Minerals — Leonora.
-- Deliberate de-escalation: a linear trend is email-only. Everything that still
-- warrants a call is marked explicitly so the deviation stands out.
DO $$
DECLARE
  v_doc_id bigint;
BEGIN
  SELECT d.id INTO v_doc_id
    FROM tarp_documents d
    JOIN clients c ON c.id = d.site_id
   WHERE c.site_name ILIKE 'Leonora' AND d.status = 'active'
   LIMIT 1;

  IF v_doc_id IS NULL THEN
    RAISE NOTICE 'Leonora backfill skipped: no active TARP document';
    RETURN;
  END IF;

  UPDATE tarp_documents SET default_response_method = 'call' WHERE id = v_doc_id;

  UPDATE tarp_triggers SET response_method = 'call'
   WHERE document_id = v_doc_id
     AND trigger_label IN ('Progressive (accelerating) trend', 'Red Alarm',
                           'Orange Alarm', 'Lost Connection');

  UPDATE tarp_triggers
     SET response_method = 'email',
         response_notice = 'Email only — do not call. Leonora de-escalated a plain linear trend to email in TARP v3.'
   WHERE document_id = v_doc_id
     AND trigger_label = 'Linear trend (constant velocity)';

  UPDATE tarp_triggers SET response_method = 'email'
   WHERE document_id = v_doc_id
     AND trigger_label IN ('Fall of Ground/failure', 'Data Contamination',
                           'Scheduled Radar Offline');

  RAISE NOTICE 'Leonora response methods backfilled on document %', v_doc_id;
END $$;

-- Greatland Gold — Telfer. Call-first site; only the email rows deviate.
DO $$
DECLARE
  v_doc_id bigint;
BEGIN
  SELECT d.id INTO v_doc_id
    FROM tarp_documents d
    JOIN clients c ON c.id = d.site_id
   WHERE c.site_name ILIKE '%telfer%' AND d.status = 'active'
   LIMIT 1;

  IF v_doc_id IS NULL THEN
    RAISE NOTICE 'Telfer backfill skipped: no active TARP document';
    RETURN;
  END IF;

  UPDATE tarp_documents SET default_response_method = 'call' WHERE id = v_doc_id;

  UPDATE tarp_triggers SET response_method = 'call'
   WHERE document_id = v_doc_id AND day_shift ILIKE 'Call%';

  UPDATE tarp_triggers SET response_method = 'email'
   WHERE document_id = v_doc_id AND day_shift ILIKE 'Email%';

  UPDATE tarp_triggers SET response_method = 'na'
   WHERE document_id = v_doc_id AND day_shift = 'NA';

  RAISE NOTICE 'Telfer response methods backfilled on document %', v_doc_id;
END $$;

-- ---------------------------------------------------------------------------
-- 4) Teach tarp_save_revision about the new columns and the document default.
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
    footer_note, escalation_note, distribution_raw, default_response_method, created_by
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
    COALESCE(NULLIF(p_document ->> 'default_response_method', ''), v_old.default_response_method),
    NULLIF(p_document ->> 'created_by', '')::uuid
  ) RETURNING id INTO v_new_id;

  INSERT INTO tarp_triggers (
    document_id, sort_order, risk_rating, band_label, trigger_label, colour,
    description, day_shift, night_shift, comments, extra_note,
    def_type, tarp_level, requires_alarm, severity_bracket,
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
