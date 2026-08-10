// lib/weather/ambient.ts
//
// The only module in this feature that performs I/O.
//
// SERVER ONLY. lightning.ambientweather.net sends no CORS headers, so a call
// from a client component fails in the browser with an opaque network error
// that looks nothing like the real cause. The module-scope guard below turns
// that into an immediate, legible failure at import time instead.
//
// The keyed public REST API (api.ambientweather.net/v1) is unusable here: it
// only exposes stations owned by the key holder, and we do not own this
// hardware. This is the endpoint the ambientweather.net web app itself calls.
// It is undocumented, unversioned, and free — treat it accordingly:
//
//   * No history. `/devices/{mac}` returns current conditions only. Everything
//     downstream exists to accumulate what this endpoint will not give us.
//   * An unknown MAC returns HTTP 204 with an EMPTY BODY. Feeding that to
//     JSON.parse throws "Unexpected end of JSON input", which is a confusing
//     way to say "no such station".
//   * Be polite. One request per station per poll, no bursts, no parallel
//     hammering of the same MAC. 5-10 minute polling is ample; the stations
//     themselves only report every minute or so.

import {
  AmbientDeviceSchema,
  extractRecords,
  parseRecords,
  readCapabilities,
  stationLabel,
  type AmbientDevice,
  type ParsedRecord,
  type StationCapabilities,
} from './parse';
import { boundingBox, haversineKm, type LatLon } from './geo';

if (typeof window !== 'undefined') {
  throw new Error(
    'lib/weather/ambient.ts is server-only: lightning.ambientweather.net sends ' +
      'no CORS headers. Call it from a route handler or server action.'
  );
}

const BASE_URL = 'https://lightning.ambientweather.net';
const DEFAULT_TIMEOUT_MS = 20_000;

// Undocumented endpoints deserve an identifiable caller. If this feature ever
// becomes a nuisance, the operator should be able to see who it is.
const USER_AGENT = 'dtg-focus-fog-monitor/1.0 (+https://dtgeotech.com)';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type AmbientErrorKind =
  /** HTTP 204 or an empty body — the MAC is not a known public station. */
  | 'station_not_found'
  | 'http_error'
  | 'network_error'
  | 'timeout'
  /** Body arrived but was not JSON. */
  | 'invalid_payload'
  /** Valid JSON, but nothing in it passed the record test. */
  | 'no_records';

export class AmbientError extends Error {
  readonly kind: AmbientErrorKind;
  readonly status?: number;

  constructor(kind: AmbientErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'AmbientError';
    this.kind = kind;
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export interface RequestOptions {
  timeoutMs?: number;
  /**
   * Retries for transient failures only (network, timeout, 5xx, 429).
   *
   * Default 1. A 204 is never retried — it is a definitive answer, not a
   * hiccup. One retry costs at most a second and saves a five-minute sample
   * that can never be recovered; more than one starts to look like a burst.
   */
  retries?: number;
  retryDelayMs?: number;
}

interface RawResponse {
  status: number;
  body: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function requestOnce(
  url: string,
  timeoutMs: number
): Promise<RawResponse> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      // Next would otherwise cache this route-handler fetch and serve the same
      // "current conditions" for the life of the deployment.
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const name = (err as Error)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new AmbientError('timeout', `Request timed out after ${timeoutMs} ms`);
    }
    throw new AmbientError(
      'network_error',
      `Network failure: ${(err as Error)?.message ?? 'unknown'}`
    );
  }

  return { status: res.status, body: await res.text() };
}

const isTransient = (e: AmbientError): boolean =>
  e.kind === 'network_error' ||
  e.kind === 'timeout' ||
  (e.kind === 'http_error' &&
    e.status !== undefined &&
    (e.status >= 500 || e.status === 429));

async function request(url: string, options: RequestOptions): Promise<RawResponse> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? 1;
  const retryDelayMs = options.retryDelayMs ?? 1500;

  let lastError: AmbientError | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await requestOnce(url, timeoutMs);
      if (res.status >= 400) {
        throw new AmbientError(
          'http_error',
          `Ambient endpoint returned HTTP ${res.status}`,
          res.status
        );
      }
      return res;
    } catch (err) {
      const e =
        err instanceof AmbientError
          ? err
          : new AmbientError('network_error', String(err));
      lastError = e;
      if (attempt >= retries || !isTransient(e)) throw e;
      await sleep(retryDelayMs);
    }
  }

  throw lastError ?? new AmbientError('network_error', 'Request failed');
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new AmbientError(
      'invalid_payload',
      'Ambient endpoint returned a body that is not JSON'
    );
  }
}

// ---------------------------------------------------------------------------
// Current conditions
// ---------------------------------------------------------------------------

/**
 * Fetch the current observation(s) for one station.
 *
 * Returns validated records oldest-first. Usually a single record; the
 * endpoint has been seen returning a short array, so the batch shape is
 * handled rather than assumed away.
 *
 * Throws AmbientError('station_not_found') on the 204/empty-body case, which
 * is what an unknown or de-published MAC looks like.
 */
