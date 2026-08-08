'use client';

// "Send Report" on a site's radar obligation.
//
// The Scheduled Reports panel already knows WHICH radars reported today; this
// fills in everything the email needs that the panel does not carry — the
// report filenames to attach, the day those reports cover, and the live status
// of every radar that did not report.
//
// mailto: cannot carry an attachment, which is why every DTG draft is
// hand-attached today. So the PDFs are downloaded to the operator's Downloads
// folder FIRST and the draft is raised afterwards, matching what
// HandoverTemplates already does: the files are sitting there, freshly written,
// when Outlook opens.

import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { openOutlookDraft } from '@/utils/openOutlookDraft';
import { resolveEmailLocale } from '@/config/emailLocale';
import { startOfToday } from './scheduleUtils';
import {
    buildDailyReportDraft,
    DailyReportDraft,
    MissingRadar,
    ReportVariant,
} from './dailyReportDraft';

const BUCKET_NAME = 'Reports';

/** Consecutive programmatic downloads are throttled by Chrome without a gap. */
const DOWNLOAD_GAP_MS = 400;

interface ReportRow {
    filename: string;
    /** The day the report COVERS (reports.date), not created_at. */
    date: string | null;
    /** `reports.category`, stored lower-cased — 'data quality', 'comprehensive', … */
    category?: string | null;
}

/** What `resolveSiteReports` needs to know about one radar at the site. */
export interface RadarState {
    radarNumber: string;
    status: string | null;
}

export interface SiteReportResolution {
    reportedRadars: string[];
    missingRadars: MissingRadar[];
    /** Storage paths of the PDFs backing `reportedRadars`. */
    attachments: string[];
    /** The period every attached report covers. */
    periodDate: string | null;
    /** Which report the site produced, which decides how the draft names it. */
    variant: ReportVariant;
    /** The window a Data Quality Assessment names — read off the filename. */
    span: string | null;
}

/**
 * The assessment window as the filename writes it.
 *
 * ReportTemplateModal builds a Data Quality filename as
 * "<date> <24h|7d|30d|Nd> Data Quality Assessment of <radar> - <site>.pdf", so
 * the window the client is owed is already sitting in the name — safer than
 * re-deriving it from a cadence the report may not have been run on.
 */
export function detectSpan(filename: string): string | null {
    const m = /\b(\d+\s*[hd])\s+data quality assessment\b/i.exec(String(filename || ''));
    return m ? m[1].replace(/\s+/g, '') : null;
}

/** 'data quality' on reports.category, or the phrase in the filename. */
export function detectVariant(report: ReportRow): ReportVariant {
    const category = String(report.category || '').trim().toLowerCase();
    if (category === 'data quality') return 'dataQuality';
    return /data quality assessment/i.test(String(report.filename || ''))
        ? 'dataQuality'
        : 'radar';
}

/**
 * Pure: split the site's radars into reported / missing by matching each radar
 * number against today's report filenames, the same case-insensitive substring
 * rule `useReportSchedules.mergeSites` uses (there is no radar column on
 * `reports` — the radar lives in the filename).
 *
 * The period is taken from the reports themselves rather than assumed to be
 * yesterday: the modal writes `reports.date` as the window's end date, so a
 * report run late or re-run for an earlier day still labels itself correctly.
 * `fallbackDate` covers rows written before that column was populated.
 */
