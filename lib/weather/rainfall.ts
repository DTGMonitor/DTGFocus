// lib/weather/rainfall.ts
//
// Reference implementation of the hourly-rainfall rule.
//
// >>> THE PRODUCTION PATH IS SQL. <<<
// Hourly totals are served from the `weather_rain_hourly` view in
// .kiro/specs/fog-monitoring/migrations/002_rainfall_views.sql, so the
// database does the bucketing instead of shipping 288 rows per station to a
// route handler. This file encodes the SAME rule in TypeScript so it can be
// tested without a live Postgres, and so the rule has one readable statement.
//
// The two implementations MUST agree. If you change a threshold here, change
// it in 002 as well — and vice versa. The constants below are the ones the
// view hard-codes.
//
// The rule itself, and why it is not obvious:
//
//   1. `hourlyrainin` is a RATE (in/h), not an accumulation. Summing it is
//      meaningless. It answers "is it raining right now" and nothing else.
//
//   2. Real totals come from deltas of the daily accumulator:
//         hourly_total(h) = dailyrainin(end of h) - dailyrainin(start of h)
//
//   3. That accumulator RESETS to zero at local midnight in the STATION's
//      timezone — Asia/Singapore (UTC+8) for ASBSAR1, which is neither UTC nor
//      necessarily the site's zone. A negative delta IS that reset, and the
//      correct step is the end value on its own.
//
//   4. Polling gaps are gaps. An hour we did not watch is null, never zero.
//      "No rain recorded" and "no recording" are opposite operational facts
//      and must never render the same.

/** A step spanning more than this cannot be trusted to contain no rain. */
export const TRUSTED_GAP_MINUTES = 20;

/** An hour needs this many of its 60 minutes covered to report a number. */
export const MIN_COVERED_MINUTES = 45;

export interface RainSample {
  observedAt: Date;
  /** `weather_readings.rain_daily_mm` — the station's daily accumulator. */
  rainDailyMm: number | null;
}

export interface RainStep {
  observedAt: Date;
  /** Millimetres attributable to this step, or null when undeterminable. */
  deltaMm: number | null;
  gapMinutes: number | null;
  isReset: boolean;
}

export interface HourlyRain {
  /** Start of the local hour, as a real instant. */
  hourStart: Date;
  /** Local hour key, "YYYY-MM-DDTHH" in the station's zone. */
  hourLocal: string;
  /** Null means NOT MEASURED. It is never a stand-in for zero. */
  rainMm: number | null;
  coveredMinutes: number;
  sampleCount: number;
  hadReset: boolean;
}

/**
 * Per-reading increments, taken across the whole ordered series.
 *
 * Deltas span bucket boundaries deliberately: rain falling between the last
 * reading of one hour and the first of the next belongs to the later hour, and
 * computing deltas within buckets would drop it entirely.
 */
export function rainSteps(samples: readonly RainSample[]): RainStep[] {
  const ordered = samples
    .filter((s) => s.rainDailyMm !== null && Number.isFinite(s.rainDailyMm))
    .slice()
    .sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());

  return ordered.map((s, i) => {
    const prev = i > 0 ? ordered[i - 1] : null;
    const current = s.rainDailyMm as number;

    if (prev === null) {
      // No predecessor: the increment is genuinely unknown, not zero.
      return {
        observedAt: s.observedAt,
        deltaMm: null,
        gapMinutes: null,
        isReset: false,
      };
    }

    const previous = prev.rainDailyMm as number;
    const isReset = current < previous;

    return {
      observedAt: s.observedAt,
      // On reset, everything on the counter fell after midnight, so the step
      // IS the current value.
      deltaMm: isReset ? current : current - previous,
      gapMinutes:
        (s.observedAt.getTime() - prev.observedAt.getTime()) / 60_000,
      isReset,
    };
  });
}

/** Wall-clock parts of an instant as observed in `timeZone`. */
function zonedParts(d: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .formatToParts(d)
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value;
      return acc;
    }, {});

  // Some engines emit hour '24' at midnight under hour12:false.
  if (parts.hour === '24') parts.hour = '00';
  return parts;
}

/** "YYYY-MM-DDTHH" in the given IANA zone. */
function localHourKey(d: Date, timeZone: string): string {
  const p = zonedParts(d, timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}`;
}

/**
 * Offset of `timeZone` from UTC at this instant, in milliseconds.
 *
 * Read from the formatted wall clock rather than assumed, so zones on a
 * non-integer offset (UTC+5:45, UTC+8:45) and DST transitions both land on the
 * right hour boundary. Not academic: getting this wrong shifts every rainfall
 * bucket by a fraction of an hour and silently mis-attributes the midnight
 * reset.
 */
function zoneOffsetMs(d: Date, timeZone: string): number {
  const p = zonedParts(d, timeZone);
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second)
  );
  // Drop sub-second precision on both sides so the difference is a clean offset.
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** The instant at which the local hour containing `d` begins. */
export function localHourStart(d: Date, timeZone: string): Date {
  const offset = zoneOffsetMs(d, timeZone);
  const shifted = d.getTime() + offset;
  return new Date(Math.floor(shifted / 3_600_000) * 3_600_000 - offset);
}

/**
 * Bucket steps into station-local hours.
 *
 * COVERAGE: untrusted steps (> TRUSTED_GAP_MINUTES) are excluded from BOTH the
 * sum and the coverage total, which keeps the two consistent — an hour holding
 * a long gap loses exactly the coverage that would have justified reporting
 * the partial total it still has.
 *
 * A step straddling an hour boundary is attributed wholly to the later hour.
 * At a five-minute cadence that is at most five minutes of slop, and it keeps
 * the rule stateless.
 */
export function hourlyRainTotals(
  samples: readonly RainSample[],
  timeZone: string
): HourlyRain[] {
  const buckets = new Map<
    string,
    { covered: number; sum: number; count: number; reset: boolean; first: Date }
  >();

  for (const step of rainSteps(samples)) {
    const key = localHourKey(step.observedAt, timeZone);
    const bucket = buckets.get(key) ?? {
      covered: 0,
      sum: 0,
      count: 0,
      reset: false,
      first: step.observedAt,
    };

    const trusted =
      step.deltaMm !== null &&
      step.gapMinutes !== null &&
      step.gapMinutes <= TRUSTED_GAP_MINUTES;

    if (trusted) {
      bucket.covered += step.gapMinutes as number;
      bucket.sum += step.deltaMm as number;
      bucket.count += 1;
    }
    if (step.isReset) bucket.reset = true;
    if (step.observedAt < bucket.first) bucket.first = step.observedAt;

    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .map(([hourLocal, b]) => ({
      hourLocal,
      hourStart: localHourStart(b.first, timeZone),
      rainMm:
        b.covered >= MIN_COVERED_MINUTES
          ? // Guard the float noise that turns a dry hour into 1e-15 mm.
            Math.max(0, Math.round(b.sum * 1000) / 1000)
          : null,
      coveredMinutes: Math.min(60, Math.round(b.covered * 10) / 10),
      sampleCount: b.count,
      hadReset: b.reset,
    }))
    .sort((a, b) => a.hourLocal.localeCompare(b.hourLocal));
}
