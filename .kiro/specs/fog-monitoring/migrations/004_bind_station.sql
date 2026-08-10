-- Migration 004: atomic station binding.
--
-- WHY A FUNCTION AND NOT TWO STATEMENTS FROM THE ROUTE
-- ---------------------------------------------------
-- `weather_stations_one_active_per_site` is a PARTIAL unique index. Partial
-- unique indexes cannot be declared as deferrable constraints, so Postgres
-- checks them ROW BY ROW during an UPDATE — not at statement end.
--
-- That rules out the obvious one-liner:
--
--     UPDATE weather_stations SET is_active = (mac_address = $1) WHERE site_id = $2;
--
-- because the row order is unspecified: if the new station is flipped to true
-- before the old one is flipped to false, the index rejects the statement.
--
-- The order that always works is deactivate-then-activate, and doing it from
-- the route means two round trips with a window in between. A failure inside
-- that window leaves the site with NO active station and the poller silently
-- stops collecting for it — the exact failure this feature cannot tolerate,
-- because the endpoint has no history and the gap is permanent.
--
-- Inside a function the two statements share one transaction, so the site
-- either ends up on the new station or stays on the old one.
--
-- Idempotent. Safe to run repeatedly.

CREATE OR REPLACE FUNCTION bind_weather_station(
  p_site_id      bigint,
  p_mac_address  text,
  p_name         text,
  p_latitude     double precision,
  p_longitude    double precision,
  p_elevation_m  double precision DEFAULT NULL,
  p_distance_km  double precision DEFAULT NULL,
  p_timezone     text DEFAULT 'UTC',
  p_station_type text DEFAULT NULL
)
RETURNS weather_stations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result weather_stations;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM clients WHERE id = p_site_id) THEN
    RAISE EXCEPTION 'site % does not exist', p_site_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- 1) Stand every station for this site down first. Never leave two rows
  --    momentarily active — see the note above about row-by-row checking.
  UPDATE weather_stations
     SET is_active = false
   WHERE site_id = p_site_id
     AND is_active;

  -- 2) A MAC already bound elsewhere moves to this site rather than
  --    duplicating. mac_address is the natural key for readings and
  --    assessments, so a second row for the same hardware would split its
  --    history in two and neither half would score.
  INSERT INTO weather_stations AS ws (
    site_id, mac_address, name, latitude, longitude,
    elevation_m, distance_km, timezone, station_type, is_active
  )
  VALUES (
    p_site_id, upper(p_mac_address), p_name, p_latitude, p_longitude,
    p_elevation_m, p_distance_km, COALESCE(p_timezone, 'UTC'), p_station_type, true
  )
  ON CONFLICT (mac_address) DO UPDATE SET
    site_id     = EXCLUDED.site_id,
    name        = COALESCE(EXCLUDED.name, ws.name),
    latitude    = EXCLUDED.latitude,
    longitude   = EXCLUDED.longitude,
    -- Elevation is operator-entered and not reported by the endpoint, so a
    -- rebind must not wipe a value someone took the trouble to work out.
    elevation_m = COALESCE(EXCLUDED.elevation_m, ws.elevation_m),
    distance_km = EXCLUDED.distance_km,
    timezone    = EXCLUDED.timezone,
    station_type = COALESCE(EXCLUDED.station_type, ws.station_type),
    is_active   = true
  RETURNING * INTO result;

  RETURN result;
END;
$$;

-- Service role only. The route handler performs the admin check; letting any
-- authenticated user call this would hand them the ability to rebind a site's
-- weather station, which no read policy in migration 001 grants.
REVOKE ALL ON FUNCTION bind_weather_station(
  bigint, text, text, double precision, double precision,
  double precision, double precision, text, text
) FROM public, anon, authenticated;
