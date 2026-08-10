import {
  assessFog,
  type ComponentScore,
  type FogReading,
  type PreviousState,
} from '@/lib/weather/fogIndex';
import { FOG_CONSTANTS } from '@/config/fogConstants';
import {
  clearnessIndex,
  haurwitzClearSkyGhi,
  solarPosition,
} from '@/lib/weather/solar';

// ---------------------------------------------------------------------------
// Fixtures
//
// Readings are built through the REAL solar module rather than with hand-typed
// irradiance values, so a scenario labelled "pre-dawn" is pre-dawn according to
// the same geometry the production path uses. A fixture that disagreed with
// the physics would let a broken Index B pass.
// ---------------------------------------------------------------------------

const STATION = { latitude: -2.5034, longitude: 121.5176 }; // ASBSAR1, East Luwu

interface Spec {
  minutesAgo: number;
  tempC: number;
  dewPointC: number;
  windKmh?: number | null;
  pressureHpa?: number | null;
  rainRateMmh?: number | null;
  /** Measured solar as a fraction of clear-sky. 0.8 = clear, 0.15 = fog. */
  solarFactor?: number;
  humidity?: number | null;
}

function reading(end: Date, spec: Spec): FogReading {
  const observedAt = new Date(end.getTime() - spec.minutesAgo * 60_000);
  const { elevationDeg, cosZenith } = solarPosition(
    observedAt,
    STATION.latitude,
    STATION.longitude
  );
  const ghiClear = haurwitzClearSkyGhi(cosZenith);
  const solarWm2 = ghiClear > 0 ? ghiClear * (spec.solarFactor ?? 0.8) : 0;

  return {
    observedAt,
    tempC: spec.tempC,
    dewPointC: spec.dewPointC,
    dpdC: spec.tempC - spec.dewPointC,
    windKmh: spec.windKmh ?? 3.4,
    humidity: spec.humidity ?? 95,
    solarWm2,
    clearnessIndex: clearnessIndex(solarWm2, ghiClear),
    solarElevationDeg: elevationDeg,
    pressureHpa: spec.pressureHpa ?? 1010,
    rainRateMmh: spec.rainRateMmh ?? 0,
  };
}

/**
 * A textbook radiation-fog night in East Luwu: clear day, quiet pressure, rain
 * ten hours back, air saturated and the cooling curve flat for the last 2.5 h.
 *
 * End is 21:00 UTC = 05:00 WITA, before sunrise, so Index B cannot run and the
 * verdict rests on Index A alone.
 */
const PRE_DAWN_END = new Date('2026-08-08T21:00:00Z');

function preDawnNight(overrides: Partial<Spec> = {}): FogReading[] {
  const out: FogReading[] = [];

  for (let m = 24 * 60; m >= 0; m -= 5) {
    let tempC: number;
    const dewPointC = 19.0;

    if (m <= 150) {
      // Saturated plateau: cooling has stopped, DPD 0.1 degC.
      tempC = 19.1;
    } else if (m <= 480) {
      // Evening: cooling towards the dew point.
      const frac = (m - 150) / (480 - 150);
      tempC = 19.2 + frac * 6.8;
    } else {
      // Daytime and the previous evening. Well above the dew point.
      tempC = 26 + 3 * Math.sin((m - 480) / 120);
    }

    out.push(
      reading(PRE_DAWN_END, {
        minutesAgo: m,
        tempC,
        dewPointC,
        // Rain 10 h back charges the moisture reservoir; nothing since.
        rainRateMmh: m === 600 ? 1.0 : 0,
        ...overrides,
      })
    );
  }

  return out;
}

const at = (r: readonly ComponentScore[], key: string): ComponentScore => {
  const found = r.find((c) => c.component === key);
  if (!found) throw new Error(`no component ${key}`);
  return found;
};

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

