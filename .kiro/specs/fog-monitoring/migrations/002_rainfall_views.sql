-- Migration 002: rainfall derivation in SQL.
--
-- WHY THIS IS SQL AND NOT REACT
-- -----------------------------
-- `hourlyrainin` is a RATE (inches per hour) — the instantaneous rate the
-- station is currently seeing. It is NOT an accumulation, and summing it over
-- a window produces a number that looks plausible and is meaningless.
--
-- Real hourly totals come from deltas of the daily accumulator:
--
--     hourly_total(h) = dailyrainin(end of h) - dailyrainin(start of h)
--
-- with two traps:
--
--   1. RESET. `dailyrainin` returns to 0 at local midnight in the STATION's
--      timezone (the `tz` field — Asia/Singapore for ASBSAR1, so UTC+8, not
--      the site's zone and not UTC). A negative delta is that reset, and the
--      correct total for that step is the end value on its own.
--
--   2. GAPS. Polling gaps produce series gaps. An hour we did not watch is
--      NULL, never 0. A missing hour and a dry hour must not render the same —
--      "no rain recorded" and "no recording" are opposite operational facts.
--
-- Doing this per-reading in the client means every consumer reimplements both
-- traps. One view, one implementation.
--
-- Idempotent. Safe to run repeatedly.

-- ---------------------------------------------------------------------------
-- 1) Per-reading rainfall increments.
--
-- Deltas are taken across the WHOLE ordered series, not within hour buckets:
-- rain that fell between the last reading of one hour and the first reading of
-- the next belongs to the later hour and would otherwise vanish.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW weather_rain_steps AS
WITH ordered AS (
  SELECT
    r.mac_address,
    r.observed_at,
    r.rain_daily_mm,
    s.timezone,
    LAG(r.rain_daily_mm) OVER w AS prev_daily_mm,
    LAG(r.observed_at)   OVER w AS prev_observed_at
  FROM weather_readings r
  JOIN weather_stations s ON s.mac_address = r.mac_address
  WHERE r.rain_daily_mm IS NOT NULL
  WINDOW w AS (PARTITION BY r.mac_address ORDER BY r.observed_at)
)
SELECT
  mac_address,
  timezone,
  observed_at,
  prev_observed_at,
  rain_daily_mm,

  -- Minutes since the previous reading. NULL on the first row of a station.
  EXTRACT(EPOCH FROM (observed_at - prev_observed_at)) / 60.0 AS gap_minutes,

  CASE
    -- No predecessor: the increment is genuinely unknown, not zero.
    WHEN prev_daily_mm IS NULL THEN NULL
    WHEN rain_daily_mm >= prev_daily_mm THEN rain_daily_mm - prev_daily_mm
    -- Counter went backwards => local-midnight reset. Everything on the clock
    -- now fell after the reset, so the step IS the current value.
    ELSE rain_daily_mm
  END AS delta_mm,

  (rain_daily_mm < prev_daily_mm) AS is_reset,

  -- Local wall-clock hour, in the station's own zone. `AT TIME ZONE tz` on a
  -- timestamptz yields a naive local timestamp, which is exactly what the
  -- reset boundary is defined against.
  date_trunc('hour', observed_at AT TIME ZONE timezone) AS hour_local,
  date_trunc('day',  observed_at AT TIME ZONE timezone) AS day_local
FROM ordered;

-- ---------------------------------------------------------------------------
-- 2) Hourly totals, with an explicit coverage test.
--
-- COVERAGE RULE: a step is trusted only if it spans <= 20 minutes. At the
-- 5-minute poll cadence that tolerates three consecutive misses; beyond it we
-- cannot say whether rain fell inside the gap. Trusted minutes are summed per
-- hour, and an hour needs >= 45 of its 60 minutes covered to report a number.
-- Below that it reports NULL, and `covered_minutes` says how thin it was.
--
-- Untrusted steps are excluded from BOTH the sum and the coverage, so the two
-- stay consistent: an hour containing a long gap loses the coverage that would
-- have justified reporting the partial total it still holds.
--
-- A step straddling an hour boundary is attributed wholly to the later hour.
-- At a 5-minute cadence that is at most 5 minutes of slop and it keeps the
-- rule stateless.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW weather_rain_hourly AS
SELECT
  mac_address,
  timezone,
  hour_local,
  -- Same instant expressed as a real instant, for charting.
  (hour_local AT TIME ZONE timezone) AS hour_start,

  COUNT(*) FILTER (WHERE delta_mm IS NOT NULL AND gap_minutes <= 20) AS sample_count,

  LEAST(60.0, COALESCE(
    SUM(gap_minutes) FILTER (WHERE delta_mm IS NOT NULL AND gap_minutes <= 20),
    0
  ))::numeric(5,1) AS covered_minutes,

  CASE
    WHEN COALESCE(
           SUM(gap_minutes) FILTER (WHERE delta_mm IS NOT NULL AND gap_minutes <= 20),
           0
         ) >= 45
    -- Guard the float noise that turns a dry hour into 1e-15 mm.
    THEN GREATEST(0, ROUND(
           SUM(delta_mm) FILTER (WHERE gap_minutes <= 20)::numeric, 3))
    ELSE NULL      -- not measured, NOT zero
  END AS rain_mm,

  bool_or(is_reset) AS had_reset
FROM weather_rain_steps
GROUP BY mac_address, timezone, hour_local;

-- ---------------------------------------------------------------------------
-- 3) Daily totals.
--
-- Taken as MAX(rain_daily_mm) over the station's local day rather than by
-- summing the hourly buckets. The station's own accumulator is authoritative
-- and monotonic within a day, so the max is the day total even when our
-- polling had holes — it survives gaps that would make a sum of hours
-- under-report. The hourly view is for shape; this is for totals.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW weather_rain_daily AS
SELECT
  mac_address,
  timezone,
  day_local,
  (day_local AT TIME ZONE timezone) AS day_start,
  ROUND(MAX(rain_daily_mm)::numeric, 3) AS rain_mm,
  COUNT(*)                             AS sample_count,
  -- Hours of the local day in which we hold at least one reading. 24 means
  -- fully watched; anything less means the total is a floor, not a fact.
  COUNT(DISTINCT hour_local)           AS hours_observed
FROM weather_rain_steps
GROUP BY mac_address, timezone, day_local;

-- ---------------------------------------------------------------------------
-- 4) Grants.
--
-- Views run with the privileges of their owner, so RLS on weather_readings is
-- NOT enforced through them by default. That is acceptable here only because
-- the underlying policy grants every authenticated user read access to every
-- reading — the view exposes nothing the base table does not. If per-site
-- restrictions are ever added to weather_readings, these views must be
-- recreated WITH (security_invoker = true).
-- ---------------------------------------------------------------------------
ALTER VIEW weather_rain_steps  SET (security_invoker = true);
ALTER VIEW weather_rain_hourly SET (security_invoker = true);
ALTER VIEW weather_rain_daily  SET (security_invoker = true);

GRANT SELECT ON weather_rain_steps, weather_rain_hourly, weather_rain_daily
  TO authenticated;
