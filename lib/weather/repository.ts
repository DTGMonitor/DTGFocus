// lib/weather/repository.ts
//
// Every database access for the fog feature, in one place.
//
// Each function takes a SupabaseClient rather than importing one, so the same
// query can run under the service role (the poll, which writes) or under the
// caller's session (the read routes, where RLS must apply). Baking a client in
// here would make it impossible to tell which of the two a given call uses.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FogReading, FogResult, Verdict } from './fogIndex';
import type { ReadingRow } from './derive';

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

export interface StationRow {
  id: number;
  site_id: number;
  mac_address: string;
  name: string | null;
  latitude: number;
  longitude: number;
  elevation_m: number | null;
  distance_km: number | null;
  timezone: string;
  station_type: string | null;
  is_active: boolean;
}

const STATION_COLUMNS =
  'id, site_id, mac_address, name, latitude, longitude, elevation_m, ' +
  'distance_km, timezone, station_type, is_active';

export interface ReadingRecord {
  observed_at: string;
  temp_c: number | null;
  dew_point_c: number | null;
  dpd_c: number | null;
  humidity: number | null;
  wind_kmh: number | null;
  wind_gust_kmh: number | null;
  wind_dir: number | null;
  solar_wm2: number | null;
  uv: number | null;
  pressure_hpa: number | null;
  rain_rate_mmh: number | null;
  rain_daily_mm: number | null;
  solar_elevation_deg: number | null;
  ghi_clear_wm2: number | null;
  clearness_index: number | null;
}

const READING_COLUMNS =
  'observed_at, temp_c, dew_point_c, dpd_c, humidity, wind_kmh, ' +
  'wind_gust_kmh, wind_dir, solar_wm2, uv, pressure_hpa, rain_rate_mmh, ' +
  'rain_daily_mm, solar_elevation_deg, ghi_clear_wm2, clearness_index';

export interface AssessmentRow {
  assessed_at: string;
  score_a: number | null;
  verdict: Verdict;
  raw_verdict: Verdict | null;
  hysteresis_held: boolean;
  reason: string | null;
  components: unknown;
  gates: unknown;
  minutes_saturated: number | null;
  dt_dt: number | null;
  kt_peak: number | null;
  pressure_delta_hpa: number | null;
  history_hours: number | null;
  reading_count: number | null;
  index_b_available: boolean;
  constants: unknown;
  algorithm_version: string;
}

const ASSESSMENT_COLUMNS =
  'assessed_at, score_a, verdict, raw_verdict, hysteresis_held, reason, ' +
  'components, gates, minutes_saturated, dt_dt, kt_peak, pressure_delta_hpa, ' +
  'history_hours, reading_count, index_b_available, constants, algorithm_version';

export interface HourlyRainRow {
  hour_start: string;
  rain_mm: number | null;
  covered_minutes: number;
  sample_count: number;
  had_reset: boolean;
}

export interface DailyRainRow {
  day_start: string;
  rain_mm: number | null;
  sample_count: number;
  hours_observed: number;
}

/**
 * Cast a PostgREST result to its row type.
 *
 * The project has no generated database types, and supabase-js infers row
 * shapes by parsing the select string as a TYPE LITERAL — which it cannot do
 * for the shared `*_COLUMNS` constants above, since those are concatenated at
 * runtime. Without generated types the shape has to be asserted somewhere; it
 * is asserted here, at the single boundary where database rows enter typed
 * code, rather than scattered across the routes.
 *
 * If Supabase type generation is ever wired into the build, delete this and
 * the row interfaces above.
 */
const rows = <T>(data: unknown): T => data as T;

/** Thrown for any Postgres error, so routes have one thing to catch. */
export class RepositoryError extends Error {
  constructor(operation: string, cause: string) {
    super(`${operation}: ${cause}`);
    this.name = 'RepositoryError';
  }
}

// ---------------------------------------------------------------------------
// Stations
// ---------------------------------------------------------------------------

export async function listActiveStations(
  db: SupabaseClient
): Promise<StationRow[]> {
  const { data, error } = await db
    .from('weather_stations')
    .select(STATION_COLUMNS)
    .eq('is_active', true)
    .order('id');

  if (error) throw new RepositoryError('listActiveStations', error.message);
  return rows<StationRow[]>(data ?? []);
}

/**
 * The station bound to a site, or null.
 *
 * Single by construction: `weather_stations_one_active_per_site` guarantees at
 * most one active row per site, which is what lets every read route resolve
 * "the site's station" without a tie-break.
 */
export async function getStationForSite(
  db: SupabaseClient,
  siteId: number
): Promise<StationRow | null> {
  const { data, error } = await db
    .from('weather_stations')
    .select(STATION_COLUMNS)
    .eq('site_id', siteId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) throw new RepositoryError('getStationForSite', error.message);
  return rows<StationRow | null>(data ?? null);
}

