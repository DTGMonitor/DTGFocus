// lib/weather/parse.ts
//
// Validation and normalisation for an UNDOCUMENTED, UNVERSIONED endpoint.
//
// lightning.ambientweather.net is the internal API behind the ambientweather.net
// web app. Nobody has promised it a shape, a field set, or a lifetime. Every
// response here is treated as hostile input: nothing is assumed present,
// nothing is assumed to be the type it was yesterday, and a field that fails
// validation is dropped rather than allowed to throw. A malformed humidity
// reading must not cost us the temperature in the same payload.
//
// Pure. No I/O — see ambient.ts for that.

import { z } from 'zod';

// ---------------------------------------------------------------------------
// The `hl` trap
// ---------------------------------------------------------------------------
//
// A device response embeds a nested `hl` object: the station's rolling 24-hour
// high/low summary. It ALSO carries a `dateutc` key, so a naive recursive
// search for "objects with a dateutc" finds two records and invents a second,
// bogus observation.
//
// The `hl` block gives itself away by its value shapes: its `tempf` is an
// object {h, l, c, s, ht, lt} — high, low, current, and their timestamps —
// rather than a bare number.
//
// Hence the rule, which is load-bearing and must not be relaxed:
//
//   A dict is a measurement record only if `dateutc` is a number AND `tempf`
//   is a number. Once accepted, do NOT recurse into it — the `hl` block lives
//   INSIDE the record, and descending would find it anyway.
//
// The type test is a strict `typeof === 'number'`, not a numeric coercion. A
// coercion here would eventually accept some future summary shape and quietly
// double the record count.

/** Depth ceiling, so an adversarial or cyclic payload cannot spin the stack. */
const MAX_DEPTH = 8;

type Json = Record<string, unknown>;

function isPlainObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Pull every genuine measurement record out of an arbitrary response body.
 *
 * Handles a bare record, an array of records, and records nested under
 * wrapper keys, because the endpoint has been observed returning more than
 * one of those shapes.
 */
export function extractRecords(node: unknown, depth = 0): Json[] {
  if (depth > MAX_DEPTH) return [];

  if (Array.isArray(node)) {
    return node.flatMap((v) => extractRecords(v, depth + 1));
  }

  if (isPlainObject(node)) {
    if (typeof node.dateutc === 'number' && typeof node.tempf === 'number') {
      return [node]; // accepted — do not descend, `hl` is in here
    }
    return Object.values(node).flatMap((v) => extractRecords(v, depth + 1));
  }

  return [];
}

// ---------------------------------------------------------------------------
// Scalar-only slimming
// ---------------------------------------------------------------------------

export type Scalar = number | string | boolean | null;

/**
 * Keep only scalar values before persisting to `weather_readings.raw`.
 *
 * This is what drops the `hl` block from storage: it is an object, so it does
 * not survive. Storing it would triple the row size to preserve a rolling
 * summary we can recompute from the series itself.
 *
 * Non-finite numbers (NaN, Infinity) are dropped too — Postgres jsonb accepts
 * neither, and a single NaN would fail the whole insert.
 */
export function slimRecord(rec: Json): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') {
      out[k] = v;
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

/**
 * A number that may arrive as a numeric string, and that degrades to
 * `undefined` instead of failing the parse.
 *
 * Fail-soft is the point: this endpoint has no contract, and one station
 * reporting `humidity: "79"` must not cost us every other field it sent.
 */
const numish = z.preprocess((v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}, z.number().optional());

const stringish = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined),
  z.string().optional()
);

/**
 * One observation.
 *
 * `dateutc` and `tempf` are required and strictly numeric — they are the same
 * two fields the `hl` discriminator keys off, so a record that reaches here
 * has already proven both.
 *
 * Unknown keys are stripped from the typed view; the untouched original is
 * preserved separately via slimRecord() into `weather_readings.raw`, so a
 * field this schema does not yet know about is never actually lost.
 */
