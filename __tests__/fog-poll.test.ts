import type { SupabaseClient } from '@supabase/supabase-js';

// The poll's two load-bearing behaviours are structural, not meteorological:
// it must never exceed the concurrency cap against an endpoint we do not own,
// and one dead station must never cost the others their sample. Both are
// invisible in normal operation and only show up when something is already
// going wrong, so they get pinned here.

jest.mock('@/lib/weather/ambient', () => {
  class AmbientError extends Error {
    kind: string;
    constructor(kind: string, message: string) {
      super(message);
      this.kind = kind;
    }
  }
  return { AmbientError, fetchStationRecords: jest.fn() };
});

jest.mock('@/lib/weather/repository', () => ({
  listActiveStations: jest.fn(),
  upsertReadings: jest.fn(),
  fetchReadings: jest.fn(),
  fetchLatestAssessment: jest.fn(),
  upsertAssessment: jest.fn(),
  startPollRun: jest.fn(),
  finishPollRun: jest.fn(),
  toFogReading: jest.requireActual('@/lib/weather/repository').toFogReading,
}));

import { fetchStationRecords } from '@/lib/weather/ambient';
import {
  fetchLatestAssessment,
  fetchReadings,
  finishPollRun,
  listActiveStations,
  startPollRun,
  upsertAssessment,
  upsertReadings,
} from '@/lib/weather/repository';
import { runPoll } from '@/lib/weather/poll';

const mocked = {
  fetchStationRecords: fetchStationRecords as jest.Mock,
  listActiveStations: listActiveStations as jest.Mock,
  upsertReadings: upsertReadings as jest.Mock,
  fetchReadings: fetchReadings as jest.Mock,
  fetchLatestAssessment: fetchLatestAssessment as jest.Mock,
  upsertAssessment: upsertAssessment as jest.Mock,
  startPollRun: startPollRun as jest.Mock,
  finishPollRun: finishPollRun as jest.Mock,
};

const NOW = new Date('2026-08-08T21:00:00Z');
const db = {} as SupabaseClient;

function station(n: number) {
  return {
    id: n,
    site_id: n,
    mac_address: `AA:BB:CC:00:00:0${n}`,
    name: `station ${n}`,
    latitude: -2.5034,
    longitude: 121.5176,
    elevation_m: 950,
    distance_km: 3,
    timezone: 'Asia/Singapore',
    station_type: 'AMBWeatherPro_V5.1.1',
    is_active: true,
  };
}

/** One validated record, shaped as parse.ts would hand it over. */
function record(msAgo: number) {
  const dateutc = NOW.getTime() - msAgo;
  const raw = { dateutc, tempf: 66.4, dewPoint: 66.2, humidity: 99 };
  return { record: { dateutc, tempf: 66.4, dewPoint: 66.2, humidity: 99 }, original: raw };
}

beforeEach(() => {
  jest.clearAllMocks();
  mocked.startPollRun.mockResolvedValue(77);
  mocked.finishPollRun.mockResolvedValue(undefined);
  mocked.upsertReadings.mockImplementation(async (_db, r: unknown[]) => r.length);
  mocked.upsertAssessment.mockResolvedValue(undefined);
  mocked.fetchLatestAssessment.mockResolvedValue(null);
  mocked.fetchReadings.mockResolvedValue([]);
  mocked.fetchStationRecords.mockResolvedValue({ parsed: [record(0)], rejected: 0 });
});

describe('concurrency', () => {
  test('never has more than three stations in flight', async () => {
    // The cap is politeness towards an undocumented endpoint we neither pay
    // for nor have permission to hammer, not a performance tuning knob.
    let inFlight = 0;
    let peak = 0;

    mocked.fetchStationRecords.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { parsed: [record(0)], rejected: 0 };
    });

    mocked.listActiveStations.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => station(i))
    );

    const report = await runPoll(db, { now: NOW, triggerSource: 'test' });

    expect(peak).toBeLessThanOrEqual(3);
    expect(report.attempted).toBe(10);
    expect(mocked.fetchStationRecords).toHaveBeenCalledTimes(10);
  });

  test('a slow station does not stall the lanes beside it', async () => {
    // Workers pull from a shared cursor rather than taking fixed slices, so
    // one station timing out cannot idle the other two lanes.
    mocked.listActiveStations.mockResolvedValue(
      Array.from({ length: 6 }, (_, i) => station(i))
    );
    mocked.fetchStationRecords.mockImplementation(async (mac: string) => {
      await new Promise((r) => setTimeout(r, mac.endsWith('00') ? 40 : 1));
      return { parsed: [record(0)], rejected: 0 };
    });

    const report = await runPoll(db, { now: NOW, triggerSource: 'test' });
    expect(report.succeeded).toBe(6);
  });
});

