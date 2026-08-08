// The daily reporting-services email, as text.
//
// One site, one day, one draft. The subject and body name only the radars that
// actually produced a report for the period — those are the PDFs the analyst is
// attaching — and a trailing Note accounts for every radar that did not, using
// its current status so the client is told why rather than left to notice.
//
// Two things vary the wording and neither is cosmetic:
//
//   * WHICH REPORT. A Data Quality Assessment is not a "Daily Radar Reporting
//     Service" and the sites do not call it one; it names its own window ("24h
//     Data Quality Assessment") and drops the "for the" before the period.
//   * WHICH LANGUAGE. The Indonesian draft follows the same shape but is not a
//     word-for-word translation: its subject names the report shortly ("Laporan
//     Harian") where the body spells it out ("Laporan Harian Analisis Data
//     Deformasi"), and it takes no "of" before the radar.
//
// So the wording is a table indexed by (locale, variant) rather than one
// template with substitutions. Everything here is pure; fetching the reports,
// downloading the PDFs and raising the Outlook draft is `useDailyReportDraft`'s.

import { EmailLocale } from '@/config/emailLocale';
import { DTG_INTERNAL_GROUP } from '@/config/tarpDocument';

/** Which report the site produced, which decides how the draft names it. */
export type ReportVariant = 'radar' | 'dataQuality';

/** A radar at the site with no report this period, and why. */
export interface MissingRadar {
    radarNumber: string;
    /** `radar_wall_folders.type` — 'Link Down', 'Lost Connection', … */
    status: string | null;
}

export interface DailyReportDraftInput {
    siteName: string;
    /** Radars whose report exists for the period — these name the subject. */
    reportedRadars: string[];
    missingRadars: MissingRadar[];
    /** The day the reports COVER, not the day they were generated. */
    periodDate: Date | string | null;
    /** Signature line — the analyst's display name. */
    senderName: string;
    locale?: EmailLocale;
    variant?: ReportVariant;
    /** The assessment window a Data Quality report names — "24h", "7d". */
    span?: string | null;
}

export interface DailyReportDraft {
    subject: string;
    body: string;
    /** Outlook distribution group, not an address — see openOutlookDraft. */
    to: string;
    cc: string;
}

/** What the wording table is handed to build a line. */
interface DraftParts {
    radars: string;
    siteName: string;
    period: string;
    span: string;
}

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

/** The window a Data Quality Assessment covers when the filename does not say. */
export const DEFAULT_SPAN = '24h';

interface VariantWording {
    subject: (p: DraftParts) => string;
    /** The "Please find attached …" sentence, terminator included. */
    attached: (p: DraftParts) => string;
}

interface LocaleWording {
    greeting: string;
    note: string;
    thanks: string;
    regards: string;
    and: string;
    /** Status -> the short consequence the client cares about. */
    statuses: Record<string, string>;
    variants: Record<ReportVariant, VariantWording>;
}

const EN: LocaleWording = {
    greeting: 'Dear All,',
    note: 'Note',
    thanks: 'Thank you.',
    regards: 'Regards,',
    and: 'and',
    statuses: {
        'Link Down': 'no data updated',
        'Lost Connection': 'connection lost',
        'Scheduled Offline': 'scheduled offline',
        Maintenance: 'under maintenance',
        'Power Outage': 'power outage',
        Intermittent: 'intermittent data',
    },
    variants: {
        radar: {
            subject: ({ radars, siteName, period }) =>
                `Daily Radar Reporting Services of ${radars} - ${siteName} period of ${period}`,
            attached: ({ radars, siteName, period }) =>
                `Please find attached the Daily Radar Reporting Services of ${radars} - ${siteName} for the period of ${period}.`,
        },
        // Note the missing "for the": the Data Quality drafts run the site
        // straight into the period, and that is what the sites already send.
        dataQuality: {
            subject: ({ radars, siteName, period, span }) =>
                `${span} Data Quality Assessment of ${radars} - ${siteName} period of ${period}`,
            attached: ({ radars, siteName, period, span }) =>
                `Please find attached the ${span} Data Quality Assessment of ${radars} - ${siteName} period of ${period}.`,
        },
    },
};

// The `radar` wording below is transcribed from a BIB draft. The `dataQuality`
// wording is NOT — no Indonesian site has sent one yet, so it is a best-effort
// rendering of the English. Confirm it with the site before its first send.
const ID: LocaleWording = {
    greeting: 'Dengan Hormat,',
    note: 'Catatan',
    thanks: 'Terima kasih.',
    regards: 'Salam,',
    and: 'dan',
    statuses: {
        'Link Down': 'data tidak terbarui',
        'Lost Connection': 'koneksi terputus',
        'Scheduled Offline': 'offline terjadwal',
        Maintenance: 'dalam pemeliharaan',
        'Power Outage': 'pemadaman listrik',
        Intermittent: 'data intermiten',
    },
    variants: {
        radar: {
            subject: ({ radars, siteName, period }) =>
                `Laporan Harian ${radars} - ${siteName} Periode ${period}`,
            // Ends on a comma, as the BIB drafts do.
            attached: ({ radars, siteName, period }) =>
                `Terlampir Laporan Harian Analisis Data Deformasi ${radars} - ${siteName} periode ${period},`,
        },
        dataQuality: {
            subject: ({ radars, siteName, period, span }) =>
                `Penilaian Kualitas Data ${span} ${radars} - ${siteName} Periode ${period}`,
            attached: ({ radars, siteName, period, span }) =>
                `Terlampir Penilaian Kualitas Data ${span} ${radars} - ${siteName} periode ${period},`,
        },
    },
};

