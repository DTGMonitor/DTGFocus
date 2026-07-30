// utils/checklistCarryOver.ts
//
// Which wall folder a radar's hourly checklist carries over from.
//
// A radar accrues wall folders over time. When it is re-aimed the old folder is
// archived (`type = 'Archive'`, `decommissioned_at` stamped) and a new one is
// commenced — see utils/reportWallFolders.js for the same shape read by the
// report. The monitoring board keys checklists by wall folder, so the moment the
// change lands the new folder has no record for the day and the row goes blank:
// a shift's worth of ticks made minutes earlier looks lost, and because those
// hours have passed the gate will not let them be entered again.
//
// So a folder with no record of its own for a date carries the retired folder's
// record for THAT SAME DATE. The date scope is what keeps this from reopening the
// old bug of a day inheriting some other day's ticks.
//
// Only archived folders are carried from. Two folders live at once are two rows
// on the board, each verified separately; letting one read the other's checklist
// would report one radar's work as two.

import { toChecks } from './checklistDay';

/** The columns of `radar_wall_folders` this needs. */
export interface FolderLike {
    id: number;
    radar_id: number;
    type?: string | null;
    commenced_at?: string | null;
    decommissioned_at?: string | null;
}

const isArchived = (folder: FolderLike): boolean =>
    String(folder?.type ?? '').toLowerCase() === 'archive';

/** When a folder stopped being the live one; unknown sorts last. */
const retiredAt = (folder: FolderLike): number => {
    const stamp = Date.parse(folder?.decommissioned_at || folder?.commenced_at || '');
    return Number.isFinite(stamp) ? stamp : -Infinity;
};

/**
 * The folders a radar's current one may carry a checklist from, most recently
 * retired first — so a radar re-aimed twice reads the folder it just left, not
 * one from a month ago.
 */
export const predecessorFolderIds = (
    folders: FolderLike[],
    radarId: number,
    currentFolderId: number
): number[] =>
    (folders || [])
        .filter((f) => f && f.radar_id === radarId && f.id !== currentFolderId && isArchived(f))
        .sort((a, b) => retiredAt(b) - retiredAt(a))
        .map((f) => f.id);

/**
 * The checklist to show and to build on when a folder has no record of its own
 * for a date. `checksByFolder` holds that ONE date's records, keyed by folder.
 *
 * Null when nothing carries — the caller must be able to tell "no ticks" from
 * "nothing recorded", which is what lets a reset skip a date it would otherwise
 * create an empty record for.
 */
export const carriedChecks = (
    predecessors: number[],
    checksByFolder: Map<number, boolean[] | null | undefined>
): boolean[] | null => {
    for (const id of predecessors) {
        if (checksByFolder.has(id)) return toChecks(checksByFolder.get(id));
    }
    return null;
};