export function resolveSiteReports(
    radars: RadarState[],
    reports: ReportRow[],
    fallbackDate: string | null = null
): SiteReportResolution {
    const reportedRadars: string[] = [];
    const missingRadars: MissingRadar[] = [];
    const attachments: string[] = [];
    const periods: string[] = [];
    const matched: ReportRow[] = [];

    for (const radar of radars) {
        const needle = radar.radarNumber.toLowerCase();
        const match = reports.find((r) => r.filename.toLowerCase().includes(needle));
        if (match) {
            reportedRadars.push(radar.radarNumber);
            if (!attachments.includes(match.filename)) attachments.push(match.filename);
            if (match.date) periods.push(match.date);
            matched.push(match);
        } else {
            missingRadars.push({ radarNumber: radar.radarNumber, status: radar.status });
        }
    }

    // The variant is a property of the reports the site actually produced. A
    // mixed day has no single honest name, so it falls back to the radar
    // wording rather than calling a deformation report a quality assessment.
    const variants = new Set(matched.map(detectVariant));
    const variant: ReportVariant =
        variants.size === 1 ? Array.from(variants)[0] : 'radar';
    const span =
        variant === 'dataQuality'
            ? matched.map((r) => detectSpan(r.filename)).find(Boolean) ?? null
            : null;

    // Reports for one site on one day share a period; if they somehow disagree,
    // the most common value wins and ties fall to the earliest.
    const tally = new Map<string, number>();
    for (const p of periods) tally.set(p, (tally.get(p) ?? 0) + 1);
    const periodDate =
        Array.from(tally.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ??
        fallbackDate;

    return {
        reportedRadars: reportedRadars.sort(),
        missingRadars,
        attachments,
        periodDate,
        variant,
        span,
    };
}

/** Local 'YYYY-MM-DD' for the day before `now` — the day a morning report covers. */
export function yesterdayKey(now: Date = new Date()): string {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Pull one report out of the Reports bucket and save it to Downloads. */
async function downloadReport(path: string): Promise<void> {
    const { data, error } = await supabase.storage.from(BUCKET_NAME).download(path);
    if (error) throw error;

    const url = URL.createObjectURL(data);
    const link = document.createElement('a');
    link.href = url;
    link.download = path.split('/').pop() || 'report.pdf';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

export type SendOutcome =
    | {
          ok: true;
          draft: DailyReportDraft;
          downloaded: string[];
          /** Attachments that could not be fetched — the draft still opened. */
          failed: string[];
      }
    | { ok: false; message: string };

/**
 * `sendFor(siteId, siteName)` gathers the site's radar states and today's radar
 * reports, downloads the matching PDFs, then opens the Outlook draft. The
 * outcome carries its own failure message so a caller does not have to race the
 * `error` state.
 */
export function useDailyReportDraft(senderName: string) {
    const [sendingSiteId, setSendingSiteId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const sendFor = useCallback(
        async (siteId: string, siteName: string): Promise<SendOutcome> => {
            setSendingSiteId(siteId);
            setError(null);
            try {
                const todayStart = startOfToday().toISOString();

                const [radarsRes, reportsRes] = await Promise.all([
                    supabase
                        .from('latest_radar_wall_folders')
                        .select('radar_number, type, status, site_name, timezone')
                        .eq('site_id', siteId)
                        .neq('type', 'Archive'),
                    supabase
                        .from('reports')
                        .select('filename, date, type, category, created_at')
                        .eq('client_id', siteId)
                        .gte('created_at', todayStart),
                ]);

                if (radarsRes.error) throw radarsRes.error;
                if (reportsRes.error) throw reportsRes.error;

                // One row per wall folder — collapse to one entry per radar,
                // keeping the first non-Live status so an outage is never hidden
                // by a sibling folder that is still reporting.
                const byRadar = new Map<string, RadarState>();
                for (const row of radarsRes.data || []) {
                    const radarNumber = String(row.radar_number || '').trim();
                    if (!radarNumber) continue;
                    const status = String(row.type || row.status || '').trim() || null;
                    const existing = byRadar.get(radarNumber);
                    if (!existing || (existing.status === 'Live' && status !== 'Live')) {
                        byRadar.set(radarNumber, { radarNumber, status });
                    }
                }
                const radars = Array.from(byRadar.values()).sort((a, b) =>
                    a.radarNumber.localeCompare(b.radarNumber)
                );

                const reports: ReportRow[] = (reportsRes.data || [])
                    .filter((r: any) => String(r.type || '').toLowerCase() === 'radar')
                    .map((r: any) => ({
                        filename: String(r.filename || ''),
                        date: r.date ? String(r.date) : null,
                        category: r.category != null ? String(r.category) : null,
                    }));

                const resolved = resolveSiteReports(radars, reports, yesterdayKey());

                if (resolved.reportedRadars.length === 0) {
                    const message = 'No radar report has been generated for this site today.';
                    setError(message);
                    return { ok: false, message };
                }

                const sample: any = (radarsRes.data || [])[0] || {};
                const locale = resolveEmailLocale(
                    { site_name: sample.site_name ?? siteName, timezone: sample.timezone },
                    sample.timezone
                );

                const draft = buildDailyReportDraft({
                    siteName,
                    reportedRadars: resolved.reportedRadars,
                    missingRadars: resolved.missingRadars,
                    periodDate: resolved.periodDate,
                    senderName,
                    locale,
                    variant: resolved.variant,
                    span: resolved.span,
                });

                // Attach first, draft second — see the module note.
                const downloaded: string[] = [];
                const failed: string[] = [];
                for (const [i, path] of resolved.attachments.entries()) {
                    if (i > 0) await sleep(DOWNLOAD_GAP_MS);
                    try {
                        await downloadReport(path);
                        downloaded.push(path);
                    } catch (e) {
                        console.error('[DailyReportDraft] Attachment download failed:', path, e);
                        failed.push(path);
                    }
                }

                openOutlookDraft(draft.subject, draft.body, draft.to, draft.cc);
                return { ok: true, draft, downloaded, failed };
            } catch (e: any) {
                const message = e?.message || String(e);
                console.error('[DailyReportDraft] Failed to prepare draft:', e);
                setError(message);
                return { ok: false, message };
            } finally {
                setSendingSiteId(null);
            }
        },
        [senderName]
    );

    return { sendFor, sendingSiteId, error, clearError: () => setError(null) };
}
