// utils/siteWideStatus.ts
//
// Helpers for the site-wide status flows (Lost Connection / Scheduled Offline).
//
// Both events hit every sensor on a site at once — a link that drops at the mine
// gateway takes all the radars with it, and DTG-side maintenance is scheduled
// for the whole site — so these flows are driven by a SET of wall folders rather
// than the one the analyst happened to have open. The pure parts live here so
// the label wording and the default maintenance window can be tested without a
// browser or a Supabase client.

import { fromUTC, toUTC } from './timezoneUtils';

/** Statuses that open the multi-sensor flow instead of the single-sensor modal. */
export const SITE_WIDE_STATUSES = ['Lost Connection', 'Scheduled Offline'] as const;
export type SiteWideStatus = (typeof SITE_WIDE_STATUSES)[number];

export const isSiteWideStatus = (status: string): status is SiteWideStatus =>
    (SITE_WIDE_STATUSES as readonly string[]).includes(status);

/**
 * How each status names "everything on this site" in its email.
 *
 * The two differ because the wording follows what each notification is about:
 * a dropped link is reported against the sensors, scheduled maintenance against
 * the radars themselves. Change a value here and both the subject and the
 * SENSOR line follow.
 */
export const ALL_SELECTED_LABEL: Record<SiteWideStatus, string> = {
    'Lost Connection': 'All Sensors',
    'Scheduled Offline': 'All Radars',
};

/** The window the analyst almost always schedules, in THEIR OWN local clock. */
export const DEFAULT_OFFLINE_WINDOW_LOCAL = { from: '11:30', to: '13:00' };

export interface SelectableSensor {
    /** downtime_records.wallfolder — the identity every write is keyed by. */
    wallfolder_id: number;
    radar_number: string;
    area?: string | null;
    /** Wall-folder name, when the radar has more than one. */
    folder_name?: string | null;
    status?: string | null;
}

export interface SensorSelectionLabel {
    /** "All Radars" / "RADAR-01" / "RADAR-01 and RADAR-02" — no site suffix. */
    bare: string;
    /** The same, suffixed with the site: "All Radars - Telfer". */
    withSite: string;
}

const joinNames = (names: string[]): string => {
    if (names.length === 0) return '';
    if (names.length === 1) return names[0];
    // Intl.ListFormat is how the deformation subjects join alarm types — keep the
    // "A, B and C" wording identical across every email the dashboard drafts.
    return new Intl.ListFormat('en-AU', { style: 'short', type: 'conjunction' }).format(names);
};

/**
 * Name the selection the way the email should quote it.
 *
 * `allLabel` is used when every sensor on the site is ticked; a partial
 * selection is quoted by its distinct radar numbers, so two wall folders of the
 * same radar read as one name rather than a repeated pair.
 */
export const sensorSelectionLabel = (
    sensors: SelectableSensor[],
    selectedIds: Array<number | string>,
    siteName: string,
    allLabel: string
): SensorSelectionLabel => {
    const selectedKeys = new Set(selectedIds.map(String));
    const selected = sensors.filter((s) => selectedKeys.has(String(s.wallfolder_id)));

    const isAll = sensors.length > 0 && selected.length === sensors.length;
    const names = Array.from(new Set(selected.map((s) => s.radar_number).filter(Boolean))) as string[];

    const bare = isAll || names.length === 0 ? allLabel : joinNames(names);
    return { bare, withSite: `${bare} - ${siteName}` };
};

/** The zone the browser (i.e. the analyst) is reading its clock in. */
export const runtimeTimeZone = (): string =>
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/**
 * Read an "HH:mm" the analyst is thinking in — their own wall clock — as the
 * time the SITE will read at that same instant.
 *
 * The maintenance window is agreed in the engineer's local time (11:30–13:00 in
 * Jakarta) but the client only cares what their own clock says, so the picker is
 * seeded with the converted value: 11:30 WIB arrives as 12:30 at Telfer.
 *
 * `now` fixes the date the conversion is anchored to, which matters at DST
 * boundaries. `userTimeZone` defaults to the browser's — passed explicitly only
 * by tests, which must not depend on the machine they run on.
 */
export const siteLocalTimeFromUserLocal = (
    hhmm: string,
    siteTimeZone: string,
    now: Date = new Date(),
    userTimeZone: string = runtimeTimeZone()
): string => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
    if (!match) return '';

    const wall = `${match[1].padStart(2, '0')}:${match[2]}`;
    // The analyst's own date — the day they are looking at, not the UTC one.
    const dayInUserZone = (fromUTC(now.toISOString(), userTimeZone) || '').slice(0, 10);
    const instant = toUTC(`${dayInUserZone}T${wall}`, userTimeZone);

    return (fromUTC(instant || '', siteTimeZone) || '').slice(11, 16);
};

/** The default maintenance window, already expressed in the site's clock. */
export const defaultOfflineWindow = (
    siteTimeZone: string,
    now: Date = new Date(),
    userTimeZone: string = runtimeTimeZone()
) => ({
    from: siteLocalTimeFromUserLocal(DEFAULT_OFFLINE_WINDOW_LOCAL.from, siteTimeZone, now, userTimeZone),
    to: siteLocalTimeFromUserLocal(DEFAULT_OFFLINE_WINDOW_LOCAL.to, siteTimeZone, now, userTimeZone),
});

export interface DowntimeWritePlan {
    /** Open records of a DIFFERENT type — closed at the new event's start. */
    closeIds: Array<number | string>;
    /** Open records already of this type — the analyst is editing them. */
    updates: Array<{ id: number | string; wallfolder: number | string }>;
    /** Wall folders with nothing open — a new record is inserted. */
    insertFolders: Array<number | string>;
}

/**
 * Decide, per selected wall folder, whether the submission closes-and-reopens,
 * edits in place, or inserts fresh — the batch form of the three scenarios the
 * single-sensor flow walks through.
 *
 * `openRecords` may hold more than one row per folder (historic data does);
 * the latest `from` wins, which is the row the single-sensor flow also picks.
 */
export const planDowntimeWrites = (
    selectedIds: Array<number | string>,
    openRecords: Array<{ id: number | string; wallfolder: number | string; type?: string | null; from?: string | null }>,
    targetStatus: string
): DowntimeWritePlan => {
    const latestOpen = new Map<string, { id: number | string; wallfolder: number | string; type?: string | null; from?: string | null }>();
    (openRecords || []).forEach((record) => {
        const key = String(record.wallfolder);
        const held = latestOpen.get(key);
        const heldFrom = held?.from ? new Date(held.from).getTime() : -Infinity;
        const thisFrom = record.from ? new Date(record.from).getTime() : -Infinity;
        if (!held || thisFrom >= heldFrom) latestOpen.set(key, record);
    });

    const plan: DowntimeWritePlan = { closeIds: [], updates: [], insertFolders: [] };

    selectedIds.forEach((folderId) => {
        const open = latestOpen.get(String(folderId));
        if (open && open.type === targetStatus) {
            plan.updates.push({ id: open.id, wallfolder: folderId });
            return;
        }
        if (open) plan.closeIds.push(open.id);
        plan.insertFolders.push(folderId);
    });

    return plan;
};
