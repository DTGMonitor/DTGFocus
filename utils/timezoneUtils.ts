// utils/timezoneUtils.ts
//
// Robust UTC <-> site-timezone conversions that DO NOT depend on the runtime
// (browser / server) timezone.
//
// The previous implementation derived the offset via
// `new Date(date.toLocaleString('en-US', { timeZone }))`, which re-parses a
// localised string in the *runtime's* timezone. That only produces correct
// results when the runtime happens to be UTC (e.g. a Vercel server). In a
// browser set to any other timezone (e.g. a site engineer in Australia/Perth)
// the offset cancelled out and the UI fell back to showing the raw UTC time.
//
// These helpers instead read the wall-clock parts of an instant *in the target
// IANA timeZone* via Intl.DateTimeFormat, so the result is identical whether
// the code runs on a UTC server or in a browser in any local timezone.

/**
 * Read the wall-clock parts (Y/M/D h:m:s) of `date` as observed in `timeZone`.
 */
function getZonedParts(
    date: Date,
    timeZone: string
): { year: string; month: string; day: string; hour: string; minute: string; second: string } {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    })
        .formatToParts(date)
        .reduce<Record<string, string>>((acc, p) => {
            if (p.type !== 'literal') acc[p.type] = p.value;
            return acc;
        }, {});

    // Some engines emit hour '24' at midnight under hour12:false — normalise.
    if (parts.hour === '24') parts.hour = '00';

    return {
        year: parts.year,
        month: parts.month,
        day: parts.day,
        hour: parts.hour,
        minute: parts.minute,
        second: parts.second,
    };
}

/**
 * Convert a tz-naive wall-clock string that the user entered while reading the
 * site clock in `timeZone` (e.g. a `<input type="datetime-local">` value
 * "YYYY-MM-DDTHH:mm") into the corresponding real UTC ISO instant for storage.
 *
 * @example toUTC("2026-06-03T10:27", "Australia/Perth") -> "2026-06-03T02:27:00.000Z"
 *
 * Returns null for falsy input; throws on an unparseable date (contract kept).
 */
export const toUTC = (localTimeString: string, timeZone?: string): string | null => {
    if (!localTimeString) return null;

    const tz = timeZone || 'UTC';

    // Interpret the wall-clock string AS IF it were UTC to obtain a reference
    // instant, then correct by the offset of `tz` at that instant.
    const naive = String(localTimeString).trim().replace(' ', 'T');
    const hasZone = /([zZ])$|[+-]\d{2}:?\d{2}$/.test(naive);
    const asIfUTC = new Date(hasZone ? naive : `${naive}Z`);

    if (isNaN(asIfUTC.getTime())) {
        console.error('toUTC received invalid date:', localTimeString);
        throw new Error(`Invalid Date Format: "${localTimeString}"`);
    }

    // If the caller already supplied a zone-qualified instant, it is absolute.
    if (hasZone) return asIfUTC.toISOString();

    const p = getZonedParts(asIfUTC, tz);
    const wallAsUTC = Date.UTC(
        Number(p.year),
        Number(p.month) - 1,
        Number(p.day),
        Number(p.hour),
        Number(p.minute),
        Number(p.second)
    );
    const offset = wallAsUTC - asIfUTC.getTime();
    return new Date(asIfUTC.getTime() - offset).toISOString();
};

/**
 * Convert a stored UTC timestamp into a "tz-naive" ISO string whose clock
 * components are the wall-clock time observed in `timeZone`.
 *
 * The returned string carries a trailing `Z` purely so existing callers can do
 * `new Date(result).toISOString().slice(0, 16)` (datetime-local value) or read
 * the components back with `toLocaleString(..., { timeZone: 'UTC' })` — in both
 * cases recovering the site wall-clock regardless of the runtime timezone.
 * It does NOT represent the real UTC instant.
 *
 * @example fromUTC("2026-06-03T02:27:00Z", "Australia/Perth") -> "2026-06-03T10:27:00.000Z"
 *
 * Returns null for falsy input; throws on an unparseable date (contract kept).
 */
export const fromUTC = (utcString: string, timeZone?: string): string | null => {
    if (!utcString) return null;

    const inputDate = new Date(utcString);

    if (isNaN(inputDate.getTime())) {
        console.error('fromUTC received invalid date:', utcString);
        throw new Error(`Invalid Date Format: "${utcString}"`);
    }

    // No timeZone provided → fall back to the UTC wall clock. (Previous no-arg
    // callers implicitly relied on the runtime timezone, which was the bug.)
    const tz = timeZone || 'UTC';
    const p = getZonedParts(inputDate, tz);
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.000Z`;
};

/**
 * Format a stored UTC timestamp for display in `timeZone`. Runtime-independent
 * (uses Intl with the target timeZone directly).
 *
 * Output example: "29/01/2026, 16:44:49"
 */
export const formatFromUTC = (utcString: string, timeZone: string): string | null => {
    if (!utcString) return null;

    const inputDate = new Date(utcString);

    if (isNaN(inputDate.getTime())) {
        console.error('formatFromUTC received invalid date:', utcString);
        return null;
    }

    return new Intl.DateTimeFormat('en-AU', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: timeZone,
        hour12: false,
    }).format(inputDate);
};
