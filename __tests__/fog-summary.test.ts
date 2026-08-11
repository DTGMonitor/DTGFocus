import { summarisePeriod, type SummaryInput } from '@/lib/weather/summary';
import { WEATHER_CONSTANTS } from '@/config/weatherConditions';

// The station's zone is the clock every reported time is written on.
const TZ = 'Asia/Singapore';

const iso = (s: string) => new Date(s);

// One local day of 10 August on the station's clock. UTC+8, so the site day
// runs 16:00Z the previous evening to 16:00Z — using a UTC-midnight window
// would silently drop the pre-dawn hours, which is when fog actually happens.
function input(over: Partial<SummaryInput> = {}): SummaryInput {
  return {
    windowStart: iso('2026-08-09T16:00:00Z'),
    windowEnd: iso('2026-08-10T16:00:00Z'),
    timeZone: TZ,
    locale: 'id',
    readings: [],
    assessments: [],
    hourly: [],
    daily: [],
    ...over,
  };
}

/** Hourly buckets on the hour, starting from a UTC instant. */
function hours(startUtc: string, values: (number | null)[]) {
  const t0 = new Date(startUtc).getTime();
  return values.map((rainMm, i) => ({
    start: new Date(t0 + i * 3_600_000),
    rainMm,
  }));
}

function days(startUtc: string, values: (number | null)[]) {
  const t0 = new Date(startUtc).getTime();
  return values.map((rainMm, i) => ({
    start: new Date(t0 + i * 86_400_000),
    rainMm,
  }));
}

// ---------------------------------------------------------------------------
// Rainfall — the two formats the reports asked for
// ---------------------------------------------------------------------------

