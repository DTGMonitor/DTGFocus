-- Migration 006: the email distribution list lives in tarp_documents.distribution_raw.
--
-- Two representations existed: structured rows in tarp_contacts (kind =
-- 'distribution') and the free-text block in tarp_documents.distribution_raw.
-- Genesis kept theirs as one pasted block, Greatland as rows — so the app had to
-- render and reconcile both, and an engineer editing one would not see the other.
--
-- The free-text block wins: it is what engineers actually paste into Outlook, it
-- survives shared mailboxes and display-name formats that structured columns
-- mangle, and it round-trips to the client workbook unchanged.
--
-- This folds any structured distribution rows into distribution_raw, then removes
-- them. Escalation contacts are untouched.
--
-- Idempotent. Safe to run repeatedly.

DO $$
DECLARE
  v_doc     record;
  v_folded  text;
  v_count   integer := 0;
BEGIN
  FOR v_doc IN
    SELECT d.id, d.distribution_raw
      FROM tarp_documents d
     WHERE EXISTS (
       SELECT 1 FROM tarp_contacts c
        WHERE c.document_id = d.id AND c.kind = 'distribution'
     )
  LOOP
    -- "Name" <email>; one per line, in the order the document listed them.
    SELECT string_agg(
             CASE
               WHEN c.name IS NOT NULL AND c.email IS NOT NULL
                 THEN '"' || c.name || '" <' || c.email || '>'
               ELSE COALESCE(c.email, c.name)
             END,
             E'\n' ORDER BY c.sort_order
           )
      INTO v_folded
      FROM tarp_contacts c
     WHERE c.document_id = v_doc.id AND c.kind = 'distribution';

    UPDATE tarp_documents
       SET distribution_raw = CASE
             WHEN COALESCE(TRIM(v_doc.distribution_raw), '') = '' THEN v_folded
             -- Keep both if the document already had a block, rather than
             -- silently dropping addresses.
             ELSE v_doc.distribution_raw || E'\n' || v_folded
           END
     WHERE id = v_doc.id;

    DELETE FROM tarp_contacts
     WHERE document_id = v_doc.id AND kind = 'distribution';

    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Folded distribution contacts into distribution_raw for % document(s)', v_count;
END $$;
