/**
 * The date range the report list is filtered by.
 *
 * A range is a pair of LOCAL calendar days, `from` and `to`, both inclusive, as
 * `YYYY-MM-DD` strings. A selection is either a preset (`{ preset: '7d' }`) or a
 * custom pair (`{ preset: 'custom', from, to }`). No range may be longer than
 * six calendar months, so a single query never pulls more than that.
 *
 * Pure: no React, no Supabase, no clock access. `today` is supplied by the
 * caller as a `YYYY-MM-DD` day.
 *
 * The cap is measured BACK from `to` (`from ≥ to − 6 months`), with the same
 * month-end clamping the presets use. Measuring forward from `from` would reject
 * the `6m` preset itself: on 31 Aug it starts 28 Feb, and 28 Feb + 6 months is
 * 28 Aug.
 */

export const DEFAULT_SELECTION = { preset: '7d' };

/** In display order. `days` presets end today and include it; `months` presets
 *  start on the same calendar day N months back. */
export const PRESETS = [
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '3m', label: 'Last 3 months', months: 3 },
  { key: '6m', label: 'Last 6 months', months: 6 },
];

export const MAX_RANGE_MONTHS = 6;

export const CUSTOM_ERRORS = {
  missing: 'Pick both a start and an end date.',
  order: 'The start date must not be after the end date.',
  tooLong: `The range may be at most ${MAX_RANGE_MONTHS} months.`,
};

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` → local-midnight Date, or null if it isn't a real calendar day. */
export function parseDay(day) {
  const m = typeof day === 'string' ? DAY_RE.exec(day) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  // Rejects 2026-02-30 and friends, which Date would roll into March.
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

/** Local Date → `YYYY-MM-DD`. */
export function formatDay(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDays(day, n) {
  const d = parseDay(day);
  return formatDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

/** Same calendar day N months earlier, clamped to the end of that month. */
export function subMonths(day, n) {
  const d = parseDay(day);
  const target = new Date(d.getFullYear(), d.getMonth() - n, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return formatDay(new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), lastDay)));
}

const minDay = (a, b) => (a < b ? a : b);

/**
 * Why a custom range can't be applied, or null if it can. A `to` after today is
 * not an error — it is capped to today, and the cap is checked against that.
 */
export function validateCustom(from, to, today) {
  if (!parseDay(from) || !parseDay(to)) return 'missing';
  const end = minDay(to, today);
  if (from > end) return 'order';
  if (from < subMonths(end, MAX_RANGE_MONTHS)) return 'tooLong';
  return null;
}

/** Selection → inclusive `{ from, to }`. A custom selection is assumed valid. */
export function resolveRange(selection, today) {
  if (selection?.preset === 'custom') {
    return { from: selection.from, to: minDay(selection.to, today) };
  }
  const preset = PRESETS.find((p) => p.key === selection?.preset) ?? PRESETS[0];
  const from = preset.days ? addDays(today, -(preset.days - 1)) : subMonths(today, preset.months);
  return { from, to: today };
}

/**
 * Inclusive days → `created_at` bounds. The upper bound is the NEXT local
 * midnight, exclusive, so the whole of the last day counts.
 */
export function toQueryBounds({ from, to }) {
  return {
    gte: parseDay(from).toISOString(),
    lt: parseDay(addDays(to, 1)).toISOString(),
  };
}

/** `location.search` → selection; anything unusable falls back to the default. */
export function parseSearch(search, today) {
  const params = new URLSearchParams(search || '');
  const range = params.get('range');
  if (PRESETS.some((p) => p.key === range)) return { preset: range };
  if (range === 'custom') {
    const from = params.get('from');
    const to = params.get('to');
    if (validateCustom(from, to, today) === null) return { preset: 'custom', from, to: minDay(to, today) };
  }
  return DEFAULT_SELECTION;
}

/**
 * Selection → a `search` string for `history.replaceState`, keeping any other
 * params already in `currentSearch`. Returns '' when no params remain.
 */
export function toSearch(selection, currentSearch = '') {
  const params = new URLSearchParams(currentSearch);
  params.delete('from');
  params.delete('to');
  params.set('range', selection.preset);
  if (selection.preset === 'custom') {
    params.set('from', selection.from);
    params.set('to', selection.to);
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

/** `{ from, to }` → "17 Oct – 23 Oct 2026", or with both years when they differ. */
export function formatRangeLabel({ from, to }) {
  const fmt = (day, withYear) =>
    parseDay(day).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      ...(withYear ? { year: 'numeric' } : {}),
    });
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${fmt(from, !sameYear)} – ${fmt(to, true)}`;
}
