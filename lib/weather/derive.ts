// lib/weather/derive.ts
//
// One validated Ambient record -> one `weather_readings` row, in SI.
//
// Pure: no clock, no I/O. The evaluation instant is passed in, so a re-derive
// of historical payloads produces byte-identical rows.
//
// Everything the scoring function needs is computed here rather than on read.
// The alternative — deriving in the query — means re-running solar geometry
// over 288 rows every time a chart loads, and means two code paths (ingest and
// read) that can disagree about what a reading meant.

import { fToC, inHgToHpa, inToMm, mphToKmh } from './units';
import { clearnessIndex, haurwitzClearSkyGhi, solarPosition } from './solar';
import { dewPointFromHumidity } from './psychrometrics';
import { slimRecord, type AmbientRecord, type ParsedRecord, type Scalar } from './parse';

/** The station's own position — where the sensors physically are. */
export interface StationGeometry {
  macAddress: string;
  latitude: number;
  longitude: number;
}

/** Shape of a `weather_readings` insert. Column names match the table. */
export interface ReadingRow {
  mac_address: string;
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
  rain_weekly_mm: number | null;
  rain_monthly_mm: number | null;
  rain_yearly_mm: number | null;
  rain_event_mm: number | null;

  solar_elevation_deg: number | null;
  ghi_clear_wm2: number | null;
  clearness_index: number | null;

  raw: Record<string, Scalar>;
}

/**
 * Timestamp sanity bounds.
 *
 * A station with a dead RTC can report 1970, and a misconfigured one can
 * report next year. Either poisons "the latest reading" permanently: the
 * series is ordered by observed_at, so one bogus future row shadows every real
 * reading behind it until it ages out. Cheaper to refuse it at the door.
 */
const MIN_PLAUSIBLE_MS = Date.UTC(2000, 0, 1);
const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

export type RejectionReason = 'timestamp_implausible' | 'timestamp_future';

export interface DeriveResult {
  row: ReadingRow | null;
  rejection: RejectionReason | null;
}

/**
 * Wind speed, km/h.
 *
 * Prefers the station's 10-minute average. The 2-7 km/h optimal band is a
 * statement about the mean flow through a shallow nocturnal layer, and an
 * instantaneous sample of that flow is noisy enough to cross the band edge on
 * gust alone. Falls back to the instantaneous reading when the station does
 * not report an average.
 */
function windKmh(rec: AmbientRecord): number | null {
  return mphToKmh(rec.windspdmph_avg10m ?? rec.windspeedmph);
}

/**
 * Wind direction, degrees.
 *
 * Matched to the same averaging window as the speed above. Showing a 10-minute
 * mean speed next to an instantaneous direction is a small lie about a single
 * vector, and the "wind with direction" tile displays them as one.
 */
function windDir(rec: AmbientRecord): number | null {
  return rec.winddir_avg10m ?? rec.winddir ?? null;
}

export function deriveReading(
  parsed: ParsedRecord,
  station: StationGeometry,
  receivedAt: Date
): DeriveResult {
  const { record, original } = parsed;
  const ms = record.dateutc;

  if (ms < MIN_PLAUSIBLE_MS) {
    return { row: null, rejection: 'timestamp_implausible' };
  }
  if (ms > receivedAt.getTime() + MAX_FUTURE_SKEW_MS) {
    return { row: null, rejection: 'timestamp_future' };
  }

  const observedAt = new Date(ms);

  const tempC = fToC(record.tempf);

  // Prefer the station's own dew point, but fall back to computing it from
  // temperature and humidity. ASBSAR1 does NOT report `dewPoint` — see
  // psychrometrics.ts. Ambient derives the field the same way when it does
  // supply it, so this changes nothing about what the number means; without the
  // fallback there is no DPD, and with no DPD nothing scores at all.
  const dewPointC =
    fToC(record.dewPoint) ?? dewPointFromHumidity(tempC, record.humidity);

  // Dew point depression. Null — not zero — when either side is missing: an
  // unknown depression must never read as perfectly saturated air.
  const dpdC = tempC !== null && dewPointC !== null ? tempC - dewPointC : null;

  const { elevationDeg, cosZenith } = solarPosition(
    observedAt,
    station.latitude,
    station.longitude
  );
  const ghiClear = haurwitzClearSkyGhi(cosZenith);
  const solarWm2 = record.solarradiation ?? null;

  return {
    row: {
      mac_address: station.macAddress,
      observed_at: observedAt.toISOString(),

      temp_c: tempC,
      dew_point_c: dewPointC,
      dpd_c: dpdC,
      humidity: record.humidity ?? null,

      wind_kmh: windKmh(record),
      wind_gust_kmh: mphToKmh(record.windgustmph),
      wind_dir: windDir(record),

      solar_wm2: solarWm2,
      uv: record.uv ?? null,

      // baromrelin is the station owner's sea-level-adjusted pressure — except
      // when they never set an offset, in which case it equals baromabsin and
      // is raw absolute pressure. Only the 3-hour DELTA is ever scored, so the
      // missing offset is harmless to the index. It is NOT safe to display as
      // MSLP; see the UI notes.
      pressure_hpa: inHgToHpa(record.baromrelin ?? record.baromabsin),

      // hourlyrainin is a RATE (in/h). The conversion to mm/h is the same
      // factor as inches to millimetres, the units being a ratio. It answers
      // only "is it raining right now" — the gate uses it for exactly that.
      rain_rate_mmh: inToMm(record.hourlyrainin),

      // dailyrainin ONLY. Some stations also report a rolling `24hourrainin`,
      // which never resets — mixing the two into this column would destroy the
      // midnight-reset detection the hourly totals depend on.
      rain_daily_mm: inToMm(record.dailyrainin),
      rain_weekly_mm: inToMm(record.weeklyrainin),
      rain_monthly_mm: inToMm(record.monthlyrainin),
      rain_yearly_mm: inToMm(record.yearlyrainin),
      rain_event_mm: inToMm(record.eventrainin),

      solar_elevation_deg: elevationDeg,
      ghi_clear_wm2: ghiClear,
      clearness_index: clearnessIndex(solarWm2, ghiClear),

      raw: slimRecord(original),
    },
    rejection: null,
  };
}

/**
 * Derive a whole batch, dropping rows that fail the timestamp sanity check.
 *
 * A record missing dew point is KEPT, unlike the Python prototype which
 * discards it. Readings are irreplaceable — the endpoint has no history, so a
 * row dropped at ingest is gone forever — and such a record still carries
 * valid wind, rain and radiation. The scoring function filters on what it
 * needs; ingest should not decide that for it.
 */
export function deriveReadings(
  parsed: ParsedRecord[],
  station: StationGeometry,
  receivedAt: Date
): { rows: ReadingRow[]; rejections: RejectionReason[] } {
  const rows: ReadingRow[] = [];
  const rejections: RejectionReason[] = [];

  for (const item of parsed) {
    const { row, rejection } = deriveReading(item, station, receivedAt);
    if (row) rows.push(row);
    else if (rejection) rejections.push(rejection);
  }

  return { rows, rejections };
}
