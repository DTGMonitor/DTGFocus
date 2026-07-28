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
