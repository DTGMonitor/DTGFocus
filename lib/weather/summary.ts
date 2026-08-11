// lib/weather/summary.ts
//
// The three lines a report prints: Kondisi Cuaca, Kondisi Kabut, Rekaman Curah
// Hujan — summarised over an arbitrary window.
//
// PURE. Readings, assessments and rain buckets in; localised strings out. No
// clock, no database. The window is an argument, so the daily report (1 day)
// and the weekly one (7 days) run the same code over a different range — which
// is exactly the difference between them.
//
// A note on what "average" means here, because it is the one number a reader
// could reasonably interpret two ways: the average is taken over the periods
// that RECORDED RAIN, not over every hour in the window. "rata-rata 5 mm/jam"
// is meant to read as the typical intensity while it was raining. Averaging
// across a mostly-dry day instead would report 0.4 mm/jam for a day that
// dropped 10 mm in one violent hour, which tells a slope engineer nothing.
//
// Unmeasured periods are excluded from both the average and the maximum. They
// are not zeroes — see rainfall.ts.

import {
  SKY_LABEL,
  SUMMARY_STRINGS,
  WEATHER_CONSTANTS,
  type ReportLocale,
  type SkyCode,
  type WeatherConstants,
} from '@/config/weatherConditions';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface SummaryReading {
  observedAt: Date;
  clearnessIndex: number | null;
  solarElevationDeg: number | null;
}

export interface SummaryAssessment {
  assessedAt: Date;
  verdict: string;
  reason: string | null;
}

export interface SummaryRainBucket {
  /** Start of the hour or day, as a real instant. */
  start: Date;
  /** Null means NOT MEASURED — excluded from every statistic below. */
  rainMm: number | null;
}

