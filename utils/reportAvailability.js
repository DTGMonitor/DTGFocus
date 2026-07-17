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
 */

/** The canonical downtime reasons, split by the ring they belong to. */
export const MECHANICAL_REASONS = ['Maintenance', 'Relocation', 'Radar System Issue'];
export const USE_OF_REASONS = ['Connection', 'PMP Issue'];

const MS_PER_HOUR = 1000 * 60 * 60;

const emptyBuckets = (reasons) =>
  Object.fromEntries(reasons.map((r) => [r, { hours: 0, percentage: 0 }]));

const clampPct = (n) => Math.min(100, Math.max(0, n));

/**
 * @param {Array<{from: string, to: string|null, reason: string}>} records
 * @param {Date|string|number} windowStart
 * @param {Date|string|number} windowEnd
 * @param {{ isOff?: boolean }} [opts]  isOff forces every availability figure to 0,
 *                                      mirroring GaugeLive's `isOff` behaviour.
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

  // Clip every record to the window and accumulate hours per reason.
  for (const d of records ?? []) {
    const fromMs = new Date(d?.from).getTime();
    // A null `to` means the downtime is still open — it runs to the window end,
    // never to "now" (which may be outside the window for a historical report).
    const toMs = d?.to ? new Date(d.to).getTime() : endMs;
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) continue;

    const overlapStart = Math.max(fromMs, startMs);
    const overlapEnd = Math.min(toMs, endMs);
    const overlapMs = Math.max(0, overlapEnd - overlapStart);
    if (overlapMs === 0) continue;

    const hours = overlapMs / MS_PER_HOUR;
    const reason = d?.reason;
    if (reason in mechanical) mechanical[reason].hours += hours;
    else if (reason in useOf) useOf[reason].hours += hours;
    // Unrecognised reasons are ignored, matching the original.
  }

  const sumHours = (buckets) => Object.values(buckets).reduce((t, b) => t + b.hours, 0);
  const mechanicalHours = sumHours(mechanical);
  const useOfHours = sumHours(useOf);
  const downtimeHours = mechanicalHours + useOfHours;
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
 * The report window for a frequency. `daily` → 24h, `weekly` → 7d, `monthly` → 30d,
 * each ending at `endDate`.
 */
export function windowForFrequency(frequency, endDate = new Date()) {
  const end = new Date(endDate);
  const days = frequency === 'weekly' ? 7 : frequency === 'monthly' ? 30 : 1;
  const start = new Date(end.getTime() - days * 24 * MS_PER_HOUR);
  return { windowStart: start, windowEnd: end };
}
