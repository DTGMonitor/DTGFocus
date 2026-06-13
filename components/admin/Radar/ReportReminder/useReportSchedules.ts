'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  SiteSchedule,
  SCHEDULES_UPDATED_EVENT,
  getSchedule,
  loadSchedules,
  saveSchedule as persistSchedule,
} from './scheduleUtils';

export interface SensorReportStatus {
  radarNumber: string;
  /** A report referencing this sensor was uploaded today (local date). */
  generatedToday: boolean;
}

export interface SiteReportStatus {
  id: string;
  name: string;
  sensorCount: number;
  sensors: SensorReportStatus[];
  /** Sensors still missing today's report. */
  pendingSensors: SensorReportStatus[];
  /** True only when every sensor has a report today. */
  generatedToday: boolean;
  schedule: SiteSchedule;
}

/**
 * Fetches the live sensors (same source as the hourly checklist —
 * `latest_radar_wall_folders`, excluding Archive), groups them by site, and
 * marks each sensor as generated when a report uploaded today references its
 * radar number. Only sites that have live sensors are returned. Merged with the
 * locally-managed reminder schedule.
 */
export function useReportSchedules() {
  const [sites, setSites] = useState<SiteReportStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const startOfTodayISO = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [liveRes, reportsRes] = await Promise.all([
        supabase
          .from('latest_radar_wall_folders')
          .select('radar_number, site_id, site_name')
          .neq('type', 'Archive'),
        supabase
          .from('reports')
          .select('filename, client_id, created_at')
          .gte('created_at', startOfTodayISO()),
      ]);

      if (liveRes.error) throw liveRes.error;

      // Today's report filenames (lowercased) keyed by owning site where known.
      const todayReports = (reportsRes.data || []).map((r: any) => ({
        filename: String(r.filename || '').toLowerCase(),
        clientId: r.client_id != null ? String(r.client_id) : null,
      }));

      // Group live sensors by site (dedupe radar numbers).
      const siteMap = new Map<string, { name: string; sensors: Set<string> }>();
      (liveRes.data || []).forEach((row: any) => {
        if (row.site_id == null || !row.radar_number) return;
        const sid = String(row.site_id);
        if (!siteMap.has(sid)) {
          siteMap.set(sid, {
            name: row.site_name || `Site ${sid}`,
            sensors: new Set<string>(),
          });
        }
        siteMap.get(sid)!.sensors.add(String(row.radar_number));
      });

      const stored = loadSchedules();

      const isGenerated = (siteId: string, radarNumber: string) => {
        const needle = radarNumber.toLowerCase();
        return todayReports.some(
          (r) =>
            (r.clientId == null || r.clientId === siteId) &&
            r.filename.includes(needle)
        );
      };

      const merged: SiteReportStatus[] = Array.from(siteMap.entries())
        .map(([id, info]) => {
          const sensors: SensorReportStatus[] = Array.from(info.sensors)
            .sort()
            .map((radarNumber) => ({
              radarNumber,
              generatedToday: isGenerated(id, radarNumber),
            }));
          const pendingSensors = sensors.filter((s) => !s.generatedToday);
          return {
            id,
            name: info.name,
            sensorCount: sensors.length,
            sensors,
            pendingSensors,
            generatedToday: pendingSensors.length === 0,
            schedule: getSchedule(stored, id),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      setSites(merged);
    } catch (err) {
      console.error('Error loading report schedules:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Keep schedules in sync when edited elsewhere in the same tab.
  useEffect(() => {
    const reload = () => {
      const stored = loadSchedules();
      setSites((prev) =>
        prev.map((s) => ({ ...s, schedule: getSchedule(stored, s.id) }))
      );
    };
    window.addEventListener(SCHEDULES_UPDATED_EVENT, reload);
    window.addEventListener('storage', reload);
    return () => {
      window.removeEventListener(SCHEDULES_UPDATED_EVENT, reload);
      window.removeEventListener('storage', reload);
    };
  }, []);

  const saveSchedule = useCallback(
    (siteId: string, patch: Partial<SiteSchedule>) => {
      persistSchedule(siteId, patch);
      // Optimistic local update (event listener also fires).
      setSites((prev) =>
        prev.map((s) =>
          s.id === siteId ? { ...s, schedule: { ...s.schedule, ...patch } } : s
        )
      );
    },
    []
  );

  return { sites, loading, saveSchedule, refresh: fetchData };
}
