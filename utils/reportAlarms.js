/**
 * Alarm aggregation for radar reports.
 *
 * Pure: no React, no Supabase, no clock access.
 *
 * The KPI tile's valid/total counts are derived from the SAME record set as the
 * cause pie (countValidTotal + aggregateAlarmCauses over one 24h query), rather
 * than from the `get_alarm_stats_by_shift` RPC the live UI uses. Two reasons:
 * the RPC is shift-scoped while the pie is 24h-scoped, so the tile and the chart
 * could legitimately disagree on the same page; and the RPC hardcodes
 * `_user_timezone: 'Asia/Jakarta'`, ignoring the sensor's own timezone.
 */

/**
 * Group alarm records by `cause`.
 *
 * Unknown causes (outside CAUSE_OPTIONS) are kept, not dropped — a cause the
 * taxonomy hasn't caught up with is still a real alarm, and silently discarding
 * it would make the percentages lie. Records with no cause are bucketed under
 * "Uncategorised".
 *
 * @param {Array<{cause?: string}>} records
 * @returns {Array<{cause: string, count: number, percentage: number}>} desc by count.
 */
export function aggregateAlarmCauses(records) {
  const list = Array.isArray(records) ? records : [];
  const total = list.length;
  if (total === 0) return [];

  const counts = new Map();
  for (const r of list) {
    const cause = (r?.cause ?? '').trim() || 'Uncategorised';
    counts.set(cause, (counts.get(cause) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([cause, count]) => ({ cause, count, percentage: (count / total) * 100 }))
    .sort((a, b) => b.count - a.count || a.cause.localeCompare(b.cause));
}

/**
 * Valid / total alarm counts over a record set.
 * `reason` is 'Valid' | 'False'; anything else counts toward the total only.
 *
 * @param {Array<{reason?: string}>} records
 * @returns {{ valid: number, total: number }}
 */
export function countValidTotal(records) {
  const list = Array.isArray(records) ? records : [];
  return {
    valid: list.filter((r) => r?.reason === 'Valid').length,
    total: list.length,
  };
}

/**
 * Alarm severity ranking, worst first. These are `alarm_regions.alarmtype`
 * values — the column stores a colour name, not a severity word.
 */
export const ALARM_HIERARCHY = ['red', 'orange', 'yellow', 'blue', 'purple'];

/**
 * The tone that represents a whole alarm set on the KPI tile / findings dot.
 *
 * An alarm's severity lives on its REGION (`alarm_regions.alarmtype`), not on
 * the record, so the region list has to be joined in here — alarm_records has
 * no severity column of its own.
 *
 * Only VALID alarms drive the colour. A false alarm is a non-event; letting one
 * paint the tile red would report a hazard the site does not have.
 *
 * @param {Array<{reason?: string, alarm_region?: string}>} records
 * @param {Array<{id: string, alarmtype?: string}>} regions
 * @returns {'none'|'false'|'unknown'|'red'|'orange'|'yellow'|'blue'|'purple'}
 */
export function deriveAlarmTone(records, regions = []) {
  const list = Array.isArray(records) ? records : [];
  if (list.length === 0) return 'none';

  const valid = list.filter((r) => r?.reason === 'Valid');
  if (valid.length === 0) {
    // Strictly all-false is the green case. Anything still unassessed is not a
    // clean bill of health, so it stays neutral rather than claiming green.
    return list.every((r) => r?.reason === 'False') ? 'false' : 'unknown';
  }

  const typeByRegion = new Map(
    (regions ?? []).map((g) => [String(g?.id), String(g?.alarmtype ?? '').toLowerCase()])
  );

  let best = -1;
  for (const r of valid) {
    const rank = ALARM_HIERARCHY.indexOf(typeByRegion.get(String(r?.alarm_region)));
    if (rank === -1) continue; // Unrecognised alarmtype — cannot be ranked.
    if (best === -1 || rank < best) best = rank;
  }

  // Valid alarms exist but none carry a rankable type: say so rather than
  // guessing a severity the data does not support.
  return best === -1 ? 'unknown' : ALARM_HIERARCHY[best];
}
