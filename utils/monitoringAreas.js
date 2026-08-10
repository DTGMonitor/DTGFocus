/**
 * The monitoring-point roster, across a wall folder rotation.
 *
 * The roster is keyed by WALL FOLDER, because that is how `def_records.location`
 * is scoped and a radar re-aimed at a new wall is monitoring different points.
 * The common case, though, is not a new wall at all — it is the same wall
 * re-scanned under a new folder, and there the points are unchanged. Without a
 * carry-over a PS radar would silently lose its whole board at every rotation
 * and print an empty table the next morning, which is the exact failure the
 * roster exists to prevent.
 *
 * Deliberately client-side rather than inside `create_wall_folder_with_defaults`:
 * the RPC is shared by every radar and predates this feature, and a copy that
 * lives here can be read, tested and changed with the code that depends on it.
 *
 * Pure of React and of the module-level Supabase client — the client is passed
 * in — so both functions can be unit-tested against a stub.
 */

import { areaKey } from './dailyStatusRows';

/**
 * The id of the folder `create_wall_folder_with_defaults` just made.
 *
 * The RPC's return value is used when it is a plain id, which is what it
 * returns today. It is not TRUSTED to be: this runs right after a successful
 * creation, so falling back to "the newest folder of this radar with this name"
 * resolves the same row, and a future RPC that returns a row or nothing at all
 * cannot silently strand the roster on the old folder.
 *
 * @returns {Promise<number|string|null>} null when nothing matches.
 */
export async function resolveCreatedFolderId(client, rpcResult, radarId, folderName) {
  const direct =
    typeof rpcResult === 'number' || typeof rpcResult === 'string'
      ? rpcResult
      : rpcResult?.id ?? (Array.isArray(rpcResult) ? rpcResult[0]?.id : null);
  if (direct !== null && direct !== undefined && direct !== '') return direct;

  if (!radarId || !folderName) return null;
  const { data, error } = await client
    .from('radar_wall_folders')
    .select('id')
    .eq('radar_id', radarId)
    .eq('name', folderName)
    .order('id', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0]?.id ?? null;
}

/**
 * Copy a wall folder's active roster onto another folder.
 *
 * Only the ACTIVE points travel: a point retired on the old wall is not one the
 * new report should start printing again. `sort_order` is carried verbatim so
 * the client keeps reading their board in the order they know it.
 *
 * A folder that already has a roster is left alone rather than merged into —
 * the operator has already said what this wall monitors, and the unique index
 * would reject half the insert anyway, leaving a half-copied board.
 *
 * @returns {Promise<number>} How many points were carried over.
 */
export async function copyAreaRoster(client, fromWallFolderId, toWallFolderId) {
  if (!fromWallFolderId || !toWallFolderId) return 0;
  if (String(fromWallFolderId) === String(toWallFolderId)) return 0;

  const { data: existing, error: existingError } = await client
    .from('monitoring_areas')
    .select('id')
    .eq('wallfolder_id', toWallFolderId)
    .limit(1);
  if (existingError) throw existingError;
  if (existing?.length) return 0;

  const { data, error } = await client
    .from('monitoring_areas')
    .select('name, sort_order')
    .eq('wallfolder_id', fromWallFolderId)
    .eq('isactive', 'Yes')
    .order('sort_order', { ascending: true });
  if (error) throw error;

  const rows = (data ?? [])
    .filter((area) => String(area?.name ?? '').trim())
    .map((area, i) => ({
      wallfolder_id: toWallFolderId,
      name: String(area.name).trim(),
      sort_order: Number.isFinite(Number(area?.sort_order)) ? Number(area.sort_order) : i + 1,
    }));
  if (rows.length === 0) return 0;

  const { error: insertError } = await client.from('monitoring_areas').insert(rows);
  if (insertError) throw insertError;
  return rows.length;
}

// ---------------------------------------------------------------------------
// Editing a board
//
// Pure, so the panel's reordering can be reasoned about without a database.
// ---------------------------------------------------------------------------

/**
 * Is `name` already on the board?
 *
 * Asked on the same key the report matches areas by and the table's unique
 * index enforces, so the answer here and the answer Postgres would give cannot
 * differ — the operator is told "already listed" instead of being handed a
 * constraint violation.
 *
 * @param {number|string} exceptId  The row being renamed, which is allowed to
 *   keep its own name.
 */
export const isDuplicateArea = (list, name, exceptId = null) => {
  const key = areaKey(name);
  if (!key) return false;
  return (list ?? []).some(
    (area) => areaKey(area?.name) === key && String(area?.id) !== String(exceptId)
  );
};

/**
 * Move one point up or down the board.
 *
 * Renumbers `sort_order` across the whole list rather than swapping two values.
 * A board seeded from free-typed history can arrive with ties and gaps, and
 * swapping two equal numbers is a move that appears to do nothing; renumbering
 * makes the printed order well defined from the first edit onwards.
 *
 * Out-of-range moves return the list unchanged, so the first row's "up" button
 * is a no-op rather than an error.
 */
export function moveArea(list, index, delta) {
  const items = [...(list ?? [])];
  const target = index + delta;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items;

  const [moved] = items.splice(index, 1);
  items.splice(target, 0, moved);
  return items.map((area, i) => ({ ...area, sort_order: i + 1 }));
}

/**
 * The rows whose `sort_order` actually moved — one UPDATE each, and none for
 * the rows a move did not touch.
 */
export const sortOrderUpdates = (before, next) => {
  const was = new Map((before ?? []).map((area) => [String(area?.id), area?.sort_order]));
  return (next ?? [])
    .filter((area) => was.get(String(area?.id)) !== area?.sort_order)
    .map((area) => ({ id: area.id, sort_order: area.sort_order }));
};

export default copyAreaRoster;
