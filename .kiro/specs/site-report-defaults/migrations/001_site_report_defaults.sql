-- Migration 001: the report each site USUALLY gets.
--
-- WHY THIS TABLE EXISTS
--
-- The report generator opened on one selection for every client — Radar / Data
-- Quality — whichever site was on screen. Telfer does take that document;
-- Leonora takes the Comprehensive report and Vale the Tabulation one, so every
-- report for those sites began with the same two corrections. The cost of
-- forgetting them is not a wasted click: it is a client receiving the wrong
-- document, or a preview built from a window nobody asked for.
--
-- Which report a client receives is a property of the CLIENT, not of the
-- analyst writing it that morning, so it is stored per site and shared by
-- everyone — exactly like the section layout it sits beside (report_layouts).
-- The two answer different questions and are deliberately separate tables:
--
--   site_report_defaults   WHICH document this site gets, and over what window
--   report_layouts         what is INSIDE that document, section by section
--
-- A layout is keyed by (site, category) because a site can have a layout for
-- each report it takes; a default is keyed by site alone, because there is only
-- one report it usually takes.
--
-- WHAT IS STORED
--
-- The generator's own strings — 'Radar', 'Comprehensive', 'daily' — and not a
-- second vocabulary that would have to be kept in step with the form. Every
-- column is nullable: a site that always takes the Comprehensive report but
-- chooses its window per report saves a category and no frequency, and the
-- generator leaves the frequency alone. A value the UI no longer offers is
-- DROPPED on read (utils/reportDefaults.js: normalizeDefault) rather than forced
-- into a <select> that has no such option, which is why no enum or CHECK
-- constrains these columns — a row that outlives a rename degrades to "no saved
-- default for that field" instead of failing to load.
--
-- Idempotent. Safe to run repeatedly in the Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- 1) The table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS site_report_defaults (
  site_id      bigint PRIMARY KEY REFERENCES clients (id) ON DELETE CASCADE,

  -- 'Radar' | 'Insar' — the generator's Report Type select.
  report_type  text,

  -- 'Data Quality' | 'Comprehensive' | 'Tabulation' | 'Water Body' |
  -- 'Deformation' — the generator's Category select.
  category     text,

  -- 'daily' | 'weekly' | 'monthly' | 'custom' | NULL for "ask each time".
  frequency    text,

  -- The span behind frequency = 'custom', in days. NULL for every other
  -- frequency: keeping a span against a Weekly default would resurrect a window
  -- the analyst never chose the next time someone picked Custom.
  custom_days  integer,

  updated_at   timestamptz NOT NULL DEFAULT now(),

  -- Who last decided what this client receives. Free text, matching how
  -- reports.generated_by and report_layouts.updated_by are written.
  updated_by   text
);

-- ---------------------------------------------------------------------------
-- 2) Keep updated_at honest.
--
-- The generator could send it, but then a row written by hand in the SQL editor
-- would not, and "when did this site's report change" is the first question
-- asked when a client says they were sent the wrong one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION site_report_defaults_touch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS site_report_defaults_touch ON site_report_defaults;
CREATE TRIGGER site_report_defaults_touch
  BEFORE UPDATE ON site_report_defaults
  FOR EACH ROW EXECUTE FUNCTION site_report_defaults_touch();

-- ---------------------------------------------------------------------------
-- 3) RLS.
--
-- Mirrors report_layouts: every surface that reaches this table sits behind the
-- admin login, and the same signed-in user both sets a site's default and reads
-- it back when generating the report, so a read-only policy would break the
-- control outright.
--
-- Drop this section if `clients` runs with RLS disabled on your project — the
-- two should be governed alike.
-- ---------------------------------------------------------------------------
ALTER TABLE site_report_defaults ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS site_report_defaults_read ON site_report_defaults;
CREATE POLICY site_report_defaults_read ON site_report_defaults
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS site_report_defaults_write ON site_report_defaults;
CREATE POLICY site_report_defaults_write ON site_report_defaults
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 4) No backfill.
--
-- A site with no row opens the generator exactly as it does today. Seeding every
-- client with 'Data Quality' would turn the form's current behaviour into a
-- stated decision for clients nobody has reviewed, and there would then be no
-- way to tell a site that really takes the DQ assessment from one that has
-- simply never been set.
--
-- To set the examples that prompted this, adjust the names and run:
--
--   INSERT INTO site_report_defaults (site_id, report_type, category, frequency, updated_by)
--   SELECT id, 'Radar', v.category, v.frequency, 'migration'
--     FROM clients
--     JOIN (VALUES
--             ('Telfer',  'Data Quality',  'daily'),
--             ('Leonora', 'Comprehensive', 'daily'),
--             ('Vale',    'Tabulation',    'daily')
--          ) AS v (site_name, category, frequency)
--       ON clients.site_name = v.site_name
--   ON CONFLICT (site_id) DO UPDATE
--     SET report_type = EXCLUDED.report_type,
--         category    = EXCLUDED.category,
--         frequency   = EXCLUDED.frequency,
--         updated_by  = EXCLUDED.updated_by;
--
-- Or just set each site once from the report generator, which is what the
-- "Save current as default" control writes.
-- ---------------------------------------------------------------------------
