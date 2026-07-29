-- Migration 010: finish the response_method backfill started in 004.
--
-- 004 promoted the required response out of the free-text day_shift cell into a
-- column, and backfilled the seeded documents by matching that cell against
-- `Call%`, `Email%` and `NA`. Any row phrased differently kept a NULL:
--
--   Telfer  "Site Geotech to email DTG monitoring engineers"   -> NULL
--   Telfer  "Email Geotech"  (blast / rainfall, added by 009)  -> NULL
--
-- NULL means "follow the document default", so on a call-first site the TARP
-- tab printed a CALL badge beside a cell that says email — the 2am mistake 004
-- exists to prevent.
--
-- config/tarpDocument.ts now reads the cell when the column is NULL, so the tab
-- is already correct without this migration. This makes the same answer
-- structural, so the .xlsx export and any future consumer see it too, and so
-- publishing a revision carries it forward instead of writing the NULL back.
--
-- Conservative by construction:
--   * only rows where response_method IS NULL are touched
--   * only wording that names exactly one response is matched; a cell naming
--     both ("Call the supervisor and email the geotechs") is left NULL for a
--     human to classify, because guessing the order is not this migration's
--     call to make
--
-- Idempotent. Safe to run repeatedly in the Supabase SQL Editor.

BEGIN;

-- No action.
UPDATE tarp_triggers
   SET response_method = 'na'
 WHERE response_method IS NULL
   AND day_shift ~* '^\s*(na|n/a|none|no action( required)?)\s*\.?\s*$';

-- The two patterns below are the SQL twin of CALL_RE / EMAIL_RE in
-- config/tarpDocument.ts. Keep them in step, or the tab and the column will
-- disagree about the same cell.

-- Email only — the cell names email and never a call.
UPDATE tarp_triggers
   SET response_method = 'email'
 WHERE response_method IS NULL
   AND day_shift ~* '\m(e-?mail|e-?mails|e-?mailed|e-?mailing)\M'
   AND day_shift !~* '\m(call|calls|called|calling|phone|phoned|ring)\M';

-- Call — the cell names a call and never an email.
UPDATE tarp_triggers
   SET response_method = 'call'
 WHERE response_method IS NULL
   AND day_shift ~* '\m(call|calls|called|calling|phone|phoned|ring)\M'
   AND day_shift !~* '\m(e-?mail|e-?mails|e-?mailed|e-?mailing)\M';

-- What is left, if anything: cells naming both, or naming neither.
DO $$
DECLARE
  v_row record;
BEGIN
  FOR v_row IN
    SELECT t.id, t.document_id, t.trigger_label, t.day_shift
      FROM tarp_triggers t
     WHERE t.response_method IS NULL
     ORDER BY t.document_id, t.sort_order
  LOOP
    RAISE NOTICE 'Left for review — doc % row % (%): "%"',
      v_row.document_id, v_row.id, v_row.trigger_label, v_row.day_shift;
  END LOOP;
END $$;

COMMIT;
