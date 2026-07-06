'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  SiteSchedule,
  Cadence,
  periodStart,
  startOfToday,
  startOfWeek,
  startOfMonth,
} from './scheduleUtils';
import {
  RADAR_TYPE,
  BULLETIN_TYPES,
  reportTypeDef,
  defaultScheduleFor,
} from './reportTypes';

const LEGACY_SCHEDULES_KEY = 'reportSchedules';

/** Composite key for the schedule map: one schedule per (site, report type). */
const scheduleKey = (siteId: string, reportType: string) => `${siteId}::${reportType}`;

/** Extract a human-readable message from a Supabase/PostgREST error object. */
function describeError(e: any): string {
  if (!e) return 'unknown error';
  const parts = [e.message, e.details, e.hint, e.code].filter(Boolean);
  if (parts.length) return parts.join(' | ');
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export interface SensorReportStatus {
  radarNumber: string;
  /** A report referencing this sensor was uploaded today (local date). */
  generatedToday: boolean;
}

/** A non-radar (bulletin) report obligation for a site. */
export interface BulletinObligation {
  type: string; // report type key, e.g. 'insar'
  label: string;
  cadence: Cadence;
  schedule: SiteSchedule;
  /** True when a report of this type was uploaded for the site this period. */
  generatedInPeriod: boolean;
}

export interface SiteReportStatus {
  id: string;
  name: string;
  /** True when the site has at least one radar sensor in the wall registry. */
  hasRadar: boolean;
  sensorCount: number;
  sensors: SensorReportStatus[];
  /** Radar sensors still missing today's report. */
  pendingSensors: SensorReportStatus[];
  /** True only when every radar sensor has a report today. */
  generatedToday: boolean;
  /** Daily radar report schedule. */
  schedule: SiteSchedule;
  /** Opt-in bulletin obligations (InSAR, VWP, …), one per configured type. */
  bulletins: BulletinObligation[];
  /** True while a Supabase upsert is in flight for this site. */
  saving: boolean;
  /** Non-null when the last upsert for this site failed; contains the error message. */
  saveError: string | null;
}

/**
 * Pure function: merges the client (site) list, radar sensor registry rows,
 * today's reports, the schedule map, and the per-type "generated this period"
 * sets into a sorted array of SiteReportStatus.
 *
 * - Sites are the union of `clients` and any radar-wall site_id (so sites with
 *   radar but no client row are not dropped).
 * - Radar sensors are grouped by site_id (Archive rows excluded, deduplicated),
 *   and matched case-insensitively against today's report filenames.
 * - Each site gets its radar schedule plus a bulletin obligation per configured
 *   bulletin type, applying defaults where no stored row exists.
 * - Sorted alphabetically by name.
 */
export function mergeSites(
  clients: Array<{ id: string; name: string }>,
  registryRows: Array<{
    radar_number: string | null;
    site_id: string | null;
    type?: string | null;
  }>,
  todayReports: Array<{ filename: string; clientId: string | null }>,
  scheduleMap: Map<string, SiteSchedule>,
  bulletinGenerated: Map<string, Set<string>> = new Map()
): SiteReportStatus[] {
  const normalisedReports = todayReports.map((r) => ({
    filename: r.filename.toLowerCase(),
    clientId: r.clientId,
  }));

  // Radar sensors grouped by site, deduplicated.
  const sensorsBySite = new Map<string, Set<string>>();
  for (const row of registryRows) {
    if (row.type === 'Archive') continue;
    if (row.site_id == null || !row.radar_number) continue;
    const sid = String(row.site_id);
    if (!sensorsBySite.has(sid)) sensorsBySite.set(sid, new Set<string>());
    sensorsBySite.get(sid)!.add(String(row.radar_number));
  }

  // Union of client sites and any radar-wall-only sites.
  const names = new Map<string, string>();
  for (const c of clients) names.set(String(c.id), c.name || `Site ${c.id}`);
  for (const sid of sensorsBySite.keys()) {
    if (!names.has(sid)) names.set(sid, `Site ${sid}`);
  }

  const isGenerated = (siteId: string, radarNumber: string): boolean => {
    const needle = radarNumber.toLowerCase();
    return normalisedReports.some(
      (r) =>
        (r.clientId == null || r.clientId === siteId) && r.filename.includes(needle)
    );
  };

  return Array.from(names.entries())
    .map(([id, name]) => {
      const sensors: SensorReportStatus[] = Array.from(sensorsBySite.get(id) ?? [])
        .sort()
        .map((radarNumber) => ({
          radarNumber,
          generatedToday: isGenerated(id, radarNumber),
        }));
      const pendingSensors = sensors.filter((s) => !s.generatedToday);

      const bulletins: BulletinObligation[] = BULLETIN_TYPES.map((def) => ({
        type: def.key,
        label: def.label,
        cadence: def.cadence,
        schedule: scheduleMap.get(scheduleKey(id, def.key)) ?? defaultScheduleFor(def),
        generatedInPeriod: bulletinGenerated.get(def.key)?.has(id) ?? false,
      }));

      return {
        id,
        name,
        hasRadar: sensors.length > 0,
        sensorCount: sensors.length,
        sensors,
        pendingSensors,
        generatedToday: pendingSensors.length === 0,
        schedule:
          scheduleMap.get(scheduleKey(id, RADAR_TYPE.key)) ??
          defaultScheduleFor(RADAR_TYPE),
        bulletins,
        saving: false,
        saveError: null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Pure optimistic-update transform used by `saveSchedule`: returns a new sites
 * array where only the target site has `patch` merged into the schedule for
 * `reportType` (radar schedule, or the matching bulletin) and is flagged as
 * saving. Every other site is returned by reference, unchanged.
 */
export function applyOptimisticPatch(
  sites: SiteReportStatus[],
  siteId: string,
  patch: Partial<SiteSchedule>,
  reportType: string = RADAR_TYPE.key
): SiteReportStatus[] {
  return sites.map((s) => {
    if (s.id !== siteId) return s;
    if (reportType === RADAR_TYPE.key) {
      return { ...s, schedule: { ...s.schedule, ...patch }, saving: true, saveError: null };
    }
    return {
      ...s,
      bulletins: s.bulletins.map((b) =>
        b.type === reportType ? { ...b, schedule: { ...b.schedule, ...patch } } : b
      ),
      saving: true,
      saveError: null,
    };
  });
}

/**
 * One-time migration of any legacy localStorage `reportSchedules` map into the
 * `site_report_schedules` Supabase table as the site's radar schedule. Only
 * sites that do not already have a radar row are upserted. On success the legacy
 * key is removed; on failure it is preserved and the error is logged.
 */
export async function migrateFromLocalStorage(
  existingRadarSiteIds: Set<string>
): Promise<void> {
  if (typeof window === 'undefined') return;

  const raw = window.localStorage.getItem(LEGACY_SCHEDULES_KEY);
  if (!raw) return;

  let legacy: Record<string, SiteSchedule>;
  try {
    legacy = JSON.parse(raw) as Record<string, SiteSchedule>;
  } catch {
    window.localStorage.removeItem(LEGACY_SCHEDULES_KEY);
    return;
  }

  const toUpsert = Object.entries(legacy)
    .filter(([siteId]) => !existingRadarSiteIds.has(siteId))
    .map(([site_id, s]) => ({
      site_id,
      report_type: RADAR_TYPE.key,
      cadence: RADAR_TYPE.cadence,
      deadline: s.deadline,
      reminder: s.reminder,
      weekday: null,
      enabled: s.enabled,
      updated_at: new Date().toISOString(),
    }));

  if (toUpsert.length === 0) {
    window.localStorage.removeItem(LEGACY_SCHEDULES_KEY);
    return;
  }

  const { error } = await supabase.from('site_report_schedules').upsert(toUpsert);
  if (error) {
    console.error(
      '[ReportScheduler] Migration failed — localStorage data preserved:',
      error
    );
    return;
  }
  window.localStorage.removeItem(LEGACY_SCHEDULES_KEY);
}

export function useReportSchedules() {
  const [sites, setSites] = useState<SiteReportStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const migratedRef = useRef(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Earliest report we need: the start of the earliest active period across
      // all cadences (weekly can begin before the month does).
      const now = new Date();
      const earliest = new Date(
        Math.min(startOfMonth(now).getTime(), startOfWeek(now).getTime())
      ).toISOString();

      const [clientsRes, liveRes, schedulesRes, reportsRes] = await Promise.all([
        supabase.from('clients').select('id, site_name'),
        supabase
          .from('latest_radar_wall_folders')
          .select('radar_number, site_id')
          .neq('type', 'Archive'),
        supabase
          .from('site_report_schedules')
          .select('site_id, report_type, cadence, deadline, reminder, weekday, enabled'),
        supabase
          .from('reports')
          .select('client_id, filename, type, created_at')
          .gte('created_at', earliest),
      ]);

      if (clientsRes.error) throw clientsRes.error;
      if (liveRes.error) throw liveRes.error;

      const clients = (clientsRes.data || []).map((c: any) => ({
        id: String(c.id),
        name: String(c.site_name || `Site ${c.id}`),
      }));

      const allReports = (reportsRes.data || []).map((r: any) => ({
        clientId: r.client_id != null ? String(r.client_id) : null,
        filename: String(r.filename || ''),
        type: r.type != null ? String(r.type).toLowerCase() : '',
        createdAt: new Date(r.created_at),
      }));
      if (reportsRes.error) {
        console.error(
          '[ReportScheduler] Failed to load reports — assuming none:',
          describeError(reportsRes.error)
        );
      }

      // Today's reports feed radar sensor matching.
      const todayStart = startOfToday(now);
      const todayReports = allReports
        .filter((r) => r.createdAt >= todayStart)
        .map((r) => ({ filename: r.filename, clientId: r.clientId }));

      // For each bulletin type, the set of sites that already have a report of
      // that type within the type's period.
      const bulletinGenerated = new Map<string, Set<string>>();
      for (const def of BULLETIN_TYPES) {
        const start = periodStart(def.cadence, now);
        const key = def.key.toLowerCase();
        const set = new Set<string>();
        for (const r of allReports) {
          if (r.clientId == null) continue;
          if (r.type === key && r.createdAt >= start) set.add(r.clientId);
        }
        bulletinGenerated.set(def.key, set);
      }

      // Schedule map keyed by (site, report type). On failure, fall back to
      // defaults for every type.
      const scheduleMap = new Map<string, SiteSchedule>();
      if (schedulesRes.error) {
        console.error(
          '[ReportScheduler] Failed to load schedules — using defaults:',
          describeError(schedulesRes.error),
          '\nIf this says a column does not exist, run migrations 002 + 003 in Supabase.'
        );
      } else {
        for (const row of schedulesRes.data || []) {
          scheduleMap.set(scheduleKey(String(row.site_id), String(row.report_type)), {
            deadline: row.deadline,
            reminder: row.reminder,
            enabled: row.enabled,
            weekday: row.weekday ?? null,
          });
        }
      }

      const merged = mergeSites(
        clients,
        liveRes.data || [],
        todayReports,
        scheduleMap,
        bulletinGenerated
      );
      setSites(merged);

      if (!migratedRef.current) {
        migratedRef.current = true;
        const radarSites = new Set<string>();
        for (const key of scheduleMap.keys()) {
          if (key.endsWith(`::${RADAR_TYPE.key}`)) radarSites.add(key.split('::')[0]);
        }
        void migrateFromLocalStorage(radarSites);
      }
    } catch (err) {
      console.error('Error loading report schedules:', err);
      setSites([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const saveSchedule = useCallback(
    (
      siteId: string,
      patch: Partial<SiteSchedule>,
      reportType: string = RADAR_TYPE.key
    ) => {
      const def = reportTypeDef(reportType) ?? RADAR_TYPE;
      const site = sites.find((s) => s.id === siteId);
      const current =
        reportType === RADAR_TYPE.key
          ? site?.schedule
          : site?.bulletins.find((b) => b.type === reportType)?.schedule;
      const rollback = current ?? defaultScheduleFor(def);
      const updated: SiteSchedule = { ...rollback, ...patch };

      setSites((prev) => applyOptimisticPatch(prev, siteId, patch, reportType));

      supabase
        .from('site_report_schedules')
        .upsert({
          site_id: siteId,
          report_type: reportType,
          cadence: def.cadence,
          deadline: updated.deadline,
          reminder: updated.reminder,
          weekday: updated.weekday ?? null,
          enabled: updated.enabled,
          updated_at: new Date().toISOString(),
        })
        .then(({ error }) => {
          if (error) {
            const msg = describeError(error);
            console.error(
              `[ReportScheduler] Failed to save ${reportType} schedule for site ${siteId}:`,
              msg,
              '\nIf this says a column does not exist or no unique/exclusion constraint, run migration 004 in Supabase.'
            );
            setSites((prev) =>
              prev.map((s) => {
                if (s.id !== siteId) return s;
                if (reportType === RADAR_TYPE.key) {
                  return { ...s, schedule: rollback, saving: false, saveError: msg };
                }
                return {
                  ...s,
                  bulletins: s.bulletins.map((b) =>
                    b.type === reportType ? { ...b, schedule: rollback } : b
                  ),
                  saving: false,
                  saveError: msg,
                };
              })
            );
          } else {
            setSites((prev) =>
              prev.map((s) =>
                s.id === siteId ? { ...s, saving: false, saveError: null } : s
              )
            );
          }
        });
    },
    [sites]
  );

  return { sites, loading, saveSchedule, refresh: fetchData };
}