describe('rainfall wording', () => {
  test('a one-day window reports per hour, naming the peak hour', () => {
    // Wet hours: 4 mm, 6 mm, 10 mm at 17:00 local (09:00 UTC in UTC+8).
    const hourly = hours('2026-08-10T00:00:00Z', [
      0, 0, 0, 0, 0, 0, 0, 4, 0, 10, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const s = summarisePeriod(input({ hourly }));

    expect(s.rainfall.basis).toBe('hourly');
    expect(s.rainfall.averageMm).toBeCloseTo(6.7, 1); // (4+10+6)/3, wet hours only
    expect(s.rainfall.maxMm).toBe(10);
    expect(s.rainfall.text).toBe(
      'rata-rata 6.7 mm/jam, maksimum 10 mm pada pukul 17:00'
    );
  });

  test('a seven-day window reports per day, naming the peak date', () => {
    const daily = days('2026-08-04T00:00:00Z', [2, 0, 8, 0, 10, 4, 0]);
    const s = summarisePeriod(
      input({
        windowStart: iso('2026-08-04T00:00:00Z'),
        windowEnd: iso('2026-08-11T00:00:00Z'),
        daily,
      })
    );

    expect(s.rainfall.basis).toBe('daily');
    expect(s.rainfall.averageMm).toBe(6); // (2+8+10+4)/4
    expect(s.rainfall.text).toBe(
      'rata-rata 6 mm/hari, maksimum 10 mm pada tanggal 8 Agustus 2026'
    );
  });

  test('the average is over wet periods, not over every hour in the window', () => {
    // 10 mm in one hour, dry for the other 23. Averaging across the whole day
    // would report 0.4 mm/jam for a day that dropped 10 mm in one hour — which
    // tells a slope engineer nothing.
    const hourly = hours('2026-08-10T00:00:00Z', [
      10, ...Array<number>(23).fill(0),
    ]);
    const s = summarisePeriod(input({ hourly }));

    expect(s.rainfall.averageMm).toBe(10);
    expect(s.rainfall.wetPeriods).toBe(1);
    expect(s.rainfall.totalMm).toBe(10);
  });

  test('unmeasured hours are excluded, not counted as dry', () => {
    const hourly = hours('2026-08-10T00:00:00Z', [6, null, null, 2]);
    const s = summarisePeriod(input({ hourly }));

    expect(s.rainfall.measuredPeriods).toBe(2);
    expect(s.rainfall.averageMm).toBe(4); // (6+2)/2
  });

  test('a measured dry window says so; an unmeasured one says the data is missing', () => {
    const dry = summarisePeriod(
      input({ hourly: hours('2026-08-10T00:00:00Z', [0, 0, 0, 0]) })
    );
    expect(dry.rainfall.text).toBe('Tidak ada hujan tercatat');

    const blank = summarisePeriod(input({ hourly: [] }));
    expect(blank.rainfall.text).toBe('Data stasiun tidak tersedia');
  });

  test('English renders the same numbers with English units', () => {
    const hourly = hours('2026-08-10T00:00:00Z', [
      0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const s = summarisePeriod(input({ hourly, locale: 'en' }));
    expect(s.rainfall.text).toBe('average 10 mm/h, maximum 10 mm at 17:00');
  });
});

// ---------------------------------------------------------------------------
// Sky condition
// ---------------------------------------------------------------------------

function daytimeReadings(kt: number, count = 12) {
  // Midday UTC, so solar elevation is comfortably above the threshold.
  return Array.from({ length: count }, (_, i) => ({
    observedAt: new Date(Date.UTC(2026, 7, 10, 2, i * 5)),
    clearnessIndex: kt,
    solarElevationDeg: 45,
  }));
}

describe('sky condition', () => {
  test.each([
    [0.75, 'Cerah'],
    [0.58, 'Cerah Berawan'],
    [0.42, 'Berawan'],
    [0.15, 'Berawan Tebal'],
  ])('mean kt %s reads as %s', (kt, expected) => {
    const s = summarisePeriod(input({ readings: daytimeReadings(kt) }));
    expect(s.weather.text).toBe(expected);
  });

  test('rain outranks sky cover', () => {
    // Bright between the showers, but 30 mm fell. BMKG calls that Hujan Sedang,
    // and a report saying "Cerah" on a 30 mm day would be indefensible.
    const s = summarisePeriod(
      input({
        readings: daytimeReadings(0.8),
        hourly: hours('2026-08-10T00:00:00Z', [30]),
      })
    );
    expect(s.weather.text).toBe('Hujan Sedang');
  });

  test.each([
    [0.4, 'Hujan Ringan'],
    [25, 'Hujan Sedang'],
    [60, 'Hujan Lebat'],
    [120, 'Hujan Sangat Lebat'],
  ])('%s mm in a day reads as %s', (mm, expected) => {
    const s = summarisePeriod(
      input({
        readings: daytimeReadings(0.8),
        hourly: hours('2026-08-10T00:00:00Z', [mm]),
      })
    );
    // 0.4 mm is below the BMKG light-rain floor, so the sky tier wins there.
    expect(s.weather.text).toBe(mm < 0.5 ? 'Cerah' : expected);
  });

  test('too few daytime samples refuses to name a condition', () => {
    // An overnight-only window has no sky condition to report at all.
    const s = summarisePeriod({
      ...input({ readings: daytimeReadings(0.8, 2) }),
    });
    expect(s.weather.code).toBe('TIDAK_DIKETAHUI');
    expect(s.weather.daytimeSamples).toBeLessThan(
      WEATHER_CONSTANTS.minDaytimeSamples
    );
  });

  test('low-sun readings are ignored, so dawn cannot darken the day', () => {
    const s = summarisePeriod(
      input({
        readings: Array.from({ length: 20 }, (_, i) => ({
          observedAt: new Date(Date.UTC(2026, 7, 10, 0, i * 5)),
          clearnessIndex: 0.05,
          solarElevationDeg: 4, // below ktElevationMinDeg
        })),
      })
    );
    expect(s.weather.code).toBe('TIDAK_DIKETAHUI');
    expect(s.weather.daytimeSamples).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Fog
// ---------------------------------------------------------------------------

const assess = (utc: string, verdict: string, reason: string | null = null) => ({
  assessedAt: iso(utc),
  verdict,
  reason,
});

describe('fog conclusion', () => {
  test('a quiet day says so plainly', () => {
    const s = summarisePeriod(
      input({
        assessments: [
          assess('2026-08-10T01:00:00Z', 'NO_FOG'),
          assess('2026-08-10T02:00:00Z', 'NO_FOG'),
        ],
      })
    );
    expect(s.fog.text).toBe('Tidak ada kabut');
  });

  test('a one-day window names the hours the peak verdict held', () => {
    const s = summarisePeriod(
      input({
        assessments: [
          assess('2026-08-09T21:10:00Z', 'FOG_LIKELY'), // 05:10 local
          assess('2026-08-09T23:20:00Z', 'FOG_LIKELY'), // 07:20 local
          assess('2026-08-10T04:00:00Z', 'NO_FOG'),
        ],
      })
    );
    expect(s.fog.peakVerdict).toBe('FOG_LIKELY');
    expect(s.fog.text).toBe('Kabut sangat mungkin, pada pukul 05:10–07:20');
  });

  test('the most severe verdict wins, not the most frequent', () => {
    const s = summarisePeriod(
      input({
        assessments: [
          assess('2026-08-10T01:00:00Z', 'NO_FOG'),
          assess('2026-08-10T02:00:00Z', 'AMBIGUOUS'),
          assess('2026-08-10T03:00:00Z', 'FOG'),
          assess('2026-08-10T04:00:00Z', 'NO_FOG'),
          assess('2026-08-10T05:00:00Z', 'NO_FOG'),
        ],
      })
    );
    expect(s.fog.peakVerdict).toBe('FOG');
    expect(s.fog.text).toMatch(/^Kabut terkonfirmasi/);
  });

  test('a calm-wind ambiguous night is reported as dew', () => {
    // Keys off the scorer's own wording, which fog-scoring.test.ts pins.
    const s = summarisePeriod(
      input({
        assessments: [
          assess(
            '2026-08-09T21:00:00Z',
            'AMBIGUOUS',
            'Saturated, but the distinguishing signals are weak — wind is very calm, likely dew rather than fog'
          ),
        ],
      })
    );
    expect(s.fog.text).toMatch(/kemungkinan embun/i);
  });

  test('a seven-day window counts days instead of naming hours', () => {
    const s = summarisePeriod(
      input({
        windowStart: iso('2026-08-04T00:00:00Z'),
        windowEnd: iso('2026-08-11T00:00:00Z'),
        assessments: [
          assess('2026-08-05T21:00:00Z', 'FOG_LIKELY'),
          assess('2026-08-05T22:00:00Z', 'FOG_LIKELY'),
          assess('2026-08-08T21:00:00Z', 'FOG_LIKELY'),
          assess('2026-08-09T02:00:00Z', 'NO_FOG'),
        ],
      })
    );
    expect(s.fog.daysAffected).toBe(2);
    expect(s.fog.text).toMatch(/2 dari 7 hari/);
  });

  test('an unscoreable window says so rather than implying calm', () => {
    const s = summarisePeriod(
      input({
        assessments: [assess('2026-08-10T01:00:00Z', 'INSUFFICIENT_HISTORY')],
      })
    );
    expect(s.fog.peakVerdict).toBeNull();
    expect(s.fog.text).toBe('Riwayat belum cukup untuk menilai');
  });

  test('no assessments at all is a data gap, not a clear night', () => {
    const s = summarisePeriod(input({ assessments: [] }));
    expect(s.fog.text).toBe('Data stasiun tidak tersedia');
  });
});

// ---------------------------------------------------------------------------
// Window handling
// ---------------------------------------------------------------------------

describe('window', () => {
  test('data outside the window is ignored', () => {
    const s = summarisePeriod(
      input({
        hourly: [
          { start: iso('2026-08-09T12:00:00Z'), rainMm: 99 }, // before
          { start: iso('2026-08-10T09:00:00Z'), rainMm: 5 }, // inside
          { start: iso('2026-08-12T12:00:00Z'), rainMm: 99 }, // after
        ],
      })
    );
    expect(s.rainfall.maxMm).toBe(5);
    expect(s.rainfall.measuredPeriods).toBe(1);
  });

  test('the basis flips at the configured range, not at exactly 24 h', () => {
    // 48 hours so a report whose window runs slightly over a day does not
    // change units unexpectedly.
    const thirty = summarisePeriod(
      input({
        windowEnd: iso('2026-08-11T06:00:00Z'),
        hourly: hours('2026-08-10T09:00:00Z', [5]),
      })
    );
    expect(thirty.rainfall.basis).toBe('hourly');

    const seventy = summarisePeriod(
      input({
        windowEnd: iso('2026-08-13T00:00:00Z'),
        daily: days('2026-08-10T00:00:00Z', [5]),
      })
    );
    expect(seventy.rainfall.basis).toBe('daily');
  });

  test('is pure — same input, same output', () => {
    const a = summarisePeriod(input({ hourly: hours('2026-08-10T00:00:00Z', [3, 7]) }));
    const b = summarisePeriod(input({ hourly: hours('2026-08-10T00:00:00Z', [3, 7]) }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
