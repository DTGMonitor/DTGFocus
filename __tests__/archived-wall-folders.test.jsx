/**
 * The read-only window onto a radar's retired wall folders.
 *
 * Two things have to hold, and they are the two the feature was asked for:
 *
 *   1. The history is actually REACHABLE — a folder that has been rotated away
 *      from still shows its deformation, alarms, downtime and data-quality sheet,
 *      each read from the folder it was written under rather than the live one.
 *   2. Opening it cannot CHANGE anything. Not "the buttons are hidden" — no write
 *      ever reaches the database, which is what makes it safe to offer this from
 *      a live radar's own panel.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mockStore = {};
const mockCalls = [];

jest.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: (table) => {
      const state = { op: 'select', filters: [], payload: null };

      const rows = () =>
        (mockStore[table] ?? []).filter((row) =>
          state.filters.every(({ op, column, value }) =>
            op === 'in'
              ? value.map(String).includes(String(row[column]))
              : String(row[column]) === String(value)
          )
        );

      const settle = (data) => {
        mockCalls.push({ table, op: state.op, filters: state.filters, payload: state.payload });
        return Promise.resolve({ data, error: null });
      };

      const chain = {
        select: () => chain,
        order: () => chain,
        limit: () => chain,
        eq: (column, value) => {
          state.filters.push({ op: 'eq', column, value });
          return chain;
        },
        in: (column, value) => {
          state.filters.push({ op: 'in', column, value });
          return chain;
        },
        // Every write path is recorded and then answered successfully, so a
        // test failing here means the component ISSUED a write — not that the
        // mock refused one.
        insert: (payload) => {
          state.op = 'insert';
          state.payload = payload;
          return settle(null);
        },
        update: (payload) => {
          state.op = 'update';
          state.payload = payload;
          return chain;
        },
        delete: () => {
          state.op = 'delete';
          return chain;
        },
        maybeSingle: () => settle(rows()[0] ?? null),
        single: () => settle(rows()[0] ?? null),
        then: (resolve) => resolve({ data: rows(), error: null }),
      };
      return chain;
    },
  },
}));

const ArchivedFoldersModal = require('@/components/admin/Radar/ArchivedFoldersModal').default;

const SENSOR = { id: 7, radar_number: 'RDR-01', area: 'Stage 9', site_name: 'Telfer' };

const seed = () => {
  mockStore.radar_wall_folders = [
    {
      id: 100,
      radar_id: 7,
      name: 'Stage 8 East',
      area: 'Open Pit',
      type: 'Archive',
      commenced_at: '2025-06-01T00:00:00.000Z',
      decommissioned_at: '2025-12-01T00:00:00.000Z',
      location_group: 'Open Pit',
    },
    {
      id: 101,
      radar_id: 7,
      name: 'Stage 7',
      area: 'Open Pit',
      type: 'Archive',
      commenced_at: '2025-01-01T00:00:00.000Z',
      decommissioned_at: '2025-06-01T00:00:00.000Z',
      location_group: 'Open Pit',
    },
    // The live one. It must never appear in this list.
    { id: 102, radar_id: 7, name: 'Stage 9', area: 'Open Pit', type: 'Live', commenced_at: '2025-12-01T00:00:00.000Z' },
  ];

  mockStore.def_records = [
    {
      id: 1,
      wallfolder_id: 100,
      def_type: 'Regressive',
      location: 'North Batter',
      created_at: '2025-09-01T00:00:00.000Z',
      isactive: 'Yes',
      precursors: null,
      properties: {},
      detected_by: 'u1',
    },
    {
      id: 2,
      wallfolder_id: 100,
      def_type: 'Progressive',
      location: 'South Batter',
      created_at: '2025-08-01T00:00:00.000Z',
      isactive: 'No',
      precursors: null,
      properties: {},
      detected_by: 'u1',
    },
    // Under the LIVE folder — must not leak into the archived folder's view.
    {
      id: 3,
      wallfolder_id: 102,
      def_type: 'Regressive',
      location: 'Current Wall',
      created_at: '2026-01-01T00:00:00.000Z',
      isactive: 'Yes',
      precursors: null,
      properties: {},
      detected_by: 'u1',
    },
  ];

  mockStore.alarm_regions = [{ id: 50, wallfolder: 100, name: 'North Region', alarmtype: 'Red' }];
  mockStore.alarm_records = [
    {
      id: 500,
      alarm_region: 50,
      triggered_at: '2025-09-02T03:00:00.000Z',
      location: 'North Batter',
      reason: 'Deformation',
      cause: 'Slope movement',
      detected_by: 'u1',
    },
  ];

  mockStore.downtime_records = [
    {
      id: 600,
      wallfolder: 100,
      type: 'Link Down',
      reason: 'Radar System Issue',
      from: '2025-10-01T00:00:00.000Z',
      to: null,
      action: 'Check Fuel',
      notes: 'Generator out',
      detected_by: 'u1',
    },
  ];

  mockStore.dqp_records = [{ id: 900, wall_folder_id: 100, created_time: '2025-11-01T00:00:00.000Z' }];
  mockStore.dqp_values = [
    {
      dqp_record_id: 900,
      parameter_id: 1,
      value: 'Optimal',
      notes: 'Clean scan',
      appendix: 'A1',
      parameters: { id: 1, name: 'Signal Strength', level: 0, parent_id: null },
    },
  ];
};

const CROSSCHECKERS = [{ id: 'u1', full_name: 'Dani Prasetyo' }];

const open = () =>
  render(
    <ArchivedFoldersModal
      isOpen
      sensor={SENSOR}
      timezone="Australia/Perth"
      crosscheckers={CROSSCHECKERS}
      onClose={() => {}}
    />
  );

beforeEach(() => {
  mockCalls.length = 0;
  seed();
});

describe('ArchivedFoldersModal', () => {
  test('lists the retired folders only, newest commenced first', async () => {
    open();

    // Twice over: once in the registry on the left, once as the heading of the
    // folder it opened on.
    expect(await screen.findAllByText('Stage 8 East (Open Pit)')).toHaveLength(2);
    expect(screen.getByText('Stage 7 (Open Pit)')).toBeInTheDocument();
    // The folder the radar is on now is not history and is not offered here.
    expect(screen.queryByText('Stage 9 (Open Pit)')).not.toBeInTheDocument();
  });

  test('opens on the most recent folder and shows its deformation, split by whether the chain was closed', async () => {
    open();

    // The chain the rotation left open, and the one that had been archived.
    await screen.findByText(/Regressive - North Batter/);
    expect(screen.getByText(/Progressive - South Batter/)).toBeInTheDocument();
    expect(screen.getByText(/Still open when the folder was retired/)).toBeInTheDocument();
    expect(screen.getByText(/Closed chains/)).toBeInTheDocument();

    // Records under the live folder belong to the live board, not to this one.
    expect(screen.queryByText(/Current Wall/)).not.toBeInTheDocument();
  });

  test('reads alarms through the folder’s own regions', async () => {
    open();
    await screen.findByText(/Regressive - North Batter/);

    fireEvent.click(screen.getByRole('button', { name: 'Alarms' }));

    const row = await screen.findByText('North Region');
    expect(within(row.closest('tr')).getByText('Slope movement')).toBeInTheDocument();
    expect(within(row.closest('tr')).getByText('Dani Prasetyo')).toBeInTheDocument();
  });

  test('a downtime record still open when the folder was retired says so rather than printing a dash', async () => {
    open();
    await screen.findByText(/Regressive - North Batter/);

    fireEvent.click(screen.getByRole('button', { name: 'Downtime' }));

    expect(await screen.findByText('still open')).toBeInTheDocument();
    expect(screen.getByText('Generator out')).toBeInTheDocument();
  });

  test('shows the data-quality sheet the folder carried when it was retired', async () => {
    open();
    await screen.findByText(/Regressive - North Batter/);

    fireEvent.click(screen.getByRole('button', { name: 'Data Quality' }));

    expect(await screen.findByText('Signal Strength')).toBeInTheDocument();
    expect(screen.getByText('Optimal')).toBeInTheDocument();
  });

  test('switching folders re-reads against the folder that was picked', async () => {
    open();
    await screen.findByText(/Regressive - North Batter/);

    fireEvent.click(screen.getByText('Stage 7 (Open Pit)'));

    await waitFor(() =>
      expect(
        screen.getByText('No deformation was recorded under this wall folder.')
      ).toBeInTheDocument()
    );
  });

  test('never writes — not a single insert, update or delete reaches the database', async () => {
    open();
    await screen.findByText(/Regressive - North Batter/);

    for (const label of ['Alarms', 'Downtime', 'Data Quality']) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => expect(mockCalls.length).toBeGreaterThan(0));
    }
    fireEvent.click(screen.getByText('Stage 7 (Open Pit)'));
    await waitFor(() =>
      expect(
        screen.getByText('No deformation was recorded under this wall folder.')
      ).toBeInTheDocument()
    );

    expect(mockCalls.filter((c) => c.op !== 'select')).toEqual([]);
  });

  test('a radar that has never retired a folder is told so, rather than shown an empty pane', async () => {
    mockStore.radar_wall_folders = [
      { id: 102, radar_id: 7, name: 'Stage 9', area: 'Open Pit', type: 'Live' },
    ];
    open();

    expect(await screen.findByText(/never retired a wall folder/)).toBeInTheDocument();
  });
});
