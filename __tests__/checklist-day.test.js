/**
 * Which day an hourly check belongs to, and what that day may contain.
 *
 * The grid is the operator's clock: the 08:00 column is 08:00 where they sit,
 * and the row is filed under their calendar day. Instants stored alongside it
 * (`created_time`) are UTC.
 *
 * Covers both halves of the failure behind Hidden Valley's stuck checklist:
 *   1. the day — a hard-coded UTC+7 disagreed with the browser clock the slots
 *      were drawn from, so checks could land on the wrong date
 *   2. the empty day — a day with no record starts blank instead of inheriting
 *      the ticks of whatever record the view happened to return
 */

// The operator's clock here is Asia/Jakarta (UTC+7), pinned in jest.config.js —
// a test file's own process.env.TZ lands too late for the test environment.

import {
    blankChecks,
    toChecks,
    localRecordDate,
    localClock,
    nextChecks
} from '../utils/checklistDay';

/** Indices 7..18 ticked — a full day shift, the state HV rows were stuck in. */
const fullDayShift = () => {
    const checks = blankChecks();
    for (let h = 7; h <= 18; h++) checks[h] = true;
    return checks;
};

describe("the operator's day", () => {
    it('files a check under the local date, not the UTC date', () => {
        // 22:00 in Jakarta on the 28th is already the 29th in UTC. The row
        // belongs to the day the operator is working, the 28th.
        const instant = new Date('2026-07-28T15:00:00Z');

        expect(localRecordDate(instant)).toBe('2026-07-28');
        expect(instant.toISOString().slice(0, 10)).toBe('2026-07-28');

        // And after local midnight it moves on, while UTC is still on the 28th.
        const afterMidnight = new Date('2026-07-28T17:30:00Z'); // 00:30 on the 29th
        expect(localRecordDate(afterMidnight)).toBe('2026-07-29');
        expect(afterMidnight.toISOString().slice(0, 10)).toBe('2026-07-28');
    });

    it('rolls over at the operator\'s midnight, not UTC\'s', () => {
        expect(localRecordDate(new Date('2026-07-28T16:59:59Z'))).toBe('2026-07-28'); // 23:59
        expect(localRecordDate(new Date('2026-07-28T17:00:00Z'))).toBe('2026-07-29'); // 00:00
    });

    it('pads single-digit months and days into a Postgres date', () => {
        expect(localRecordDate(new Date('2026-03-04T05:00:00Z'))).toBe('2026-03-04');
        expect(localRecordDate(new Date('2026-12-31T20:00:00Z'))).toBe('2027-01-01');
    });

    it('reads the local wall clock that decides which slots have passed', () => {
        // 02:36Z is 09:36 in Jakarta: hour 9 is in progress, 10..18 still open.
        expect(localClock(new Date('2026-07-28T02:36:00Z'))).toEqual({ hour: 9, minute: 36 });
        expect(localClock(new Date('2026-07-28T17:00:00Z'))).toEqual({ hour: 0, minute: 0 });
    });
});

describe('a new day starts empty', () => {
    it('does not inherit an earlier day\'s ticks', () => {
        // The screen was showing 2026-07-26's record (07..18 all green) because
        // the view returns the newest record whatever its date. Ticking 09:00 on
        // a day with no record must write 09:00 alone.
        const stored = nextChecks(null, 9, true);

        expect(stored[9]).toBe(true);
        expect(stored.filter(Boolean)).toHaveLength(1);
        expect(stored).not.toEqual(fullDayShift());
    });

    it('keeps the ticks the day already holds', () => {
        const today = blankChecks();
        today[7] = true;
        today[8] = true;

        const stored = nextChecks(today, 9, true);

        expect(stored.slice(7, 10)).toEqual([true, true, true]);
        expect(stored.filter(Boolean)).toHaveLength(3);
    });

    it('clears one hour without touching the rest of the day', () => {
        const stored = nextChecks(fullDayShift(), 15, false);

        expect(stored[15]).toBe(false);
        expect(stored[14]).toBe(true);
        expect(stored[16]).toBe(true);
        expect(stored.filter(Boolean)).toHaveLength(11);
    });

    it('never mutates the day it was handed', () => {
        const today = fullDayShift();

        nextChecks(today, 15, false);

        expect(today[15]).toBe(true);
    });

    it('always produces 24 hours, whatever was stored', () => {
        expect(blankChecks()).toHaveLength(24);
        expect(nextChecks(null, 0, true)).toHaveLength(24);
        expect(toChecks(null)).toEqual(blankChecks());
        expect(toChecks([true, false])).toHaveLength(24);
        expect(toChecks([true, false])[0]).toBe(true);
        expect(toChecks([true, false])[23]).toBe(false);
    });
});