describe('failure isolation', () => {
  test('one station failing does not abort the others', async () => {
    mocked.listActiveStations.mockResolvedValue([
      station(1),
      station(2),
      station(3),
    ]);
    mocked.fetchStationRecords.mockImplementation(async (mac: string) => {
      if (mac.endsWith('02')) throw new Error('HTTP 204, empty body');
      return { parsed: [record(0)], rejected: 0 };
    });

    const report = await runPoll(db, { now: NOW, triggerSource: 'test' });

    expect(report.attempted).toBe(3);
    expect(report.succeeded).toBe(2);
    expect(report.failed).toBe(1);
    expect(report.errorSamples).toHaveLength(1);
    expect(report.errorSamples[0].error).toMatch(/204/);
  });

  test('a database failure for one station is contained too', async () => {
    mocked.listActiveStations.mockResolvedValue([station(1), station(2)]);
    mocked.upsertReadings.mockImplementation(async (_db, r: unknown[]) => {
      if (r.length && (r[0] as { mac_address: string }).mac_address.endsWith('01')) {
        throw new Error('deadlock detected');
      }
      return r.length;
    });

    const report = await runPoll(db, { now: NOW, triggerSource: 'test' });
    expect(report.succeeded).toBe(1);
    expect(report.failed).toBe(1);
  });

  test('error samples are capped so one broken station cannot bloat the table', async () => {
    mocked.listActiveStations.mockResolvedValue(
      Array.from({ length: 9 }, (_, i) => station(i))
    );
    mocked.fetchStationRecords.mockRejectedValue(new Error('endpoint down'));

    const report = await runPoll(db, { now: NOW, triggerSource: 'test' });

    expect(report.failed).toBe(9);
    expect(report.errorSamples.length).toBeLessThanOrEqual(5);
  });

  test('failing to list stations still closes the audit row', async () => {
    mocked.listActiveStations.mockRejectedValue(new Error('connection refused'));

    const report = await runPoll(db, { now: NOW, triggerSource: 'test' });

    expect(report.attempted).toBe(0);
    expect(mocked.finishPollRun).toHaveBeenCalledTimes(1);
    expect(report.errorSamples[0].error).toMatch(/connection refused/);
  });
});

describe('audit', () => {
  test('the run row is opened before any station is touched', async () => {
    // A run that times out mid-flight must still leave evidence it began.
    // Otherwise a silently dead poller is indistinguishable from one that was
    // never scheduled.
    const order: string[] = [];
    mocked.startPollRun.mockImplementation(async () => {
      order.push('start');
      return 77;
    });
    mocked.fetchStationRecords.mockImplementation(async () => {
      order.push('fetch');
      return { parsed: [record(0)], rejected: 0 };
    });
    mocked.listActiveStations.mockResolvedValue([station(1)]);

    await runPoll(db, { now: NOW, triggerSource: 'cron' });

    expect(order[0]).toBe('start');
    expect(mocked.startPollRun).toHaveBeenCalledWith(db, 'cron');
  });

  test('an unwritable audit row does not stop the poll it audits', async () => {
    mocked.startPollRun.mockResolvedValue(null);
    mocked.listActiveStations.mockResolvedValue([station(1)]);

    const report = await runPoll(db, { now: NOW, triggerSource: 'test' });

    expect(report.runId).toBeNull();
    expect(report.succeeded).toBe(1);
  });
});

describe('scoring integration', () => {
  test('previous state is read strictly before the instant being scored', async () => {
    // Without the bound, a rerun in the same minute reads back the row it just
    // wrote and feeds its own output in as the previous state, which defeats
    // the hysteresis on every retry.
    const observedAt = '2026-08-08T20:55:00.000Z';
    mocked.listActiveStations.mockResolvedValue([station(1)]);
    mocked.fetchReadings.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({
        observed_at: new Date(
          new Date(observedAt).getTime() - (11 - i) * 5 * 60_000
        ).toISOString(),
        temp_c: 19.1,
        dew_point_c: 19.0,
        dpd_c: 0.1,
        humidity: 99,
        wind_kmh: 3.4,
        wind_gust_kmh: 5,
        wind_dir: 90,
        solar_wm2: 0,
        uv: 0,
        pressure_hpa: 1010,
        rain_rate_mmh: 0,
        rain_daily_mm: 0,
        solar_elevation_deg: -12,
        ghi_clear_wm2: 0,
        clearness_index: null,
      }))
    );

    await runPoll(db, { now: NOW, triggerSource: 'test' });

    expect(mocked.fetchLatestAssessment).toHaveBeenCalledWith(
      db,
      'AA:BB:CC:00:00:01',
      observedAt
    );
    // Assessment is anchored to the newest READING, not to the poll's clock,
    // so a rerun lands on the same assessed_at and upserts instead of
    // duplicating.
    expect(mocked.upsertAssessment).toHaveBeenCalledWith(
      db,
      'AA:BB:CC:00:00:01',
      new Date(observedAt),
      expect.objectContaining({ status: 'scored' })
    );
  });

  test('no readings means no assessment is invented', async () => {
    mocked.listActiveStations.mockResolvedValue([station(1)]);
    mocked.fetchReadings.mockResolvedValue([]);

    const report = await runPoll(db, { now: NOW, triggerSource: 'test' });

    expect(mocked.upsertAssessment).not.toHaveBeenCalled();
    expect(report.succeeded).toBe(1);
  });
});
