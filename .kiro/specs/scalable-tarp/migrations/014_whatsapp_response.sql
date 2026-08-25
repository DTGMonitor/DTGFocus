-- Migration 014: WhatsApp as a response method.
--
-- The charts already name it. An Indonesian site's day-shift cell reads
-- "Telfon Geotek, WhatsApp, Email semua kontak", the client-facing TARP view
-- says "Send WhatsApp message + Email distribution list", and the deformation
-- form has offered WhatsApp as a contact method all along. The one place it
-- could not be said was the column that decides what a trigger requires.
--
-- Widens three CHECK constraints and nothing else. No row is rewritten: every
-- existing value is still valid, so no chart, workbook or email subject changes
-- until someone deliberately sets a row to 'whatsapp'.
--
-- Ranking, for the record (config/tarpDocument.ts RESPONSE_STRENGTH): a
-- WhatsApp message sits ABOVE no action and BELOW email. It is a chat message —
-- it reaches a phone, but nothing about it is a record or an answered call.
--
-- Idempotent. Safe to run repeatedly in the Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- 1) Per-row response method
-- ---------------------------------------------------------------------------
ALTER TABLE tarp_triggers
  DROP CONSTRAINT IF EXISTS tarp_triggers_response_method_chk;

ALTER TABLE tarp_triggers
  ADD CONSTRAINT tarp_triggers_response_method_chk
  CHECK (response_method IS NULL
         OR response_method IN ('call', 'email', 'whatsapp', 'call_then_email', 'na'));

-- ---------------------------------------------------------------------------
-- 2) Document defaults — the site's normal response, and its de-escalation
-- ---------------------------------------------------------------------------
ALTER TABLE tarp_documents
  DROP CONSTRAINT IF EXISTS tarp_documents_default_response_method_chk;

ALTER TABLE tarp_documents
  ADD CONSTRAINT tarp_documents_default_response_method_chk
  CHECK (default_response_method IN ('call', 'email', 'whatsapp', 'call_then_email', 'na'));

-- Named as migration 005 named it, not as it reads.
ALTER TABLE tarp_documents
  DROP CONSTRAINT IF EXISTS tarp_documents_deescalation_method_chk;

ALTER TABLE tarp_documents
  ADD CONSTRAINT tarp_documents_deescalation_method_chk
  CHECK (deescalation_response_method IN ('call', 'email', 'whatsapp', 'call_then_email', 'na'));

COMMENT ON COLUMN tarp_triggers.response_method IS
  'call | email | whatsapp | call_then_email | na. NULL means read the day-shift '
  'cell, then fall back to the document default. See resolveResponseRequirement.';