export const AmbientRecordSchema = z.object({
  dateutc: z.number(),
  tempf: z.number(),

  // Computed server-side by Ambient from tempf + humidity. NOT an independent
  // measurement — dew point and relative humidity are one signal, not two.
  dewPoint: numish,
  feelsLike: numish,
  humidity: numish,

  windspeedmph: numish,
  // The 10-minute averages, when present, are what the wind scoring band was
  // defined against. See derive.ts for the preference order.
  windspdmph_avg10m: numish,
  windgustmph: numish,
  maxdailygust: numish,
  winddir: numish,
  winddir_avg10m: numish,

  solarradiation: numish,
  uv: numish,

  baromrelin: numish,
  baromabsin: numish,

  // A RATE, inches per hour — not an accumulation. See derive.ts.
  hourlyrainin: numish,
  dailyrainin: numish,
  weeklyrainin: numish,
  monthlyrainin: numish,
  yearlyrainin: numish,
  eventrainin: numish,

  tz: stringish,
  stationtype: stringish,
});

export type AmbientRecord = z.infer<typeof AmbientRecordSchema>;

/**
 * A validated record kept alongside the untouched payload it came from.
 *
 * The pair travels together so `weather_readings.raw` can preserve fields the
 * schema does not model, without the two ever drifting out of alignment.
 */
export interface ParsedRecord {
  record: AmbientRecord;
  original: Json;
}

/**
 * Validate a batch, dropping records that fail rather than rejecting the batch.
 *
 * Returns the survivors sorted oldest-first, which is the order every
 * downstream consumer (delta maths, saturation runs, charts) expects.
 */
export function parseRecords(raw: Json[]): {
  parsed: ParsedRecord[];
  rejected: number;
} {
  const parsed: ParsedRecord[] = [];
  let rejected = 0;

  for (const item of raw) {
    const result = AmbientRecordSchema.safeParse(item);
    if (result.success) parsed.push({ record: result.data, original: item });
    else rejected += 1;
  }

  parsed.sort((a, b) => a.record.dateutc - b.record.dateutc);

  return { parsed, rejected };
}

// ---------------------------------------------------------------------------
// Discovery payloads
// ---------------------------------------------------------------------------

/**
 * A public station as returned by the `$publicBox` search.
 *
 * Coordinates live at `info.coords.coords.{lat,lon}` — the doubled `coords` is
 * the endpoint's own shape, not a typo. Everything is optional because
 * public stations are configured by their owners, and plenty of them have set
 * nothing at all.
 */
export const AmbientDeviceSchema = z.object({
  macAddress: stringish,
  info: z
    .object({
      name: stringish,
      coords: z
        .object({
          location: stringish,
          address: stringish,
          elevation: numish,
          coords: z.object({ lat: numish, lon: numish }).optional(),
        })
        .optional(),
    })
    .optional(),
  lastData: z.record(z.string(), z.unknown()).optional(),
});

export type AmbientDevice = z.infer<typeof AmbientDeviceSchema>;

/** Which sensors a candidate station actually reports. */
export interface StationCapabilities {
  temperature: boolean;
  dewPoint: boolean;
  humidity: boolean;
  wind: boolean;
  pressure: boolean;
  rain: boolean;
  /** A pyranometer. Without it Index B can never run, day or night. */
  solar: boolean;
  uv: boolean;
}

export function readCapabilities(
  lastData: Record<string, unknown> | undefined
): StationCapabilities {
  const has = (key: string): boolean =>
    lastData !== undefined &&
    lastData[key] !== null &&
    lastData[key] !== undefined;

  return {
    temperature: has('tempf'),
    dewPoint: has('dewPoint'),
    humidity: has('humidity'),
    wind: has('windspeedmph') || has('windspdmph_avg10m'),
    pressure: has('baromrelin') || has('baromabsin'),
    rain: has('dailyrainin') || has('hourlyrainin'),
    solar: has('solarradiation'),
    uv: has('uv'),
  };
}

/** Best available human label for a station, mirroring the prototype's order. */
export function stationLabel(device: AmbientDevice): string {
  return (
    device.info?.name ??
    device.info?.coords?.location ??
    device.info?.coords?.address ??
    device.macAddress ??
    '(unnamed station)'
  );
}
