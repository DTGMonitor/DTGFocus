/**
 * The Failure History tab: one site-wide query, a field selector over it.
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const mockCalls = [];
let mockRows = [];

jest.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: (table) => {
      const call = { table, filters: [] };
      mockCalls.push(call);
      const builder = {
        select: () => builder,
        eq: (column, value) => {
          call.filters.push([column, value]);
          return builder;
        },
        order: () => Promise.resolve({ data: mockRows, error: null }),
      };
      return builder;
    },
  },
}));

jest.mock('@/components/Reusable/Spinner', () => ({ Spinner: () => <div>loading</div> }));

import FailureHistoryTab from '@/components/admin/Radar/Tabs/FailureHistoryTab';

const folder = (radar, name, type = 'Live') => ({ id: name, name, type, radar: { id: radar, radar_number: radar, site_id: 7 } });

beforeEach(() => {
  mockCalls.length = 0;
  mockRows = [
    {
      id: 1, def_type: 'Failure', start: '2026-01-01T00:00:00Z', wallfolder_id: 'A',
      wallfolder: folder('SSR-1', 'A'),
      properties: { Vmax1: 2, InverseVelocity1: 0.5, VCP1: 60, Vmax2: 20, VCP2: 1440, TypeOfFailure: 'Wedge' },
    },
    {
      id: 2, def_type: 'Failure', start: '2026-02-01T00:00:00Z', wallfolder_id: 'B',
      wallfolder: folder('SSR-2', 'B', 'Archive'),
      properties: { Vmax1: 4, InverseVelocity1: 0.25, VCP1: 60 },
    },
  ];
});

const renderTab = () =>
  render(<FailureHistoryTab sensor={{ site_id: 7, site_name: 'Telfer' }} timezone="Australia/Perth" activeTab="failures" />);

test('queries failures by site, not by wall folder', async () => {
  renderTab();
  await screen.findByText(/2 failures across 2 radars and 2 wall folders/);
  expect(mockCalls[0].table).toBe('def_records');
  expect(mockCalls[0].filters).toEqual([
    ['def_type', 'Failure'],
    ['wallfolder.radar.site_id', 7],
  ]);
});

test('inverse velocity is the default view, grouped by VCP', async () => {
  renderTab();
  await screen.findByText(/2 failures/);
  const rows = screen.getAllByRole('row');
  // header + VCP 60 + VCP 1440 (the long set's inverse is derived from Vmax)
  expect(rows).toHaveLength(3);
  expect(within(rows[1]).getByText('h/mm')).toBeTruthy();
  expect(within(rows[1]).getAllByText('0.375').length).toBeGreaterThan(0); // mean and median
  expect(within(rows[2]).getByText('d/mm')).toBeTruthy();
});

test('the field selector switches to a categorical count', async () => {
  renderTab();
  await screen.findByText(/2 failures/);
  fireEvent.change(screen.getByLabelText('Field'), { target: { value: 'typeOfFailure' } });
  await waitFor(() => expect(screen.getByText('Wedge')).toBeTruthy());
  expect(screen.getByText('Not recorded')).toBeTruthy();
  expect(screen.queryByLabelText('VCP set')).toBeNull();
});

test('an empty site says so', async () => {
  mockRows = [];
  renderTab();
  await screen.findByText('No failures have been recorded on this site.');
});
