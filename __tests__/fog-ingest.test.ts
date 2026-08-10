import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { extractRecords, parseRecords, slimRecord } from '@/lib/weather/parse';
import { deriveReadings } from '@/lib/weather/derive';
import { solarPosition, haurwitzClearSkyGhi } from '@/lib/weather/solar';

// The real ASBSAR1 payload, with the hl block that traps a naive walker.
const PAYLOAD = {
  dateutc: 1786261080000,
  tempf: 72.7,
  dewPoint: 65.79929436864073,
  humidity: 79,
  windspeedmph: 4.47,
  windspdmph_avg10m: 3.1,
  windgustmph: 6.26,
  winddir: 59,
  winddir_avg10m: 69,
  solarradiation: 139.38,
  uv: 1,
  baromrelin: 26.639,
  hourlyrainin: 0,
  dailyrainin: 0,
  monthlyrainin: 0.031,
  tz: 'Asia/Singapore',
  stationtype: 'AMBWeatherPro_V5.1.1',
  hl: {
    dateutc: 1786261080000,
    tempf: { h: 88.5, l: 70.1, c: 72.7, s: 1, ht: 1786230000000, lt: 1786200000000 },
    humidity: { h: 95, l: 55, c: 79 },
  },
};

test('the hl block does not become a second record', () => {
  const found = extractRecords(PAYLOAD);
  expect(found).toHaveLength(1);
  expect(found[0].tempf).toBe(72.7);
});

test('nested values are stripped before persisting', () => {
  expect(slimRecord(PAYLOAD)).not.toHaveProperty('hl');
  expect(slimRecord(PAYLOAD).tempf).toBe(72.7);
});

test('derive produces SI with the 10-minute wind preferred', () => {
  const { parsed } = parseRecords(extractRecords(PAYLOAD));
  const { rows } = deriveReadings(
    parsed,
    { macAddress: 'C8:C9:A3:0F:C7:FD', latitude: -2.5034, longitude: 121.5176 },
    new Date('2026-08-09T00:00:00Z')
  );
  const r = rows[0];
  expect(r.temp_c).toBeCloseTo(22.611, 3);
  expect(r.dew_point_c).toBeCloseTo(18.777, 3);
  expect(r.dpd_c).toBeCloseTo(3.834, 3);
  expect(r.wind_kmh).toBeCloseTo(3.1 * 1.609344, 6); // avg10m, not 4.47
  expect(r.wind_dir).toBe(69);
  expect(r.pressure_hpa).toBeCloseTo(902.0, 0);
  expect(r.raw).not.toHaveProperty('hl');
});

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|jsx?)$/.test(entry)) out.push(full);
  }
  return out;
}

test('no client component imports the Ambient endpoint client', () => {
  // The endpoint sends no CORS headers, so a browser call fails with an opaque
  // network error that looks nothing like the real cause. ambient.ts carries a
  // runtime guard, but a runtime guard only fires once someone has already
  // shipped the mistake. This catches it at test time instead.
  //
  // Server-side callers (route handlers, lib/weather/poll.ts) are unaffected —
  // only files carrying the "use client" directive are checked.
  const offenders: string[] = [];

  for (const file of walk(join(process.cwd(), 'components'))) {
    const source = readFileSync(file, 'utf8');
    const isClient = /^\s*['"]use client['"]/m.test(source);
    if (isClient && /from\s+['"][^'"]*weather\/ambient['"]/.test(source)) {
      offenders.push(file);
    }
  }

  expect(offenders).toEqual([]);
});

describe('dew point', () => {
  // ASBSAR1 does not report dewPoint. Its lastData keys are, in full:
  //   stationtype, dateutc, tempf, humidity, windspeedmph, windgustmph,
  //   maxdailygust, winddir, winddir_avg10m, uv, solarradiation, hourlyrainin,
  //   eventrainin, dailyrainin, weeklyrainin, monthlyrainin, yearlyrainin,
  //   battrain, baromrelin, baromabsin, type, created_at, feelsLike, dateutc5,
  //   tz, hl
  // Without a fallback there is no DPD, and with no DPD nothing scores at all.
  const station = {
    macAddress: 'C8:C9:A3:0F:C7:FD',
    latitude: -2.5034,
    longitude: 121.5176,
  };
  const evaluatedAt = new Date('2026-08-10T08:00:00Z');

  test('is computed from temperature and humidity when the station omits it', () => {
    const { parsed } = parseRecords(
      extractRecords({ dateutc: 1786333200000, tempf: 76.6, humidity: 71 })
    );
    const { rows } = deriveReadings(parsed, station, evaluatedAt);

    expect(rows[0].dew_point_c).not.toBeNull();
    // 76.6 degF = 24.778 degC. At 71% RH, Magnus-Tetens gives 19.16 degC:
    //   gamma = ln(0.71) + (17.625 x 24.778)/(243.04 + 24.778) = 1.2881
    //   Td    = (243.04 x 1.2881)/(17.625 - 1.2881)            = 19.163
    expect(rows[0].dew_point_c as number).toBeCloseTo(19.163, 2);
    expect(rows[0].dpd_c as number).toBeCloseTo(5.615, 2);
  });

  test('the station’s own value wins when it is present', () => {
    const { parsed } = parseRecords(
      extractRecords({
        dateutc: 1786333200000,
        tempf: 76.6,
        humidity: 71,
        dewPoint: 65.8, // deliberately inconsistent with the humidity above
      })
    );
    const { rows } = deriveReadings(parsed, station, evaluatedAt);
    expect(rows[0].dew_point_c as number).toBeCloseTo(18.78, 2);
  });

  test('is null, not zero, when humidity is missing too', () => {
    const { parsed } = parseRecords(
      extractRecords({ dateutc: 1786333200000, tempf: 76.6 })
    );
    const { rows } = deriveReadings(parsed, station, evaluatedAt);

    expect(rows[0].dew_point_c).toBeNull();
    // An unknown depression must never read as perfectly saturated air.
    expect(rows[0].dpd_c).toBeNull();
  });

  test('never exceeds the temperature, so DPD cannot go negative', () => {
    // Humidity sensors drift above 100% in fog — exactly when it matters.
    const { parsed } = parseRecords(
      extractRecords({ dateutc: 1786333200000, tempf: 60, humidity: 104 })
    );
    const { rows } = deriveReadings(parsed, station, evaluatedAt);
    expect(rows[0].dpd_c as number).toBeGreaterThanOrEqual(0);
  });
});

test('solar noon at the equator in March is near overhead', () => {
  // Equinox, local solar noon at lon 0 => elevation ~ 90 - |lat|.
  const { elevationDeg } = solarPosition(new Date('2026-03-20T12:00:00Z'), 0, 0);
  expect(elevationDeg).toBeGreaterThan(87);
  expect(haurwitzClearSkyGhi(1)).toBeCloseTo(1098 * Math.exp(-0.059), 3);
});
