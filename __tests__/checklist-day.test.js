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
    nextChecks,
    wrapIndex,
    shiftWindow,
    shiftChecks,
    hoursOn,
    withStoredDay,
    clearedShiftHours
} from '../utils/checklistDay';

/** The shift grids of RadarMonitoring, in its own order. */
const DS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
const NS = [19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6];
const CROSS = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];

/** A Jakarta wall-clock instant, written as the operator would read it. */
const at = (isoLocal) => new Date(`${isoLocal}+07:00`);

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

describe('a shift that crosses midnight', () => {
    it('knows which shifts wrap', () => {
        expect(wrapIndex(NS)).toBe(5); // 23 → 00
        expect(wrapIndex(DS)).toBe(-1);
        expect(wrapIndex(CROSS)).toBe(-1);
    });

    it('keeps a shift inside one day on one record', () => {
        const window = shiftWindow(DS, at('2026-07-30T09:00'));

        expect(window.dates).toEqual(['2026-07-30']);
        expect(window.dateForHour(7)).toBe('2026-07-30');
        expect(window.dateForHour(18)).toBe('2026-07-30');
    });

    it('reads the same two records at 20:00 and at 01:00', () => {
        // The complaint: at 01:00 the grid emptied. The evening hours were still
        // filed under the 29th, and only the 30th was being read.
        const evening = shiftWindow(NS, at('2026-07-29T20:00'));
        const afterMidnight = shiftWindow(NS, at('2026-07-30T01:00'));

        expect(evening.dates).toEqual(['2026-07-29', '2026-07-30']);
        expect(afterMidnight.dates).toEqual(['2026-07-29', '2026-07-30']);

        [evening, afterMidnight].forEach((window) => {
            expect(window.dateForHour(19)).toBe('2026-07-29');
            expect(window.dateForHour(23)).toBe('2026-07-29');
            expect(window.dateForHour(0)).toBe('2026-07-30');
            expect(window.dateForHour(1)).toBe('2026-07-30');
            expect(window.dateForHour(6)).toBe('2026-07-30');
        });
    });

    it('moves on to the coming night at noon', () => {
        expect(shiftWindow(NS, at('2026-07-30T11:59')).dates).toEqual(['2026-07-29', '2026-07-30']);
        expect(shiftWindow(NS, at('2026-07-30T12:00')).dates).toEqual(['2026-07-30', '2026-07-31']);
    });

    it('crosses a month, and a year, without arithmetic on milliseconds', () => {
        expect(shiftWindow(NS, at('2026-08-01T02:00')).dates).toEqual(['2026-07-31', '2026-08-01']);
        expect(shiftWindow(NS, at('2027-01-01T02:00')).dates).toEqual(['2026-12-31', '2027-01-01']);
        expect(shiftWindow(NS, at('2026-12-31T20:00')).dates).toEqual(['2026-12-31', '2027-01-01']);
    });

    it('assembles the grid from both records', () => {
        const yesterday = blankChecks();
        [19, 20, 21, 22, 23].forEach((h) => { yesterday[h] = true; });
        const today = blankChecks();
        today[0] = true;

        const window = shiftWindow(NS, at('2026-07-30T01:00'));
        const grid = shiftChecks(NS, window, (date) =>
            date === '2026-07-29' ? yesterday : today
        );

        // The evening the operator worked is still on screen at 01:00.
        expect([19, 20, 21, 22, 23].map((h) => grid[h])).toEqual([true, true, true, true, true]);
        expect(grid[0]).toBe(true);
        expect(grid[1]).toBe(false);
    });

    it('leaves the hours outside the shift alone', () => {
        const dayShiftDone = blankChecks();
        DS.forEach((h) => { dayShiftDone[h] = true; });

        const window = shiftWindow(NS, at('2026-07-29T20:00'));
        const grid = shiftChecks(NS, window, () => dayShiftDone);

        // 07..18 are the day shift's business; the night grid neither shows nor
        // counts them.
        expect(DS.map((h) => grid[h])).toEqual(DS.map(() => false));
    });

    it('splits the shift between its two records', () => {
        const window = shiftWindow(NS, at('2026-07-30T01:00'));

        expect(hoursOn(NS, window, '2026-07-29')).toEqual([19, 20, 21, 22, 23]);
        expect(hoursOn(NS, window, '2026-07-30')).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });
});

describe('settling a write back into the grid', () => {
    const window = shiftWindow(NS, at('2026-07-30T01:00'));

    it('takes only the hours the written record owns', () => {
        const onScreen = blankChecks();
        [19, 20, 21, 22, 23].forEach((h) => { onScreen[h] = true; });
        onScreen[1] = true;

        // 01:00 was just stored against the 30th; the 29th's evening is not in
        // that array and must survive the merge.
        const stored = blankChecks();
        stored[1] = true;
        stored[2] = true;

        const merged = withStoredDay(onScreen, NS, window, '2026-07-30', stored);

        expect([19, 20, 21, 22, 23].map((h) => merged[h])).toEqual([true, true, true, true, true]);
        expect(merged[1]).toBe(true);
        expect(merged[2]).toBe(true);
    });

    it('drops an hour the record says is no longer ticked', () => {
        const onScreen = blankChecks();
        onScreen[1] = true;
        onScreen[19] = true;

        const merged = withStoredDay(onScreen, NS, window, '2026-07-30', blankChecks());

        expect(merged[1]).toBe(false);
        expect(merged[19]).toBe(true);
    });
});

describe('clearing a shift', () => {
    it('clears its own hours and keeps the other shift\'s', () => {
        const stored = blankChecks();
        DS.forEach((h) => { stored[h] = true; });   // day shift, all done
        stored[19] = true;
        stored[20] = true;                          // night shift, two hours in

        const window = shiftWindow(NS, at('2026-07-29T21:00'));
        const cleared = clearedShiftHours(stored, NS, window, '2026-07-29');

        expect(cleared[19]).toBe(false);
        expect(cleared[20]).toBe(false);
        expect(DS.map((h) => cleared[h])).toEqual(DS.map(() => true));
    });

    it('never mutates the day it was handed', () => {
        const stored = blankChecks();
        stored[19] = true;

        clearedShiftHours(stored, NS, shiftWindow(NS, at('2026-07-29T21:00')), '2026-07-29');

        expect(stored[19]).toBe(true);
    });
});
