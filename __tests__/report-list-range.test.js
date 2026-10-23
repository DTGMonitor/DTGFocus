/**
 * The report list's date range: presets, the custom-range rules, the 6-month
 * cap, the `created_at` query bounds, and the URL round-trip.
 *
 * Runs under TZ=Asia/Jakarta (jest.config.js), so "local midnight" is 17:00 UTC
 * the previous day — the bounds below are asserted in that zone.
 */

import {
  PRESETS,
  DEFAULT_SELECTION,
  resolveRange,
  validateCustom,
  toQueryBounds,
  parseSearch,
  toSearch,
  formatRangeLabel,
  subMonths,
} from '@/utils/reportListRange';

const TODAY = '2026-10-23';

describe('resolveRange — presets end today and include it', () => {
  test('Last 7 days', () => {
    expect(resolveRange({ preset: '7d' }, TODAY)).toEqual({ from: '2026-10-17', to: TODAY });
  });

  test('Last 30 days', () => {
    expect(resolveRange({ preset: '30d' }, TODAY)).toEqual({ from: '2026-09-24', to: TODAY });
  });

  test('Last 3 months', () => {
    expect(resolveRange({ preset: '3m' }, TODAY)).toEqual({ from: '2026-07-23', to: TODAY });
  });

  test('Last 6 months clamps 31 Aug back to 28 Feb', () => {
    expect(resolveRange({ preset: '6m' }, '2026-08-31')).toEqual({ from: '2026-02-28', to: '2026-08-31' });
  });

  test('an unknown preset resolves as the default', () => {
    expect(resolveRange({ preset: 'nope' }, TODAY)).toEqual(resolveRange(DEFAULT_SELECTION, TODAY));
  });

  test('a custom range is capped at today', () => {
    expect(resolveRange({ preset: 'custom', from: '2026-10-01', to: '2026-10-30' }, TODAY))
      .toEqual({ from: '2026-10-01', to: TODAY });
  });
});

describe('validateCustom — the 6-month cap and ordering', () => {
  test('an old range within the cap is fine', () => {
    expect(validateCustom('2025-01-01', '2025-06-30', TODAY)).toBeNull();
  });

  test('exactly 6 months is fine', () => {
    expect(validateCustom('2025-01-15', '2025-07-15', TODAY)).toBeNull();
  });

  test('one day over 6 months is too long', () => {
    expect(validateCustom('2025-01-14', '2025-07-15', TODAY)).toBe('tooLong');
  });

  test('1 Jan – 15 Jul is too long', () => {
    expect(validateCustom('2025-01-01', '2025-07-15', TODAY)).toBe('tooLong');
  });

  test('reversed range', () => {
    expect(validateCustom('2026-03-10', '2026-03-01', TODAY)).toBe('order');
  });

  test('missing or malformed days', () => {
    expect(validateCustom('', '2026-03-01', TODAY)).toBe('missing');
    expect(validateCustom('2026-03-01', null, TODAY)).toBe('missing');
    expect(validateCustom('2026-02-30', '2026-03-01', TODAY)).toBe('missing');
  });

  test('a future end is capped before the checks, not rejected', () => {
    expect(validateCustom('2026-10-01', '2026-10-30', TODAY)).toBeNull();
    // Capped to 23 Oct, 23 Apr is still within 6 months even though 30 Oct − 6m isn't.
    expect(validateCustom('2026-04-23', '2026-10-30', TODAY)).toBeNull();
  });

  test('a start after today is out of order once the end is capped', () => {
    expect(validateCustom('2026-10-25', '2026-10-30', TODAY)).toBe('order');
  });

  test.each(PRESETS.map((p) => [p.key]))('preset %s passes its own cap', (key) => {
    for (const today of [TODAY, '2026-08-31', '2026-03-31', '2024-02-29']) {
      const { from, to } = resolveRange({ preset: key }, today);
      expect(validateCustom(from, to, today)).toBeNull();
    }
  });

  test('subMonths clamps across a leap year', () => {
    expect(subMonths('2024-08-31', 6)).toBe('2024-02-29');
  });
});

describe('toQueryBounds — the last day counts in full', () => {
  test('gte is local midnight of from, lt is local midnight after to', () => {
    // Asia/Jakarta is UTC+7.
    expect(toQueryBounds({ from: '2026-03-01', to: '2026-03-31' })).toEqual({
      gte: '2026-02-28T17:00:00.000Z',
      lt: '2026-03-31T17:00:00.000Z',
    });
  });

  test('a report late on the last day is in, the next midnight is out', () => {
    const { gte, lt } = toQueryBounds({ from: '2026-03-01', to: '2026-03-31' });
    const inRange = (d) => d.toISOString() >= gte && d.toISOString() < lt;
    expect(inRange(new Date(2026, 2, 31, 22, 0))).toBe(true);
    expect(inRange(new Date(2026, 3, 1, 0, 0))).toBe(false);
    expect(inRange(new Date(2026, 1, 28, 23, 59))).toBe(false);
  });
});

describe('parseSearch / toSearch — the URL round-trip', () => {
  test('presets round-trip', () => {
    for (const { key } of PRESETS) {
      expect(parseSearch(toSearch({ preset: key }), TODAY)).toEqual({ preset: key });
    }
  });

  test('a custom range round-trips', () => {
    const sel = { preset: 'custom', from: '2025-01-01', to: '2025-06-30' };
    expect(toSearch(sel)).toBe('?range=custom&from=2025-01-01&to=2025-06-30');
    expect(parseSearch(toSearch(sel), TODAY)).toEqual(sel);
  });

  test('other params are kept, stale from/to are dropped', () => {
    expect(toSearch({ preset: '30d' }, '?tab=reports&range=custom&from=2025-01-01&to=2025-06-30'))
      .toBe('?tab=reports&range=30d');
  });

  test.each([
    [''],
    ['?range=1y'],
    ['?range=custom'],
    ['?range=custom&from=2025-01-01&to=2025-12-31'],
    ['?range=custom&from=2025-06-30&to=2025-01-01'],
    ['?range=custom&from=garbage&to=2025-01-01'],
  ])('%s falls back to Last 7 days', (search) => {
    expect(parseSearch(search, TODAY)).toEqual(DEFAULT_SELECTION);
  });

  test('a custom URL ending in the future is capped to today', () => {
    expect(parseSearch('?range=custom&from=2026-10-01&to=2026-10-30', TODAY))
      .toEqual({ preset: 'custom', from: '2026-10-01', to: TODAY });
  });
});

describe('formatRangeLabel', () => {
  test('same year shows the year once', () => {
    expect(formatRangeLabel({ from: '2026-10-17', to: '2026-10-23' })).toBe('17 Oct – 23 Oct 2026');
  });

  test('different years show both', () => {
    expect(formatRangeLabel({ from: '2025-12-28', to: '2026-01-03' })).toBe('28 Dec 2025 – 3 Jan 2026');
  });
});
