/**
 * The shared report list: the `created_at` range reaches the query, the filter
 * bar survives an empty range, the type pin, and the custom-range guard.
 *
 * The clock is pinned to 23 Oct 2026 12:00 Asia/Jakarta (jest.config.js sets
 * the zone), so the default 7-day range is 17 Oct – 23 Oct.
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// Records every builder call and resolves with `mockRows`.
let mockCalls;
let mockRows;
jest.mock('@/lib/supabaseClient', () => {
  const builder = () => {
    const b = {};
    for (const m of ['select', 'gte', 'lt', 'eq', 'order', 'ilike']) {
      b[m] = (...args) => { mockCalls.push([m, ...args]); return b; };
    }
    b.then = (resolve) => resolve({ data: mockRows, error: null });
    return b;
  };
  return {
    supabase: {
      from: (table) => { mockCalls.push(['from', table]); return builder(); },
      storage: { from: () => ({}) },
    },
  };
});

let mockUserSite;
jest.mock('@/components/Reusable/useUserSite', () => ({
  useUserSite: () => ({ userSite: mockUserSite, loading: false }),
}));

import ReportsList from '@/components/Reusable/ReportList';

const calls = (name) => mockCalls.filter(([m]) => m === name);

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(2026, 9, 23, 12, 0), doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'] });
  mockCalls = [];
  mockRows = [];
  mockUserSite = { role: 'admin', site: null };
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  jest.useRealTimers();
});

test('the default query is bounded to the last 7 days of created_at', async () => {
  render(<ReportsList />);

  await waitFor(() => expect(calls('gte')).toHaveLength(1));
  // Local midnight 17 Oct and 24 Oct in UTC+7.
  expect(calls('gte')[0]).toEqual(['gte', 'created_at', '2026-10-16T17:00:00.000Z']);
  expect(calls('lt')[0]).toEqual(['lt', 'created_at', '2026-10-23T17:00:00.000Z']);
  expect(calls('eq')).toHaveLength(0);
  expect(await screen.findByText(/17 Oct – 23 Oct 2026/)).toBeInTheDocument();
});

test('an empty range keeps the filter bar and says so', async () => {
  render(<ReportsList />);

  expect(await screen.findByText('No reports in this range.')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('Search reports...')).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Date range' })).toBeInTheDocument();
  expect(screen.getByText(/0 results/)).toBeInTheDocument();
});

test('rows are listed with the result count', async () => {
  mockRows = [
    { id: 1, filename: 'site-a/daily.pdf', type: 'radar', status: 'Completed', date: '2026-10-22' },
    { id: 2, filename: 'site-a/weekly.pdf', type: 'insar', status: 'Completed', date: '2026-10-20' },
  ];
  render(<ReportsList />);

  expect(await screen.findByText('daily.pdf')).toBeInTheDocument();
  expect(screen.getByText('weekly.pdf')).toBeInTheDocument();
  expect(screen.getByText(/2 results/)).toBeInTheDocument();
});

test('a pinned client tab hides the type dropdown and scopes type and site', async () => {
  mockUserSite = { role: 'client', site: { id: 'site-a' } };
  render(<ReportsList page="insar" />);

  await waitFor(() => expect(calls('eq')).toHaveLength(1));
  expect(calls('eq')[0]).toEqual(['eq', 'type', 'insar']);
  expect(calls('ilike')[0]).toEqual(['ilike', 'filename', 'site-a/%']);
  expect(screen.queryByRole('combobox', { name: 'Report type' })).not.toBeInTheDocument();
});

test('the admin board shows the type dropdown', async () => {
  render(<ReportsList />);

  expect(await screen.findByRole('combobox', { name: 'Report type' })).toBeInTheDocument();
});

test('a user with no site gets the no-site message and no query', async () => {
  mockUserSite = { role: 'client', site: null };
  render(<ReportsList />);

  expect(await screen.findByText('No client site associated with this user.')).toBeInTheDocument();
  expect(calls('from')).toHaveLength(0);
});

test('a custom range from the URL is applied', async () => {
  window.history.replaceState(null, '', '/?range=custom&from=2025-01-01&to=2025-06-30');
  render(<ReportsList />);

  await waitFor(() => expect(calls('gte')).toHaveLength(1));
  expect(calls('gte')[0][2]).toBe('2024-12-31T17:00:00.000Z');
  expect(calls('lt')[0][2]).toBe('2025-06-30T17:00:00.000Z');
  expect(screen.getByLabelText('From')).toHaveValue('2025-01-01');
});

test('an over-long custom range disables Apply and keeps the applied range', async () => {
  window.history.replaceState(null, '', '/?range=custom&from=2025-01-01&to=2025-06-30');
  render(<ReportsList />);
  await waitFor(() => expect(calls('gte')).toHaveLength(1));

  fireEvent.change(screen.getByLabelText('To'), { target: { value: '2025-07-15' } });

  expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('at most 6 months');
  expect(calls('gte')).toHaveLength(1);
  expect(window.location.search).toBe('?range=custom&from=2025-01-01&to=2025-06-30');
});

test('applying a valid custom range refetches and writes the URL', async () => {
  window.history.replaceState(null, '', '/?tab=x&range=custom&from=2025-01-01&to=2025-06-30');
  render(<ReportsList />);
  await waitFor(() => expect(calls('gte')).toHaveLength(1));

  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2025-03-01' } });
  fireEvent.change(screen.getByLabelText('To'), { target: { value: '2025-03-31' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

  await waitFor(() => expect(calls('gte')).toHaveLength(2));
  expect(calls('gte')[1][2]).toBe('2025-02-28T17:00:00.000Z');
  expect(window.location.search).toBe('?tab=x&range=custom&from=2025-03-01&to=2025-03-31');
});

test('an invalid URL range falls back to the last 7 days', async () => {
  window.history.replaceState(null, '', '/?range=custom&from=2025-01-01&to=2025-12-31');
  render(<ReportsList />);

  await waitFor(() => expect(calls('gte')).toHaveLength(1));
  expect(calls('gte')[0][2]).toBe('2026-10-16T17:00:00.000Z');
});
