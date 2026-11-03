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
// THE RAINFALL LINE DESCRIBES THE CHART PRINTED BESIDE IT. That is a hard
// constraint, not a preference. The report puts RainfallCharts.jsx directly
// under this summary, and a reader who cannot find the summary's numbers on
// the plot concludes one of the two is broken.
//
// So the line leads with the two quantities that are legible on the plot:
//
//   * TOTAL — how far the teal accumulator climbed across the window. This is
//     the plateau height the eye lands on first.
//   * PEAK RATE — the tallest spike on the blue line, in mm/h, named as a rate.
//     The chart's top y-tick is the max across BOTH series, so this value very
//     often IS the number printed on the axis.
//
// It closes with the worst single bucket's accumulation, which is NOT on the
// chart but is what the TARP accumulation thresholds compare against. That one
// is spelled "akumulasi 1 jam" / "1-hour accumulation" rather than "maksimum",
// because the previous wording sat next to an axis labelled mm/mm-hr and read
// as a rate — a 16 mm hour beside a visible 37.2 looked like a contradiction.
//
// THE WET-HOUR AVERAGE IS STILL COMPUTED BUT NO LONGER PRINTED. It survives on
// RainfallPart.averageMm for anyone interrogating the workings. Keep it off the
// page: it averages only hours above the wet threshold, so it is neither the
// chart's shape nor a true daily mean, and readers took it for the latter.
//
// Unmeasured periods are excluded from every bucket statistic. They are not
// zeroes — see rainfall.ts.

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

/**
 * One poll of the gauge — the raw pair the chart plots, before any bucketing.
 *
 * Optional on SummaryInput so a caller that only has buckets still works; the
 * line simply loses its peak-rate clause and falls back to the bucket sum for
 * the total.
 */
export interface SummaryRainSample {
  observedAt: Date;
  /** Instantaneous rate, mm/h — the chart's BLUE line. Never summed. */
  rainRateMmh: number | null;
  /** The station's daily accumulator, mm — the chart's TEAL line. */
  rainDailyMm: number | null;
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
  /** Raw gauge samples. Omit and the line degrades rather than fails. */
  rain?: readonly SummaryRainSample[];
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
  /** The line the report prints. */
  text: string;
  /**
   * Mean over WET buckets only. Computed, deliberately NOT printed — see the
   * file header before putting it back on the page.
   */
  averageMm: number | null;
  /** Largest single bucket's accumulation, mm. */
  maxMm: number | null;
  maxAt: Date | null;
  /** Tallest instantaneous rate in the window, mm/h — the blue line's peak. */
  peakRateMmh: number | null;
  peakRateAt: Date | null;
  /** First wet bucket's start and last wet bucket's end — the rain's span. */
  wetFrom: Date | null;
  wetTo: Date | null;
  /** Buckets that recorded rain above the wet threshold. */
  wetPeriods: number;
  /** Buckets with a measurement at all — the rest were never observed. */
  measuredPeriods: number;
  /** Window total, mm — how far the accumulator climbed. */
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

const round1 = (v: number | null): number | null =>
  v === null ? null : Math.round(v * 10) / 10;

/**
 * Peak rate and accumulator climb, read off the SAME two series the chart
 * draws, so the sentence and the picture cannot disagree.
 */
function fromSeries(
  samples: readonly SummaryRainSample[],
  windowStart: Date,
  windowEnd: Date
): { peakRateMmh: number | null; peakRateAt: Date | null; climbMm: number | null } {
  const ordered = samples
    .filter((s) => within(s.observedAt, windowStart, windowEnd))
    .slice()
    .sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());

  let peakRateMmh: number | null = null;
  let peakRateAt: Date | null = null;
  for (const s of ordered) {
    if (s.rainRateMmh === null) continue;
    if (peakRateMmh === null || s.rainRateMmh > peakRateMmh) {
      peakRateMmh = s.rainRateMmh;
      peakRateAt = s.observedAt;
    }
  }

  // How far the teal line climbed, with the midnight reset stitched back
  // together exactly as rainfall.ts does it: a counter that went backwards
  // means everything on it fell after the reset, so the step IS the value.
  //
  // Taken from the series rather than by summing the hourly buckets BECAUSE
  // the buckets drop any hour below MIN_COVERED_MINUTES. A window with one
  // thin hour would otherwise print a total visibly short of the plateau the
  // reader is looking at. The accumulator is the station's own count and
  // survives a polling gap — the same reasoning weather_rain_daily already
  // applies to day totals.
  let climbMm = 0;
  let previous: number | null = null;
  let measured = false;
  for (const s of ordered) {
    if (s.rainDailyMm === null) continue;
    measured = true;
    if (previous !== null) {
      climbMm +=
        s.rainDailyMm < previous ? s.rainDailyMm : s.rainDailyMm - previous;
    }
    previous = s.rainDailyMm;
  }

