-- Migration 002: seed the two DTG-standard reference TARPs.
--
-- Transcribed verbatim from:
--   public/data/TARP/DTG Radar TARP - Genesis Minerals_22072026.xlsx
--   public/data/TARP/DTG radar TARP - Greatland Gold - Telfer_260130.xlsx
--
-- Each block resolves its site from `clients.site_name` and silently skips if
-- the site is not present, so this is safe to run on any environment.
-- Idempotent: re-running replaces the seeded version.

-- ===========================================================================
-- Genesis Minerals — Leonora  (workbook version 3)
-- ===========================================================================
DO $$
DECLARE
  v_site_id bigint;
  v_doc_id  bigint;
BEGIN
  SELECT id INTO v_site_id FROM clients WHERE site_name ILIKE 'Leonora' LIMIT 1;
  IF v_site_id IS NULL THEN
    RAISE NOTICE 'Genesis seed skipped: no clients row with site_name ILIKE ''Leonora''';
    RETURN;
  END IF;

  DELETE FROM tarp_documents WHERE site_id = v_site_id AND version = 3;
  UPDATE tarp_documents SET status = 'superseded'
    WHERE site_id = v_site_id AND status = 'active';

  INSERT INTO tarp_documents
    (site_id, heading, version, status, effective_from,
     footer_note, escalation_note, distribution_raw)
  VALUES
    (v_site_id, 'Genesis Minerals', 3, 'active', DATE '2026-07-22',
     'ALL CALLS FROM REMOTE ENGINEER TO SITE ENGINEER MUST BE FOLLOWED BY AN EMAIL SUMMARY',
     'Contact hierarchy: 1. supervisor 2. superintendent 3. mine manager 4. Geotech',
     '"Thulio Fernandes" <Thulio.Fernandes@genesisminerals.com.au>; "Shanny Chokkaiyan" <Shanmuga.Chokkaiyan@genesisminerals.com.au>; "Craig Pinny" <Craig.Pinny@genesisminerals.com.au>; "Conrad Hunt" <Conrad.Hunt@genesisminerals.com.au>; "Redcliffe All Supervisors" <RedcliffeAllSupervisors@genesisminerals.com.au>; "Open Pit Survey" <OpenPitSurvey@genesisminerals.com.au>; "Hub Geology" <HubGeology@genesisminerals.com.au>; "Hub Engineers" <HubEngineers@genesisminerals.com.au>; "Leonora Geotech" <LeonoraGeotech@genesisminerals.com.au>; Shane Wylie <shane.wylie@srgglobal.com.au>; Lewis Smith <lewis.smith@srgglobal.com.au>; admiral.leadinghands <admiral.leadinghands@srgglobal.com.au>')
  RETURNING id INTO v_doc_id;

  INSERT INTO tarp_triggers
    (document_id, sort_order, risk_rating, band_label, trigger_label, colour,
     description, day_shift, night_shift, comments, extra_note,
     def_type, tarp_level, requires_alarm)
  VALUES
    (v_doc_id, 1, 'Extreme', 'TARP Trigger 4 - Red', 'Progressive (accelerating) trend', 'red',
     'Progressive (accelerating) slope displacement trend is identified (at any rate)',
     'Call Supervisor and Mine Manager and email off-site Geotechs (With Priority people on site).',
     'Call Supervisor and Mine Manager and Geotechs (With Priority people on site).',
     '["1. State area of concern","2. Advise to respond as per site TARP","3. Conduct velocity analysis","4. Conduct collapse forecast where possible as per DTG procedure."]'::jsonb,
     'After calling supervisor and/or superintendent THEN also call Mine Manager',
     'Progressive', 4, false),

    (v_doc_id, 2, 'Extreme', 'TARP Trigger 4 - Red', 'Red Alarm', 'red',
     'A genuine Red Alarm is triggered.',
     'Call Supervisor and Mine Manager and email off-site Geotechs (With Priority people on site).',
     'Call Supervisor and Mine Manager and Geotechs (With Priority people on site).',
     '["1. State alarm area","2. Advise to respond as per site TARP for the specific area","3. Check for progressive deformation trend and commence collapse forecast where possible"]'::jsonb,
     'After calling supervisor and/or superintendent THEN also call Mine Manager',
     NULL, 4, true),

    (v_doc_id, 3, 'Moderate', 'TARP Trigger 3 - Orange', 'Linear trend (constant velocity)', 'orange',
     'A consistent linear trend (at any rate) is identified.',
     'Email Geotech, mine manger and site superintendent',
     'Email Geotech, mine manger and site superintendent',
     '["1. Monitor as per TARP Trigger 3 procedures"]'::jsonb,
     NULL,
     -- Version 3 of this TARP moved a plain linear trend from a call to an
     -- email, so the trigger is only quoted when an alarm actually fired.
     'Linear', 3, true),

    (v_doc_id, 4, 'Moderate', 'TARP Trigger 3 - Orange', 'Orange Alarm', 'orange',
     'A genuine Orange alarm is triggered',
     'Call supervisor (escalate by contact hierarchy if unreachable) and notify Leonorageotech by Email.',
     'Call supervisor (escalate by contact hierarchy if unreachable) and notify Leonorageotech by Email.',
     '["1. Clear alarm. Conduct velocity analysis","2. Monitor closely for and change in deformation trend","3. Liaise with site engineers to support application of velocity ratio alarms where possible.","4. Validate velocity / movement with drone inspections photos"]'::jsonb,
     NULL,
     NULL, 3, true),

    (v_doc_id, 5, NULL, NULL, 'Lost Connection', 'yellow',
     'Connection between monitoring centre and site is lost',
     'Call supervisor', 'Call supervisor',
     '["1. Advise remote link is down and no longer able to monitor remotely","2. Advise Dispatch to follow site procedure for alarms (Dispatch to call site Geotech for all triggered alarms)"]'::jsonb,
     NULL, NULL, NULL, false),

    (v_doc_id, 6, NULL, NULL, 'Fall of Ground/failure', 'grey',
     'Uncontrolled fall of ground (FOG) occurs. This may occur following a previously identified deformation trend',
     'Email Geotech, mine manger and site superintendent',
     'Email Geotech, mine manger and site superintendent',
     '["All uncontrolled falls of ground (rockfalls) must be reported and documented. Mine manger, superintendent and off-site geotech is to be notified by email. If considered \"high potential\" or near miss - call on day shift"]'::jsonb,
     NULL, 'Failure', NULL, false),

    (v_doc_id, 7, NULL, NULL, 'Data Contamination', 'grey',
     'Significant data contamination impacts the remote engineer''s ability to analyse and interpret data',
     'Email Geotech', 'Email Geotech',
     '[]'::jsonb, NULL, NULL, NULL, false),

    (v_doc_id, 8, NULL, NULL, 'Scheduled Radar Offline', 'green',
     NULL, 'Email Geotech', 'NA',
     '["1. State time period for offline","2. Follow up by email"]'::jsonb,
     NULL, NULL, NULL, false);

  INSERT INTO tarp_contacts (document_id, kind, sort_order, name, role, phone)
  VALUES
    (v_doc_id, 'escalation', 1, 'Thulio Cesar Fernandes', 'Open Pit Manager',            '466437593'),
    (v_doc_id, 'escalation', 2, 'Shanny Chokkaiyan',      'Senior Mining Engineer / QM', '0431 253 175'),
    (v_doc_id, 'escalation', 3, 'Craig Pinny',            'Mine Superintendent',         '459353472'),
    (v_doc_id, 'escalation', 4, 'Conrad Hunt',            'Mine Superintendent',         '0400 009 224'),
    (v_doc_id, 'escalation', 5, NULL,                     'Mine supervisor',             '461486250'),
    (v_doc_id, 'escalation', 6, NULL,                     'GEOTECH ON CALL',             '419853944'),
    (v_doc_id, 'escalation', 7, NULL,                     'DISPATCH',                    NULL);

  INSERT INTO tarp_revisions
    (document_id, seq, site_label, version_no, approval_date, approved_by_site,
     site_role, approved_by_dtg, dtg_role, modified_date, sections_modified, remark)
  VALUES
    (v_doc_id, 1, 'Leonora - Genesis Minerals', 1, DATE '2026-07-22', 'Shanny Chokkaiyan',
     'Acting Alt Quarry manager', 'Nessy Salsabilita', 'Geotech Engineer', DATE '2026-07-22',
     'Adding Email Addresses to the Mailing List',
     'Adding admiral.leadinghands@srgglobal.com.au, lewis.smith@srgglobal.com.au and shane.wylie@srgglobal.com.au to the mailing list'),
    (v_doc_id, 2, 'Leonora - Genesis Minerals', 2, DATE '2026-07-22', 'Frank Jamshasb',
     'Geotechnical Engineer', 'Nessy Salsabilita', 'Geotech Engineer', DATE '2026-07-22',
     'Update the Geotech On-Call Number',
     'Remove Fred''s work number and update the Geotech on-call contact number'),
    (v_doc_id, 3, 'Leonora - Genesis Minerals', 3, DATE '2026-07-22', 'Shanny Chokkaiyan',
     'Acting Alt Quarry manager', 'Nessy Salsabilita', 'Geotech Engineer', DATE '2026-07-22',
     'Update TARP Communication Protocol for Linear Deformation Trends',
     'Changing linear trend from calling to email');

  RAISE NOTICE 'Genesis TARP seeded as document %', v_doc_id;
