// utils/generatorRuntime.ts
//
// The generator running-time strip on the Tabulation report: which seven days
// it shows, and what a cell may hold.
//
// The strip is a WINDOW, not a stored list. It is derived from the report day
// every time the report is composed, which is what makes the shift automatic:
// the analyst never moves a number, the window moves under them. A value keyed
// to 09/08 stays keyed to 09/08 and simply appears one column further right the
// next morning, until it falls off the end after a week.
//
// It starts at YESTERDAY, never today. The report is issued at 05:00–06:00 site
// time, so "today" is five hours old and no generator has finished running in
// it — the figure the analyst has in hand at that moment is the night that just
// ended. A window starting at today would ask for a number that cannot exist
// yet and would push the oldest real day off the strip a day early.

/** How many days the strip prints. */
export const GENERATOR_DAYS = 7;

/** A day's worth of minutes — the ceiling any single cell can honestly hold. */
export const MINUTES_IN_DAY = 1440;

const DAY_ONLY = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * Calendar arithmetic on a 'YYYY-MM-DD' string, done in UTC so the result never
 * depends on the runtime timezone — a `setDate()` on a local-midnight date can
 * land on the wrong day either side of a DST change.
 */
export const shiftDay = (day: string, deltaDays: number): string => {
    const m = DAY_ONLY.exec(String(day ?? '').trim());
    if (!m) return '';
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return '';
    d.setUTCDate(d.getUTCDate() + deltaDays);
    return d.toISOString().slice(0, 10);
};

/**
 * The dates the strip prints, LATEST FIRST: yesterday, then backward.
 *
 * `reportDay` is the report's day on the SITE's calendar (useDailyReportData's
 * `reportDay`), never the viewer's — an analyst in Jakarta composing a Makassar
 * report must be offered Makassar's yesterday.
 *
 * Returns [] for an unparseable day rather than a week of empty strings, so the
 * strip renders as absent rather than as seven blanks nobody can fill.
 */
export const generatorDays = (reportDay: string, count: number = GENERATOR_DAYS): string[] => {
    if (!DAY_ONLY.test(String(reportDay ?? '').trim())) return [];
    return Array.from({ length: count }, (_, i) => shiftDay(reportDay, -(i + 1))).filter(Boolean);
};

/** A column heading: '2026-08-10' → '10/08'. The year is the report's own. */
export const generatorLabel = (day: string): string => {
    const m = DAY_ONLY.exec(String(day ?? '').trim());
    return m ? `${m[3]}/${m[2]}` : '';
};

/**
 * What a typed cell stores.
 *
 * null means "no figure for this day" — an empty field, or anything that is not
 * a number — and is stored by DELETING the row rather than by writing a zero.
 * Zero is a real reading (the generator did not run) and the report must be
 * able to say it without it being mistaken for an unanswered day.
 *
 * Clamped to one day of minutes: a generator cannot run 2000 minutes in 24
 * hours, and the usual cause of such a number is minutes typed where hours were
 * meant. Clamping keeps the strip readable; the analyst sees the correction.
 */
export const parseMinutes = (raw: unknown): number | null => {
    const text = String(raw ?? '').trim();
    if (!text) return null;
    const n = Number(text);
    if (!Number.isFinite(n)) return null;
    return Math.min(MINUTES_IN_DAY, Math.max(0, Math.round(n)));
};

/** A stored value as the cell's text. `0` prints as "0", not as blank. */
export const minutesText = (minutes: number | null | undefined): string =>
    minutes === null || minutes === undefined ? '' : String(minutes);
