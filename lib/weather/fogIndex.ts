// lib/weather/fogIndex.ts
//
// The fog index. Readings in, assessment out.
//
// STRICTLY PURE. No fetching, no database, no Date.now(). The evaluation
// instant is an argument, so the same window always produces the same
// assessment and a re-score of history under new constants is deterministic.
// If a clock or a query ever appears in this file, the calibration record
// stops being reproducible and the tests stop meaning anything.
//
// Two indices, doing different jobs:
//
//   Index A — fog POTENTIAL. Valid 24 hours. Scores the preconditions for
//             radiation fog: saturated air, how long it has been saturated,
//             enough wind to mix but not enough to shear the layer apart, a
//             stalled cooling curve, and a clear quiet night before it.
//
//   Index B — fog CONFIRMATION. Daytime only. Fog crushes shortwave radiation,
//             so measured-vs-clear-sky is direct evidence rather than
//             inference. It overrides Index A when it fires, because a
//             precondition score is a prediction and this is an observation.
//
// A note that governs the whole file: dew point is computed server-side by
// Ambient from temperature and humidity. It is NOT an independent measurement.
// Nothing here may treat DPD and relative humidity as two corroborating
// signals — humidity is carried for display only and is never scored.

import { FOG_CONSTANTS, type FogConstants } from '@/config/fogConstants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One derived reading. Deliberately not the database row type: the scorer must
 * be feedable from a test fixture as easily as from a query.
 */
export interface FogReading {
  observedAt: Date;
  tempC: number;
  dewPointC: number;
  /** tempC - dewPointC, precomputed at ingest. */
  dpdC: number;
  windKmh: number | null;
  windGustKmh?: number | null;
  humidity: number | null;
  solarWm2: number | null;
  clearnessIndex: number | null;
  solarElevationDeg: number;
  pressureHpa: number | null;
  /** From hourlyrainin — a RATE in mm/h, never an accumulation. */
  rainRateMmh: number | null;
}

export type Verdict =
  | 'FOG'
  | 'FOG_LIKELY'
  | 'AMBIGUOUS'
  | 'NOT_FOG'
  | 'NO_FOG'
  | 'INSUFFICIENT_HISTORY';

export type ComponentKey =
  | 'saturation'
  | 'persistence'
  | 'wind'
  | 'plateau'
  | 'radiative'
  | 'reservoir';

export interface ComponentScore {
  component: ComponentKey;
  points: number;
  max: number;
  detail: string;
  /**
   * Whether enough data exists for this component to be able to reach its
   * maximum. False means the points are a floor, not a measurement — the UI
   * must not present a capped component as a scored one.
   */
  available: boolean;
}

export type GateKey = 'raining' | 'not_saturated' | 'wind_too_strong';

export interface Gate {
  gate: GateKey;
  detail: string;
}

/** Index B's observation, independent of which verdict finally wins. */
export type IndexBSignal = 'CONFIRMED' | 'NOT_FOG' | 'DISSIPATING';

export interface IndexBResult {
  available: boolean;
  /** Why it could not run, when it could not. */
  unavailableReason: 'below_elevation' | 'no_clearness_index' | null;
  signal: IndexBSignal | null;
  detail: string | null;
}

export interface CurrentConditions {
  observedAt: Date;
  tempC: number;
  dewPointC: number;
  dpdC: number;
  humidity: number | null;
  windKmh: number | null;
  solarWm2: number | null;
  clearnessIndex: number | null;
  solarElevationDeg: number;
  pressureHpa: number | null;
  rainRateMmh: number | null;
  /** Minutes between this reading and the evaluation instant. */
  ageMinutes: number;
}

export interface FogAssessment {
  status: 'scored';
  verdict: Verdict;
  /** The verdict before hysteresis. Persisted so the next run can damp it. */
  rawVerdict: Verdict;
  /** True when hysteresis suppressed a proposed change this cycle. */
  hysteresisHeld: boolean;
  reason: string;

