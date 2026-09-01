-- Migration 006: repoint the fog poll at the current deployment hostname.
--
-- WHAT HAPPENED
-- -------------
-- The app moved from `dtg-focus.vercel.app` to `dashboard.digitaltwingeotechnical.com`.
-- The scheduler did not move with it. `fog_poll_tick()` (migration 005) reads its
-- target from the Vault secret `fog_poll_url`, which is a plain string set once by
-- hand — nothing in a deploy touches it, so a domain change silently orphans it.
--
-- pg_cron kept firing every five minutes. Every tick POSTed to the old hostname and
-- got Vercel's 404 ("The deployment could not be found on Vercel"). The route was
-- never reached, so no `poll_runs` row was ever written and no readings accumulated:
--
--   last poll_runs row      2026-08-27 18:00 UTC  (1/1 succeeded — healthy, then nothing)
--   last weather_readings   2026-08-27 17:59 UTC
--   every tick since        status_code 404
--
-- This is the failure mode migration 005's header calls out as the one the feature is
-- least able to survive: the UI keeps rendering the last row it saw, and the gap is
-- unrecoverable — the station endpoint has no history to backfill from.
--
-- Note the *route* was fine the whole time. An unauthenticated POST to the new host
-- answers 401 (not 500), which is proof `CRON_SECRET` is present in the new Vercel
-- environment; an authenticated POST runs a full cycle and returns 200. Only the URL
-- the database holds was stale.
--
-- ===========================================================================
-- RUN STEP 1 AND STEP 2 AS SEPARATE QUERIES.
--
-- The Supabase SQL Editor wraps whatever you submit in a single transaction, so a
-- failure anywhere rolls back everything before it — including the one-line fix.
-- Step 2 is a repair of an unrelated diagnostic view; it must not be able to take
-- Step 1 down with it.
--
-- Both steps are idempotent and safe to run repeatedly.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- STEP 1 — the actual fix. Repoint the Vault secret. Run this on its own.
--
-- `update_secret` rather than `create_secret`: the secret already exists, and a
-- second row under the same name would make the `SELECT ... WHERE name =` in
-- fog_poll_tick() ambiguous — it would pick one arbitrarily, which is how you get
-- a poll that works only half the time.
-- ---------------------------------------------------------------------------
SELECT vault.update_secret(
  id,
  'https://dashboard.digitaltwingeotechnical.com/api/weather/poll?source=pg_cron'
)
FROM vault.secrets
WHERE name = 'fog_poll_url';

-- Confirm it took (should print the new URL):
--   SELECT name, decrypted_secret FROM vault.decrypted_secrets WHERE name = 'fog_poll_url';

-- Fire one tick immediately rather than waiting up to five minutes for pg_cron.
-- Returns a pg_net request id; the response lands asynchronously.
--   SELECT fog_poll_tick();

-- A few seconds later, the route's own audit trail should start moving again:
--   SELECT * FROM poll_runs ORDER BY started_at DESC LIMIT 5;


-- ---------------------------------------------------------------------------
-- STEP 2 — repair the health view. Run this separately, and only after Step 1.
--
-- The deployed copy of `fog_poll_schedule_health` predates the guard in migration
-- 005 and casts `r.content::jsonb` on any 200. Vercel's 404 body is plain text, so
-- selecting every column errors with:
--
--   22P02  invalid input syntax for type json  —  Token "The" is invalid
--
-- The view therefore broke at exactly the moment it was the thing you would reach
-- for. Recreated below with 005's regex guard, so a non-JSON body degrades to NULL
-- columns instead of taking the whole view down.
--
-- DROP then CREATE, not CREATE OR REPLACE. The deployed view's columns are ordered
-- `status_code, called_at, error_msg, route_ok, ...` and it has no `response_body`.
-- CREATE OR REPLACE can only append columns to the end of an existing view — it
-- cannot rename or reorder them, and fails with:
--
--   42P16  cannot change name of view column "status_code" to "called_at"
--
-- The DROP is deliberately not CASCADE: nothing should depend on a diagnostic view,
-- and if something does, this should fail loudly rather than quietly delete it.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS fog_poll_schedule_health;

CREATE VIEW fog_poll_schedule_health AS
SELECT
  r.created                                        AS called_at,
  r.status_code,
  -- The poll route answers 200 even when individual stations fail, so anything
  -- else here is the route or the secret, not the weather station.
  (r.status_code = 200)                            AS route_ok,
  r.error_msg,

  -- The route's OWN words. A bare status code sends you hunting through Vercel
  -- logs for something the response already said — a 500 here is almost always
  -- `CRON_SECRET` missing from the deployment environment, and the body says so.
  left(coalesce(r.content, ''), 300)               AS response_body,

  -- Guarded: a platform-level failure answers with plain text or an HTML error
  -- page, and an unguarded ::jsonb cast on that makes the whole view error out —
  -- blinding the one query you reach for when things are already broken.
  CASE WHEN r.status_code = 200 AND r.content ~ '^\s*\{'
       THEN (r.content::jsonb ->> 'succeeded')::int END AS stations_succeeded,
  CASE WHEN r.status_code = 200 AND r.content ~ '^\s*\{'
       THEN (r.content::jsonb ->> 'failed')::int END    AS stations_failed
FROM net._http_response r
WHERE r.created > now() - interval '24 hours'
ORDER BY r.created DESC;

COMMENT ON VIEW fog_poll_schedule_health IS
  'Did the scheduler actually reach /api/weather/poll? Empty means pg_cron is not firing — check cron.job_run_details.';

-- Verify — the newest rows should now be 200, and a SELECT * must not error:
--   SELECT * FROM fog_poll_schedule_health LIMIT 5;

-- Confirm the schedule itself never stopped (it did not — it was firing into a 404):
--   SELECT * FROM cron.job WHERE jobname = 'fog-poll';


-- ---------------------------------------------------------------------------
-- AFTERWARDS
--
-- The four-day gap emptied the 24-hour scoring window, so the index returns
-- INSUFFICIENT_HISTORY until eight readings accumulate — roughly forty minutes at
-- the five-minute cadence. That is expected, not a second fault.
--
-- NEXT TIME THE DOMAIN CHANGES: this secret has to change with it. It is the only
-- place the deployment hostname is written down outside Vercel itself — the
-- application code contains no hardcoded hostname.
-- ---------------------------------------------------------------------------
