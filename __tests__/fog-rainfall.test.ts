import {
  hourlyRainTotals,
  rainSteps,
  MIN_COVERED_MINUTES,
  TRUSTED_GAP_MINUTES,
  type RainSample,
} from '@/lib/weather/rainfall';

// These tests pin the RULE. The production path is the `weather_rain_hourly`
// view in migrations/002_rainfall_views.sql, which encodes the same rule in
// SQL; lib/weather/rainfall.ts is its readable twin and the only version that
// can be exercised without a live Postgres. If a threshold moves in one, it
// must move in the other.

const TZ = 'Asia/Singapore'; // UTC+8 — the station's own zone, per its `tz` field

/** Build a series at a fixed cadence starting from a UTC instant. */
function series(
  startUtc: string,
  cadenceMinutes: number,
  dailyMm: readonly (number | null)[]
): RainSample[] {
  const t0 = new Date(startUtc).getTime();
  return dailyMm.map((v, i) => ({
    observedAt: new Date(t0 + i * cadenceMinutes * 60_000),
    rainDailyMm: v,
  }));
}

describe('per-reading steps', () => {
  test('a rising accumulator yields plain differences', () => {
    const steps = rainSteps(series('2026-08-08T02:00:00Z', 5, [0, 0.5, 1.2, 1.2]));

    expect(steps[0].deltaMm).toBeNull(); // no predecessor: unknown, not zero
    expect(steps[1].deltaMm).toBeCloseTo(0.5, 9);
    expect(steps[2].deltaMm).toBeCloseTo(0.7, 9);
    expect(steps[3].deltaMm).toBeCloseTo(0, 9);
  });

  test('a negative delta is the midnight reset, and the step is the end value', () => {
    // The counter cannot fall. When it does, it reset at local midnight and
    // everything on the clock now fell after the reset.
    const steps = rainSteps(series('2026-08-08T15:50:00Z', 5, [8.4, 8.4, 0.3, 0.9]));

    expect(steps[2].isReset).toBe(true);
    expect(steps[2].deltaMm).toBeCloseTo(0.3, 9); // NOT 0.3 - 8.4
    expect(steps[3].isReset).toBe(false);
    expect(steps[3].deltaMm).toBeCloseTo(0.6, 9);
  });

  test('the reset lands where the station says midnight is, not where UTC does', () => {
    // 16:00 UTC IS local midnight in Asia/Singapore. A series that reset at
    // UTC midnight instead would put the reset eight hours out, and every
    // bucket after it in the wrong day.
    const samples = series('2026-08-08T15:45:00Z', 5, [12.0, 12.0, 12.0, 0, 0]);
    const hours = hourlyRainTotals(samples, TZ);

    // 15:45-15:55 UTC is the 23:xx local hour; 16:00 UTC starts a new local day.
    expect(hours.map((h) => h.hourLocal)).toEqual([
      '2026-08-08T23',
      '2026-08-09T00',
    ]);
    expect(hours[1].hadReset).toBe(true);
  });

  test('unordered input is sorted before differencing', () => {
    const ordered = series('2026-08-08T02:00:00Z', 5, [0, 0.5, 1.2]);
    const shuffled = [ordered[2], ordered[0], ordered[1]];

    expect(rainSteps(shuffled).map((s) => s.deltaMm)).toEqual(
      rainSteps(ordered).map((s) => s.deltaMm)
    );
  });

  test('readings with no accumulator value are dropped, not treated as zero', () => {
    const steps = rainSteps(series('2026-08-08T02:00:00Z', 5, [1.0, null, 1.6]));
    expect(steps).toHaveLength(2);
    expect(steps[1].deltaMm).toBeCloseTo(0.6, 9);
    expect(steps[1].gapMinutes).toBe(10); // the gap spans the dropped reading
  });
});