const wording = (locale: EmailLocale = 'en'): LocaleWording => (locale === 'id' ? ID : EN);

/** Statuses lead the Note in this order; anything else follows, alphabetically. */
const STATUS_ORDER = ['Link Down', 'Lost Connection', 'Scheduled Offline'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `reports.date` is a bare 'YYYY-MM-DD'. `new Date()` reads that as UTC
 * midnight, which renders as the previous day west of Greenwich, so date-only
 * values are built component-wise in local time instead.
 */
export function parseReportDate(value: Date | string | null | undefined): Date | null {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

    const raw = String(value).trim();
    const dateOnly = DATE_ONLY.exec(raw);
    if (dateOnly) {
        return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** "7 August 2026" / "6 Mei 2026". */
export function formatPeriodDate(
    value: Date | string | null | undefined,
    locale: EmailLocale = 'en'
): string {
    const date = parseReportDate(value);
    if (!date) return '';
    return new Intl.DateTimeFormat(locale === 'id' ? 'id-ID' : 'en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    }).format(date);
}

/**
 * "A", "A and B", "A, B, and C".
 *
 * Written out rather than handed to Intl.ListFormat: en-AU drops the serial
 * comma and the drafts these replace carry one.
 */
export function joinRadars(items: string[], locale: EmailLocale = 'en'): string {
    const and = wording(locale).and;
    if (items.length === 0) return '';
    if (items.length === 1) return items[0];
    if (items.length === 2) return `${items[0]} ${and} ${items[1]}`;
    return `${items.slice(0, -1).join(', ')}, ${and} ${items[items.length - 1]}`;
}

/** The short consequence for a status, falling back to the status itself. */
export function statusPhrase(status: string | null | undefined, locale: EmailLocale = 'en'): string {
    const raw = String(status || '').trim();
    if (!raw) return locale === 'id' ? 'tidak ada laporan' : 'no report generated';
    return wording(locale).statuses[raw] ?? raw.toLowerCase();
}

/**
 * "Note: SSR925XT and SSR535XT — no data updated; SSR778XT — connection lost."
 *
 * Radars are grouped by status so a site with six link-down radars gets one
 * clause, not six. Empty string when nothing is missing — the caller drops the
 * whole paragraph.
 */
export function buildStatusNote(
    missing: MissingRadar[],
    locale: EmailLocale = 'en'
): string {
    if (!missing.length) return '';

    const groups = new Map<string, string[]>();
    for (const m of missing) {
        const key = String(m.status || '').trim();
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(m.radarNumber);
    }

    const rank = (status: string) => {
        const i = STATUS_ORDER.indexOf(status);
        return i === -1 ? STATUS_ORDER.length : i;
    };

    const clauses = Array.from(groups.entries())
        .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
        .map(([status, radars]) => {
            const sorted = [...radars].sort();
            return `${joinRadars(sorted, locale)} — ${statusPhrase(status, locale)}`;
        });

    return `${wording(locale).note}: ${clauses.join('; ')}.`;
}

// ---------------------------------------------------------------------------
// The draft
// ---------------------------------------------------------------------------

/**
 * To / Cc follow the convention every other draft in the app uses: the site's
 * own Outlook distribution group, copied to DTG Engineers. Both are group
 * DISPLAY NAMES that Outlook resolves — not addresses.
 */
export const siteGroupFor = (siteName: string): string => `"${siteName} [All]"`;

/**
 * Close the gap a missing radar list leaves behind. The caller refuses to draft
 * with nothing to attach, so this only ever fires on a degenerate input — but a
 * draft with "Services of  - Telfer" in the subject must never reach a client.
 */
const tidy = (line: string): string =>
    line
        .replace(/\s+of\s+-\s/g, ' - ')
        .replace(/ {2,}/g, ' ')
        .trim();

export function buildDailyReportDraft({
    siteName,
    reportedRadars,
    missingRadars,
    periodDate,
    senderName,
    locale = 'en',
    variant = 'radar',
    span,
}: DailyReportDraftInput): DailyReportDraft {
    const w = wording(locale);
    const v = w.variants[variant] ?? w.variants.radar;

    const parts: DraftParts = {
        radars: joinRadars([...reportedRadars].sort(), locale),
        siteName,
        period: formatPeriodDate(periodDate, locale),
        span: (span || DEFAULT_SPAN).trim(),
    };

    const note = buildStatusNote(missingRadars, locale);

    const body = [
        w.greeting,
        '',
        tidy(v.attached(parts)),
        ...(note ? ['', note] : []),
        '',
        w.thanks,
        '',
        w.regards,
        senderName,
    ].join('\n');

    return {
        subject: tidy(v.subject(parts)),
        body,
        to: siteGroupFor(siteName),
        cc: DTG_INTERNAL_GROUP,
    };
}