export async function fetchStationRecords(
  macAddress: string,
  options: RequestOptions = {}
): Promise<{ parsed: ParsedRecord[]; rejected: number }> {
  const mac = macAddress.trim().toUpperCase();
  if (!mac) {
    throw new AmbientError('station_not_found', 'No MAC address supplied');
  }

  const { status, body } = await request(
    `${BASE_URL}/devices/${encodeURIComponent(mac)}`,
    options
  );

  // The documented failure mode for an unknown station. Note the body check as
  // well as the status: a 200 with an empty body means the same thing, and
  // only one of the two has actually been observed.
  if (status === 204 || body.trim() === '') {
    throw new AmbientError(
      'station_not_found',
      `Station ${mac} not found (HTTP ${status}, empty body). ` +
        'Verify the MAC via station discovery.'
    );
  }

  const { parsed, rejected } = parseRecords(extractRecords(parseJson(body)));

  if (parsed.length === 0) {
    throw new AmbientError(
      'no_records',
      `Station ${mac} responded, but no field in the payload passed the ` +
        'record test (dateutc and tempf both numeric).'
    );
  }

  return { parsed, rejected };
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export interface StationCandidate {
  macAddress: string;
  name: string;
  latitude: number;
  longitude: number;
  elevationM: number | null;
  distanceKm: number;
  timezone: string | null;
  stationType: string | null;
  capabilities: StationCapabilities;
  /** Age of the station's last report, or null if it never reported one. */
  lastReportAt: string | null;
}

function toCandidate(
  device: AmbientDevice,
  centre: LatLon
): StationCandidate | null {
  const mac = device.macAddress;
  const lat = device.info?.coords?.coords?.lat;
  const lon = device.info?.coords?.coords?.lon;

  // A station with no MAC cannot be polled, and one with no coordinates cannot
  // have its solar geometry computed. Both are disqualifying, not cosmetic.
  if (!mac || lat === undefined || lon === undefined) return null;

  const lastData = device.lastData;
  const dateutc = lastData?.['dateutc'];
  const tz = lastData?.['tz'];
  const stationType = lastData?.['stationtype'];

  return {
    macAddress: mac.toUpperCase(),
    name: stationLabel(device),
    latitude: lat,
    longitude: lon,
    elevationM: device.info?.coords?.elevation ?? null,
    distanceKm: haversineKm(centre, { latitude: lat, longitude: lon }),
    timezone: typeof tz === 'string' ? tz : null,
    stationType: typeof stationType === 'string' ? stationType : null,
    capabilities: readCapabilities(lastData),
    lastReportAt:
      typeof dateutc === 'number' && Number.isFinite(dateutc)
        ? new Date(dateutc).toISOString()
        : null,
  };
}

/**
 * Build the `$publicBox` query, verified against the live endpoint.
 *
 * TWO THINGS HERE ARE NOT GUESSES — both were wrong on the first attempt and
 * both were confirmed by calling the endpoint:
 *
 *   1. ENCODING. This is a FeathersJS service, and it wants the bracketed
 *      nested form. A JSON array in a single parameter —
 *      `$publicBox=[[a,b],[c,d]]` — is rejected outright:
 *        HTTP 400 {"name":"BadRequest","message":"Invalid query parameter $publicBox"}
 *
 *   2. ORDER. Each corner is [LONGITUDE, LATITUDE], GeoJSON style — not
 *      [lat, lon]. Getting it backwards is not a silent miss; the server says so:
 *        HTTP 500 {"message":"Longitude/latitude is out of bounds, lng: -2.8652 lat: 121.158"}
 *      which also confirms element 0 is read as longitude.
 */
function boxParams(box: {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}): string {
  const corners: [string, number][] = [
    ['$publicBox[0][0]', box.minLon],
    ['$publicBox[0][1]', box.minLat],
    ['$publicBox[1][0]', box.maxLon],
    ['$publicBox[1][1]', box.maxLat],
  ];
  return corners
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/**
 * Unwrap the discovery payload.
 *
 * The device search answers `{ "data": [ … ] }`, NOT a bare array — unlike
 * `/devices/{mac}`, which returns the device object directly. Treating the
 * envelope as an array yields zero candidates on a perfectly good 200, which
 * is indistinguishable from "no stations nearby".
 */
function collectDevices(payload: unknown): AmbientDevice[] {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { data?: unknown })?.data)
      ? ((payload as { data: unknown[] }).data)
      : [];

  const out: AmbientDevice[] = [];
  for (const item of list) {
    const result = AmbientDeviceSchema.safeParse(item);
    if (result.success) out.push(result.data);
  }
  return out;
}

/**
 * Find public stations near a point.
 *
 * The box is deliberately wider than the radius and the results are then
 * filtered by true great-circle distance, so the returned radius is exact even
 * though the query is rectangular.
 *
 * One request. The encoding and corner order are settled — see boxParams().
 */
export async function discoverStations(
  centre: LatLon,
  radiusKm: number,
  options: RequestOptions = {}
): Promise<StationCandidate[]> {
  const box = boundingBox(centre, radiusKm);
  const { status, body } = await request(
    `${BASE_URL}/devices?${boxParams(box)}`,
    options
  );

  if (status === 204 || body.trim() === '') return [];

  return collectDevices(parseJson(body))
    .map((d) => toCandidate(d, centre))
    .filter((c): c is StationCandidate => c !== null)
    .filter((c) => c.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}