describe('hourly totals', () => {
  test('a fully covered wet hour reports its total', () => {
    // 09:00-10:00 local (01:00-02:00 UTC), 5-minute cadence, 0.2 mm per step.
    //
    // The series starts one reading EARLY, at 08:55. The first reading of any
    // series has no predecessor and so contributes no step — starting exactly
    // on the hour would leave 09:00 with 55 covered minutes, not 60.
    const dailyMm = Array.from({ length: 14 }, (_, i) => 4.0 + i * 0.2);
    const hours = hourlyRainTotals(series('2026-08-08T00:55:00Z', 5, dailyMm), TZ);

    const nine = hours.find((h) => h.hourLocal === '2026-08-08T09');
    expect(nine).toBeDefined();
    expect(nine?.rainMm).toBeCloseTo(2.4, 3);
    expect(nine?.coveredMinutes).toBe(60);
    expect(nine?.sampleCount).toBe(12);
  });

  test('a dry hour reports 0, which is not the same as null', () => {
    const dailyMm = Array.from({ length: 13 }, () => 4.0);
    const hours = hourlyRainTotals(series('2026-08-08T01:00:00Z', 5, dailyMm), TZ);

    const nine = hours.find((h) => h.hourLocal === '2026-08-08T09');
    expect(nine?.rainMm).toBe(0);
    expect(nine?.rainMm).not.toBeNull();
  });

  test('an hour we did not watch reports null, never 0', () => {
    // Three readings across an hour: nowhere near enough coverage to claim the
    // rest of it was dry. "No rain recorded" and "no recording" are opposite
    // operational facts.
    const hours = hourlyRainTotals(
      series('2026-08-08T01:00:00Z', 5, [4.0, 4.0, 4.0]),
      TZ
    );

    const nine = hours.find((h) => h.hourLocal === '2026-08-08T09');
    expect(nine?.rainMm).toBeNull();
    expect(nine?.coveredMinutes).toBeLessThan(MIN_COVERED_MINUTES);
  });

  test('a long gap disqualifies the hour rather than reporting a partial total', () => {
    // 30 minutes of good data, then a 25-minute hole. The untrusted step is
    // dropped from BOTH the sum and the coverage, so the hour cannot report
    // the partial total it is still holding.
    const t0 = new Date('2026-08-08T01:00:00Z').getTime();
    const samples: RainSample[] = [
      { observedAt: new Date(t0), rainDailyMm: 4.0 },
      { observedAt: new Date(t0 + 5 * 60_000), rainDailyMm: 4.2 },
      { observedAt: new Date(t0 + 10 * 60_000), rainDailyMm: 4.4 },
      { observedAt: new Date(t0 + 15 * 60_000), rainDailyMm: 4.6 },
      { observedAt: new Date(t0 + 20 * 60_000), rainDailyMm: 4.8 },
      { observedAt: new Date(t0 + 25 * 60_000), rainDailyMm: 5.0 },
      { observedAt: new Date(t0 + 30 * 60_000), rainDailyMm: 5.2 },
      // 25-minute hole — beyond the trusted step length.
      { observedAt: new Date(t0 + 55 * 60_000), rainDailyMm: 9.0 },
    ];

    const nine = hourlyRainTotals(samples, TZ).find(
      (h) => h.hourLocal === '2026-08-08T09'
    );
    expect(nine?.rainMm).toBeNull();
    expect(nine?.coveredMinutes).toBeCloseTo(30, 1);
  });

  test('a step at exactly the trust limit still counts', () => {
    // A 20-minute cadence is the slowest that can still cover an hour. Starts
    // at 08:40 so the 09:00 reading has a predecessor to difference against.
    const t0 = new Date('2026-08-08T00:40:00Z').getTime();
    const samples: RainSample[] = [4.0, 4.2, 4.4, 4.6, 4.8].map((v, i) => ({
      observedAt: new Date(t0 + i * 20 * 60_000),
      rainDailyMm: v,
    }));

    expect(TRUSTED_GAP_MINUTES).toBe(20);
    const nine = hourlyRainTotals(samples, TZ).find(
      (h) => h.hourLocal === '2026-08-08T09'
    );
    expect(nine?.coveredMinutes).toBe(60);
    expect(nine?.rainMm).toBeCloseTo(0.6, 3);
  });

  test('rain across an hour boundary belongs to the later hour, not to nobody', () => {
    // The step from 09:55 to 10:00 local carries 1.0 mm. Differencing inside
    // buckets instead of across the series would lose it entirely.
    const t0 = new Date('2026-08-08T01:50:00Z').getTime(); // 09:50 local
    const samples: RainSample[] = [
      { observedAt: new Date(t0), rainDailyMm: 4.0 },
      { observedAt: new Date(t0 + 5 * 60_000), rainDailyMm: 4.0 }, // 09:55
      { observedAt: new Date(t0 + 10 * 60_000), rainDailyMm: 5.0 }, // 10:00
    ];

    const steps = rainSteps(samples);
    const total = steps.reduce((s, x) => s + (x.deltaMm ?? 0), 0);
    expect(total).toBeCloseTo(1.0, 9);

    const ten = hourlyRainTotals(samples, TZ).find(
      (h) => h.hourLocal === '2026-08-08T10'
    );
    expect(ten?.sampleCount).toBe(1);
  });

  test('a reset inside a covered hour does not produce a negative total', () => {
    // 23:30 local through 00:30 local, resetting at midnight (16:00 UTC).
    const t0 = new Date('2026-08-08T15:30:00Z').getTime();
    const samples: RainSample[] = [];
    for (let m = 0; m <= 60; m += 5) {
      const beforeMidnight = m < 30;
      samples.push({
        observedAt: new Date(t0 + m * 60_000),
        rainDailyMm: beforeMidnight ? 12.0 : (m - 30) * 0.02,
      });
    }

    for (const hour of hourlyRainTotals(samples, TZ)) {
      if (hour.rainMm !== null) expect(hour.rainMm).toBeGreaterThanOrEqual(0);
    }
  });

  test('float noise does not turn a dry hour into a trace of rain', () => {
    // 0.1 + 0.2 - 0.3 is not 0 in binary floating point. A bar chart that
    // renders 4e-17 mm as "trace rainfall" is worse than one that renders 0.
    const dailyMm = Array.from({ length: 14 }, (_, i) => 0.1 * i);
    const hours = hourlyRainTotals(series('2026-08-08T00:55:00Z', 5, dailyMm), TZ);

    const nine = hours.find((h) => h.hourLocal === '2026-08-08T09');
    expect(nine?.rainMm).toBeCloseTo(1.2, 3);
    expect(Number.isInteger((nine?.rainMm ?? 0) * 1000)).toBe(true);
  });

  test('hourStart is the real instant the local hour begins', () => {
    const hours = hourlyRainTotals(
      series('2026-08-08T01:20:00Z', 5, [4.0, 4.1, 4.2]),
      TZ
    );
    // 09:00 local on 8 Aug in UTC+8 is 01:00 UTC.
    expect(hours[0].hourStart.toISOString()).toBe('2026-08-08T01:00:00.000Z');
  });
});
