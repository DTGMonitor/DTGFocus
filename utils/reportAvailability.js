/**
 * Availability / uptime derivation for radar reports.
 *
 * Generalised from the 24h calculation in components/Radars/Live/RadarDetail.jsx,
 * which hardcodes the window in two places: the query bound (`now - 24h`) and the
 * percentage denominator (`totalWindowHours = 24`). Both are parameters here, so
 * a report can aggregate over a daily / weekly / monthly window.
 *
 * Pure: no React, no Supabase, no clock access. `windowStart`/`windowEnd` are
 * supplied by the caller.
 *
 * Two denominators, preserved from the original:
 *   - Mechanical reasons  → over the whole window.
 *   - Use-of reasons      → over the hours left *after* mechanical downtime,
 *                           falling back to the whole window if that is <= 0.
 *
 * `hours` and `percentage` are returned as NUMBERS. The original emitted
 * `.toFixed()` strings, which GaugeLive then re-wrapped in `Number()`;
 * formatting belongs to the render layer, not the calculation.
 *
 * KNOWN BEHAVIOUR (inherited, deliberately preserved): overlapping records are
 * NOT merged. Two Maintenance records covering the same 12h both count, so a
 * reason's hours can exceed the window and downtime can exceed 100%. Every
 * percentage is clamped to [0,100], so this degrades to "fully down" rather than
 * producing nonsense. Merging intervals would be more correct but would change
 * the numbers the live dashboard has always shown — a separate decision.
 *
 * OPT-IN MERGE (`opts.mergeOverlaps`): the comprehensive report unions downtime
 * across every wall folder of a radar, so the SAME outage logged under both the
 * old and new folder during a changeover would otherwise be counted twice. With
 * the flag set, intervals are merged before they are summed: per-reason for the
 * ring buckets (a reason double-logged counts once), and as one union across ALL
 * reasons for the overall uptime figure. The live dashboard never passes the flag
 * and so is unaffected.
 */

import { toUTC, fromUTC } from '@/utils/timezoneUtils';

/** The canonical downtime reasons, split by the ring they belong to. */
export const MECHANICAL_REASONS = ['Maintenance', 'Relocation', 'Radar System Issue'];
export const USE_OF_REASONS = ['Connection', 'PMP Issue'];

const MS_PER_HOUR = 1000 * 60 * 60;

const emptyBuckets = (reasons) =>
  Object.fromEntries(reasons.map((r) => [r, { hours: 0, percentage: 0 }]));

const clampPct = (n) => Math.min(100, Math.max(0, n));

/**
 * Total span, in hours, covered by a set of `[startMs, endMs]` intervals with
 * overlaps merged away. Two intervals covering the same wall-clock time count
 * once. Empty in → 0. Used only on the mergeOverlaps path.
 */
function mergedHours(intervals) {
  if (!intervals || intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [curStart, curEnd] = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const [s, e] = sorted[i];
    if (s <= curEnd) {
      if (e > curEnd) curEnd = e;
    } else {
      total += curEnd - curStart;
      curStart = s;
      curEnd = e;
    }
  }
  total += curEnd - curStart;
  return total / MS_PER_HOUR;
}

/**
 * @param {Array<{from: string, to: string|null, reason: string}>} records
 * @param {Date|string|number} windowStart
 * @param {Date|string|number} windowEnd
 * @param {{ isOff?: boolean, mergeOverlaps?: boolean }} [opts]
 *   isOff forces every availability figure to 0, mirroring GaugeLive's `isOff`.
 *   mergeOverlaps merges overlapping intervals before summing (see file header);
 *   off by default so the live dashboard's numbers are unchanged.
 * @returns {{
 *   mechanical: Record<string, {hours: number, percentage: number}>,
 *   useOf: Record<string, {hours: number, percentage: number}>,
 *   windowHours: number,
 *   mechanicalHours: number,
 *   downtimeHours: number,
 *   availableHours: number,
 *   mechanicalAvailability: number,
 *   useOfAvailability: number,
 *   uptimePercentage: number,
 * }}
 */
