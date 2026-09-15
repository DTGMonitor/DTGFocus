/**
 * Site-wide summary statistics over past Failure records.
 *
 * A Failure record carries two velocity sets in `properties` — the short VCP
 * (Vmax1 / InverseVelocity1 / VCP1) and the long VCP (…2). The two quantities
 * that matter for calibrating the next alarm are velocity and inverse velocity,
 * and neither can be pooled across VCPs: under a day of VCP a velocity reads
 * mm/h, at or over a day mm/d (see velocityUnit), and even within one unit a
 * 30-minute VCP catches peaks a 12-hour VCP smooths away. So samples are grouped
 * by the VCP they were measured over, and the stats are computed per group.
 *
 * The same VCP entered as set 1 on one record and set 2 on another is the same
 * measurement, so groups key on the VCP value, not on the set number.
 *
 * Pure: no React, no clock, no I/O.
 */

import { velocityUnit } from '@/utils/reportDefDetails';

export const FAILURE_DEF_TYPE = 'Failure';

const MINUTES_PER_DAY = 1440;

/** Inverse-velocity unit implied by a VCP in minutes. Matches getInverseUnit(). */
export const inverseUnit = (vcp) => (Number(vcp) < MINUTES_PER_DAY ? 'h/mm' : 'd/mm');

/** The share of smallest values P90 leaves out. */
export const P90_EXCLUDED_SHARE = 0.1;

/** Sets on a Failure record: 1 is the short VCP, 2 the long. */
export const VCP_SETS = [
  { value: 'all', label: 'Both VCP sets' },
  { value: '1', label: 'Short VCP (set 1)' },
  { value: '2', label: 'Long VCP (set 2)' },
];

/**
 * Fields the tab can summarise.
 *
 * kind:
 *   by-vcp   — numeric, grouped by the VCP the value was measured over
 *   numeric  — numeric, one group for the whole site
 *   vcp      — the VCPs themselves: numeric stats plus how often each was used
 *   category — free text, counted
 */
export const FAILURE_FIELDS = [
  { key: 'inverseVelocity', label: 'Inverse Velocity', kind: 'by-vcp', decimals: 4, primary: true },
  { key: 'velocity', label: 'Velocity (Vmax)', kind: 'by-vcp', decimals: 2, primary: true },
  { key: 'vcp', label: 'VCP used', kind: 'vcp', decimals: 0, unit: 'min', primary: true },
  { key: 'maxDeformation', label: 'Max Deformation', kind: 'numeric', decimals: 2, unit: 'mm', prop: 'MaximumDeformation' },
  { key: 'coherence', label: 'Coherence', kind: 'numeric', decimals: 3, prop: 'Coherence' },
  { key: 'typeOfFailure', label: 'Type of Failure', kind: 'category', prop: 'TypeOfFailure' },
  { key: 'materials', label: 'Materials', kind: 'category', prop: 'Materials' },
];

/** Stored values arrive as numbers, numeric strings or blanks. */
export function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

/** Numbers without trailing-zero noise. */
export function formatStat(n, decimals = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return String(Number(n.toFixed(decimals)));
}

/**
 * Linear-interpolation quantile over an ascending array — the same definition
 * as Excel's PERCENTILE.INC, so a figure here can be checked against a sheet.
 */
export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * The most frequent value(s).
 *
 * Values are compared at `decimals` places, because inverse velocity is stored
 * to four places from a division and two records of "the same" value can differ
 * in the fifteenth. When nothing repeats there is no mode — every value would
 * be one, which says nothing — except for a single sample, whose mode is itself.
 *
 * @returns {{ values: number[], count: number }}
 */
