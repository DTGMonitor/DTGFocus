/**
 * Pure helpers for wall-folder-change handling in the Comprehensive report.
 *
 * A radar accrues many wall folders over time — rows in `radar_wall_folders`
 * sharing one `radar_id`. When the radar is re-aimed the old folder is archived
 * (`type = 'Archive'`, `decommissioned_at` stamped) and a new one is commenced.
 * The live report only ever sees the current folder, so anything recorded under
 * a now-archived folder within the window is invisible.
 *
 * Deformation and alarm data are LOCATION-specific, so records from different
 * folders are kept ATTRIBUTED to their folder rather than silently merged; only
 * downtime (a property of the radar hardware) is unioned across folders — that
 * happens in reportAvailability via `mergeOverlaps`, not here.
 *
 * Everything in this module is pure so the grouping and window-gating can be
 * unit-tested without React or Supabase.
 */

const toMs = (v) => new Date(v).getTime();

/**
 * The key that clusters folders into one "location" section. Prefers the explicit
 * `location_group`; falls back through `area` → `name` → id so a null column can
 * never collapse unrelated folders into a single bucket.
 * @param {{location_group?: string, area?: string, name?: string, id?: number|string}} folder
 */
export function folderGroupKey(folder) {
  if (!folder) return '—';
  return (
    folder.location_group ||
    folder.area ||
    folder.name ||
    (folder.id != null ? `folder-${folder.id}` : '—')
  );
}

/** Whether a folder is archived (retired) rather than the current live one. */
export function isArchivedFolder(folder) {
  return String(folder?.type ?? '').toLowerCase() === 'archive';
}

/**
 * A short human label for a folder in the report — its name, with the area in
 * parentheses when the area adds information the name does not already carry.
 */
export function folderDisplayLabel(folder) {
  const name = (folder?.name ?? '').trim();
  const area = (folder?.area ?? '').trim();
  if (name && area && area.toLowerCase() !== name.toLowerCase()) return `${name} (${area})`;
  return name || area || 'Unnamed wall folder';
}

/** Is this record's `created_at` inside [windowStart, windowEnd] (inclusive)? */
export function nodeInWindow(node, windowStart, windowEnd) {
  const t = toMs(node?.created_at);
  const s = toMs(windowStart);
  const e = toMs(windowEnd);
  return Number.isFinite(t) && Number.isFinite(s) && Number.isFinite(e) && t >= s && t <= e;
}

/** Does any node in a resolved chain fall inside the window? */
export function chainInWindow(chain, windowStart, windowEnd) {
  return (chain ?? []).some((n) => nodeInWindow(n, windowStart, windowEnd));
}

/**
 * Should a resolved deformation chain be kept in the report?
 *
 * The CURRENT folder always contributes its active chains — unchanged behaviour,
 * so a report on a radar that never changed folders looks exactly as before. An
 * ARCHIVED folder contributes a chain ONLY when that chain has activity inside
 * the report window; otherwise old, unrelated history would resurface every time.
 *
 * @param {{isCurrent: boolean, chain: object[], windowStart: any, windowEnd: any}} arg
 */
export function shouldIncludeChain({ isCurrent, chain, windowStart, windowEnd }) {
  if (isCurrent) return true;
  return chainInWindow(chain, windowStart, windowEnd);
}

/**
 * Group folder-tagged timelines into an ordered, per-folder structure for the
 * report. Each input timeline carries `folder` (metadata) and `isCurrent`.
 *
 * Ordering keeps the reader oriented: the current folder first, then the rest
 * clustered so folders sharing a `location_group` sit together (same wall, a
 * rename), archived folders within a cluster ordered newest-commenced first.
 *
 * @param {Array<{folder: object|null, isCurrent: boolean, trimmed: object[]}>} timelines
 * @param {number|string|null} currentFolderId
 * @returns {Array<{ folderId: any, folder: object|null, isCurrent: boolean,
 *   isArchived: boolean, groupKey: string, timelines: object[] }>}
 */
export function groupTimelinesByFolder(timelines = [], currentFolderId = null) {
  const byFolder = new Map();
  for (const t of timelines) {
    const fid = t.folder?.id ?? t.folder?.wallfolder_id ?? '—';
    if (!byFolder.has(fid)) {
      byFolder.set(fid, {
        folderId: fid,
        folder: t.folder ?? null,
        isCurrent: Boolean(t.isCurrent) || fid === currentFolderId,
        isArchived: isArchivedFolder(t.folder),
        groupKey: folderGroupKey(t.folder),
        timelines: [],
      });
    }
    byFolder.get(fid).timelines.push(t);
  }

  const groups = [...byFolder.values()];

  // The current folder's location cluster leads; everything else follows,
  // clustered by groupKey. Within equal rank, most-recently-commenced first.
  const currentGroupKey = groups.find((g) => g.isCurrent)?.groupKey ?? null;
  const commencedMs = (g) => {
    const ms = toMs(g.folder?.commenced_at);
    return Number.isFinite(ms) ? ms : -Infinity;
  };

  return groups.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    const aInCurrent = a.groupKey === currentGroupKey;
    const bInCurrent = b.groupKey === currentGroupKey;
    if (aInCurrent !== bInCurrent) return aInCurrent ? -1 : 1;
    if (a.groupKey !== b.groupKey) return String(a.groupKey).localeCompare(String(b.groupKey));
    return commencedMs(b) - commencedMs(a);
  });
}

/**
 * Did a folder change take effect inside the window? True when any folder
 * commenced or was decommissioned within [windowStart, windowEnd].
 */
export function folderChangedInWindow(folders = [], windowStart, windowEnd) {
  const s = toMs(windowStart);
  const e = toMs(windowEnd);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return false;
  const inWin = (v) => {
    const t = toMs(v);
    return Number.isFinite(t) && t >= s && t <= e;
  };
  return folders.some((f) => inWin(f?.commenced_at) || inWin(f?.decommissioned_at));
}