END $$;

-- ===========================================================================
-- Greatland Gold — Telfer Open Pit  (workbook version 2)
-- ===========================================================================
DO $$
DECLARE
  v_site_id bigint;
  v_doc_id  bigint;
BEGIN
  SELECT id INTO v_site_id FROM clients WHERE site_name ILIKE '%telfer%' LIMIT 1;
  IF v_site_id IS NULL THEN
    RAISE NOTICE 'Greatland seed skipped: no clients row with site_name ILIKE ''%%telfer%%''';
    RETURN;
  END IF;

  DELETE FROM tarp_documents WHERE site_id = v_site_id AND version = 2;
  UPDATE tarp_documents SET status = 'superseded'
    WHERE site_id = v_site_id AND status = 'active';

  INSERT INTO tarp_documents
    (site_id, heading, version, status, effective_from, footer_note, escalation_note)
  VALUES
    (v_site_id, 'Greatland Gold - Telfer Open Pit', 2, 'active', DATE '2026-01-30',
     'ALL CALLS FROM REMOTE ENGINEER TO SITE ENGINEER MUST BE FOLLOWED BY AN EMAIL SUMMARY',
     'Please confirm required response where all phone contacts are unreachable')
  RETURNING id INTO v_doc_id;

  INSERT INTO tarp_triggers
    (document_id, sort_order, risk_rating, band_label, trigger_label, colour,
     description, day_shift, night_shift, comments, def_type, tarp_level, requires_alarm)
  VALUES
    (v_doc_id, 1, 'Extreme', 'TARP Trigger 4 (RED)', 'Progressive trend', 'red',
     'Progressive (accelerating) slope displacement trend is identified',
     'Call Geotech', 'Call Geotech',
     '["1. State area of concern","2. Advise to respond as per site TARP","3. Conduct velocity analysis","4. Conduct collapse forecast where possible as per DTG procedure."]'::jsonb,
     'Progressive', 4, false),

    (v_doc_id, 2, 'Extreme', 'TARP Trigger 4 (RED)', 'Linear accelerating trend', 'red',
     'Stick-slip linear displacement trend with increasing average velocity is identified.',
     'Call Geotech', 'Call Geotech',
     '["1. State area of concern","2. Advise to respond as per site TARP","3. Conduct velocity analysis","4. Liaise with site engineers to support application of velocity ratio alarms where possible"]'::jsonb,
     'Linear Accelerating', 4, false),

    (v_doc_id, 3, 'Extreme', 'TARP Trigger 4 (RED)', 'Red Alarm', 'red',
     'A genuine Red Alarm is triggered.',
     'Call Geotech', 'Call Geotech',
     '["1. State alarm area","2. Advise to respond as per site TARP for the specific area","3. Check for progressive deformation trend and commence collapse forecast where possible"]'::jsonb,
     NULL, 4, true),

    (v_doc_id, 4, 'Moderate', 'TARP Trigger 3 (Orange)', 'Linear trend', 'orange',
     'A consistent linear (constant velocity) displacement trend is identified.',
     'Call Geotech', 'Call Geotech',
     '["1. Monitor as per TARP Trigger 3 procedures"]'::jsonb,
     'Linear', 3, false),

    (v_doc_id, 5, 'Moderate', 'TARP Trigger 3 (Orange)', 'Orange Alarm', 'orange',
     'A genuine Orange alarm is triggered',
     'Call Geotech', 'Call Geotech',
     '["1. Clear alarm. Conduct velocity analysis","2. Monitor closely for and change in deformation trend","3. Liaise with site engineers to support application of velocity ratio alarms where possible"]'::jsonb,
     NULL, 3, true),

    (v_doc_id, 6, 'Intermediate', 'TARP Trigger 2 (Yellow)', 'Non-radar related hazard', 'yellow',
     'Site Geotechnical Engineer(s) identify a Geotechnical Hazard or potential precursor to slope displacement. This may include tension cracks, ponding or increase in pore pressure, bench heave or significant blast damage, TARP trigger from other sensor types (E.g., VWP or RTS)',
     'Site Geotech to email DTG monitoring engineers',
     'Site Geotech to email DTG monitoring engineers',
     '["1. Highlight area on DTG site hazard map","2. Notify cross-shift","3. Record in daily log"]'::jsonb,
     NULL, 2, false),

    (v_doc_id, 7, 'Intermediate', NULL, 'Grey Alert', 'grey',
     'Connection between PMP and the radar is lost',
     'Call Geotech', 'Call Geotech',
     '["1. Clear alarm and email GroundProbe support desk","2. Check if possible to VNC to radar","3. If able to continue monitoring with VNC email geotech and call GroundProbe support desk"]'::jsonb,
     NULL, NULL, false),

    (v_doc_id, 8, 'Intermediate', NULL, 'Lost Connection', 'grey',
     'Connection between monitoring centre and site is lost',
     'Call Geotech', 'Call Geotech',
     '["1. Advise remote link is down and no longer able to monitor remotely","2. Advise Dispatch to follow site procedure for alarms (Dispatch to call site Geotech for all triggered alarms)"]'::jsonb,
     NULL, NULL, false),

    (v_doc_id, 9, NULL, NULL, 'Fall of Ground', 'grey',
     'Uncontrolled fall of ground (FOG) occurs. This may occur following a previously identified deformation trend or by an observed unexplained drop in coherence.',
     'Email Geotech', 'Email Geotech',
     '["All uncontrolled falls of ground (rockfalls) must be reported and documented. Site geotech is to be notified by email. If considered \"high potential\" or near miss - call on day shift"]'::jsonb,
     'Failure', NULL, false),

    (v_doc_id, 10, NULL, NULL, 'Unwanted / "false" alarm triggered', 'grey',
     'An unwanted alarm is triggered due to data contamination or other',
     'NA', 'NA',
     '["1. Clear the alarm","2. DTG engineer escalates internally for peer review/validation","3. Alarm is confirmed unwanted","4. Record in alarms register and include in daily report"]'::jsonb,
     NULL, NULL, false),

    (v_doc_id, 11, NULL, NULL, 'Data Contamination', 'grey',
     'Significant data contamination impacts the remote engineer''s ability to analyse and interpret data',
     'Email Geotech', 'Email Geotech',
     '[]'::jsonb, NULL, NULL, false),

    (v_doc_id, 12, NULL, NULL, 'Scheduled Radar Offline', 'green',
     NULL, 'Email Geotech', 'NA',
     '["1. State time period for offline","2. Follow up by email"]'::jsonb,
     NULL, NULL, false);

  INSERT INTO tarp_contacts (document_id, kind, sort_order, name, role, phone, email)
  VALUES
    (v_doc_id, 'escalation',   1, NULL,             'GEOTECH ON CALL',              '(+61) 409 189 852', NULL),
    (v_doc_id, 'escalation',   2, 'Peter DuPlessis', 'Sr. Geotech Telfer',          '(+61) 418 786 585', NULL),
    (v_doc_id, 'escalation',   3, NULL,             'DISPATCH',                     '(+61) 437 803 062', NULL),
    (v_doc_id, 'distribution', 1, 'Telfer Geotech On-Call', NULL, NULL, 'TelferOpenPitGeotechnicaldept@greatland.com.au'),
    (v_doc_id, 'distribution', 2, 'Peter DuPlessis',        NULL, NULL, 'peter.duplessis@greatland.au');

  INSERT INTO tarp_revisions
    (document_id, seq, site_label, version_no, approval_date, approved_by_site,
     site_role, approved_by_dtg, dtg_role, modified_date, sections_modified, remark)
  VALUES
    (v_doc_id, 1, 'Telfer', 1, DATE '2025-04-26', 'Max Lepper',
     'Senior Geotechnical Engineer', 'Peter Saunders', 'Director', DATE '2025-04-26',
     'All parts', 'New TARP'),
    (v_doc_id, 2, 'Telfer', 2, DATE '2026-01-29', 'Peter Du Plessis',
     'Production Superintendent', 'Lintang Sadewa', 'Geotechnical Engineer', DATE '2026-01-30',
     'TARP 4 variation', 'Added "Linear accelerating trend" into the TARP 4');

  RAISE NOTICE 'Greatland TARP seeded as document %', v_doc_id;
END $$;
