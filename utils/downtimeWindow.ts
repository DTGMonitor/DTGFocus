// utils/downtimeWindow.ts
//
// One rule, in one place: a downtime record cannot end before it begins.
//
// Three flows write `downtime_records.to`, and two of them write it onto a row
// the analyst is not looking at:
//
//   SensorDetail        — switching failure type closes the open record with the
//                         NEW record's start time.
//   SiteWideStatusModal — the same close, applied across every ticked folder.
//   DowntimeTab         — a direct edit of `from` and `to`.
//
// A start typed earlier than the open record's own start (or with a mis-typed
// date) leaves that older record reversed. Nothing downstream reports it: the
// availability RPCs drop a reversed record, so the outage it describes vanishes
// from the figures rather than showing up wrong. Two Hidden Valley records were
// found that way in Sep 2026, by recomputing the numbers by hand.
//
// These helpers are pure so the rule can be tested without a browser or a
// Supabase client. The database backstops them with a CHECK constraint
// (.kiro/specs/availability-summary/migrations/002_downtime_window_guard.sql).

/** A timestamp as any of the forms the downtime flows hold one in. */
export type TimeInput = string | number | Date | null | undefined;

const msOf = (value: TimeInput): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
};

/**
 * Does this pair describe a window that runs backwards?
 *
 * An open record (`to` empty) is not reversed — it has not ended yet. An
 * unparseable or missing bound is not reversed either: there is nothing to
 * compare, and a blank field is the caller's own required-field problem.
 * Equal timestamps pass; a zero-length record is odd but it is not backwards,
 * and the close-and-reopen flows produce one legitimately when a status
 * changes at the same instant the previous one started.
 */
export const isReversedWindow = (from: TimeInput, to: TimeInput): boolean => {
    const fromMs = msOf(from);
    const toMs = msOf(to);
    if (fromMs === null || toMs === null) return false;
    return toMs < fromMs;
};

/**
 * The message to show when a write is refused. Deliberately names both times,
 * because the reversed one is usually a mis-typed DATE on an otherwise sensible
 * time — seeing the two side by side is what makes that obvious.
 *
 * `format` renders a stored timestamp for display; pass the caller's own
 * site-timezone formatter so the analyst reads site time, never UTC or their
 * own clock. Without one the raw values are shown.
 */
export const reversedWindowMessage = (
    from: TimeInput,
    to: TimeInput,
    format: (value: TimeInput) => string = (value) => String(value ?? '')
): string =>
    `End time (${format(to)}) is before the start time (${format(from)}). ` +
    `Check the date on both before saving.`;

export interface OpenRecordRef {
    id: number | string;
    /** downtime_records.from of the record about to be closed. */
    from?: string | null;
    /** Carried through untouched so the caller can name the sensor in an error. */
    wallfolder?: number | string;
}

/**
 * Which of these open records would be left reversed by closing them at
 * `closingTime`.
 *
 * This is the check the close-and-reopen flows need and the plain field
 * validation cannot give them: the analyst sets a START on the new record, and
 * that value silently becomes the END of a record they never see. Returns the
 * offending rows (empty when the close is safe) so the caller can both refuse
 * the write and say which sensors are in the way.
 */
export const reversedByClose = <T extends OpenRecordRef>(
    openRecords: T[] | null | undefined,
    closingTime: TimeInput
): T[] => {
    const closingMs = msOf(closingTime);
    if (closingMs === null) return [];
    return (openRecords || []).filter((record) => {
        const fromMs = msOf(record?.from);
        return fromMs !== null && closingMs < fromMs;
    });
};