/** Bind via the RPC in migration 004, which does it in one transaction. */
export async function bindStation(
  db: SupabaseClient,
  params: {
    siteId: number;
    macAddress: string;
    name: string | null;
    latitude: number;
    longitude: number;
    elevationM: number | null;
    distanceKm: number | null;
    timezone: string;
    stationType: string | null;
  }
): Promise<StationRow> {
  const { data, error } = await db.rpc('bind_weather_station', {
    p_site_id: params.siteId,
    p_mac_address: params.macAddress,
    p_name: params.name,
    p_latitude: params.latitude,
    p_longitude: params.longitude,
    p_elevation_m: params.elevationM,
    p_distance_km: params.distanceKm,
    p_timezone: params.timezone,
    p_station_type: params.stationType,
  });

  if (error) throw new RepositoryError('bindStation', error.message);
  return rows<StationRow>(data);
}

// ---------------------------------------------------------------------------
// Readings
// ---------------------------------------------------------------------------

/**
 * Upsert readings on (mac_address, observed_at).
 *
 * This is what makes the poll idempotent. The station reports on its own
 * cadence, so a five-minute poll re-reads the same observation more often than
 * not, and a cron that fires twice in a minute must not double the series.
 */
export async function upsertReadings(
  db: SupabaseClient,
  readings: ReadingRow[]
): Promise<number> {
  if (readings.length === 0) return 0;

  const { error } = await db
    .from('weather_readings')
    .upsert(readings, { onConflict: 'mac_address,observed_at' });

  if (error) throw new RepositoryError('upsertReadings', error.message);
  return readings.length;
}

/**
 * Readings for a station since an instant, oldest first.
 *
 * `untilIso` bounds the window at both ends. Without it a report summarising
 * last week would pull every reading from then to now — correct once the
 * summariser filters, but pointless traffic that grows with the retention
 * period rather than with the window.
 */
export async function fetchReadings(
  db: SupabaseClient,
  macAddress: string,
  sinceIso: string,
  untilIso?: string
): Promise<ReadingRecord[]> {
  let query = db
    .from('weather_readings')
    .select(READING_COLUMNS)
    .eq('mac_address', macAddress)
    .gte('observed_at', sinceIso);

  if (untilIso) query = query.lte('observed_at', untilIso);

  const { data, error } = await query.order('observed_at', { ascending: true });

  if (error) throw new RepositoryError('fetchReadings', error.message);
  return rows<ReadingRecord[]>(data ?? []);
}

/** Assessments across a window, oldest first. */
export async function fetchAssessments(
  db: SupabaseClient,
  macAddress: string,
  sinceIso: string,
  untilIso?: string
): Promise<AssessmentRow[]> {
  let query = db
    .from('fog_assessments')
    .select(ASSESSMENT_COLUMNS)
    .eq('mac_address', macAddress)
    .gte('assessed_at', sinceIso);

  if (untilIso) query = query.lte('assessed_at', untilIso);

  const { data, error } = await query.order('assessed_at', { ascending: true });

  if (error) throw new RepositoryError('fetchAssessments', error.message);
  return rows<AssessmentRow[]>(data ?? []);
}

