// utils/checklistDay.ts
//
// Which day an hourly check belongs to, and what a day's checklist may contain.
//
// The grid is the operator's own clock. A tick in the 08:00 column means the
// sensor was verified at 08:00 where the operator is sitting, and the row is
// filed under the operator's calendar day — one day, one record, 24 slots.
// Instants are stored as UTC (`created_time`); the slots are positions in that
// local day, not UTC hours.
//
// Two things were wrong before:
//
//   1. The day came from a hard-coded UTC+7 while the slots came from the
//      browser clock. Any operator not on Jakarta time filed checks against the
//      wrong date, and the two never agreed about when the day rolled over.
//   2. A day with no record yet inherited whatever ticks the view's newest
//      record happened to hold — `latest_radar_wall_folders` returns the newest
//      dqp_record for a wallfolder whatever its date. Those inherited ticks
//      landed on hours the "slot has passed" gate had already closed, so
//      nothing could clear them.
//
// One record per calendar day fits the day and cross shifts, whose hours all sit
// inside one date. The NIGHT shift does not: it runs 19:00 to 06:00, so its
// slots span two records. Reading one date alone emptied the grid at midnight —
// the 19:00..23:00 ticks stayed on yesterday's record, unreadable and, with the
// gate closed on hours that have passed, un-re-enterable. `shiftWindow` says
// which record each slot belongs to so a shift reads and writes as one thing.

/** Hours in a day, and so entries in a checklist. */
export const HOURS_IN_DAY = 24;

/** A fresh day's checklist: every hour unticked. */
export const blankChecks = (): boolean[] => Array(HOURS_IN_DAY).fill(false);

/** Coerce a stored checklist (null, short, or ragged) into exactly 24 booleans. */
export const toChecks = (value: boolean[] | null | undefined): boolean[] =>
    Array.from({ length: HOURS_IN_DAY }, (_, i) => Boolean(value?.[i]));

const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * The `record_date` a check made now belongs to: the operator's calendar day.
 *
 * Deliberately built from the local date parts rather than `toISOString()`,
 * which would give the UTC day and put every evening check on tomorrow's row
 * for a UTC+7 operator.
 */
export const localRecordDate = (instant: Date = new Date()): string =>
    `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}`;

/** The operator's wall clock, for deciding which of the day's slots have passed. */
export const localClock = (instant: Date = new Date()): { hour: number; minute: number } => ({
    hour: instant.getHours(),
    minute: instant.getMinutes()
});

/**
 * The checklist to store after ticking (or unticking) one hour.
 *
 * `todayChecks` is what today's record already holds — null when the day has no
 * record yet, which is the case that must start blank rather than inherit.
 * Nothing else about the day changes: one hour in, one hour out.
 */
export const nextChecks = (
    todayChecks: boolean[] | null,
    hour: number,
    ticked: boolean
): boolean[] => {
    const next = todayChecks ? toChecks(todayChecks) : blankChecks();
    next[hour] = ticked;
    return next;
};

/**
 * When a shift that crosses midnight stops meaning "the night now ending" and
 * starts meaning "the night about to begin".
 *
 * The same cutover `isCheckboxDisabled` uses, so the grid and the gate can never
 * disagree about which night a slot belongs to.
 */
export const SHIFT_CUTOVER_HOUR = 12;

/** A local date `days` from `instant`, built from date parts so a DST jump can't slide it. */
const shiftedDay = (instant: Date, days: number): Date =>
    new Date(instant.getFullYear(), instant.getMonth(), instant.getDate() + days);

/**
 * Where a shift's hours wrap past midnight — the index of its first after-midnight
 * hour, or -1 for a shift that sits inside one date.
 */
export const wrapIndex = (indices: number[]): number =>
    indices.findIndex((hour, i) => i > 0 && hour < indices[i - 1]);

/** The record dates a shift's slots live on, and which of them owns each slot. */
export interface ShiftWindow {
    /** Every `record_date` the shift touches, earliest first. One date unless it wraps. */
    dates: string[];
    /** The `record_date` holding this slot. */
    dateForHour: (hour: number) => string;
}

/**
 * Which record each slot of the displayed shift belongs to.
 *
 * A shift inside one date is one record — the operator's day. A shift that wraps
 * is two: its evening hours on the date it started, its morning hours on the
 * next. Before noon the operator is finishing the night that began yesterday, so
 * 19:00..23:00 read from yesterday and 00:00..06:00 from today; from noon the
 * coming night is in view and the pair moves on a day.
 */
export const shiftWindow = (indices: number[], instant: Date = new Date()): ShiftWindow => {
    const today = localRecordDate(instant);
    const wrap = wrapIndex(indices);

    if (wrap === -1) return { dates: [today], dateForHour: () => today };

    const endingNow = instant.getHours() < SHIFT_CUTOVER_HOUR;
    const start = endingNow ? localRecordDate(shiftedDay(instant, -1)) : today;
    const end = endingNow ? today : localRecordDate(shiftedDay(instant, 1));
    const afterMidnight = new Set(indices.slice(wrap));

    return {
        dates: [start, end],
        dateForHour: (hour) => (afterMidnight.has(hour) ? end : start)
    };
};

/**
 * One row's grid, assembled from the record of each date the shift spans.
 *
 * Only the shift's own slots are filled: everything a row displays or counts is
 * read through `indices`, and leaving the rest blank keeps another shift's ticks
 * out of this one's figures.
 */
export const shiftChecks = (
    indices: number[],
    window: ShiftWindow,
    checksOn: (date: string) => boolean[] | null | undefined
): boolean[] => {
    const checks = blankChecks();
    indices.forEach((hour) => {
        checks[hour] = Boolean(checksOn(window.dateForHour(hour))?.[hour]);
    });
    return checks;
};

/** The slots of `indices` that `date` holds. */
export const hoursOn = (indices: number[], window: ShiftWindow, date: string): number[] =>
    indices.filter((hour) => window.dateForHour(hour) === date);

/**
 * Fold what one date just stored back into a row's grid.
 *
 * A write settles one record, and under a wrapping shift that is half the grid —
 * so only the hours that date owns are taken from it. Overwriting the whole row
 * would blank the other date's ticks on every click.
 */
export const withStoredDay = (
    rowChecks: boolean[] | null,
    indices: number[],
    window: ShiftWindow,
    date: string,
    stored: boolean[]
): boolean[] => {
    const merged = toChecks(rowChecks);
    hoursOn(indices, window, date).forEach((hour) => {
        merged[hour] = Boolean(stored[hour]);
    });
    return merged;
};

/**
 * A day's checklist with the displayed shift's slots cleared.
 *
 * Scoped to the shift because a reset is made from inside one grid: clearing the
 * whole 24 would take the day shift's morning with it when the night operator
 * resets their own row.
 */
export const clearedShiftHours = (
    dayChecks: boolean[] | null,
    indices: number[],
    window: ShiftWindow,
    date: string
): boolean[] => {
    const next = toChecks(dayChecks);
    hoursOn(indices, window, date).forEach((hour) => {
        next[hour] = false;
    });
    return next;
};
