-- Migration 009: Telfer triggers TARP 2 on blast and rainfall events.
--
-- A document-backed policy is EXHAUSTIVE (see buildPolicyFromDocument): a
-- deformation type with no row in the client's TARP carries no TARP level at
-- all. That is what lets Leonora say "Regressive: nothing" simply by not listing
-- it — but it also meant Telfer's blast and rainfall records were being written
-- with no level, because the workbook this document was seeded from never had a
-- row for either. Telfer treats both as TARP Trigger 2 (Yellow), so the rows
-- have to exist on the document.
--
-- The three sites now differ deliberately, and each difference is data:
--
--   Telfer         Blast / Rainfall -> TARP 2       (this migration)
--   Leonora        Blast / Rainfall -> no trigger   (no row; also the code fallback)
--   Hidden Valley  named by band colour, not by level
--
-- These two rows PRINT: they appear in the TARP tab, the .xlsx export and the
-- signed chart, sorted with the other TARP 2 row rather than appended after the
-- grey ones. No revision row is added — recording the approval is a decision for
-- whoever signs it, from the TARP tab.
--
-- Idempotent. Safe to run repeatedly in the Supabase SQL Editor.

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
    RAISE NOTICE 'Telfer blast/rainfall skipped: no active TARP document. Seed 002 first, then re-run.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM tarp_triggers
     WHERE document_id = v_doc_id AND def_type IN ('Blast Event', 'Rainfall Event')
  ) THEN
    RAISE NOTICE 'Telfer blast/rainfall already present on document % — nothing to do.', v_doc_id;
    RETURN;
  END IF;

  -- Make room after the existing TARP 2 row (sort_order 6, "Non-radar related
  -- hazard"). UNIQUE (document_id, sort_order) is checked per row, so the shift
  -- goes out to a disjoint range and back rather than sliding through itself.
  UPDATE tarp_triggers
     SET sort_order = sort_order + 1000
   WHERE document_id = v_doc_id AND sort_order > 6;

  INSERT INTO tarp_triggers
    (document_id, sort_order, risk_rating, band_label, trigger_label, colour,
     description, day_shift, night_shift, comments, def_type, tarp_level, requires_alarm)
  VALUES
    (v_doc_id, 7, 'Intermediate', 'TARP Trigger 2 (Yellow)', 'Blast event', 'yellow',
     'Slope displacement associated with a production blast is identified.',
     'Email Geotech', 'Email Geotech',
     '["1. Confirm blast time and location","2. Conduct velocity analysis over the 24 hours following the blast","3. Advise site geotech if displacement does not return to background"]'::jsonb,
     'Blast Event', 2, false),

    (v_doc_id, 8, 'Intermediate', 'TARP Trigger 2 (Yellow)', 'Rainfall event', 'yellow',
     'Slope displacement associated with a rainfall event is identified.',
     'Email Geotech', 'Email Geotech',
     '["1. Confirm the rainfall period","2. Monitor for a response in slope velocity","3. Advise site geotech if displacement does not return to background"]'::jsonb,
     'Rainfall Event', 2, false);

  UPDATE tarp_triggers
     SET sort_order = sort_order - 998
   WHERE document_id = v_doc_id AND sort_order > 1000;

  RAISE NOTICE 'Telfer blast/rainfall seeded as TARP 2 on document %', v_doc_id;
END $$;
