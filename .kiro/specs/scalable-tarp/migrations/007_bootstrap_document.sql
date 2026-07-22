-- Migration 007: bootstrapping a TARP for a newly onboarded site.
--
-- TARP documents are per SITE, not per radar:
--   * a new radar at an existing site inherits that site's active document —
--     nothing to do, the TARP tab and the email engine already work;
--   * a new radar at a NEW site has no document, so the email engine silently
--     falls back to the DTG standard mapping in config/formConfig.ts.
--
-- That silent fallback is the risk this migration addresses. It gives an
-- engineer two ways to stand a document up in seconds, so the gap gets closed
-- rather than forgotten:
--
--   tarp_create_from_standard(site_id, created_by)  -- DTG standard chart
--   tarp_clone_document(source_document_id, target_site_id, created_by)
--
-- Both return the new document id and refuse to run if the site already has an
-- active document, so neither can clobber a client-approved TARP.
--
-- Idempotent DDL. Safe to run repeatedly.

-- ---------------------------------------------------------------------------
-- 1) The DTG standard chart — the common shape of every reference TARP,
--    with the TYPE_MATRIX levels the email engine has always defaulted to.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tarp_create_from_standard(
  p_site_id    bigint,
  p_created_by uuid DEFAULT NULL
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
    RAISE EXCEPTION 'Site % already has an active TARP document', v_site_name;
  END IF;

  INSERT INTO tarp_documents (
    site_id, heading, version, status, effective_from,
    footer_note, default_response_method, deescalation_response_method, created_by
  )
  VALUES (
    p_site_id,
    v_site_name,
    COALESCE((SELECT MAX(version) FROM tarp_documents WHERE site_id = p_site_id), 0) + 1,
    'active',
    CURRENT_DATE,
    'ALL CALLS FROM REMOTE ENGINEER TO SITE ENGINEER MUST BE FOLLOWED BY AN EMAIL SUMMARY',
    'call', 'call',
    p_created_by
  )
  RETURNING id INTO v_doc_id;

  INSERT INTO tarp_triggers (
    document_id, sort_order, risk_rating, band_label, trigger_label, colour,
    description, day_shift, night_shift, comments,
    def_type, tarp_level, requires_alarm, response_method
  ) VALUES
    (v_doc_id, 1, 'Extreme', 'TARP Trigger 4 (Red)', 'Progressive trend', 'red',
     'Progressive (accelerating) slope displacement trend is identified',
     'Call Geotech', 'Call Geotech',
     '["1. State area of concern","2. Advise to respond as per site TARP","3. Conduct velocity analysis","4. Conduct collapse forecast where possible as per DTG procedure."]'::jsonb,
     'Progressive', 4, false, 'call'),

    (v_doc_id, 2, 'Extreme', 'TARP Trigger 4 (Red)', 'Linear accelerating trend', 'red',
     'Stick-slip linear displacement trend with increasing average velocity is identified.',
     'Call Geotech', 'Call Geotech',
     '["1. State area of concern","2. Advise to respond as per site TARP","3. Conduct velocity analysis","4. Liaise with site engineers to support application of velocity ratio alarms where possible"]'::jsonb,
     'Linear Accelerating', 4, false, 'call'),

    (v_doc_id, 3, 'Extreme', 'TARP Trigger 4 (Red)', 'Red Alarm', 'red',
     'A genuine Red Alarm is triggered.',
     'Call Geotech', 'Call Geotech',
     '["1. State alarm area","2. Advise to respond as per site TARP for the specific area","3. Check for progressive deformation trend and commence collapse forecast where possible"]'::jsonb,
     NULL, 4, true, 'call'),

    (v_doc_id, 4, 'Moderate', 'TARP Trigger 3 (Orange)', 'Linear trend', 'orange',
     'A consistent linear (constant velocity) displacement trend is identified.',
     'Call Geotech', 'Call Geotech',
     '["1. Monitor as per TARP Trigger 3 procedures"]'::jsonb,
     'Linear', 3, false, 'call'),

    (v_doc_id, 5, 'Moderate', 'TARP Trigger 3 (Orange)', 'Orange Alarm', 'orange',
     'A genuine Orange alarm is triggered',
     'Call Geotech', 'Call Geotech',
     '["1. Clear alarm. Conduct velocity analysis","2. Monitor closely for and change in deformation trend","3. Liaise with site engineers to support application of velocity ratio alarms where possible"]'::jsonb,
     NULL, 3, true, 'call'),

    (v_doc_id, 6, 'Intermediate', 'TARP Trigger 2 (Yellow)', 'Regressive trend', 'yellow',
     'A regressive (decelerating) displacement trend is identified.',
     'Email Geotech', 'Email Geotech',
     '["1. Monitor as per TARP Trigger 2 procedures","2. Record in daily log"]'::jsonb,
     'Regressive', 2, false, 'email'),

    (v_doc_id, 7, 'Intermediate', NULL, 'Lost Connection', 'grey',
     'Connection between monitoring centre and site is lost',
     'Call Geotech', 'Call Geotech',
     '["1. Advise remote link is down and no longer able to monitor remotely","2. Advise Dispatch to follow site procedure for alarms (Dispatch to call site Geotech for all triggered alarms)"]'::jsonb,
     NULL, NULL, false, 'call'),

    (v_doc_id, 8, NULL, NULL, 'Fall of Ground', 'grey',
     'Uncontrolled fall of ground (FOG) occurs. This may occur following a previously identified deformation trend or by an observed unexplained drop in coherence.',
     'Email Geotech', 'Email Geotech',
     '["All uncontrolled falls of ground (rockfalls) must be reported and documented. Site geotech is to be notified by email. If considered \"high potential\" or near miss - call on day shift"]'::jsonb,
     'Failure', NULL, false, 'email'),

    (v_doc_id, 9, NULL, NULL, 'Data Contamination', 'grey',
     'Significant data contamination impacts the remote engineer''s ability to analyse and interpret data',
     'Email Geotech', 'Email Geotech', '[]'::jsonb,
     NULL, NULL, false, 'email'),

    (v_doc_id, 10, NULL, NULL, 'Scheduled Radar Offline', 'green',
     NULL, 'Email Geotech', 'NA',
     '["1. State time period for offline","2. Follow up by email"]'::jsonb,
     NULL, NULL, false, 'email');

  INSERT INTO tarp_revisions (
    document_id, seq, site_label, version_no, approval_date,
    approved_by_dtg, dtg_role, modified_date, sections_modified, remark
  ) VALUES (
    v_doc_id, 1, v_site_name,
    (SELECT version FROM tarp_documents WHERE id = v_doc_id),
    CURRENT_DATE, NULL, NULL, CURRENT_DATE,
    'All parts',
    'New TARP created from the DTG standard chart. NOT YET AGREED WITH SITE — review every row, add contacts and the distribution list, then publish an approved version.'
  );

  RETURN v_doc_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) Clone another site's document. Useful when a client onboards a second pit
--    under the same corporate TARP.
--
--    Triggers and contacts copy across; revision history does NOT — the new
--    site starts its own audit trail, recording where the content came from.
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
    default_response_method, deescalation_response_method, deescalation_notice, created_by
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
    p_created_by
  ) RETURNING id INTO v_doc_id;

  INSERT INTO tarp_triggers (
    document_id, sort_order, risk_rating, band_label, trigger_label, colour,
    description, day_shift, night_shift, comments, extra_note,
    def_type, tarp_level, requires_alarm, severity_bracket,
    response_method, response_notice
  )
  SELECT
    v_doc_id, sort_order, risk_rating, band_label, trigger_label, colour,
    description, day_shift, night_shift, comments, extra_note,
    def_type, tarp_level, requires_alarm, severity_bracket,
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

-- If you enabled RLS in migration 001, also grant execute:
-- GRANT EXECUTE ON FUNCTION tarp_create_from_standard(bigint, uuid) TO authenticated;
-- GRANT EXECUTE ON FUNCTION tarp_clone_document(bigint, bigint, uuid) TO authenticated;
