/**
 * Parameter-tree construction for radar data-quality records.
 *
 * Extracted from components/Radars/Live/RadarGallery.jsx, where it was inlined
 * in the fetch effect and therefore unusable anywhere else. `buildRadarData()`
 * (the radar/spider chart) needs this tree, so the report needs it too.
 *
 * Pure: no React, no Supabase.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INHERITED BUG — PRESERVED DELIBERATELY. Do not "fix" here.
 *
 * Level-0/1 entries are keyed by the raw parameter name ("System Health"), while
 * level-2 rows look their parent up with the spaces stripped ("SystemHealth").
 * Those keys never match, so every multi-word parent gets a DUPLICATE
 * placeholder entry holding the children, alongside the real entry holding the
 * value.
 *
 * Downstream code has adapted to this split:
 *   - buildRadarData() reads the spaced key   → gets the real value.
 *   - RadarDetail.getIssues() walks .children → reads the placeholder.
 *
 * Fixing the keying would silently change what the live gallery renders, so it
 * is out of scope here and tracked as a separate ticket. This function is a
 * behaviour-preserving move, nothing more.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Pivot flat dqp_values rows into a nested parameter tree.
 *
 * @param {Array<{value: string, notes: string, appendix: any,
 *                images?: {id: number, caption: string, image_url: string}[],
 *                parameters: {id: number, name: string, level: number, parent_id: number}}>} rows
 *   `images` is what attachDqpImages() leaves on the row; absent on an
 *   unresolved row, which pivots to an empty list rather than throwing.
 * @returns {{ parameters: Record<string, object>, emptyChildren: object[] }}
 */
export function pivotParameterTree(rows) {
  const list = Array.isArray(rows) ? rows : [];

  // Parameter metadata by id, for parent lookups.
  const metaById = {};
  list.forEach((r) => {
    const p = r?.parameters;
    if (!p) return;
    metaById[p.id] = metaById[p.id] || { id: p.id, name: p.name, level: p.level, parent_id: p.parent_id };
  });

  const paramsByKey = {};
  const emptyChildren = [];

  // Level 0 / 1 entries.
  list.forEach((r) => {
    const p = r?.parameters;
    if (!p) return;
    if (p.level === 0 || p.level === 1) {
      const key = p.name;
      if (!paramsByKey[key]) {
        paramsByKey[key] = {
          id: p.id,
          name: p.name,
          value: r.value || '',
          comments: r.notes || '',
          level: p.level,
          children: p.level === 1 ? [] : undefined,
        };
      }
      // Prefer non-empty values if multiple rows exist.
      if (!paramsByKey[key].value && r.value) paramsByKey[key].value = r.value;
      if (!paramsByKey[key].comments && r.notes) paramsByKey[key].comments = r.notes;
    }
  });

  // Level 2 rows (children). Missing parent → placeholder, so children survive.
  list.forEach((r) => {
    const p = r?.parameters;
    if (!p) return;
    if (p.level === 2) {
      const parentMeta = metaById[p.parent_id];
      const parentKey = parentMeta ? parentMeta.name.replace(/\s+/g, '') : `Parent_${p.parent_id}`;

      if (!paramsByKey[parentKey]) {
        paramsByKey[parentKey] = {
          id: parentMeta?.id || p.parent_id,
          name: parentMeta?.name || `Unknown (${p.parent_id})`,
          value: '',
          comments: '',
          level: 1,
          children: [],
        };
      }

      paramsByKey[parentKey].children.push({
        id: p.id,
        name: p.name,
        value: r.value || '',
        comments: r.notes || '',
        appendix: r.appendix || null,
        images: Array.isArray(r.images) ? r.images : [],
        level: 2,
        parent_id: p.parent_id,
      });

      if (!r.value) {
        emptyChildren.push({ id: p.id, name: p.name, parent_id: p.parent_id });
      }
    }
  });

  return { parameters: paramsByKey, emptyChildren };
}

/**
 * Build the minimal `record` shape `buildRadarData()` consumes.
 *
 * buildRadarData reads exactly three things: `record.radar` (to drop the Visual
 * Data axis on XT units), `record.brand` (to drop Photograph on non-GroundProbe
 * units), and `record.parameters`. Anything else the live gallery attaches is
 * gallery-specific and deliberately not reproduced here.
 *
 * @param {{ radar_number: string, brand: string }} wallFolderRow
 * @param {Array} dqpRows  Raw dqp_values rows with an embedded `parameters` join.
 * @returns {{ radar: string, brand: string, parameters: object, emptyChildren: object[] }}
 */
export function buildRadarRecord(wallFolderRow, dqpRows) {
  const { parameters, emptyChildren } = pivotParameterTree(dqpRows);
  return {
    radar: wallFolderRow?.radar_number ?? '',
    brand: wallFolderRow?.brand ?? '',
    parameters,
    emptyChildren,
  };
}
