/**
 * The rule that a downtime record cannot end before it begins.
 *
 * The cases that matter are not the obvious ones. A reversed record does not
 * show up as a wrong number: the availability RPCs drop it, so the outage it
 * describes disappears from the figures entirely. And the flow that produces
 * one writes to a record the analyst is not looking at — closing an open
 * record with the new event's start time — which is why `reversedByClose`
 * exists alongside the plain field check.
 */

import {
    isReversedWindow,
    reversedByClose,
    reversedWindowMessage,
} from '@/utils/downtimeWindow';

describe('isReversedWindow', () => {
    it('accepts a window that runs forwards', () => {
        expect(isReversedWindow('2026-07-30T09:03:00+00:00', '2026-07-30T12:03:00+00:00')).toBe(false);
    });

    it('rejects a window that runs backwards', () => {
        expect(isReversedWindow('2026-07-30T12:03:00+00:00', '2026-07-30T09:03:00+00:00')).toBe(true);
    });

    it('catches the mis-typed date, where only the day is wrong', () => {
        // Record 525: the time of day was right, the date was a day ahead.
        expect(isReversedWindow('2026-09-30T12:51:00+00:00', '2026-09-29T16:00:00+00:00')).toBe(true);
    });

    it('treats an open record as valid — it has not ended yet', () => {
        expect(isReversedWindow('2026-07-30T09:03:00+00:00', null)).toBe(false);
        expect(isReversedWindow('2026-07-30T09:03:00+00:00', '')).toBe(false);
        expect(isReversedWindow('2026-07-30T09:03:00+00:00', undefined)).toBe(false);
    });

    it('accepts equal timestamps: zero-length is odd, but it is not backwards', () => {
        // A close-and-reopen at the same instant produces exactly this.
        expect(isReversedWindow('2026-07-30T09:03:00+00:00', '2026-07-30T09:03:00+00:00')).toBe(false);
    });

    it('stays quiet when a bound is missing or unparseable', () => {
        // A blank required field is the form's problem, not this rule's.
        expect(isReversedWindow(null, '2026-07-30T12:03:00+00:00')).toBe(false);
        expect(isReversedWindow('not a date', '2026-07-30T12:03:00+00:00')).toBe(false);
    });

    it('reads Date objects and epoch milliseconds, not just ISO strings', () => {
        const from = new Date('2026-07-30T12:00:00Z');
        const to = new Date('2026-07-30T09:00:00Z');
        expect(isReversedWindow(from, to)).toBe(true);
        expect(isReversedWindow(from.getTime(), to.getTime())).toBe(true);
    });
});

describe('reversedByClose', () => {
    const open = [
        { id: 1, wallfolder: 52, from: '2026-07-30T09:00:00+00:00' },
        { id: 2, wallfolder: 53, from: '2026-07-30T14:00:00+00:00' },
    ];

    it('names the records a close would leave reversed', () => {
        // Closing at 12:00 is after #1 started but before #2 did.
        const blocked = reversedByClose(open, '2026-07-30T12:00:00+00:00');
        expect(blocked.map((r) => r.id)).toEqual([2]);
    });

    it('allows a close that is after every open record started', () => {
        expect(reversedByClose(open, '2026-07-30T15:00:00+00:00')).toEqual([]);
    });

    it('allows a close exactly on an open record start', () => {
        expect(reversedByClose(open, '2026-07-30T14:00:00+00:00')).toEqual([]);
    });

    it('returns the whole record, so the caller can name the sensor', () => {
        const [blocked] = reversedByClose(open, '2026-07-30T10:00:00+00:00');
        expect(blocked.wallfolder).toBe(53);
    });

    it('has nothing to say about an empty or absent list', () => {
        expect(reversedByClose([], '2026-07-30T12:00:00+00:00')).toEqual([]);
        expect(reversedByClose(null, '2026-07-30T12:00:00+00:00')).toEqual([]);
    });

    it('blocks nothing when the closing time itself is unusable', () => {
        // The caller's required-field check owns that failure.
        expect(reversedByClose(open, null)).toEqual([]);
    });

    it('ignores an open record with no start recorded', () => {
        expect(reversedByClose([{ id: 3, from: null }], '2026-07-30T12:00:00+00:00')).toEqual([]);
    });
});

describe('reversedWindowMessage', () => {
    it('names both times, because the error is usually the date on one of them', () => {
        const message = reversedWindowMessage(
            '2026-09-30T12:51:00+00:00',
            '2026-09-29T16:00:00+00:00'
        );
        expect(message).toContain('2026-09-30T12:51:00+00:00');
        expect(message).toContain('2026-09-29T16:00:00+00:00');
    });

    it('renders through the formatter it is given, so the analyst reads site time', () => {
        const siteTime = (value) => (value === '2026-09-30T12:51:00+00:00' ? '30 Sep 22:51' : '30 Sep 02:00');
        const message = reversedWindowMessage(
            '2026-09-30T12:51:00+00:00',
            '2026-09-29T16:00:00+00:00',
            siteTime
        );
        expect(message).toContain('30 Sep 22:51');
        expect(message).toContain('30 Sep 02:00');
    });
});