describe('gates', () => {
  test('a clear afternoon scores zero on the not-saturated gate', () => {
    // 14:00 WITA. Warm, dry, breezy — the ordinary state of the world.
    const end = new Date('2026-08-08T06:00:00Z');
    const readings = Array.from({ length: 24 }, (_, i) =>
      reading(end, { minutesAgo: i * 5, tempC: 29, dewPointC: 19, windKmh: 9 })
    );

    const result = assessFog(readings, { evaluatedAt: end });
    if (result.status !== 'scored') throw new Error('expected a scored result');

    expect(result.scoreA).toBe(0);
    expect(result.verdict).toBe('NO_FOG');
    expect(result.gates.map((g) => g.gate)).toContain('not_saturated');
  });

  test('rain zeroes the total but leaves the component breakdown intact', () => {
    // The perfect fog night, with rain falling right now. The gate forces the
    // score to zero; the components must still report what they earned, or the
    // calibration record loses the ability to say how close it was.
    const readings = preDawnNight();
    readings[readings.length - 1] = {
      ...readings[readings.length - 1],
      rainRateMmh: 1.4,
    };

    const result = assessFog(readings, { evaluatedAt: PRE_DAWN_END });
    if (result.status !== 'scored') throw new Error('expected a scored result');

    expect(result.gates.map((g) => g.gate)).toContain('raining');
    expect(result.scoreA).toBe(0);
    expect(result.verdict).toBe('NO_FOG');
    expect(at(result.components, 'saturation').points).toBe(30);
    expect(
      result.components.reduce((s, c) => s + c.points, 0)
    ).toBeGreaterThan(70);
  });

  test('wind above the veto zeroes the total', () => {
    const readings = preDawnNight({ windKmh: 14 });
    const result = assessFog(readings, { evaluatedAt: PRE_DAWN_END });
    if (result.status !== 'scored') throw new Error('expected a scored result');

    expect(result.gates.map((g) => g.gate)).toContain('wind_too_strong');
    expect(result.scoreA).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Index A
// ---------------------------------------------------------------------------

describe('index A', () => {
  test('pre-dawn saturation with light wind scores at least 70', () => {
    const result = assessFog(preDawnNight(), { evaluatedAt: PRE_DAWN_END });
    if (result.status !== 'scored') throw new Error('expected a scored result');

    expect(result.scoreA).toBeGreaterThanOrEqual(70);
    expect(result.verdict).toBe('FOG_LIKELY');
    expect(result.gates).toHaveLength(0);

    // Every component earned its maximum on this night.
    expect(at(result.components, 'saturation').points).toBe(30);
    expect(at(result.components, 'persistence').points).toBe(15);
    expect(at(result.components, 'wind').points).toBe(20);
    expect(at(result.components, 'plateau').points).toBe(20);
    expect(at(result.components, 'radiative').points).toBe(10);
    expect(at(result.components, 'reservoir').points).toBe(5);
    expect(result.scoreA).toBe(100);

    // The run reaches back past the 150-minute plateau: the evening cooling
    // curve is already inside DPD <= 1.0 degC before it flattens, and the run
    // breaks only where it crosses back out, 185 minutes ago.
    expect(result.minutesSaturated).toBe(185);
    expect(result.dTdt).toBeCloseTo(0, 6);
    expect(result.ktPeak).toBeCloseTo(0.8, 6);
    expect(result.pressureDeltaHpa).toBeCloseTo(0, 6);

    // Before sunrise, so the score has NOT been cross-checked by observation.
    expect(result.indexB.available).toBe(false);
    expect(result.indexB.unavailableReason).toBe('below_elevation');
    expect(result.current.solarElevationDeg).toBeLessThan(0);
  });

  test('dead calm scores only 5 for wind, not more', () => {
    // The counterintuitive rule, pinned. Calm air has no mechanical mixing to
    // distribute radiative cooling through a layer, so it deposits dew on
    // surfaces instead of suspending droplets. Anyone "fixing" this to reward
    // calm will fail here.
    const calm = assessFog(preDawnNight({ windKmh: 1.2 }), {
      evaluatedAt: PRE_DAWN_END,
    });
    const optimal = assessFog(preDawnNight({ windKmh: 3.4 }), {
      evaluatedAt: PRE_DAWN_END,
    });
    if (calm.status !== 'scored' || optimal.status !== 'scored') {
      throw new Error('expected scored results');
    }

    expect(at(calm.components, 'wind').points).toBe(5);
    expect(at(optimal.components, 'wind').points).toBe(20);
    expect(at(calm.components, 'wind').detail).toMatch(/dew/i);
    expect(calm.scoreA).toBe(optimal.scoreA - 15);
  });

  test('a dead-calm ambiguous case is called out as dew', () => {
    // Short history: saturated and flat, but nothing else observable yet.
    const end = new Date('2026-08-08T21:00:00Z');
    const readings = Array.from({ length: 9 }, (_, i) =>
      reading(end, {
        minutesAgo: i * 5,
        tempC: 19.1,
        dewPointC: 19.0,
        windKmh: 1.2,
      })
    );

    const result = assessFog(readings, { evaluatedAt: end });
    if (result.status !== 'scored') throw new Error('expected a scored result');

    expect(result.scoreA).toBe(60);
    expect(result.verdict).toBe('AMBIGUOUS');
    expect(result.reason).toMatch(/dew rather than fog/i);
  });

  test('components report their own availability', () => {
    const end = new Date('2026-08-08T21:00:00Z');
    const readings = Array.from({ length: 9 }, (_, i) =>
      reading(end, { minutesAgo: i * 5, tempC: 19.1, dewPointC: 19.0 })
    );

    const result = assessFog(readings, { evaluatedAt: end });
    if (result.status !== 'scored') throw new Error('expected a scored result');

    // 40 minutes of history: enough for a trend, not enough for anything that
    // looks back hours. The UI must be able to say which is which.
    expect(at(result.components, 'saturation').available).toBe(true);
    expect(at(result.components, 'wind').available).toBe(true);
    expect(at(result.components, 'plateau').available).toBe(true);
    expect(at(result.components, 'persistence').available).toBe(false);
    expect(at(result.components, 'radiative').available).toBe(false);
    expect(at(result.components, 'reservoir').available).toBe(false);
  });

  test('the thermal plateau is not extrapolated from too short a window', () => {
    // Six readings five minutes apart plus a couple more: 40 minutes total, so
    // a 35-minute reference exists. Shrink it and the component must score 0
    // rather than inventing a trend worth 20 points.
    const end = new Date('2026-08-08T21:00:00Z');
    const tooShort = Array.from({ length: 9 }, (_, i) =>
      reading(end, { minutesAgo: i * 3, tempC: 19.1, dewPointC: 19.0 })
    ); // 24 minutes of history

    const result = assessFog(tooShort, { evaluatedAt: end });
    if (result.status !== 'scored') throw new Error('expected a scored result');

    expect(result.dTdt).toBeNull();
    expect(at(result.components, 'plateau').points).toBe(0);
    expect(at(result.components, 'plateau').available).toBe(false);
  });

  test('saturation persistence breaks on the first dry reading', () => {
    // A run is a run, not a tally: an hour saturated, ten dry minutes, an hour
    // saturated is a ten-minute run, because the layer was destroyed and
    // rebuilt.
    const end = new Date('2026-08-08T21:00:00Z');
    const readings = Array.from({ length: 40 }, (_, i) => {
      const m = i * 5;
      const dry = m > 20 && m <= 30; // a gap 20-30 minutes back
      return reading(end, {
        minutesAgo: m,
        tempC: dry ? 21.0 : 19.1,
        dewPointC: 19.0,
      });
    });

    const result = assessFog(readings, { evaluatedAt: end });
    if (result.status !== 'scored') throw new Error('expected a scored result');

    expect(result.minutesSaturated).toBe(20);
    expect(at(result.components, 'persistence').points).toBe(0);
  });

  test('the moisture reservoir requires the last hour to be dry', () => {
    // Divergence from the Python prototype, which checks only the 6-24 h
    // window. The written spec adds the quiet period, and the spec wins.
    const withRecentRain = preDawnNight().map((r, i, arr) =>
      i === arr.length - 7 ? { ...r, rainRateMmh: 0.9 } : r
    ); // 30 minutes ago

    const result = assessFog(withRecentRain, { evaluatedAt: PRE_DAWN_END });
    if (result.status !== 'scored') throw new Error('expected a scored result');

    expect(at(result.components, 'reservoir').points).toBe(0);
    expect(at(result.components, 'reservoir').detail).toMatch(/last hour/i);
  });
});

// ---------------------------------------------------------------------------
// Index B
// ---------------------------------------------------------------------------

describe('index B', () => {
  test('post-sunrise radiation suppression confirms fog and overrides index A', () => {
    // 08:00 WITA. Sun well up, radiation crushed to 15% of clear-sky, air
    // saturated. Index A is only 40 — below even the ambiguous threshold —
    // because the layer formed minutes ago and nothing else has had time to
    // register. The observation must beat the prediction.
    const end = new Date('2026-08-09T00:00:00Z');
    const readings = Array.from({ length: 10 }, (_, i) => {
      const m = 45 - i * 5;
      const saturated = m <= 5;
      const tempC = 20.0 + (45 - m) * (0.75 / 45);
      return reading(end, {
        minutesAgo: m,
        tempC,
        dewPointC: saturated ? tempC - 0.2 : tempC - 1.5,
        windKmh: 9,
        solarFactor: 0.15,
      });
    });

    const result = assessFog(readings, { evaluatedAt: end });
    if (result.status !== 'scored') throw new Error('expected a scored result');

    expect(result.current.solarElevationDeg).toBeGreaterThan(
      FOG_CONSTANTS.indexB.minElevationDeg
    );
    expect(result.indexB.available).toBe(true);
    expect(result.indexB.signal).toBe('CONFIRMED');
    expect(result.scoreA).toBeLessThan(FOG_CONSTANTS.verdict.ambiguousMin);
    expect(result.verdict).toBe('FOG'); // index B overrides the low score
  });

  test('suppressed radiation over dry air is stratus, not fog', () => {
    const end = new Date('2026-08-09T00:00:00Z');
    const readings = Array.from({ length: 10 }, (_, i) =>
      reading(end, {
        minutesAgo: 45 - i * 5,
        tempC: 24,
        dewPointC: 21, // DPD 3.0 — well above the 2.0 threshold
        windKmh: 5,
        solarFactor: 0.2,
      })
    );

    const result = assessFog(readings, { evaluatedAt: end });
    if (result.status !== 'scored') throw new Error('expected a scored result');

    // The not-saturated gate fires first in the resolution order, so the
    // verdict is NO_FOG — but index B's own reading is still recorded.
    expect(result.indexB.signal).toBe('NOT_FOG');
    expect(result.gates.map((g) => g.gate)).toContain('not_saturated');
    expect(result.verdict).toBe('NO_FOG');
  });

  test('index B is unavailable at night and says why', () => {
    const result = assessFog(preDawnNight(), { evaluatedAt: PRE_DAWN_END });
    if (result.status !== 'scored') throw new Error('expected a scored result');

    expect(result.indexB.available).toBe(false);
    expect(result.indexB.unavailableReason).toBe('below_elevation');
    expect(result.indexB.signal).toBeNull();
  });

  test('index B is unavailable on a station with no pyranometer', () => {
    const end = new Date('2026-08-09T00:00:00Z');
    const readings = Array.from({ length: 10 }, (_, i) => ({
      ...reading(end, {
        minutesAgo: 45 - i * 5,
        tempC: 20,
        dewPointC: 19.9,
        windKmh: 4,
      }),
      solarWm2: null,
      clearnessIndex: null,
    }));

    const result = assessFog(readings, { evaluatedAt: end });
    if (result.status !== 'scored') throw new Error('expected a scored result');

    expect(result.indexB.available).toBe(false);
    expect(result.indexB.unavailableReason).toBe('no_clearness_index');
  });

  test('a dissipating layer annotates the reason but never becomes the verdict', () => {
    // kt climbing past 0.4 while a saturation run is active. The resolution
    // order has no slot for DISSIPATING, so it must surface as a note.
    const end = new Date('2026-08-09T00:00:00Z');
    const readings = Array.from({ length: 12 }, (_, i) =>
      reading(end, {
        minutesAgo: 55 - i * 5,
        tempC: 20.0,
        dewPointC: 19.4, // DPD 0.6 — saturated, but above the confirm threshold
        windKmh: 4,
        solarFactor: 0.55,
      })
    );

    const result = assessFog(readings, { evaluatedAt: end });
    if (result.status !== 'scored') throw new Error('expected a scored result');

    expect(result.indexB.signal).toBe('DISSIPATING');
    expect(result.verdict).not.toBe('FOG');
    expect(result.reason).toMatch(/lifting/i);
  });
});

// ---------------------------------------------------------------------------
// Insufficient history
// ---------------------------------------------------------------------------

describe('insufficient history', () => {
  test('fewer than eight readings refuses to score but still reports conditions', () => {
    const end = new Date('2026-08-08T21:00:00Z');
    const readings = Array.from({ length: 5 }, (_, i) =>
      reading(end, { minutesAgo: i * 5, tempC: 19.4, dewPointC: 19.0 })
    );

    const result = assessFog(readings, { evaluatedAt: end });

    expect(result.status).toBe('insufficient_history');
    if (result.status !== 'insufficient_history') return;

    expect(result.verdict).toBe('INSUFFICIENT_HISTORY');
    expect(result.readingCount).toBe(5);
    expect(result.readingsRequired).toBe(8);
    // The UI can still show live conditions while the history accumulates.
    expect(result.current?.dpdC).toBeCloseTo(0.4, 6);
    expect(result.current?.tempC).toBeCloseTo(19.4, 6);
    expect(result.current?.dewPointC).toBeCloseTo(19.0, 6);
  });

  test('a reading with no dew point is not scoreable', () => {
    // Ingest keeps these records — they carry valid wind, rain and radiation,
    // and the endpoint has no history so nothing dropped is recoverable. The
    // filter belongs here, where the requirement actually is.
    const end = new Date('2026-08-08T21:00:00Z');
    const readings = Array.from({ length: 12 }, (_, i) => ({
      ...reading(end, { minutesAgo: i * 5, tempC: 19.1, dewPointC: 19.0 }),
      dewPointC: NaN,
      dpdC: NaN,
    }));

    const result = assessFog(readings, { evaluatedAt: end });
    expect(result.status).toBe('insufficient_history');
    if (result.status !== 'insufficient_history') return;
    expect(result.current).toBeNull();
  });

  test('data age is reported against the evaluation instant, not the reading', () => {
    const end = new Date('2026-08-08T21:00:00Z');
    const readings = Array.from({ length: 12 }, (_, i) =>
      reading(end, { minutesAgo: i * 5, tempC: 19.1, dewPointC: 19.0 })
    );

    // Scored 90 minutes after the last reading arrived: a stalled poller.
    const result = assessFog(readings, {
      evaluatedAt: new Date(end.getTime() + 90 * 60_000),
    });
    if (result.status !== 'scored') throw new Error('expected a scored result');

    expect(result.current.ageMinutes).toBeCloseTo(90, 6);
  });
});

// ---------------------------------------------------------------------------
// Hysteresis
// ---------------------------------------------------------------------------

describe('hysteresis', () => {
  const scoreWith = (previous: PreviousState | null) =>
    assessFog(preDawnNight(), { evaluatedAt: PRE_DAWN_END, previous });

  test('a single reading cannot flip the published verdict', () => {
    const result = scoreWith({ verdict: 'NO_FOG', rawVerdict: 'NO_FOG' });
    if (result.status !== 'scored') throw new Error('expected a scored result');

    expect(result.rawVerdict).toBe('FOG_LIKELY');
    expect(result.verdict).toBe('NO_FOG'); // held
    expect(result.hysteresisHeld).toBe(true);
    expect(result.reason).toMatch(/holding previous verdict/i);
  });

  test('a second agreeing reading adopts the change', () => {
    const result = scoreWith({ verdict: 'NO_FOG', rawVerdict: 'FOG_LIKELY' });
    if (result.status !== 'scored') throw new Error('expected a scored result');

    expect(result.verdict).toBe('FOG_LIKELY');
    expect(result.hysteresisHeld).toBe(false);
  });

  test('an unchanged verdict is never held', () => {
    const result = scoreWith({ verdict: 'FOG_LIKELY', rawVerdict: 'FOG_LIKELY' });
    if (result.status !== 'scored') throw new Error('expected a scored result');

    expect(result.verdict).toBe('FOG_LIKELY');
    expect(result.hysteresisHeld).toBe(false);
  });

  test('coming out of insufficient history is adopted immediately', () => {
    // There was no established state to protect, and holding "no data" once
    // real data exists would be actively misleading.
    const result = scoreWith({
      verdict: 'INSUFFICIENT_HISTORY',
      rawVerdict: 'INSUFFICIENT_HISTORY',
    });
    if (result.status !== 'scored') throw new Error('expected a scored result');

    expect(result.verdict).toBe('FOG_LIKELY');
    expect(result.hysteresisHeld).toBe(false);
  });

  test('with no prior state the raw verdict is published', () => {
    const result = scoreWith(null);
    if (result.status !== 'scored') throw new Error('expected a scored result');

    expect(result.verdict).toBe(result.rawVerdict);
    expect(result.hysteresisHeld).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

describe('purity', () => {
  test('the same input scores identically regardless of the wall clock', () => {
    const readings = preDawnNight();
    const a = assessFog(readings, { evaluatedAt: PRE_DAWN_END });
    const b = assessFog(readings, { evaluatedAt: PRE_DAWN_END });

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test('the input array is not mutated or reordered in place', () => {
    const readings = preDawnNight();
    const before = readings.map((r) => r.observedAt.getTime());

    assessFog(readings.slice().reverse(), { evaluatedAt: PRE_DAWN_END });
    assessFog(readings, { evaluatedAt: PRE_DAWN_END });

    expect(readings.map((r) => r.observedAt.getTime())).toEqual(before);
  });

  test('readings arriving newest-first score the same as oldest-first', () => {
    const readings = preDawnNight();
    const forward = assessFog(readings, { evaluatedAt: PRE_DAWN_END });
    const reversed = assessFog(readings.slice().reverse(), {
      evaluatedAt: PRE_DAWN_END,
    });

    if (forward.status !== 'scored' || reversed.status !== 'scored') {
      throw new Error('expected scored results');
    }
    expect(reversed.scoreA).toBe(forward.scoreA);
    expect(reversed.minutesSaturated).toBe(forward.minutesSaturated);
  });

  test('constants are injectable, so a recalibration needs no code change', () => {
    const strict = {
      ...FOG_CONSTANTS,
      // Demand near-perfect saturation before awarding the top tier.
      saturation: {
        ...FOG_CONSTANTS.saturation,
        tiers: [
          { maxDpdC: 0.05, points: 30 },
          { maxDpdC: 0.5, points: 20 },
          { maxDpdC: 1.5, points: 10 },
        ],
      },
    };

    const result = assessFog(preDawnNight(), {
      evaluatedAt: PRE_DAWN_END,
      constants: strict,
    });
    if (result.status !== 'scored') throw new Error('expected a scored result');

    // DPD is 0.1: top tier under the defaults, second tier under these.
    expect(at(result.components, 'saturation').points).toBe(20);
    expect(result.scoreA).toBe(90);
    expect(result.constants.saturation.tiers[0].maxDpdC).toBe(0.05);
  });
});
