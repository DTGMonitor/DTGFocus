// utils/siteTime.ts
//
// Display helpers for timestamps that belong to a SITE rather than to whoever
// is looking at them.
//
// The distinction matters because the people reading these screens are rarely
// in the same timezone as the radar. A monitoring team in Jakarta (UTC+7)
// watching Hidden Valley (Pacific/Port_Moresby, UTC+10) reading "assessed at
// 09:41" is three hours out, and the label carries no zone to say so. Every
// stored instant is UTC; the question is only whose clock renders it.
//
// `fromUTC` does the conversion without depending on the runtime timezone
// (see timezoneUtils). These helpers exist so the derivation is written once
// and can be tested, rather than repeated with getHours() in each component.

import { fromUTC } from './timezoneUtils';

const MONTHS_SHORT = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * The site wall clock of a stored UTC instant, as a Date whose *UTC* getters
 * read back the site-local components.
 *
 * Null for falsy or unparseable input — `fromUTC` throws on the latter, and a
 * bad timestamp must degrade to a blank cell rather than take a whole report
 * render down. Without a timeZone the UTC wall clock is used: timezoneUtils'
 * own fallback, and better than silently adopting the viewer's.
 */
const siteWall = (
    utcString: string | null | undefined,
    timeZone?: string | null
): Date | null => {
    if (!utcString) return null;
    try {
        // fromUTC returns the site wall clock as an ISO string with a trailing
        // Z: the components are site-local, so they are read back in UTC.
        const wall = fromUTC(String(utcString), timeZone || 'UTC');
        if (!wall) return null;
        const d = new Date(wall);
        return Number.isNaN(d.getTime()) ? null : d;
    } catch {
        return null;
    }
};

/**
 * A stored UTC instant as "HH:mm, DD Mon YYYY" on the site's clock.
 *
 * @example formatSiteDateTime('2026-09-29T23:41:00Z', 'Pacific/Port_Moresby')
 *          -> '09:41, 30 Sep 2026'
 *
 * Falsy input gives 'N/A' and an unparseable one is handed back untouched, both
 * matching what the gallery card did before.
 */
export const formatSiteDateTime = (
    utcString: string | null | undefined,
    timeZone?: string | null
): string => {
    if (!utcString) return 'N/A';
    const wall = siteWall(utcString, timeZone);
    if (!wall) return String(utcString);

    return `${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}, ` +
        `${pad(wall.getUTCDate())} ${MONTHS_SHORT[wall.getUTCMonth()]} ${wall.getUTCFullYear()}`;
};

/**
 * A stored UTC instant as 'DD/MM/YYYY' on the site's clock — the day format the
 * printed reports use.
 *
 * @example formatSiteDay('2026-09-29T23:41:00Z', 'Pacific/Port_Moresby')
 *          -> '30/09/2026'
 *
 * Returns null rather than a placeholder for anything it cannot render: the
 * caller decides whether that is '—', a blank, or a dropped row.
 */
export const formatSiteDay = (
    utcString: string | null | undefined,
    timeZone?: string | null
): string | null => {
    const wall = siteWall(utcString, timeZone);
    if (!wall) return null;
    return `${pad(wall.getUTCDate())}/${pad(wall.getUTCMonth() + 1)}/${wall.getUTCFullYear()}`;
};

/**
 * A stored UTC instant as 'DD/MM/YYYY, HH:MM' on the site's clock — the
 * datetime format the printed reports use.
 *
 * @example formatSiteDayTime('2026-09-29T23:41:00Z', 'Pacific/Port_Moresby')
 *          -> '30/09/2026, 09:41'
 *
 * Null for anything it cannot render, as `formatSiteDay`.
 */
export const formatSiteDayTime = (
    utcString: string | null | undefined,
    timeZone?: string | null
): string | null => {
    const wall = siteWall(utcString, timeZone);
    if (!wall) return null;
    return `${pad(wall.getUTCDate())}/${pad(wall.getUTCMonth() + 1)}/${wall.getUTCFullYear()}, ` +
        `${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}`;
};
