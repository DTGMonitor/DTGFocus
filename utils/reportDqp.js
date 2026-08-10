/**
 * Data-quality grouping for radar reports.
 *
 * Mirrors the two-pass grouping in components/admin/Reports/RadarReportTemplates.jsx
 * (parent status map → group children), but works on the raw dqp_values shape
 * with an embedded `parameters` join rather than SensorDetail's pre-nested
 * `item.parameter` shape.
 *
 * Pure: no React, no Supabase.
 */

import { normaliseDqpImages } from './dqpImages';

/** Parameter id 26 is excluded from the printed table (inherited from RadarTemplate). */
const EXCLUDED_PARAMETER_IDS = new Set([26]);

/**
 * A row's figures, whether the caller already resolved them or not.
 *
 * `attachDqpImages()` puts a resolved `images` array on the row; a hand-built
 * test row or a legacy single-image row has only `image`/`caption`. Falling back
 * to `normaliseDqpImages` keeps this module usable on an unresolved row —
 * without storage paths, but with the right count and captions, which is what
 * the figure numbering below depends on.
 */
function rowImages(r) {
  if (Array.isArray(r?.images)) return r.images;
  return normaliseDqpImages(r).map((p) => ({ ...p, image_url: null }));
}

const isNonOptimal = (value) =>
  value !== 'Optimal' && value !== 'N/A' && value !== null && value !== undefined && String(value).trim() !== '';

/**
 * Group level-2 rows under their level-1 parents.
 *
 * @param {Array} rows dqp_values rows with `parameters: {id,name,level,parent_id}`.
 * @returns {{id: number, name: string, status: string, items: object[]}[]} sorted by parent id.
 */
export function buildDqpGroups(rows) {
  const list = Array.isArray(rows) ? rows : [];

  // Pass 1 — parent (level 1) status and names by id.
  const parentStatus = {};
  const parentName = {};
  for (const r of list) {
    const p = r?.parameters;
    if (!p) continue;
    if (p.level === 1) {
      parentStatus[p.id] = r.value;
      parentName[p.id] = p.name;
    }
  }

  // Pass 2 — group the children.
  const groups = {};
  for (const r of list) {
    const p = r?.parameters;
    if (!p) continue;
    if (p.level === 0 || p.level === 1) continue;
    if (EXCLUDED_PARAMETER_IDS.has(p.id)) continue;

    const groupId = p.parent_id ?? 0;
    if (!groups[groupId]) {
      groups[groupId] = {
        id: groupId,
        name: parentName[groupId] ?? 'General',
        status: parentStatus[groupId],
        items: [],
      };
    }
    groups[groupId].items.push({
      id: p.id,
      name: p.name,
      value: r.value,
      notes: r.notes,
      appendix: r.appendix,
      images: rowImages(r),
    });
  }

  return Object.values(groups)
    .sort((a, b) => a.id - b.id)
    .map((g) => ({ ...g, items: g.items.sort((a, b) => a.id - b.id) }));
}

/**
 * EVERY group, flagged optimal or not, failures first (Requirement 5.2).
 *
 * Each group is kept whole, never trimmed to its offending children: the printed
 * chips show every sub-parameter's status, which is what makes a "Sub-Optimal"
 * verdict legible — you can see which of the four sub-parameters caused it.
 *
 * All groups print, not just the failing ones. The radar chart plots one axis
 * per group, so a table listing only failures left the reader to reconstruct the
 * passing axes from a 220px chart — and the dead space that cost was the
 * section's most visible flaw. The render layer collapses optimal groups to a
 * single line, so completeness is nearly free.
 *
 * Failures sort first because they are what the reader came for. `id` is the
 * explicit tie-break rather than a reliance on sort stability, so within each
 * partition the row order still matches the chart's axis order.
 */
export function buildStatusGroups(rows) {
  return buildDqpGroups(rows)
    .map((g) => ({ ...g, isOptimal: !g.items.some((i) => isNonOptimal(i.value)) }))
    .sort((a, b) => Number(a.isOptimal) - Number(b.isOptimal) || a.id - b.id);
}

/** The flat list of non-optimal level-2 rows (RadarTemplate's `nonOptimalParams`). */
export function listNonOptimalParams(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list.filter((r) => {
    const p = r?.parameters;
    if (!p) return false;
    if (p.level === 0 || p.level === 1) return false;
    return isNonOptimal(r.value);
  });
}

/**
 * Appendix items: rows with notes AND (at least one image or appendix text),
 * sorted by parameter id, lettered A, B, C… (Requirement 9.3/9.4).
 *
 * A row can carry several figures, so figure numbers run across the whole
 * appendix rather than per item: item A with two images takes Figures 1 and 2,
 * and item B starts at 3. `item.figure` is the item's FIRST figure number — the
 * renderer numbers each image `item.figure + index`. Keeping it a single number
 * is what lets the template shift the whole appendix by `figureOffset` when the
 * deformation image claims Figure 1.
 *
 * An item that is appendix prose only consumes no figure numbers.
 */
export function buildAppendixItems(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let figure = 1;
  return list
    .map((r) => ({ row: r, images: rowImages(r) }))
    .filter(({ row, images }) => row?.notes && (images.length || row.appendix))
    .sort((a, b) => (a.row.parameters?.id ?? 0) - (b.row.parameters?.id ?? 0))
    .map(({ row, images }, i) => {
      const first = figure;
      figure += images.length;
      return {
        letter: String.fromCharCode(65 + i),
        figure: first,
        name: row.parameters?.name ?? '',
        parameterId: row.parameters?.id ?? null,
        notes: row.notes,
        appendix: row.appendix,
        // `imageUrl` on each entry is filled in by the caller once the storage
        // path is signed and inlined as a data URL.
        images: images.map((img) => ({
          id: img.id,
          caption: img.caption ?? '',
          image_url: img.image_url ?? null,
          imageUrl: null,
        })),
      };
    });
}

/**
 * The parenthetical the daily report prints after its quality label —
 * "Acceptable (Latency issue)".
 *
 * Built from the NOTES the analyst wrote against each non-optimal parameter,
 * not from the parameter names: "Latency issue" is what the DQP row says, and
 * it is the sentence a client can act on. A row with no note contributes its
 * parameter name instead, so a downgrade is never left unexplained.
 *
 * Deduplicated, case-insensitively — several parameters commonly share one
 * cause, and "Latency issue; Latency issue" reads as two separate faults.
 */
export function buildQualityNote(rows) {
  const seen = new Set();
  const parts = [];
  for (const row of listNonOptimalParams(rows)) {
    const text = String(row?.notes ?? '').trim() || String(row?.parameters?.name ?? '').trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(text);
  }
  return parts.join('; ');
}

/** The overall (level 0) status, or null. Callers must tolerate null. */
export function findOverallStatus(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list.find((r) => r?.parameters?.level === 0)?.value ?? null;
}

export { isNonOptimal };