export function computeAvailability(records, windowStart, windowEnd, opts = {}) {
  const startMs = new Date(windowStart).getTime();
  const endMs = new Date(windowEnd).getTime();

  const mechanical = emptyBuckets(MECHANICAL_REASONS);
  const useOf = emptyBuckets(USE_OF_REASONS);

  const windowHours =
    Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
      ? (endMs - startMs) / MS_PER_HOUR
      : 0;

  if (windowHours <= 0) {
    return {
      mechanical, useOf,
      windowHours: 0, mechanicalHours: 0, downtimeHours: 0, availableHours: 0,
      mechanicalAvailability: 0, useOfAvailability: 0, uptimePercentage: 0,
    };
  }

  // Clip every record to the window; drop unrecognised reasons (matching the
  // original). Keep the clipped `[start, end]` so the merge path can union them.
  const mergeOverlaps = Boolean(opts.mergeOverlaps);
  const clipped = [];
  for (const d of records ?? []) {
    const fromMs = new Date(d?.from).getTime();
    // A null `to` means the downtime is still open — it runs to the window end,
    // never to "now" (which may be outside the window for a historical report).
    const toMs = d?.to ? new Date(d.to).getTime() : endMs;
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) continue;

    const overlapStart = Math.max(fromMs, startMs);
    const overlapEnd = Math.min(toMs, endMs);
    if (overlapEnd <= overlapStart) continue;

    const reason = d?.reason;
    if (reason in mechanical || reason in useOf) {
      clipped.push({ reason, start: overlapStart, end: overlapEnd });
    }
  }

  if (mergeOverlaps) {
    // Per-reason: merge that reason's intervals, so an outage logged under two
    // wall folders during a changeover counts once toward its reason.
    const byReason = {};
    for (const c of clipped) (byReason[c.reason] ??= []).push([c.start, c.end]);
    for (const [reason, intervals] of Object.entries(byReason)) {
      const hours = mergedHours(intervals);
      if (reason in mechanical) mechanical[reason].hours = hours;
      else useOf[reason].hours = hours;
    }
  } else {
    // Original behaviour: every record contributes; overlaps are NOT merged.
    for (const c of clipped) {
      const hours = (c.end - c.start) / MS_PER_HOUR;
      if (c.reason in mechanical) mechanical[c.reason].hours += hours;
      else useOf[c.reason].hours += hours;
    }
  }

  const sumHours = (buckets) => Object.values(buckets).reduce((t, b) => t + b.hours, 0);
  const mechanicalHours = sumHours(mechanical);
  const useOfHours = sumHours(useOf);
  // Overall downtime drives the uptime figure. On the merge path it is the union
  // of ALL clipped intervals across every reason (double-logged or cross-reason
  // overlaps counted once); otherwise the inherited per-reason sum.
  const downtimeHours = mergeOverlaps
    ? mergedHours(clipped.map((c) => [c.start, c.end]))
    : mechanicalHours + useOfHours;
  const availableHours = windowHours - mechanicalHours;

  for (const b of Object.values(mechanical)) {
    b.percentage = clampPct((b.hours / windowHours) * 100);
  }
  const useOfDenominator = availableHours > 0 ? availableHours : windowHours;
  for (const b of Object.values(useOf)) {
    b.percentage = clampPct((b.hours / useOfDenominator) * 100);
  }

  const sumPct = (buckets) => Object.values(buckets).reduce((t, b) => t + b.percentage, 0);

  // The two gauge rings — each the complement of its own downtime share, over its
  // own denominator. Mirrors gaugelive.jsx.
  let mechanicalAvailability = clampPct(100 - sumPct(mechanical));
  let useOfAvailability = clampPct(100 - sumPct(useOf));

  // Overall uptime is derived from HOURS, not from the ring percentages: those
  // two use different denominators, so summing them would be meaningless.
  let uptimePercentage = clampPct(((windowHours - downtimeHours) / windowHours) * 100);

  if (opts.isOff) {
    mechanicalAvailability = 0;
    useOfAvailability = 0;
    uptimePercentage = 0;
  }

  return {
    mechanical,
    useOf,
    windowHours,
    mechanicalHours,
    downtimeHours,
    availableHours,
    mechanicalAvailability,
    useOfAvailability,
    uptimePercentage,
  };
}

/**
 * Reshape a computeAvailability() result into the `downtime` prop GaugeLive
 * expects, so the existing gauge renders unchanged.
 */
export function toGaugeShape(availability) {
  return {
    'Mechanical Availability': availability.mechanical,
    'Use of Availability': availability.useOf,
  };
}

/**
 * The report "day" boundary. A daily report opened in the morning is meant to
 * cover the PREVIOUS day up to this wall-clock time in the SITE's timezone, so
 * overnight downtime lands in the report the operator reads at ~05:00. This is
 * why a record that ran 2026-07-26 02:04→16:04 UTC belongs in the 2026-07-27
 * report, not the 2026-07-26 one.
 */
const REPORT_DAY_BOUNDARY = '05:00:00';

/**
 * The report window for a frequency. The START is anchored to REPORT_DAY_BOUNDARY
 * (05:00) in the site's IANA `timeZone`, spanning back 1 / 7 / 30 days from the
 * report day. `reportDay` is the report's calendar day as 'YYYY-MM-DD' (the form's
 * End Date); `now` is the moment the report is generated (injected for testing).
 *
 * The END depends on `now`, NOT on the 05:00 schedule — the schedule time is a
 * delivery concern that can change and must not drive the maths:
 *   - report day is TODAY or in the future → the period is still open, so the
 *     window ends at `now`. An in-progress / still-open (`to == null`) downtime is
 *     therefore counted up to the present, and never beyond it (no future
 *     over-counting).
 *   - report day is in the PAST → a closed period; the window ends at its fixed
 *     05:00 boundary so historical reports stay stable.
 *
 * So `daily` for 2026-07-27, generated that afternoon, covers 05:00 2026-07-26 →
 * now (site local) — it includes both yesterday and today's ongoing downtime.
 *
 * Boundaries go through toUTC()/fromUTC(), so the window is identical whether this
 * runs on a UTC server or a browser in any timezone.
 */
export function windowForFrequency(frequency, reportDay, timeZone = 'UTC', now = Date.now()) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const days = frequency === 'weekly' ? 7 : frequency === 'monthly' ? 30 : 1;

  const scheduledEndIso = reportDay ? toUTC(`${reportDay}T${REPORT_DAY_BOUNDARY}`, timeZone) : null;
  const scheduledEnd = scheduledEndIso ? new Date(scheduledEndIso).getTime() : nowMs;
  const windowStart = new Date(scheduledEnd - days * 24 * MS_PER_HOUR);

  // "Is this report day still open?" — compare the report day to today's date in
  // the site timezone. Lexical compare on 'YYYY-MM-DD' is chronological.
  const today = (fromUTC(new Date(nowMs).toISOString(), timeZone) || '').slice(0, 10);
  const isOpenPeriod = !reportDay || reportDay >= today;
  const windowEnd = new Date(isOpenPeriod ? nowMs : scheduledEnd);

  return { windowStart, windowEnd };
}