export async function fetchLatestReading(
  db: SupabaseClient,
  macAddress: string
): Promise<ReadingRecord | null> {
  const { data, error } = await db
    .from('weather_readings')
    .select(READING_COLUMNS)
    .eq('mac_address', macAddress)
    .order('observed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new RepositoryError('fetchLatestReading', error.message);
  return rows<ReadingRecord | null>(data ?? null);
}

/**
 * Database row -> scorer input.
 *
 * Missing thermodynamics become NaN rather than 0, so the scorer's
 * finite-number filter drops the reading instead of treating an unknown dew
 * point depression as perfectly saturated air.
 */
export function toFogReading(row: ReadingRecord): FogReading {
  return {
    observedAt: new Date(row.observed_at),
    tempC: row.temp_c ?? NaN,
    dewPointC: row.dew_point_c ?? NaN,
    dpdC: row.dpd_c ?? NaN,
    windKmh: row.wind_kmh,
    windGustKmh: row.wind_gust_kmh,
    humidity: row.humidity,
    solarWm2: row.solar_wm2,
    clearnessIndex: row.clearness_index,
    solarElevationDeg: row.solar_elevation_deg ?? 0,
    pressureHpa: row.pressure_hpa,
    rainRateMmh: row.rain_rate_mmh,
  };
}

// ---------------------------------------------------------------------------
// Assessments
// ---------------------------------------------------------------------------

export async function fetchLatestAssessment(
  db: SupabaseClient,
  macAddress: string,
  beforeIso?: string
): Promise<AssessmentRow | null> {
  let query = db
    .from('fog_assessments')
    .select(ASSESSMENT_COLUMNS)
    .eq('mac_address', macAddress);

  // The poll passes the instant it is about to score. Without it, a rerun in
  // the same minute would read back the row it just wrote and treat its own
  // output as the previous state, which breaks hysteresis on every retry.
  if (beforeIso) query = query.lt('assessed_at', beforeIso);

  const { data, error } = await query
    .order('assessed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new RepositoryError('fetchLatestAssessment', error.message);
  return rows<AssessmentRow | null>(data ?? null);
}

/**
 * Persist an assessment.
 *
 * Insufficient-history results are stored too. "The poller ran but could not
 * score" and "the poller did not run" are different operational facts, and
 * fog_assessments is the only table that survives the 90-day prune to tell
 * them apart.
 */
export async function upsertAssessment(
  db: SupabaseClient,
  macAddress: string,
  assessedAt: Date,
  result: FogResult
): Promise<void> {
  const row =
    result.status === 'scored'
      ? {
          mac_address: macAddress,
          assessed_at: assessedAt.toISOString(),
          score_a: result.scoreA,
          verdict: result.verdict,
          raw_verdict: result.rawVerdict,
          hysteresis_held: result.hysteresisHeld,
          reason: result.reason,
          components: result.components,
          gates: result.gates,
          minutes_saturated: result.minutesSaturated,
          dt_dt: result.dTdt,
          kt_peak: result.ktPeak,
          pressure_delta_hpa: result.pressureDeltaHpa,
          history_hours: Number(result.historyHours.toFixed(2)),
          reading_count: result.readingCount,
          index_b_available: result.indexB.available,
          constants: result.constants,
          algorithm_version: result.constants.version,
        }
      : {
          mac_address: macAddress,
          assessed_at: assessedAt.toISOString(),
          score_a: null,
          verdict: result.verdict,
          raw_verdict: result.verdict,
          hysteresis_held: false,
          reason: result.reason,
          components: [],
          gates: [],
          minutes_saturated: null,
          dt_dt: null,
          kt_peak: null,
          pressure_delta_hpa: null,
          history_hours: Number(result.historyHours.toFixed(2)),
          reading_count: result.readingCount,
          index_b_available: false,
          constants: result.constants,
          algorithm_version: result.constants.version,
        };

  const { error } = await db
    .from('fog_assessments')
    .upsert(row, { onConflict: 'mac_address,assessed_at' });

  if (error) throw new RepositoryError('upsertAssessment', error.message);
}

// ---------------------------------------------------------------------------
// Rainfall (the views from migration 002)
// ---------------------------------------------------------------------------

export async function fetchHourlyRain(
  db: SupabaseClient,
  macAddress: string,
  sinceIso: string
): Promise<HourlyRainRow[]> {
  const { data, error } = await db
    .from('weather_rain_hourly')
    .select('hour_start, rain_mm, covered_minutes, sample_count, had_reset')
    .eq('mac_address', macAddress)
    .gte('hour_start', sinceIso)
    .order('hour_start', { ascending: true });

  if (error) throw new RepositoryError('fetchHourlyRain', error.message);
  return rows<HourlyRainRow[]>(data ?? []);
}

export async function fetchDailyRain(
  db: SupabaseClient,
  macAddress: string,
  sinceIso: string
): Promise<DailyRainRow[]> {
  const { data, error } = await db
    .from('weather_rain_daily')
    .select('day_start, rain_mm, sample_count, hours_observed')
    .eq('mac_address', macAddress)
    .gte('day_start', sinceIso)
    .order('day_start', { ascending: true });

  if (error) throw new RepositoryError('fetchDailyRain', error.message);
  return rows<DailyRainRow[]>(data ?? []);
}

// ---------------------------------------------------------------------------
// Poll audit
// ---------------------------------------------------------------------------

export interface PollOutcome {
  attempted: number;
  succeeded: number;
  failed: number;
  readingsInserted: number;
  errorSamples: { mac: string; error: string }[];
}

/**
 * Open a poll_runs row before any work starts.
 *
 * Written up front rather than at the end so a run that times out or is killed
 * mid-flight still leaves evidence it began. A silent poller is the failure
 * mode that matters here: readings simply stop, the UI keeps rendering the
 * last row it saw, and nobody notices until the index is scoring yesterday's
 * air.
 */
export async function startPollRun(
  db: SupabaseClient,
  triggerSource: string
): Promise<number | null> {
  const { data, error } = await db
    .from('poll_runs')
    .insert({ trigger_source: triggerSource })
    .select('id')
    .single();

  // Audit failures must never abort the poll they are auditing.
  if (error) return null;
  return rows<{ id: number }>(data).id;
}

export async function finishPollRun(
  db: SupabaseClient,
  runId: number | null,
  outcome: PollOutcome
): Promise<void> {
  if (runId === null) return;

  await db
    .from('poll_runs')
    .update({
      finished_at: new Date().toISOString(),
      stations_attempted: outcome.attempted,
      stations_succeeded: outcome.succeeded,
      stations_failed: outcome.failed,
      readings_inserted: outcome.readingsInserted,
      error_samples: outcome.errorSamples,
    })
    .eq('id', runId);
}
