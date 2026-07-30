/**
 * What a re-aimed radar's checklist carries over from.
 *
 * The board keys hourly checks by wall folder. When a radar is re-aimed the old
 * folder is archived and a new one commenced, so the new folder had no record for
 * the day and the row went blank mid-shift — with the hours already passed and
 * the gate closed on them, that work could not be entered again.
 */

import { predecessorFolderIds, carriedChecks } from '../utils/checklistCarryOver';
import { blankChecks, toChecks } from '../utils/checklistDay';

const folder = (id, radar_id, type, decommissioned_at = null, commenced_at = null) =>
    ({ id, radar_id, type, decommissioned_at, commenced_at });

/** 07:00..13:00 ticked — a shift interrupted by a folder change at 14:00. */
const halfADay = () => {
    const checks = blankChecks();
    for (let h = 7; h <= 13; h++) checks[h] = true;
    return checks;
};

describe('which folder a checklist carries from', () => {
    it('reads the folder the radar just retired', () => {
        const folders = [
            folder(9, 1, 'Live'),
            folder(8, 1, 'Archive', '2026-07-30T07:00:00Z')
        ];

        expect(predecessorFolderIds(folders, 1, 9)).toEqual([8]);
    });

    it('prefers the most recently retired of several', () => {
        const folders = [
            folder(9, 1, 'Live'),
            folder(8, 1, 'Archive', '2026-07-30T07:00:00Z'),
            folder(5, 1, 'Archive', '2026-02-01T07:00:00Z'),
            folder(6, 1, 'Archive', '2026-05-01T07:00:00Z')
        ];

        expect(predecessorFolderIds(folders, 1, 9)).toEqual([8, 6, 5]);
    });

    it('falls back to when a folder commenced if it was never stamped', () => {
        const folders = [
            folder(9, 1, 'Live'),
            folder(8, 1, 'Archive', null, '2026-06-01T00:00:00Z'),
            folder(7, 1, 'Archive', null, '2026-01-01T00:00:00Z'),
            folder(4, 1, 'Archive') // no stamp at all — last, not first
        ];

        expect(predecessorFolderIds(folders, 1, 9)).toEqual([8, 7, 4]);
    });

    it('never reads another radar\'s folder', () => {
        const folders = [
            folder(9, 1, 'Live'),
            folder(8, 2, 'Archive', '2026-07-30T07:00:00Z')
        ];

        expect(predecessorFolderIds(folders, 1, 9)).toEqual([]);
    });

    it('never reads a folder that is still live', () => {
        // Two live folders are two rows on the board, each verified on its own.
        // Sharing one checklist would report one radar's work as two.
        const folders = [
            folder(9, 1, 'Live'),
            folder(10, 1, 'Live')
        ];

        expect(predecessorFolderIds(folders, 1, 9)).toEqual([]);
        expect(predecessorFolderIds(folders, 1, 10)).toEqual([]);
    });

    it('does not read itself', () => {
        expect(predecessorFolderIds([folder(9, 1, 'Archive')], 1, 9)).toEqual([]);
    });

    it('survives a missing or malformed folder list', () => {
        expect(predecessorFolderIds(undefined, 1, 9)).toEqual([]);
        expect(predecessorFolderIds([null, folder(9, 1, 'Live')], 1, 9)).toEqual([]);
        expect(predecessorFolderIds([{ id: 8, radar_id: 1 }], 1, 9)).toEqual([]);
    });
});

describe('the checklist a new folder carries', () => {
    it('brings the interrupted shift across the change', () => {
        const carried = carriedChecks([8], new Map([[8, halfADay()]]));

        expect(carried).toEqual(halfADay());
    });

    it('takes the first predecessor that has a record for the date', () => {
        const older = blankChecks();
        older[7] = true;

        // Folder 8 was retired most recently but logged nothing that day.
        const carried = carriedChecks([8, 6], new Map([[6, older]]));

        expect(carried[7]).toBe(true);
        expect(carried.filter(Boolean)).toHaveLength(1);
    });

    it('reports nothing recorded as null, not as a blank day', () => {
        // The distinction is what lets a reset skip a date rather than create an
        // empty record for it.
        expect(carriedChecks([8], new Map())).toBeNull();
        expect(carriedChecks([], new Map([[8, halfADay()]]))).toBeNull();
    });

    it('treats a recorded but empty checklist as a real record', () => {
        expect(carriedChecks([8], new Map([[8, null]]))).toEqual(blankChecks());
    });

    it('coerces whatever was stored into 24 hours', () => {
        expect(carriedChecks([8], new Map([[8, [true, false]]]))).toEqual(toChecks([true, false]));
    });
});
