/**
 * The Tabulation report's generator running-time strip.
 *
 * Two properties carry the whole feature:
 *
 *   1. The window starts at YESTERDAY. The report is issued at 05:00–06:00 site
 *      time, so the figure the analyst holds is the night that just ended;
 *      offering today would ask for a number that does not exist yet.
 *   2. Cells are keyed to DATES, not to positions. That is what makes the shift
 *      automatic — tomorrow's window is today's window moved by one, so a stored
 *      figure appears one column further right without anything re-keying it.
 */

import {
    GENERATOR_DAYS,
    MINUTES_IN_DAY,
    shiftDay,
    generatorDays,
    generatorLabel,
    parseMinutes,
    minutesText,
} from '../utils/generatorRuntime';

describe('the seven-day window', () => {
    it('starts at yesterday and runs backward, latest first', () => {
        expect(generatorDays('2026-08-11')).toEqual([
            '2026-08-10',
            '2026-08-09',
            '2026-08-08',
            '2026-08-07',
            '2026-08-06',
            '2026-08-05',
            '2026-08-04',
        ]);
    });

    it('never includes the report day itself', () => {
        expect(generatorDays('2026-08-11')).not.toContain('2026-08-11');
    });

    it('prints seven columns', () => {
        expect(generatorDays('2026-08-11')).toHaveLength(GENERATOR_DAYS);
    });

    it('crosses a month boundary', () => {
        expect(generatorDays('2026-03-03')).toEqual([
            '2026-03-02',
            '2026-03-01',
            '2026-02-28',
            '2026-02-27',
            '2026-02-26',
            '2026-02-25',
            '2026-02-24',
        ]);
    });

    it('crosses a leap day', () => {
        expect(generatorDays('2024-03-01').slice(0, 2)).toEqual(['2024-02-29', '2024-02-28']);
    });

    /**
     * The shift, stated directly: tomorrow's strip is today's strip moved one
     * column right, with one new blank on the left and one day dropped off the
     * end. Nothing in the app moves a value to make this happen.
     */
    it('moves every day one column right on the next edition', () => {
        const today = generatorDays('2026-08-11');
        const tomorrow = generatorDays('2026-08-12');

        expect(tomorrow[0]).toBe('2026-08-11'); // the new, blank cell
        expect(tomorrow.slice(1)).toEqual(today.slice(0, GENERATOR_DAYS - 1));
        expect(tomorrow).not.toContain(today[GENERATOR_DAYS - 1]); // fell off the end
    });

    it('renders as absent rather than as seven blanks when the day is unusable', () => {
        expect(generatorDays('')).toEqual([]);
        expect(generatorDays('not a day')).toEqual([]);
        expect(generatorDays(undefined as unknown as string)).toEqual([]);
    });

    it('labels a column dd/mm', () => {
        expect(generatorLabel('2026-08-04')).toBe('04/08');
        expect(generatorLabel('')).toBe('');
    });

    // The runtime timezone is pinned to Asia/Jakarta in jest.config.js. The
    // arithmetic is UTC-based precisely so that pinning cannot matter.
    it('does not depend on the runtime timezone', () => {
        expect(shiftDay('2026-08-11', -1)).toBe('2026-08-10');
        expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31');
        expect(shiftDay('2026-08-11', 1)).toBe('2026-08-12');
    });
});

describe('what a cell may hold', () => {
    it('reads a typed number as minutes', () => {
        expect(parseMinutes('612')).toBe(612);
        expect(parseMinutes(' 612 ')).toBe(612);
        expect(parseMinutes('612.4')).toBe(612);
    });

    /**
     * Zero is a READING — the generator did not run — and has to survive as one.
     * Everything empty or unparseable is the absence of an answer, which the
     * hook stores by deleting the row rather than by writing a 0.
     */
    it('keeps 0 distinct from unanswered', () => {
        expect(parseMinutes('0')).toBe(0);
        expect(parseMinutes('')).toBeNull();
        expect(parseMinutes('   ')).toBeNull();
        expect(parseMinutes('abc')).toBeNull();
        expect(parseMinutes(null)).toBeNull();
    });

    it('cannot exceed a day, whichever end it is typed at', () => {
        expect(parseMinutes('2000')).toBe(MINUTES_IN_DAY);
        expect(parseMinutes('-30')).toBe(0);
    });

    it('prints 0 as a figure, and nothing as blank', () => {
        expect(minutesText(0)).toBe('0');
        expect(minutesText(612)).toBe('612');
        expect(minutesText(null)).toBe('');
        expect(minutesText(undefined)).toBe('');
    });
});