export function modeOf(values, decimals = 4) {
  if (!values.length) return { values: [], count: 0 };
  const counts = new Map();
  for (const v of values) {
    const key = Number(v.toFixed(decimals));
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const top = Math.max(...counts.values());
  if (top < 2 && values.length > 1) return { values: [], count: 1 };
  const modes = [...counts.entries()].filter(([, c]) => c === top).map(([v]) => v).sort((a, b) => a - b);
  return { values: modes, count: top };
}

/**
 * n, mean, mode, median, P90, min, max.
 *
 * P90 here is the value 90% of failures reached or exceeded: the smallest 10%
 * are excluded, i.e. the 10th percentile.
 */
export function summarise(values, decimals = 4) {
  const clean = values.filter((v) => Number.isFinite(v));
  const n = clean.length;
  if (!n) {
    return { n: 0, mean: null, mode: { values: [], count: 0 }, median: null, p90: null, min: null, max: null };
  }
  const sorted = [...clean].sort((a, b) => a - b);
  return {
    n,
    mean: sorted.reduce((s, v) => s + v, 0) / n,
    mode: modeOf(sorted, decimals),
    median: quantile(sorted, 0.5),
    p90: quantile(sorted, P90_EXCLUDED_SHARE),
    min: sorted[0],
    max: sorted[n - 1],
  };
}

/** Only the records that are failures, whatever whitespace crept into def_type. */
export function failureRecordsOnly(records) {
  return (records || []).filter((r) => String(r?.def_type ?? '').trim() === FAILURE_DEF_TYPE);
}

/**
 * One sample per velocity set that carries anything.
 *
 * Inverse velocity is derived from Vmax when it is missing, as the entry form
 * does (1 / Vmax), so a record entered before that auto-fill still counts. A
 * derived value is flagged so the records list can say so.
 *
 * @param {object[]} records def_records rows
 * @param {'all'|'1'|'2'} set
 * @returns {{recordId: any, set: 1|2, vcp: number|null, velocity: number|null, inverseVelocity: number|null, inverseDerived: boolean}[]}
 */
export function extractVelocitySamples(records, set = 'all') {
  const sets = set === 'all' ? [1, 2] : [Number(set)];
  const out = [];
  for (const record of failureRecordsOnly(records)) {
    const p = record.properties || {};
    for (const i of sets) {
      const vcp = toNumber(p[`VCP${i}`]);
      const velocity = toNumber(p[`Vmax${i}`]);
      let inverseVelocity = toNumber(p[`InverseVelocity${i}`]);
      let inverseDerived = false;
      if (inverseVelocity === null && velocity !== null && velocity !== 0) {
        inverseVelocity = 1 / velocity;
        inverseDerived = true;
      }
      if (vcp === null && velocity === null && inverseVelocity === null) continue;
      out.push({ recordId: record.id, set: i, vcp, velocity, inverseVelocity, inverseDerived });
    }
  }
  return out;
}

/**
 * Stats for velocity or inverse velocity, one row per VCP, ascending.
 * Samples with no VCP land in a trailing group of their own — their unit is
 * unknown, so they may not join any other group, but dropping them silently
 * would under-count the site's history.
 */
export function statsByVcp(records, field, set = 'all') {
  const def = FAILURE_FIELDS.find((f) => f.key === field);
  const groups = new Map();
  for (const s of extractVelocitySamples(records, set)) {
    const v = s[field];
    if (v === null) continue;
    const key = s.vcp === null ? 'none' : s.vcp;
    if (!groups.has(key)) groups.set(key, { values: [], recordIds: new Set() });
    const g = groups.get(key);
    g.values.push(v);
    g.recordIds.add(s.recordId);
  }
  const unitFor = field === 'inverseVelocity' ? inverseUnit : velocityUnit;
  return [...groups.entries()]
    .sort(([a], [b]) => (a === 'none' ? 1 : b === 'none' ? -1 : a - b))
    .map(([vcp, g]) => ({
      vcp: vcp === 'none' ? null : vcp,
      unit: vcp === 'none' ? null : unitFor(vcp),
      records: g.recordIds.size,
      ...summarise(g.values, def?.decimals ?? 4),
    }));
}

/** Every VCP used, with how many failures used it. */
export function vcpUsage(records, set = 'all') {
  const samples = extractVelocitySamples(records, set).filter((s) => s.vcp !== null);
  const counts = new Map();
  for (const s of samples) {
    if (!counts.has(s.vcp)) counts.set(s.vcp, new Set());
    counts.get(s.vcp).add(s.recordId);
  }
  const total = new Set(samples.map((s) => s.recordId)).size;
  return {
    stats: summarise(samples.map((s) => s.vcp), 0),
    usage: [...counts.entries()]
      .sort(([a], [b]) => a - b)
      .map(([vcp, ids]) => ({ vcp, records: ids.size, share: total ? ids.size / total : 0 })),
  };
}

/** Stats for a single numeric property across the site. */
export function numericStats(records, prop, decimals = 4) {
  return summarise(
    failureRecordsOnly(records).map((r) => toNumber(r.properties?.[prop])).filter((v) => v !== null),
    decimals
  );
}

/**
 * Counts of a free-text property, most common first. Case and surrounding
 * whitespace are folded so "Rockfall" and "rockfall " are one bucket; the
 * first spelling seen is the one shown.
 */
export function categoryCounts(records, prop) {
  const failures = failureRecordsOnly(records);
  const buckets = new Map();
  for (const r of failures) {
    const raw = String(r.properties?.[prop] ?? '').trim();
    const key = raw ? raw.toLowerCase() : '';
    if (!buckets.has(key)) buckets.set(key, { label: raw || 'Not recorded', count: 0, blank: !raw });
    buckets.get(key).count += 1;
  }
  const total = failures.length;
  return [...buckets.values()]
    .sort((a, b) => (a.blank !== b.blank ? (a.blank ? 1 : -1) : b.count - a.count || a.label.localeCompare(b.label)))
    .map((b) => ({ ...b, share: total ? b.count / total : 0 }));
}
