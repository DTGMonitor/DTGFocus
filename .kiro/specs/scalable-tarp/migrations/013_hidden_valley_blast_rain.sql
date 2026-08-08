-- Migration 013: Hidden Valley triggers on blast and rainfall events.
--
-- The third site to take these rows, and the first to take them as an INTERNAL
-- notice. Migration 009 gave Telfer "Email Geotech" — a promise to the mine.
-- Hidden Valley's blast and rainfall rows are DTG watching its own back
-- analysis: we already know the blast happened, the site fired it, and what we
-- are recording is whether the slope answered. So the shift cells read
-- "Email DTG Internal", and config/tarpDocument.ts resolveDraftAudience reads
-- that wording to address the draft to DTG with no CC. Change the wording here
-- and the recipient changes with it — that is the point of it being data.
--
-- The band is yellow at TARP 2, the same standing Telfer gives them. Hidden
-- Valley does not NUMBER its bands (migration 008 sets its subject wording to
-- "{Colour} Notification:" / "{Colour} Alarm:"), so tarp_level is carried for
-- the engine while the printed chart and the email subject both say Yellow.
-- band_label and risk_rating are copied from whatever this document already
-- calls its yellow band rather than invented here, because the client's own
-- wording is the one the chart has to keep printing.
--
-- If an alarm fires alongside one of these, responseRequirementForType resolves
-- to the alarm row instead and the draft goes back to the site — an alarm is a
-- client-facing trigger in its own right, and no wording on this row overrides
-- that.
--
-- Idempotent. Safe to run repeatedly in the Supabase SQL Editor.

DO $$
DECLARE
  v_doc_id     bigint;
  v_band       text;
  v_risk       text;
  v_anchor     integer;
BEGIN
  SELECT d.id INTO v_doc_id
    FROM tarp_documents d
    JOIN clients c ON c.id = d.site_id
   WHERE c.site_name ILIKE '%hidden valley%' AND d.status = 'active'
   LIMIT 1;

  IF v_doc_id IS NULL THEN
    RAISE NOTICE 'Hidden Valley blast/rainfall skipped: no active TARP document. Create one from the TARP tab, then re-run.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM tarp_triggers
     WHERE document_id = v_doc_id AND def_type IN ('Blast Event', 'Rainfall Event')
  ) THEN
    RAISE NOTICE 'Hidden Valley blast/rainfall already present on document % — nothing to do.', v_doc_id;
    RETURN;
  END IF;

  -- The client's own name for its yellow band, and where that band sits. Fall
  -- back to the end of the chart when the document has no yellow row at all,
  -- rather than guessing a position among rows we cannot see.
  SELECT band_label, risk_rating, sort_order
    INTO v_band, v_risk, v_anchor
    FROM tarp_triggers
   WHERE document_id = v_doc_id AND colour = 'yellow'
   ORDER BY sort_order DESC
   LIMIT 1;

  IF v_anchor IS NULL THEN
    SELECT COALESCE(MAX(sort_order), 0) INTO v_anchor
      FROM tarp_triggers WHERE document_id = v_doc_id;
    RAISE NOTICE 'Hidden Valley has no yellow row — blast/rainfall appended at the end of the chart.';
  END IF;

  v_band := COALESCE(v_band, 'Yellow Notification');

  -- Make room after the anchor. UNIQUE (document_id, sort_order) is checked per
  -- row, so the shift goes out to a disjoint range and back rather than sliding
  -- through itself.
  UPDATE tarp_triggers
     SET sort_order = sort_order + 1000
   WHERE document_id = v_doc_id AND sort_order > v_anchor;

  INSERT INTO tarp_triggers
    (document_id, sort_order, risk_rating, band_label, trigger_label, colour,
     description, day_shift, night_shift, comments, def_type, tarp_level,
     requires_alarm, response_method)
  VALUES
    (v_doc_id, v_anchor + 1, v_risk, v_band, 'Blast event', 'yellow',
     'Slope displacement associated with a production blast is identified.',
     'Email DTG Internal', 'Email DTG Internal',
     '["1. Confirm blast time and location","2. Conduct velocity analysis over the 24 hours following the blast","3. Escalate to the site TARP response if displacement does not return to background"]'::jsonb,
     'Blast Event', 2, false, 'email'),

    (v_doc_id, v_anchor + 2, v_risk, v_band, 'Rainfall event', 'yellow',
     'Slope displacement associated with a rainfall event is identified.',
     'Email DTG Internal', 'Email DTG Internal',
     '["1. Confirm the rainfall period","2. Monitor for a response in slope velocity","3. Raise Atmospheric Refractivity as Service Impacted on the DQP where data quality is affected","4. Escalate to the site TARP response if displacement does not return to background"]'::jsonb,
     'Rainfall Event', 2, false, 'email');

  UPDATE tarp_triggers
     SET sort_order = sort_order - 998
   WHERE document_id = v_doc_id AND sort_order > 1000;

  RAISE NOTICE 'Hidden Valley blast/rainfall seeded as internal-notice rows on document %', v_doc_id;
END $$;
