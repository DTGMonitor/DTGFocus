import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchAssessments,
  fetchReadings,
  RepositoryError,
} from '@/lib/weather/repository';

// PostgREST's `max-rows` cap TRUNCATES AND RETURNS 200 OK. Nothing in the
// response says it happened, so an unpaged read of a wide window produces a
// series that ends days before "now" and looks complete — a wrong chart, not
// an empty one.
//
// This bit for real: at the five-minute poll cadence the cap lands around
// 3.5 days, so the fog monitor's 24-hour view was fine and its 7-day view
// silently plotted the oldest 3.5 days and stopped. These tests pin the
// paging that closes it, at the one boundary where it matters — a window
// WIDER than the cap.

/**
 * A Supabase double that enforces a row cap the way the server does.
 *
 * `select/eq/gte/lte/order` are pass-throughs; `range` is where the cap bites,
 * returning at most `maxRows` however many were asked for.
 */
function fakeDb(rows: unknown[], maxRows: number) {
  const ranges: [number, number][] = [];

  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'gte', 'lte', 'order']) {
    builder[method] = () => builder;
  }
  builder.range = (from: number, to: number) => {
    ranges.push([from, to]);
    const size = Math.min(to - from + 1, maxRows);
    return Promise.resolve({ data: rows.slice(from, from + size), error: null });
  };

  return {
    db: { from: () => builder } as unknown as SupabaseClient,
    ranges,
  };
}

function readings(count: number) {
  const t0 = Date.parse('2026-09-17T00:00:00Z');
  return Array.from({ length: count }, (_, i) => ({
    observed_at: new Date(t0 + i * 5 * 60_000).toISOString(),
    rain_daily_mm: i * 0.01,
  }));
}

describe('paged reads', () => {
  test('a window wider than the row cap returns all of it, not the first page', () => {
    // Eight days at five minutes — the fog monitor's 7-day range plus its
    // rolling-window lead-in, and more than twice the cap.
    const all = readings(2301);
    const { db } = fakeDb(all, 1000);

    return fetchReadings(db, 'MAC', '2026-09-17T00:00:00Z').then((got) => {
      expect(got.length).toBe(2301);
      // The tail is the part the cap ate, and the part the chart needs: a
      // series that stops 3.5 days short is the whole bug.
      expect(got[got.length - 1].observed_at).toBe(
        all[all.length - 1].observed_at
      );
    });
  });

  test('pages are contiguous — no row read twice, none skipped', async () => {
    const { db, ranges } = fakeDb(readings(2301), 1000);

    const got = await fetchReadings(db, 'MAC', '2026-09-17T00:00:00Z');

    expect(ranges.map((r) => r[0])).toEqual([0, 1000, 2000, 2301]);
    expect(new Set(got.map((r) => r.observed_at)).size).toBe(got.length);
  });

  test('still complete when the server cap is SMALLER than the page size', async () => {
    // The case a "short page means the end" check gets wrong. If max-rows is
    // ever lowered below PAGE_ROWS, every page is short and truncation comes
    // straight back — silently. Paging stops on an EMPTY page instead.
    const { db } = fakeDb(readings(1200), 400);

    const got = await fetchReadings(db, 'MAC', '2026-09-17T00:00:00Z');

    expect(got.length).toBe(1200);
  });

  test('a window that fits in one page costs one extra empty read, not a loop', async () => {
    const { db, ranges } = fakeDb(readings(287), 1000);

    const got = await fetchReadings(db, 'MAC', '2026-09-24T00:00:00Z');

    expect(got.length).toBe(287);
    expect(ranges.length).toBe(2); // the page, then the empty one that ends it
  });

  test('no rows is an empty result, not an error', async () => {
    const { db } = fakeDb([], 1000);
    await expect(fetchReadings(db, 'MAC', '2026-09-24T00:00:00Z')).resolves.toEqual(
      []
    );
  });

  test('a database error surfaces as RepositoryError rather than a short read', async () => {
    // The failure mode to avoid is the quiet one: returning the pages that
    // did arrive would look exactly like a station that stopped reporting.
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'gte', 'lte', 'order']) builder[m] = () => builder;
    builder.range = () =>
      Promise.resolve({ data: null, error: { message: 'connection reset' } });
    const db = { from: () => builder } as unknown as SupabaseClient;

    await expect(fetchReadings(db, 'MAC', '2026-09-24T00:00:00Z')).rejects.toThrow(
      RepositoryError
    );
  });

  test('assessments page too — the summary route accepts windows of up to a year', async () => {
    const t0 = Date.parse('2026-09-17T00:00:00Z');
    const rows = Array.from({ length: 1500 }, (_, i) => ({
      assessed_at: new Date(t0 + i * 5 * 60_000).toISOString(),
    }));
    const { db } = fakeDb(rows, 1000);

    const got = await fetchAssessments(db, 'MAC', '2026-09-17T00:00:00Z');

    expect(got.length).toBe(1500);
  });
});
