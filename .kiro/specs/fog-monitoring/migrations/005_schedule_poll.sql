-- Migration 005: run the five-minute poll from Postgres instead of Vercel Cron.
--
-- WHY THIS EXISTS
-- ---------------
-- Vercel's Hobby plan allows cron jobs at a maximum frequency of ONCE PER DAY.
-- A `*/5 * * * *` entry in vercel.json is rejected at deploy time:
--   https://vercel.com/docs/cron-jobs/usage-and-pricing
--
-- Dropping to a daily schedule is not an option that preserves the feature. The
-- index needs 8 readings inside a 24-hour window and the station publishes
-- roughly every five minutes; one poll a day yields one reading a day, so the
-- scorer would refuse to assess anything, forever. The cadence IS the feature —
-- the endpoint has no history, so anything not polled is lost permanently.
--
-- So the schedule moves into Supabase, which already runs pg_cron for the
-- retention job in migration 001. pg_net makes the HTTP call. This costs
-- nothing, adds no third party, and keeps the secret inside the database.
--
-- If you later move to Vercel Pro, you can put the cron back in vercel.json and
-- unschedule this one — but do NOT run both, or every observation gets fetched
-- twice for no benefit. (It would not corrupt anything: the upsert on
-- (mac_address, observed_at) makes a duplicate poll a no-op. It is simply rude
-- to an endpoint we do not own.)
--
-- ---------------------------------------------------------------------------
-- BEFORE RUNNING: set the two values below.
--
--   1. Enable the extensions in the Supabase dashboard (Database > Extensions):
--        pg_cron   — the scheduler
--        pg_net    — outbound HTTP from Postgres
--        supabase_vault — encrypted secret storage (usually already enabled)
--
--   2. Store your deployment URL and cron secret in Vault. Run this ONCE,
--      substituting your own values. Vault is used rather than a plain table so
--      the secret is encrypted at rest and never shows up in a table dump:
--
--        select vault.create_secret(
--          'https://YOUR-APP.vercel.app/api/weather/poll?source=pg_cron',
--          'fog_poll_url',
--          'Target for the fog monitoring poll'
--        );
--
--        select vault.create_secret(
--          'YOUR-CRON-SECRET',           -- must match CRON_SECRET in Vercel
--          'fog_cron_secret',
--          'Bearer token for /api/weather/poll'
--        );
--
--      To change either later:
--        select vault.update_secret(id, 'new value')
--        from vault.secrets where name = 'fog_poll_url';
-- ---------------------------------------------------------------------------
--
-- Idempotent. Safe to run repeatedly.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ---------------------------------------------------------------------------
-- The tick. One HTTP POST, exactly what Vercel Cron would have sent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fog_poll_tick()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, vault
AS $$
DECLARE
  v_url        text;
  v_secret     text;
  v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets WHERE name = 'fog_poll_url';
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'fog_cron_secret';

  -- Fail loudly. A tick that silently does nothing is the failure mode this
  -- whole feature is least able to survive: readings just stop, the UI keeps
  -- rendering the last row it saw, and the gap is unrecoverable.
  IF v_url IS NULL THEN
    RAISE EXCEPTION 'Vault secret "fog_poll_url" is missing — see the header of migration 005';
  END IF;
  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'Vault secret "fog_cron_secret" is missing — see the header of migration 005';
  END IF;

  -- pg_net is asynchronous: this queues the request and returns immediately.
  -- The response lands in net._http_response, which is what the health view
  -- below reads. The poll route answers 200 even when individual stations
  -- fail, so a non-2xx here means the ROUTE is broken, not a station.
  SELECT net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || v_secret,
                 'Content-Type',  'application/json'
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION fog_poll_tick() FROM public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Schedule it. Five minutes, matching the station's own publish cadence.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM cron.unschedule('fog-poll')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fog-poll');

  PERFORM cron.schedule('fog-poll', '*/5 * * * *', 'SELECT fog_poll_tick()');
END;
$$;

-- ---------------------------------------------------------------------------
-- Health. `poll_runs` records what the ROUTE did; this records whether the
-- route was ever reached. Both are needed — a scheduler that stopped firing and
-- a route that started failing look identical from inside the application.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW fog_poll_schedule_health AS
SELECT
  r.created                                        AS called_at,
  r.status_code,
  -- The poll route answers 200 even when individual stations fail, so anything
  -- else here is the route or the secret, not the weather station.
  (r.status_code = 200)                            AS route_ok,
  r.error_msg,

  -- The route's OWN words, which is the whole point. A bare status code sends
  -- you hunting through Vercel logs for something the response already said —
  -- a 500 here is almost always `CRON_SECRET` missing from the deployment
  -- environment, and the body says exactly that.
  left(coalesce(r.content, ''), 300)               AS response_body,

  -- Guarded: a platform-level failure answers with an HTML error page, and an
  -- unguarded ::jsonb cast on that would make the whole view error out —
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

-- Useful when it goes quiet:
--   select * from fog_poll_schedule_health limit 20;
--   select * from cron.job where jobname = 'fog-poll';
--   select * from cron.job_run_details where jobname = 'fog-poll'
--     order by start_time desc limit 20;
