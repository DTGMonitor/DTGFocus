import {
  clearnessIndex,
  haurwitzClearSkyGhi,
  solarPosition,
} from '@/lib/weather/solar';

// Reference values are the textbook geometry results, asserted with a
// tolerance that matches the NOAA approximation's own accuracy (a fraction of
// a degree). Tightening these beyond ~1 degree would be asserting that an
// approximation is exact.

describe('solar elevation', () => {
  test('equinox noon on the equator puts the sun overhead', () => {
    // March equinox, longitude 0, 12:00 UTC. Declination ~0, so elevation
    // should be within a degree or two of vertical.
    const { elevationDeg, cosZenith } = solarPosition(
      new Date('2026-03-20T12:00:00Z'),
      0,
      0
    );
    expect(elevationDeg).toBeGreaterThan(87);
    expect(cosZenith).toBeCloseTo(Math.sin((elevationDeg * Math.PI) / 180), 9);
  });

  test('June solstice noon at Greenwich matches 90 - lat + declination', () => {
    // 51.4778 N. Expected: 90 - 51.4778 + 23.44 = 61.96 degrees.
    const { elevationDeg } = solarPosition(
      new Date('2026-06-21T12:00:00Z'),
      51.4778,
      0
    );
    expect(elevationDeg).toBeGreaterThan(60.5);
    expect(elevationDeg).toBeLessThan(63.5);
  });

  test('December solstice noon at Greenwich matches 90 - lat - declination', () => {
    // Expected: 90 - 51.4778 - 23.44 = 15.08 degrees.
    const { elevationDeg } = solarPosition(
      new Date('2026-12-21T12:00:00Z'),
      51.4778,
      0
    );
    expect(elevationDeg).toBeGreaterThan(13.5);
    expect(elevationDeg).toBeLessThan(16.5);
  });

  test('the sun is below the horizon at local midnight', () => {
    // ASBSAR1: 2.5034 S, 121.5176 E, so local midnight (WITA) is 16:00 UTC.
    const { elevationDeg } = solarPosition(
      new Date('2026-08-08T16:00:00Z'),
      -2.5034,
      121.5176
    );
    expect(elevationDeg).toBeLessThan(-60);
  });

  test('the sun is still down at 05:00 WITA, which is why index B sleeps', () => {
    const { elevationDeg } = solarPosition(
      new Date('2026-08-08T21:00:00Z'),
      -2.5034,
      121.5176
    );
    expect(elevationDeg).toBeLessThan(0);
  });

  test('the station sees a high sun at local noon', () => {
    // 12:00 WITA = 04:00 UTC. Near the equator in August the sun is high but
    // north of vertical (declination ~ +16, latitude -2.5).
    const { elevationDeg } = solarPosition(
      new Date('2026-08-08T04:00:00Z'),
      -2.5034,
      121.5176
    );
    expect(elevationDeg).toBeGreaterThan(65);
    expect(elevationDeg).toBeLessThan(75);
  });

  test('elevation peaks at solar noon and is symmetric around it', () => {
    const sample = (utcHour: number) =>
      solarPosition(
        new Date(`2026-08-08T${String(utcHour).padStart(2, '0')}:00:00Z`),
        -2.5034,
        121.5176
      ).elevationDeg;

    const noon = sample(4);
    expect(noon).toBeGreaterThan(sample(2));
    expect(noon).toBeGreaterThan(sample(6));
    expect(sample(2)).toBeCloseTo(sample(6), 0);
  });

  test('longitude shifts solar noon by four minutes per degree', () => {
    // 15 degrees of longitude is one hour of solar time.
    const a = solarPosition(new Date('2026-08-08T12:00:00Z'), 0, 0).elevationDeg;
    const b = solarPosition(new Date('2026-08-08T11:00:00Z'), 0, 15).elevationDeg;
    expect(b).toBeCloseTo(a, 1);
  });
});

describe('Haurwitz clear-sky GHI', () => {
  test('collapses to zero below the model floor', () => {
    // Below cosZ = 0.02 the exp(-0.059/cosZ) term stops meaning anything, so
    // the model returns 0 rather than a number that looks usable.
    expect(haurwitzClearSkyGhi(0.02)).toBe(0);
    expect(haurwitzClearSkyGhi(0.001)).toBe(0);
    expect(haurwitzClearSkyGhi(-0.5)).toBe(0);
  });

  test('overhead sun gives the model maximum', () => {
    expect(haurwitzClearSkyGhi(1)).toBeCloseTo(1098 * Math.exp(-0.059), 6);
    expect(haurwitzClearSkyGhi(1)).toBeGreaterThan(1000);
  });

  test('rises monotonically with sun height', () => {
    const steps = [0.1, 0.3, 0.5, 0.7, 0.9, 1.0].map(haurwitzClearSkyGhi);
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i]).toBeGreaterThan(steps[i - 1]);
    }
  });
});

describe('clearness index', () => {
  test('is null when the clear-sky denominator is too small to divide by', () => {
    // Near sunrise and sunset the ratio explodes into noise. The 20 W/m2 floor
    // is what stops twilight reading as dense fog.
    expect(clearnessIndex(5, 15)).toBeNull();
    expect(clearnessIndex(5, 20)).toBeNull();
    expect(clearnessIndex(5, 0)).toBeNull();
  });

  test('is null when the station reports no radiation at all', () => {
    expect(clearnessIndex(null, 800)).toBeNull();
    expect(clearnessIndex(undefined, 800)).toBeNull();
  });

  test('is NOT clamped above 1.0', () => {
    // Cloud-edge enhancement genuinely delivers more than the clear-sky model
    // predicts: direct beam plus bright reflection off an adjacent cloud face.
    // Clamping would hide a real, physical measurement.
    expect(clearnessIndex(1150, 1000)).toBeCloseTo(1.15, 9);
  });

  test('fog crushes kt into the confirmation range', () => {
    expect(clearnessIndex(120, 800)).toBeCloseTo(0.15, 9);
  });
});