  scoreA: number;
  components: ComponentScore[];
  gates: Gate[];
  indexB: IndexBResult;

  minutesSaturated: number;
  dTdt: number | null;
  ktPeak: number | null;
  pressureDeltaHpa: number | null;

  current: CurrentConditions;
  readingCount: number;
  historyHours: number;
  constants: FogConstants;
}

export interface InsufficientHistory {
  status: 'insufficient_history';
  verdict: 'INSUFFICIENT_HISTORY';
  reason: string;
  readingCount: number;
  readingsRequired: number;
  historyHours: number;
  /**
   * Present whenever at least one usable reading exists, so the UI can still
   * show live conditions while the history fills. Null only when the station
   * has produced nothing scoreable at all.
   */
  current: CurrentConditions | null;
  /**
   * Carried even though nothing was scored: `minReadings` is what refused the
   * assessment, and the calibration record needs to know which threshold said
   * no. Also lets both result branches persist an algorithm_version.
   */
  constants: FogConstants;
}

export type FogResult = FogAssessment | InsufficientHistory;

/** Prior state, for hysteresis. Pure input — the caller supplies it. */
export interface PreviousState {
  verdict: Verdict;
  rawVerdict: Verdict;
}

export interface AssessOptions {
  /** Evaluation instant. Required — this file must never read a clock. */
  evaluatedAt: Date;
  constants?: FogConstants;
  previous?: PreviousState | null;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const MS_PER_MIN = 60_000;
const MS_PER_HOUR = 3_600_000;

const minutesBetween = (later: Date, earlier: Date): number =>
  (later.getTime() - earlier.getTime()) / MS_PER_MIN;

const hoursBetween = (later: Date, earlier: Date): number =>
  (later.getTime() - earlier.getTime()) / MS_PER_HOUR;

const fmt = (v: number, digits = 2): string => v.toFixed(digits);

const signed = (v: number, digits = 2): string =>
  `${v >= 0 ? '+' : ''}${v.toFixed(digits)}`;

/**
 * A reading is usable only with both temperature and dew point.
 *
 * Ingest deliberately keeps records missing dew point — they still carry valid
 * wind, rain and radiation, and the endpoint has no history so nothing dropped
 * can be recovered. Filtering belongs here instead, where the requirement
 * actually lives.
 */
function isUsable(r: FogReading): boolean {
  return (
    Number.isFinite(r.tempC) &&
    Number.isFinite(r.dewPointC) &&
    Number.isFinite(r.dpdC)
  );
}

function toCurrent(r: FogReading, evaluatedAt: Date): CurrentConditions {
  return {
    observedAt: r.observedAt,
    tempC: r.tempC,
    dewPointC: r.dewPointC,
    dpdC: r.dpdC,
    humidity: r.humidity,
    windKmh: r.windKmh,
    solarWm2: r.solarWm2,
    clearnessIndex: r.clearnessIndex,
    solarElevationDeg: r.solarElevationDeg,
    pressureHpa: r.pressureHpa,
    rainRateMmh: r.rainRateMmh,
    ageMinutes: minutesBetween(evaluatedAt, r.observedAt),
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function assessFog(
  readings: readonly FogReading[],
  options: AssessOptions
): FogResult {
  const K = options.constants ?? FOG_CONSTANTS;
  const { evaluatedAt } = options;

  // Sort defensively and keep only scoreable readings. Callers pass query
  // results, and an ORDER BY that changes upstream must not silently invert
  // every delta in this file.
  const usable = readings
    .filter(isUsable)
    .slice()
    .sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());

  if (usable.length === 0) {
    return {
      status: 'insufficient_history',
      verdict: 'INSUFFICIENT_HISTORY',
      reason: 'No readings with both temperature and dew point.',
      readingCount: 0,
      readingsRequired: K.minReadings,
      historyHours: 0,
      current: null,
      constants: K,
    };
  }

  // The window is anchored to the newest READING, not to evaluatedAt, matching
  // the prototype. Anchoring to evaluatedAt would shrink the window whenever
  // polling stalls, quietly starving the components that need 24 hours at
  // exactly the moment the data is already degraded.
  const newest = usable[usable.length - 1];
  const cutoff = newest.observedAt.getTime() - K.windowHours * MS_PER_HOUR;
  const window = usable.filter((r) => r.observedAt.getTime() >= cutoff);

  const now = window[window.length - 1];
  const oldest = window[0];
  const historyHours = hoursBetween(now.observedAt, oldest.observedAt);

  if (window.length < K.minReadings) {
    return {
      status: 'insufficient_history',
      verdict: 'INSUFFICIENT_HISTORY',
      reason:
        `Only ${window.length} of ${K.minReadings} required readings ` +
        `(${fmt(historyHours * 60, 0)} minutes of history). ` +
        'The public endpoint returns no history, so this fills by polling.',
      readingCount: window.length,
      readingsRequired: K.minReadings,
      historyHours,
      current: toCurrent(now, evaluatedAt),
      constants: K,
    };
  }

  // -------------------------------------------------------------------------
  // Derived quantities
  // -------------------------------------------------------------------------

  const minutesSaturated = saturationRunMinutes(window, K);
  const { dTdt, referenceGapMinutes } = temperatureTrend(window, K);
  const ktPeak = peakDaytimeKt(window, K);
  const pressureDeltaHpa = pressureFlatness(window, K);

  // -------------------------------------------------------------------------
  // Gates. Any one forces the total to zero.
  // -------------------------------------------------------------------------

  const gates: Gate[] = [];

  if (now.rainRateMmh !== null && now.rainRateMmh > K.rainGateMmh) {
    gates.push({
      gate: 'raining',
      detail: `raining now (${fmt(now.rainRateMmh)} mm/h)`,
    });
  }
  if (now.dpdC > K.dpdSatC) {
    gates.push({
      gate: 'not_saturated',
      detail: `air not saturated (DPD ${fmt(now.dpdC)} °C)`,
    });
  }
  if (now.windKmh !== null && now.windKmh > K.windVetoKmh) {
    gates.push({
      gate: 'wind_too_strong',
      detail: `wind too strong (${fmt(now.windKmh, 1)} km/h)`,
    });
  }

  // -------------------------------------------------------------------------
  // Index A components
  // -------------------------------------------------------------------------

  const components: ComponentScore[] = [
    scoreSaturation(now, K),
    scorePersistence(minutesSaturated, historyHours, K),
    scoreWind(now, K),
    scorePlateau(now, dTdt, referenceGapMinutes, K),
    scoreRadiative(ktPeak, pressureDeltaHpa, historyHours, K),
    scoreReservoir(window, now, historyHours, K),
  ];

  const earned = components.reduce((sum, c) => sum + c.points, 0);
  const scoreA = gates.length > 0 ? 0 : earned;

  // -------------------------------------------------------------------------
  // Index B
  // -------------------------------------------------------------------------

  const indexB = evaluateIndexB(now, minutesSaturated, K);

  // -------------------------------------------------------------------------
  // Verdict resolution, in the specified order
  // -------------------------------------------------------------------------

  let rawVerdict: Verdict;
  let reason: string;

  if (gates.length > 0) {
    rawVerdict = 'NO_FOG';
    reason = gates.map((g) => g.detail).join('; ');
  } else if (indexB.signal === 'CONFIRMED') {
    rawVerdict = 'FOG';
    reason = indexB.detail ?? 'Index B confirmed';
  } else if (indexB.signal === 'NOT_FOG') {
    rawVerdict = 'NOT_FOG';
    reason = indexB.detail ?? 'Index B: low stratus or overcast, not fog';
  } else if (scoreA >= K.verdict.likelyMin) {
    rawVerdict = 'FOG_LIKELY';
    reason = 'All radiation-fog preconditions satisfied';
  } else if (scoreA >= K.verdict.ambiguousMin) {
    rawVerdict = 'AMBIGUOUS';
    reason = 'Saturated, but the distinguishing signals are weak';
    if (now.windKmh !== null && now.windKmh < K.windLoKmh) {
      // Not a hedge — an assertion. Calm air with no mechanical mixing
      // deposits moisture on surfaces instead of suspending it.
      reason += ' — wind is very calm, likely dew rather than fog';
    }
  } else {
    rawVerdict = 'NO_FOG';
    reason = 'Score below threshold';
  }

  // A DISSIPATING signal never becomes the verdict: it describes a transition,
  // and the resolution order has no slot for it. It is surfaced through
  // indexB.signal and appended to the reason so the UI can show a layer that
  // is lifting.
  if (indexB.signal === 'DISSIPATING' && indexB.detail) {
    reason += ` (${indexB.detail})`;
  }

  // -------------------------------------------------------------------------
  // Hysteresis
  // -------------------------------------------------------------------------

  const { verdict, hysteresisHeld } = applyHysteresis(
    rawVerdict,
    options.previous ?? null
  );

  return {
    status: 'scored',
    verdict,
    rawVerdict,
    hysteresisHeld,
    reason: hysteresisHeld
      ? `${reason} — holding previous verdict pending a second agreeing reading`
      : reason,
    scoreA,
    components,
    gates,
    indexB,
    minutesSaturated,
    dTdt,
    ktPeak,
    pressureDeltaHpa,
    current: toCurrent(now, evaluatedAt),
    readingCount: window.length,
    historyHours,
    constants: K,
  };
}

// ---------------------------------------------------------------------------
// Derived quantities
// ---------------------------------------------------------------------------

/**
 * Length of the UNBROKEN run of saturated readings counting back from now.
 *
 * Breaks on the first reading above the threshold — this is a run length, not
 * a tally. An hour saturated, ten minutes dry, an hour saturated is a
 * ten-minute run, because the layer was destroyed and rebuilt.
 *
 * Zero when the current reading itself is not saturated.
 */
function saturationRunMinutes(
  window: readonly FogReading[],
  K: FogConstants
): number {
  let minutes = 0;
  for (let i = window.length - 1; i >= 0; i -= 1) {
    const r = window[i];
    if (r.dpdC <= K.dpdSatC) {
      minutes = minutesBetween(window[window.length - 1].observedAt, r.observedAt);
    } else {
      break;
    }
  }
  return minutes;
}

/**
 * dT/dt in °C per hour, from the newest reading at least `minGapMinutes` old.
 *
 * The reference is chosen by TIME, not by index: a 5-minute cadence and a
 * 20-minute cadence must produce the same trend, and "n readings back" would
 * not. If no reading is old enough the trend is null and the component scores
 * zero — never extrapolated. A fabricated plateau is worth 20 points, which is
 * far too much to hand out on a guess.
 */
function temperatureTrend(
  window: readonly FogReading[],
  K: FogConstants
): { dTdt: number | null; referenceGapMinutes: number | null } {
  const now = window[window.length - 1];

  for (let i = window.length - 1; i >= 0; i -= 1) {
    const gap = minutesBetween(now.observedAt, window[i].observedAt);
    if (gap >= K.plateau.minGapMinutes) {
      const spanHours = gap / 60;
      if (spanHours <= 0) break;
      return {
        dTdt: (now.tempC - window[i].tempC) / spanHours,
        referenceGapMinutes: gap,
      };
    }
  }

  return { dTdt: null, referenceGapMinutes: null };
}

/**
 * Highest clearness index observed while the sun was well up.
 *
 * The elevation floor matters: near the horizon the clear-sky denominator
 * collapses and kt becomes noise, so a low-sun sample could either invent a
 * clear day or hide one.
 */
function peakDaytimeKt(
  window: readonly FogReading[],
  K: FogConstants
): number | null {
  let peak: number | null = null;
  for (const r of window) {
    if (
      r.solarElevationDeg > K.radiative.ktElevationMinDeg &&
      r.clearnessIndex !== null
    ) {
      peak = peak === null ? r.clearnessIndex : Math.max(peak, r.clearnessIndex);
    }
  }
  return peak;
}

/**
 * |Δ pressure| over the configured window, hPa.
 *
 * The reference reading is picked by time — the newest at least N hours old —
 * and only then checked for a pressure value, matching the prototype. If that
 * particular reading lacks pressure the result is null rather than reaching
 * further back, because a delta measured over an unknown span is not a delta.
 */
function pressureFlatness(
  window: readonly FogReading[],
  K: FogConstants
): number | null {
  const now = window[window.length - 1];
  if (now.pressureHpa === null) return null;

  for (let i = window.length - 1; i >= 0; i -= 1) {
    if (
      hoursBetween(now.observedAt, window[i].observedAt) >=
      K.radiative.pressureWindowHours
    ) {
      const ref = window[i];
      return ref.pressureHpa === null
        ? null
        : Math.abs(now.pressureHpa - ref.pressureHpa);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function scoreSaturation(now: FogReading, K: FogConstants): ComponentScore {
  const tier = K.saturation.tiers.find((t) => now.dpdC <= t.maxDpdC);
  const humidity = now.humidity === null ? 'n/a' : `${fmt(now.humidity, 0)}%`;

  return {
    component: 'saturation',
    points: tier?.points ?? 0,
    max: K.saturation.max,
    // Humidity is shown but NOT scored. It is the input Ambient derived the
    // dew point from, so scoring both would double-count one measurement.
    detail: `DPD ${fmt(now.dpdC)} °C (RH ${humidity})`,
    available: true,
  };
}

function scorePersistence(
  minutesSaturated: number,
  historyHours: number,
  K: FogConstants
): ComponentScore {
  const tier = K.persistence.tiers.find((t) => minutesSaturated >= t.minMinutes);
  const topTier = K.persistence.tiers[0].minMinutes;
  const available = historyHours * 60 >= topTier;

  return {
    component: 'persistence',
    points: tier?.points ?? 0,
    max: K.persistence.max,
    detail: available
      ? `saturated ${fmt(minutesSaturated, 0)} minutes continuously`
      : `saturated ${fmt(minutesSaturated, 0)} minutes — only ` +
        `${fmt(historyHours * 60, 0)} minutes of history, ${topTier} needed for full marks`,
    available,
  };
}

function scoreWind(now: FogReading, K: FogConstants): ComponentScore {
  const w = now.windKmh;
  const { wind } = K;

  let points = 0;
  let detail: string;

  if (w === null) {
    detail = 'wind data unavailable';
  } else if (w >= K.windLoKmh && w <= K.windHiKmh) {
    points = wind.optimalPoints;
    detail = `${fmt(w, 1)} km/h — inside the optimal band`;
  } else if (w > K.windHiKmh && w <= wind.briskMaxKmh) {
    points = wind.briskPoints;
    detail = `${fmt(w, 1)} km/h — brisk`;
  } else if (w < K.windLoKmh) {
    // See fogConstants: calm favours dew over fog. Not a bug.
    points = wind.calmPoints;
    detail = `${fmt(w, 1)} km/h — too calm to mix, favours dew`;
  } else if (w > wind.briskMaxKmh && w <= wind.marginalMaxKmh) {
    points = wind.marginalPoints;
    detail = `${fmt(w, 1)} km/h — marginal`;
  } else {
    detail = `${fmt(w, 1)} km/h — outside the usable range`;
  }

  return {
    component: 'wind',
    points,
    max: wind.max,
    detail,
    available: w !== null,
  };
}

function scorePlateau(
  now: FogReading,
  dTdt: number | null,
  referenceGapMinutes: number | null,
  K: FogConstants
): ComponentScore {
  const { plateau } = K;
  let points = 0;
  let detail: string;

  if (dTdt === null) {
    detail = `no reading at least ${plateau.minGapMinutes} minutes old — trend unknown`;
  } else if (now.dpdC > K.dpdSatC) {
    detail = `dT/dt ${signed(dTdt)} °C/h — air not saturated, plateau irrelevant`;
  } else if (Math.abs(dTdt) < plateau.tightRateCPerH) {
    points = plateau.tightPoints;
    detail = `dT/dt ${signed(dTdt)} °C/h over ${fmt(referenceGapMinutes ?? 0, 0)} min — cooling has stopped`;
  } else if (Math.abs(dTdt) < plateau.looseRateCPerH) {
    points = plateau.loosePoints;
    detail = `dT/dt ${signed(dTdt)} °C/h — flattening`;
  } else {
    detail = `dT/dt ${signed(dTdt)} °C/h — still cooling`;
  }

  return {
    component: 'plateau',
    points,
    max: plateau.max,
    detail,
    available: dTdt !== null,
  };
}

function scoreRadiative(
  ktPeak: number | null,
  pressureDeltaHpa: number | null,
  historyHours: number,
  K: FogConstants
): ComponentScore {
  const { radiative } = K;
  const clearDay = ktPeak !== null && ktPeak > radiative.ktPeakMin;
  const quietPressure =
    pressureDeltaHpa !== null && pressureDeltaHpa < radiative.pressureDeltaMaxHpa;

  const points =
    clearDay && quietPressure
      ? radiative.bothPoints
      : clearDay || quietPressure
        ? radiative.eitherPoints
        : 0;

  const bits = [
    ktPeak === null ? 'peak kt n/a' : `peak kt ${fmt(ktPeak)}`,
    pressureDeltaHpa === null
      ? `Δp/${radiative.pressureWindowHours}h n/a`
      : `Δp/${radiative.pressureWindowHours}h ${fmt(pressureDeltaHpa)} hPa`,
  ];

  return {
    component: 'radiative',
    points,
    max: radiative.max,
    detail: bits.join(' | '),
    // Both sub-signals must be observable for full marks. A night that started
    // before we did has no daytime kt to look back on.
    available: ktPeak !== null && pressureDeltaHpa !== null,
  };
}

function scoreReservoir(
  window: readonly FogReading[],
  now: FogReading,
  historyHours: number,
  K: FogConstants
): ComponentScore {
  const { reservoir } = K;

  const rainedInWindow = window.some((r) => {
    const ago = hoursBetween(now.observedAt, r.observedAt);
    return (
      ago >= reservoir.windowStartHoursAgo &&
      ago <= reservoir.windowEndHoursAgo &&
      r.rainRateMmh !== null &&
      r.rainRateMmh > K.rainGateMmh
    );
  });

  // "None in the last hour" — the moisture has to have had time to evaporate
  // into the layer and the ground to have started cooling again. Rain an hour
  // ago is a wet surface, not a reservoir.
  //
  // NOTE: this quiet-period test is in the written specification but NOT in
  // the Python prototype, which checks only the 6-24 h window. The spec wins.
  const recentRain = window.some((r) => {
    const ago = hoursBetween(now.observedAt, r.observedAt);
    return (
      ago <= reservoir.quietHours &&
      r.rainRateMmh !== null &&
      r.rainRateMmh > K.rainGateMmh
    );
  });

  const earned = rainedInWindow && !recentRain;

  let detail: string;
  if (earned) {
    detail = `rain ${reservoir.windowStartHoursAgo}-${reservoir.windowEndHoursAgo} h ago, dry since`;
  } else if (rainedInWindow && recentRain) {
    detail = 'rain in the window, but also within the last hour';
  } else {
    detail = 'no antecedent rain';
  }

  return {
    component: 'reservoir',
    points: earned ? reservoir.points : 0,
    max: reservoir.max,
    detail,
    // The full 6-24 h window has to be observable before an absence means
    // anything. Below that, "no antecedent rain" only means "not seen yet".
    available: historyHours >= reservoir.windowEndHoursAgo,
  };
}

// ---------------------------------------------------------------------------
// Index B
// ---------------------------------------------------------------------------

function evaluateIndexB(
  now: FogReading,
  minutesSaturated: number,
  K: FogConstants
): IndexBResult {
  const { indexB } = K;

  if (now.solarElevationDeg <= indexB.minElevationDeg) {
    return {
      available: false,
      unavailableReason: 'below_elevation',
      signal: null,
      detail: null,
    };
  }

  if (now.clearnessIndex === null) {
    // Either the station has no pyranometer at all, or the clear-sky
    // denominator was too small to divide by. Both mean the same to the UI:
    // the score has not been cross-checked against an observation.
    return {
      available: false,
      unavailableReason: 'no_clearness_index',
      signal: null,
      detail: null,
    };
  }

  const kt = now.clearnessIndex;

  if (kt < indexB.confirmKtMax && now.dpdC < indexB.confirmDpdMaxC) {
    return {
      available: true,
      unavailableReason: null,
      signal: 'CONFIRMED',
      detail: `kt ${fmt(kt)} below ${indexB.confirmKtMax} with DPD ${fmt(now.dpdC)} °C`,
    };
  }

  if (kt < indexB.notFogKtMax && now.dpdC > indexB.notFogDpdMinC) {
    // Radiation is suppressed but the air is dry: something is blocking the
    // sun from above rather than around the sensor.
    return {
      available: true,
      unavailableReason: null,
      signal: 'NOT_FOG',
      detail: `kt low but DPD ${fmt(now.dpdC)} °C — low stratus or overcast`,
    };
  }

  if (kt > indexB.dissipatingKtMin && minutesSaturated > 0) {
    return {
      available: true,
      unavailableReason: null,
      signal: 'DISSIPATING',
      detail: `kt risen to ${fmt(kt)} — layer lifting`,
    };
  }

  return { available: true, unavailableReason: null, signal: null, detail: null };
}

// ---------------------------------------------------------------------------
// Hysteresis
// ---------------------------------------------------------------------------

/**
 * Require two consecutive agreeing readings before the published verdict moves.
 *
 * A single reading crossing a threshold is noise as often as it is a change,
 * and a status card that flickers between FOG and NO_FOG every five minutes
 * teaches operators to ignore it. The damping costs one polling interval of
 * latency on a genuine transition, which is the right trade at five minutes.
 *
 * Implemented against the PREVIOUS raw verdict rather than a rolling counter,
 * so the whole thing stays a pure function of two stored values.
 *
 * Coming out of INSUFFICIENT_HISTORY is not a flip and is never damped: there
 * was no established state to protect, and holding "no data" once real data
 * exists would be actively misleading.
 */
function applyHysteresis(
  rawVerdict: Verdict,
  previous: PreviousState | null
): { verdict: Verdict; hysteresisHeld: boolean } {
  if (!previous) return { verdict: rawVerdict, hysteresisHeld: false };
  if (previous.verdict === 'INSUFFICIENT_HISTORY') {
    return { verdict: rawVerdict, hysteresisHeld: false };
  }
  if (previous.verdict === rawVerdict) {
    return { verdict: rawVerdict, hysteresisHeld: false };
  }
  // The change is adopted only once a second reading has agreed with it.
  if (previous.rawVerdict === rawVerdict) {
    return { verdict: rawVerdict, hysteresisHeld: false };
  }
  return { verdict: previous.verdict, hysteresisHeld: true };
}