export interface SummaryInput {
  windowStart: Date;
  windowEnd: Date;
  /** The STATION's zone — the clock every time in the output is written on. */
  timeZone: string;
  locale: ReportLocale;
  readings: readonly SummaryReading[];
  assessments: readonly SummaryAssessment[];
  hourly: readonly SummaryRainBucket[];
  daily: readonly SummaryRainBucket[];
  constants?: WeatherConstants;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export interface WeatherPart {
  code: SkyCode;
  /** The line the report prints. */
  text: string;
  meanKt: number | null;
  daytimeSamples: number;
  meanDailyRainMm: number | null;
}

export interface FogPart {
  /** The most severe verdict reached in the window. */
  peakVerdict: string | null;
  text: string;
  occurrences: number;
  daysAffected: number;
}

export interface RainfallPart {
  basis: 'hourly' | 'daily';
  text: string;
  averageMm: number | null;
  maxMm: number | null;
  maxAt: Date | null;
  /** Buckets that recorded rain above the wet threshold. */
  wetPeriods: number;
  /** Buckets with a measurement at all — the rest were never observed. */
  measuredPeriods: number;
  totalMm: number | null;
}

export interface PeriodSummary {
  windowStart: Date;
  windowEnd: Date;
  hours: number;
  weather: WeatherPart;
  fog: FogPart;
  rainfall: RainfallPart;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const INTL_LOCALE: Record<ReportLocale, string> = { id: 'id-ID', en: 'en-GB' };

/**
 * "17:00", always with a colon.
 *
 * Deliberately NOT the request locale. `id-ID` formats clock times with a dot
 * ("17.00"), which is correct Indonesian typography but reads as a decimal when
 * it lands beside "maksimum 10 mm" in the same sentence. The colon is also the
 * form the report format was specified in.
 */
function fmtHour(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

function fmtDate(d: Date, timeZone: string, locale: ReportLocale): string {
  // "10 Agustus 2026" / "10 August 2026".
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    timeZone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

function fmtDayMonth(d: Date, timeZone: string, locale: ReportLocale): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    timeZone,
    day: 'numeric',
    month: 'long',
  }).format(d);
}

/** Local calendar day key, for counting "how many days did this happen on". */
function dayKey(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Trim trailing zeros: 5.0 -> "5", 5.25 -> "5.3". */
function num(v: number): string {
  const rounded = Math.round(v * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

const within = (t: Date, start: Date, end: Date) =>
  t.getTime() >= start.getTime() && t.getTime() <= end.getTime();

// ---------------------------------------------------------------------------
// Rainfall
// ---------------------------------------------------------------------------

function summariseRainfall(input: SummaryInput, K: WeatherConstants): RainfallPart {
  const { windowStart, windowEnd, timeZone, locale } = input;
  const S = SUMMARY_STRINGS[locale];

  const hours = (windowEnd.getTime() - windowStart.getTime()) / 3_600_000;
  const basis: 'hourly' | 'daily' =
    hours <= K.hourlyBasisMaxHours ? 'hourly' : 'daily';

  const source = basis === 'hourly' ? input.hourly : input.daily;
  const buckets = source.filter(
    (b) => within(b.start, windowStart, windowEnd) && b.rainMm !== null
  );

  const wet = buckets.filter((b) => (b.rainMm as number) > K.wetThresholdMm);
  const totalMm = buckets.reduce((s, b) => s + (b.rainMm as number), 0);

  const empty: RainfallPart = {
    basis,
    text: buckets.length === 0 ? S.noData : S.noRain,
    averageMm: null,
    maxMm: null,
    maxAt: null,
    wetPeriods: 0,
    measuredPeriods: buckets.length,
    totalMm: buckets.length === 0 ? null : Math.round(totalMm * 10) / 10,
  };
  if (wet.length === 0) return empty;

  const average = wet.reduce((s, b) => s + (b.rainMm as number), 0) / wet.length;
  const peak = wet.reduce((a, b) =>
    (b.rainMm as number) > (a.rainMm as number) ? b : a
  );

  const unit = basis === 'hourly' ? S.mmPerHour : S.mmPerDay;
  const when =
    basis === 'hourly'
      ? S.atHour(fmtHour(peak.start, timeZone))
      : S.onDate(fmtDate(peak.start, timeZone, locale));

  return {
    basis,
    // "rata-rata 5 mm/jam, maksimum 10 mm pada pukul 17:00"
    // "rata-rata 6 mm/hari, maksimum 10 mm pada tanggal 10 Agustus 2026"
    text: `${S.average} ${num(average)} ${unit}, ${S.maximum} ${num(
      peak.rainMm as number
    )} mm ${when}`,
    averageMm: Math.round(average * 10) / 10,
    maxMm: Math.round((peak.rainMm as number) * 10) / 10,
    maxAt: peak.start,
    wetPeriods: wet.length,
    measuredPeriods: buckets.length,
    totalMm: Math.round(totalMm * 10) / 10,
  };
}

// ---------------------------------------------------------------------------
// Sky condition
// ---------------------------------------------------------------------------

function summariseWeather(
  input: SummaryInput,
  K: WeatherConstants,
  rainfall: RainfallPart
): WeatherPart {
  const { windowStart, windowEnd, locale } = input;

  const daytime = input.readings.filter(
    (r) =>
      within(r.observedAt, windowStart, windowEnd) &&
      r.clearnessIndex !== null &&
      r.solarElevationDeg !== null &&
      r.solarElevationDeg > K.ktElevationMinDeg
  );

  const meanKt =
    daytime.length > 0
      ? daytime.reduce((s, r) => s + (r.clearnessIndex as number), 0) / daytime.length
      : null;

  const days = Math.max(
    1,
    (windowEnd.getTime() - windowStart.getTime()) / 86_400_000
  );
  const meanDailyRainMm =
    rainfall.totalMm === null ? null : rainfall.totalMm / days;

  // Rain outranks sky cover: a day that dropped 30 mm is "Hujan Sedang", not
  // "Berawan", however bright the gaps between the showers were.
  const rainTier =
    meanDailyRainMm === null
      ? undefined
      : K.rainTiers.find((t) => meanDailyRainMm >= t.minMmPerDay);

  let code: SkyCode;
  if (rainTier) {
    code = rainTier.code;
  } else if (meanKt === null || daytime.length < K.minDaytimeSamples) {
    // Refuse rather than guess. A single dawn sample is not a day's weather,
    // and an overnight-only window has no sky condition to report at all.
    code = 'TIDAK_DIKETAHUI';
  } else {
    code = (K.skyTiers.find((t) => meanKt >= t.minKt) ?? K.skyTiers[K.skyTiers.length - 1]).code;
  }

  return {
    code,
    text: SKY_LABEL[locale][code],
    meanKt: meanKt === null ? null : Math.round(meanKt * 100) / 100,
    daytimeSamples: daytime.length,
    meanDailyRainMm:
      meanDailyRainMm === null ? null : Math.round(meanDailyRainMm * 10) / 10,
  };
}

// ---------------------------------------------------------------------------
// Fog
// ---------------------------------------------------------------------------

/** Most severe first. INSUFFICIENT_HISTORY is not a severity, it is an absence. */
const SEVERITY: Record<string, number> = {
  FOG: 4,
  FOG_LIKELY: 3,
  AMBIGUOUS: 2,
  NOT_FOG: 1,
  NO_FOG: 0,
};

function summariseFog(
  input: SummaryInput,
  K: WeatherConstants,
  basis: 'hourly' | 'daily'
): FogPart {
  const { windowStart, windowEnd, timeZone, locale } = input;
  const S = SUMMARY_STRINGS[locale];

  const scored = input.assessments
    .filter((a) => within(a.assessedAt, windowStart, windowEnd))
    .filter((a) => a.verdict in SEVERITY)
    .slice()
    .sort((a, b) => a.assessedAt.getTime() - b.assessedAt.getTime());

  const none: FogPart = {
    peakVerdict: null,
    text: input.assessments.length === 0 ? S.noData : S.fog.insufficient,
    occurrences: 0,
    daysAffected: 0,
  };
  if (scored.length === 0) return none;

  const peakVerdict = scored.reduce((best, a) =>
    SEVERITY[a.verdict] > SEVERITY[best.verdict] ? a : best
  ).verdict;

  const hits = scored.filter((a) => a.verdict === peakVerdict);
  const days = new Set(hits.map((a) => dayKey(a.assessedAt, timeZone)));
  const windowDays = Math.max(
    1,
    Math.round((windowEnd.getTime() - windowStart.getTime()) / 86_400_000)
  );

  // Nothing worse than "no fog" happened all window. Say so plainly rather than
  // reporting a peak of NO_FOG, which reads as a finding.
  if (SEVERITY[peakVerdict] <= SEVERITY.NO_FOG) {
    return {
      peakVerdict,
      text: S.fog.none,
      occurrences: hits.length,
      daysAffected: 0,
    };
  }

  let label: string;
  if (peakVerdict === 'FOG') label = S.fog.confirmed;
  else if (peakVerdict === 'FOG_LIKELY') label = S.fog.likely;
  else if (peakVerdict === 'NOT_FOG') label = S.fog.notFog;
  else {
    // The dew qualifier keys off the scorer's own wording, which
    // __tests__/fog-scoring.test.ts pins ("likely dew rather than fog"). If
    // that phrasing changes, this quietly loses the distinction — which is why
    // the phrase is asserted there rather than only here.
    const dew = hits.some((a) => /dew|embun/i.test(a.reason ?? ''));
    label = dew ? S.fog.ambiguousDew : S.fog.ambiguous;
  }

  // A one-day report names the hours; a multi-day report counts the days,
  // because "05:10–07:20" is meaningless spread across a week.
  let when: string;
  if (basis === 'hourly') {
    const from = fmtHour(hits[0].assessedAt, timeZone);
    const to = fmtHour(hits[hits.length - 1].assessedAt, timeZone);
    when = from === to ? S.atHour(from) : `${S.atHour(from)}–${to}`;
  } else {
    const dates = [...days]
      .sort()
      .slice(0, 3)
      .map((k) =>
        fmtDayMonth(new Date(`${k}T12:00:00Z`), timeZone, locale)
      );
    const listed = days.size > 3 ? `${dates.join(', ')}, …` : dates.join(', ');
    when = `${S.ofDays(days.size, windowDays)} (${listed})`;
  }

  return {
    peakVerdict,
    text: `${label}, ${when}`,
    occurrences: hits.length,
    daysAffected: days.size,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function summarisePeriod(input: SummaryInput): PeriodSummary {
  const K = input.constants ?? WEATHER_CONSTANTS;

  const rainfall = summariseRainfall(input, K);
  const weather = summariseWeather(input, K, rainfall);
  const fog = summariseFog(input, K, rainfall.basis);

  return {
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    hours:
      Math.round(
        ((input.windowEnd.getTime() - input.windowStart.getTime()) / 3_600_000) * 10
      ) / 10,
    weather,
    fog,
    rainfall,
  };
}