  // Guard the float noise that turns a dry window into 1e-15 mm.
  return {
    peakRateMmh,
    peakRateAt,
    climbMm: measured ? Math.max(0, climbMm) : null,
  };
}

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
  const bucketTotal = buckets.reduce((s, b) => s + (b.rainMm as number), 0);

  const { peakRateMmh, peakRateAt, climbMm } = fromSeries(
    input.rain ?? [],
    windowStart,
    windowEnd
  );

  // The accumulator is preferred; the bucket sum is the fallback for a caller
  // that passed no raw samples.
  const totalMm = climbMm ?? (buckets.length > 0 ? bucketTotal : null);

  /** "laju puncak 37.2 mm/jam pada pukul 21:05" — omitted when the gauge saw none. */
  const rateClause = (): string | null => {
    if (peakRateMmh === null || peakRateAt === null || !(peakRateMmh > 0)) {
      return null;
    }
    const when =
      basis === 'hourly'
        ? S.atHour(fmtHour(peakRateAt, timeZone))
        : S.onDate(fmtDate(peakRateAt, timeZone, locale));
    return `${S.peakRate} ${num(peakRateMmh)} ${S.mmPerHour} ${when}`;
  };

  const base = {
    basis,
    averageMm: null,
    maxMm: null,
    maxAt: null,
    peakRateMmh: round1(peakRateMmh),
    peakRateAt,
    wetFrom: null,
    wetTo: null,
    wetPeriods: 0,
    measuredPeriods: buckets.length,
    totalMm: round1(totalMm),
  } satisfies Omit<RainfallPart, 'text'>;

  if (wet.length === 0) {
    // Rain the accumulator counted but no bucket could attribute — every hour
    // was too thinly polled to report. Saying "no rainfall recorded" over a
    // chart whose teal line climbed is the worst thing this line can do.
    if (totalMm !== null && totalMm > K.wetThresholdMm) {
      const parts = [`${S.total} ${num(totalMm)} mm`];
      const rate = rateClause();
      if (rate) parts.push(rate);
      return { ...base, text: parts.join(', ') };
    }
    return {
      ...base,
      text: buckets.length === 0 && climbMm === null ? S.noData : S.noRain,
    };
  }

  const average = wet.reduce((s, b) => s + (b.rainMm as number), 0) / wet.length;
  const peak = wet.reduce((a, b) =>
    (b.rainMm as number) > (a.rainMm as number) ? b : a
  );

  const bucketMs = basis === 'hourly' ? 3_600_000 : 86_400_000;
  const wetFrom = wet[0].start;
  const wetTo = new Date(wet[wet.length - 1].start.getTime() + bucketMs);

  const parts: string[] = [];

  // 1. The headline. On the hourly basis it carries the span the rain occupied,
  //    which is the other thing the eye reads straight off the plot. The daily
  //    basis omits it: a span of dates duplicates the peak-day clause below.
  const span =
    basis === 'hourly'
      ? ` (${fmtHour(wetFrom, timeZone)}–${fmtHour(wetTo, timeZone)})`
      : '';
  parts.push(`${S.total} ${num(totalMm as number)} mm${span}`);

  // 2. The tallest spike on the rate line, explicitly in mm/h.
  const rate = rateClause();
  if (rate) parts.push(rate);

  // 3. The worst bucket's accumulation. Its time is dropped when the peak rate
  //    already fell inside that bucket — the usual case, and repeating the
  //    clock there reads as two separate events.
  const label = basis === 'hourly' ? S.topHourAccum : S.topDayAccum;
  const rateInsidePeak =
    peakRateAt !== null &&
    peakRateAt.getTime() >= peak.start.getTime() &&
    peakRateAt.getTime() < peak.start.getTime() + bucketMs;
  const peakWhen = rateInsidePeak
    ? ''
    : ` ${
        basis === 'hourly'
          ? S.atHour(fmtHour(peak.start, timeZone))
          : S.onDate(fmtDate(peak.start, timeZone, locale))
      }`;
  parts.push(`${label} ${num(peak.rainMm as number)} mm${peakWhen}`);

  return {
    ...base,
    // "Total 37.2 mm (16:00–22:00), laju puncak 37.2 mm/jam pada pukul 21:05,
    //  akumulasi 1 jam tertinggi 16 mm"
    text: parts.join(', '),
    averageMm: round1(average),
    maxMm: round1(peak.rainMm as number),
    maxAt: peak.start,
    wetFrom,
    wetTo,
    wetPeriods: wet.length,
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
