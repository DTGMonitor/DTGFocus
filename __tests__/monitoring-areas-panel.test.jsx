/**
 * The monitoring-point board.
 *
 * On a roster radar this list IS the report's Area column, so these cover the
 * ways an edit here silently changes tomorrow's report: what is written to the
 * database when a point is added, retired or reordered, and that a duplicate is
 * refused before it reaches a unique-constraint error the operator cannot read.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mockStore = { monitoring_areas: [] };
const mockCalls = [];

jest.mock('react-hot-toast', () => {
  const toast = jest.fn();
  toast.success = jest.fn();
  toast.error = jest.fn();
  return { __esModule: true, default: toast };
});

jest.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: (table) => {
      const state = { op: 'select', filters: {}, payload: null };
      const rows = () =>
        (mockStore[table] ?? []).filter((row) =>
          Object.entries(state.filters).every(([k, v]) => String(row[k]) === String(v))
        );
      const settle = () => {
        mockCalls.push({ table, ...state });
        if (state.op === 'update') {
          mockStore[table] = (mockStore[table] ?? []).map((row) =>
            rows().some((r) => r.id === row.id) ? { ...row, ...state.payload } : row
          );
        }
        if (state.op === 'delete') {
          const doomed = new Set(rows().map((r) => r.id));
          mockStore[table] = (mockStore[table] ?? []).filter((row) => !doomed.has(row.id));
        }
        return Promise.resolve({ data: null, error: null });
      };
      const chain = {
        select: () => chain,
        order: () => chain,
        limit: () => chain,
        eq: (column, value) => {
          state.filters[column] = value;
          return state.op === 'select' ? chain : settle();
        },
        insert: (payload) => {
          const list = Array.isArray(payload) ? payload : [payload];
          mockCalls.push({ table, op: 'insert', payload: list });
          mockStore[table] = [
            ...(mockStore[table] ?? []),
            ...list.map((row, i) => ({ id: 900 + i, isactive: 'Yes', ...row })),
          ];
          return Promise.resolve({ data: null, error: null });
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
        then: (resolve) => resolve({ data: rows(), error: null }),
      };
      return chain;
    },
  },
}));

import toast from 'react-hot-toast';
import MonitoringAreasPanel from '@/components/admin/Radar/Deformation/MonitoringAreasPanel';
import { isDuplicateArea, moveArea, sortOrderUpdates } from '@/utils/monitoringAreas';

const SENSOR = { wallfolder_id: 10, radar_number: 'PS2000' };

const seed = (areas) => {
  mockStore.monitoring_areas = areas.map((a, i) => ({
    id: i + 1,
    wallfolder_id: 10,
    isactive: 'Yes',
    sort_order: i + 1,
    ...a,
  }));
};

const updatesTo = (table) => mockCalls.filter((c) => c.table === table && c.op === 'update');
const insertsTo = (table) => mockCalls.filter((c) => c.table === table && c.op === 'insert');

beforeEach(() => {
  mockCalls.length = 0;
  jest.clearAllMocks();
  seed([{ name: 'Top dk 1' }, { name: 'Poli Dk' }, { name: 'Kaki disp 1' }]);
});

const openPanel = async () => {
  render(<MonitoringAreasPanel sensor={SENSOR} defaultOpen />);
  await screen.findByText('Top dk 1');
};

describe('the monitoring-point board', () => {
  test('lists the wall’s points in the order they will print', async () => {
    await openPanel();

    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => within(li).getByText(/dk|disp/i).textContent)).toEqual([
      'Top dk 1',
      'Poli Dk',
      'Kaki disp 1',
    ]);
  });

  test('a new point is appended, not inserted into the middle', async () => {
    await openPanel();

    fireEvent.change(screen.getByLabelText('New monitoring point'), {
      target: { value: '  Midle disp 102  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add/i }));

    await waitFor(() => expect(insertsTo('monitoring_areas')).toHaveLength(1));
    expect(insertsTo('monitoring_areas')[0].payload[0]).toEqual({
      wallfolder_id: 10,
      name: 'Midle disp 102',
      sort_order: 4,
    });
  });

  test('a point already on the board is refused before the database sees it', async () => {
    await openPanel();

    // Same point, different spelling — which is exactly what the unique index
    // would reject, with an error no operator can act on.
    fireEvent.change(screen.getByLabelText('New monitoring point'), {
      target: { value: 'poli  dk' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(insertsTo('monitoring_areas')).toHaveLength(0);
  });

  test('retiring a point stops it printing without deleting anything', async () => {
    await openPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Retire Poli Dk' }));

    await waitFor(() => expect(updatesTo('monitoring_areas')).toHaveLength(1));
    expect(updatesTo('monitoring_areas')[0].payload).toEqual({ isactive: 'No' });
    expect(mockCalls.some((c) => c.op === 'delete')).toBe(false);

    // Out of the live list, still on the board.
    await waitFor(() => expect(screen.queryByText('Poli Dk')).not.toBeInTheDocument());
    expect(screen.getByText(/1 retired point/)).toBeInTheDocument();
  });

  test('moving a point renumbers only the rows that moved', async () => {
    await openPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Move Top dk 1 down' }));

    await waitFor(() => expect(updatesTo('monitoring_areas')).toHaveLength(2));
    expect(
      updatesTo('monitoring_areas').map((c) => ({ id: c.filters.id, ...c.payload }))
    ).toEqual([
      { id: 2, sort_order: 1 },
      { id: 1, sort_order: 2 },
    ]);
    // The third point did not move, so it was not written.
    expect(updatesTo('monitoring_areas').some((c) => String(c.filters.id) === '3')).toBe(false);
  });

  test('an empty board says so rather than looking broken', async () => {
    seed([]);
    render(<MonitoringAreasPanel sensor={SENSOR} defaultOpen />);

    expect(await screen.findByText(/No monitoring points yet/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The pure edits behind the panel
// ---------------------------------------------------------------------------

describe('board edits', () => {
  const board = [
    { id: 1, name: 'Top dk 1', sort_order: 1 },
    { id: 2, name: 'Poli Dk', sort_order: 2 },
    { id: 3, name: 'Kaki disp 1', sort_order: 3 },
  ];

  test('a move renumbers the whole board, so ties and gaps cannot survive it', () => {
    const ragged = [
      { id: 1, name: 'A', sort_order: 0 },
      { id: 2, name: 'B', sort_order: 0 },
    ];
    expect(moveArea(ragged, 1, -1).map((a) => [a.id, a.sort_order])).toEqual([
      [2, 1],
      [1, 2],
    ]);
  });

  test('a move off either end changes nothing', () => {
    expect(moveArea(board, 0, -1)).toEqual(board);
    expect(moveArea(board, 2, 1)).toEqual(board);
    expect(moveArea(board, 9, 1)).toEqual(board);
  });

  test('only the rows that actually moved are written', () => {
    expect(sortOrderUpdates(board, moveArea(board, 0, 1))).toEqual([
      { id: 2, sort_order: 1 },
      { id: 1, sort_order: 2 },
    ]);
    expect(sortOrderUpdates(board, board)).toEqual([]);
  });

  test('duplicates are judged on the match key, and a rename may keep its own name', () => {
    expect(isDuplicateArea(board, 'poli  dk')).toBe(true);
    expect(isDuplicateArea(board, 'Poli Dk', 2)).toBe(false);
    expect(isDuplicateArea(board, 'Something else')).toBe(false);
    expect(isDuplicateArea(board, '   ')).toBe(false);
  });
});
