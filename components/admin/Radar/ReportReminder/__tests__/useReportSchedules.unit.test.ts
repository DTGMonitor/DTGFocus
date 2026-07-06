import { renderHook, act, waitFor } from '@testing-library/react';

// Mutable per-test config for the Supabase mock. Prefixed with `mock` so the
// jest.mock factory (hoisted above imports) may reference it.
let mockConfig: {
  read: Record<string, { data?: any; error: any }>;
  upsert: Record<string, { error?: any; __pending?: boolean } | undefined>;
  upsertCalls: Array<{ table: string; args: any[] }>;
};

jest.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const builder: any = {
        select: () => builder,
        neq: () => builder,
        gte: () => builder,
        ilike: () => builder,
        upsert: (...args: any[]) => {
          mockConfig.upsertCalls.push({ table, args });
          const r = mockConfig.upsert[table];
          if (r && r.__pending) return new Promise(() => {});
          return Promise.resolve(r ?? { error: null });
        },
        then: (resolve: any, reject: any) =>
          Promise.resolve(mockConfig.read[table] ?? { data: [], error: null }).then(
            resolve,
            reject
          ),
      };
      return builder;
    },
  },
}));

import { useReportSchedules } from '../useReportSchedules';
import { RADAR_TYPE, defaultScheduleFor } from '../reportTypes';

const ONE_CLIENT = [{ id: 'S1', site_name: 'Alpha' }];
const ONE_SENSOR = [{ radar_number: 'R1', site_id: 'S1' }];

beforeEach(() => {
  window.localStorage.clear();
  jest.restoreAllMocks();
  mockConfig = {
    read: {
      clients: { data: [], error: null },
      latest_radar_wall_folders: { data: [], error: null },
      reports: { data: [], error: null },
      site_report_schedules: { data: [], error: null },
    },
    upsert: {},
    upsertCalls: [],
  };
});

async function renderLoaded() {
  const hook = renderHook(() => useReportSchedules());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe('useReportSchedules — migration', () => {
  it('success path: upserts legacy entries as radar then removes the localStorage key', async () => {
    window.localStorage.setItem(
      'reportSchedules',
      JSON.stringify({ S9: { deadline: '07:00', reminder: '06:30', enabled: true } })
    );
    mockConfig.upsert.site_report_schedules = { error: null };

    await renderLoaded();

    await waitFor(() =>
      expect(window.localStorage.getItem('reportSchedules')).toBeNull()
    );
    const call = mockConfig.upsertCalls.find((c) => c.table === 'site_report_schedules');
    expect(call).toBeTruthy();
    expect(call!.args[0][0]).toMatchObject({ report_type: 'radar', cadence: 'daily' });
  });

  it('failure path: retains the key and logs the descriptive error', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    window.localStorage.setItem(
      'reportSchedules',
      JSON.stringify({ S9: { deadline: '07:00', reminder: '06:30', enabled: true } })
    );
    mockConfig.upsert.site_report_schedules = { error: { message: 'network error' } };

    await renderLoaded();

    await waitFor(() =>
      expect(
        err.mock.calls.some(
          (args) =>
            typeof args[0] === 'string' &&
            args[0].includes('[ReportScheduler] Migration failed')
        )
      ).toBe(true)
    );
    expect(window.localStorage.getItem('reportSchedules')).not.toBeNull();
  });
});

describe('useReportSchedules — saveSchedule', () => {
  it('shows a saving state while the upsert is in flight', async () => {
    mockConfig.read.clients = { data: ONE_CLIENT, error: null };
    mockConfig.read.latest_radar_wall_folders = { data: ONE_SENSOR, error: null };
    mockConfig.upsert.site_report_schedules = { __pending: true };

    const { result } = await renderLoaded();
    expect(result.current.sites).toHaveLength(1);

    act(() => {
      result.current.saveSchedule('S1', { enabled: false });
    });

    expect(result.current.sites[0].saving).toBe(true);
    expect(result.current.sites[0].schedule.enabled).toBe(false);
  });

  it('upserts a bulletin schedule with the type key and its cadence', async () => {
    mockConfig.read.clients = { data: ONE_CLIENT, error: null };
    mockConfig.upsert.site_report_schedules = { error: null };

    const { result } = await renderLoaded();

    await act(async () => {
      result.current.saveSchedule('S1', { enabled: true }, 'insar');
    });

    const call = mockConfig.upsertCalls.find(
      (c) => c.table === 'site_report_schedules' && c.args[0]?.report_type === 'insar'
    );
    expect(call).toBeTruthy();
    expect(call!.args[0]).toMatchObject({
      site_id: 'S1',
      report_type: 'insar',
      cadence: 'monthly',
      enabled: true,
    });
    const insar = result.current.sites[0].bulletins.find((b) => b.type === 'insar');
    expect(insar!.schedule.enabled).toBe(true);
  });

  it('rolls back and surfaces the error when the upsert fails', async () => {
    mockConfig.read.clients = { data: ONE_CLIENT, error: null };
    mockConfig.read.latest_radar_wall_folders = { data: ONE_SENSOR, error: null };
    mockConfig.upsert.site_report_schedules = { error: { message: 'DB error' } };

    const { result } = await renderLoaded();
    const original = result.current.sites[0].schedule.deadline;

    await act(async () => {
      result.current.saveSchedule('S1', { deadline: '09:00' });
    });

    await waitFor(() => expect(result.current.sites[0].saving).toBe(false));
    expect(result.current.sites[0].saveError).toBe('DB error');
    expect(result.current.sites[0].schedule.deadline).toBe(original);
  });
});

describe('useReportSchedules — fetch errors', () => {
  it('sensor registry failure leaves sites empty and loading false', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockConfig.read.latest_radar_wall_folders = { data: null, error: { message: 'boom' } };

    const { result } = await renderLoaded();

    expect(result.current.sites).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('schedule fetch failure falls back to the default radar schedule for every site', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockConfig.read.clients = { data: ONE_CLIENT, error: null };
    mockConfig.read.site_report_schedules = { data: null, error: { message: 'nope' } };

    const { result } = await renderLoaded();

    expect(result.current.sites).toHaveLength(1);
    expect(result.current.sites[0].schedule).toEqual(defaultScheduleFor(RADAR_TYPE));
  });
});
