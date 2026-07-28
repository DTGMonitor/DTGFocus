'use client';

/**
 * Fetch orchestrator for the Comprehensive radar report.
 *
 * Pulls everything the report needs for one sensor and one window, runs it
 * through the pure derivations, and hands the template a ready-to-render shape.
 *
 * Never throws: a failed section degrades to an empty state so the rest of the
 * report still generates. Partial data is more useful than no report.
 *
 * All queries mirror the live surfaces they come from (SensorDetail, AlarmTab,
 * RadarDetail) — there is no API route layer for radar data; it is all direct
 * Supabase from the browser.
 */

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { resolveTimelineChain, normalizePrecursorss, resolveDetectedBy } from '@/utils/tabHelpers';
import { trimChain, isTrimmedHeadTrueRoot } from '@/utils/reportTimeline';
import { computeAvailability, windowForFrequency } from '@/utils/reportAvailability';
import { fromUTC } from '@/utils/timezoneUtils';
import { aggregateAlarmCauses, countValidTotal, deriveAlarmTone } from '@/utils/reportAlarms';
import { shouldIncludeChain, folderChangedInWindow } from '@/utils/reportWallFolders';
import { buildRadarRecord } from '@/utils/buildRadarRecord';
import { normalizeTarpDocument } from '@/config/tarpDocument';
import { resolveRiskPresentation, tarpPriority } from '@/config/riskDisplay';
import { urlToDataUrl } from '@/components/admin/Radar/report/pdfExport';

const TIMELINE_SELECT =
  'id, created_at, location, precursors, def_type, tarp_level, isactive, start, detected_by, alarm, crosschecked_by, notification_time, site_engineer, properties, wallfolder_id';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The names `get_safe_crosscheckers` will return.
 *
 * The RPC filters on this list — passing [] matches nobody and returns zero
 * rows, which is why the report printed a raw UUID in the timeline's "By:" line
 * instead of a display name (resolveDetectedBy falls back to the UUID when the
 * lookup misses). Same list SensorDetail and HandoverTemplates already pass.
 */
const CROSSCHECKER_NAMES = ['Adib Izzuddin', 'Lintang Sadewa', 'Nurhuda Santoso', 'Nessy Salsabilita'];

/** TARP label → priority. Re-exported from riskDisplay, which owns the scale. */
export const getRiskPriority = tarpPriority;

/**
 * The sensor's rolled-up risk, worded the way its SITE words it.
 *
 * Telfer reads the highest TARP level; Leonora reads one only when it is a
 * TARP 3 or 4 and otherwise names the deformation; Hidden Valley names the band
 * colour and never a level. See config/riskDisplay.ts — the same resolution the
 * checklist board and sensor detail run, so a report cannot disagree with the
 * screen it was generated from.
 *
 * @param {object[]} records  active def_records rows
 * @param {object} sensor     the sensor row; its site decides the wording
 */
export function deriveRisk(records, sensor) {
  return resolveRiskPresentation(records, sensor);
}

/**
 * The calendar day a TARP revision took effect. Prefers the modified date (when
 * the change was actually made) and falls back to the approval date. Returned as
 * a 'YYYY-MM-DD' string — both columns are Postgres `date`s, so the slice is a
 * no-op guard rather than a truncation.
 */
function revisionDay(revision) {
  return String(revision?.modifiedDate || revision?.approvalDate || '').slice(0, 10);
}

/**
 * TARP procedural updates whose effective day falls inside the report window.
 *
 * A revision is a controlled-document change to the site's TARP; this surfaces
 * only the ones dated within the chosen period, newest first. Window bounds are
 * absolute instants, so they are converted to the SITE's calendar day (the same
 * boundary the rest of the report uses) before the inclusive day comparison.
 * Lexical compare on 'YYYY-MM-DD' is chronological.
 *
 * @param {import('@/config/tarpDocument').TarpRevision[]} revisions
 * @param {Date|string|number} windowStart
 * @param {Date|string|number} windowEnd
 * @param {string} timeZone  Site IANA timezone.
 */
export function filterTarpUpdatesInWindow(revisions, windowStart, windowEnd, timeZone = 'UTC') {
  const startDay = (fromUTC(new Date(windowStart).toISOString(), timeZone) || '').slice(0, 10);
  const endDay = (fromUTC(new Date(windowEnd).toISOString(), timeZone) || '').slice(0, 10);
  if (!startDay || !endDay) return [];

  return (revisions ?? [])
    .filter((r) => {
      const day = revisionDay(r);
      return day && day >= startDay && day <= endDay;
    })
    .sort((a, b) => {
      const cmp = revisionDay(b).localeCompare(revisionDay(a));
      return cmp !== 0 ? cmp : (b?.seq ?? 0) - (a?.seq ?? 0);
    });
}

/**
 * @param {object} sensor      { wallfolder_id, radar_number, brand, dqp_record_id, site_name, ... }
 * @param {string} frequency   'daily' | 'weekly' | 'monthly'
 * @param {string} endDate     ISO date string ('YYYY-MM-DD') — the window end.
 * @param {boolean} enabled
 */
export function useComprehensiveReportData(sensor, frequency, endDate, enabled = true) {
  // Keyed state rather than a `loading` flag we flip on: setting state
  // synchronously inside an effect triggers cascading renders. `loading` is
  // derived instead — we're loading whenever the settled result predates the
  // current request key.
  const [state, setState] = useState({ key: null, data: null, error: null });

  // The report-day boundary is 05:00 in the SITE's timezone (never the viewer's
  // browser clock), so a report opened in the morning covers the previous day's
  // overnight downtime. Default to UTC when the sensor carries no timezone.
  const timeZone = sensor?.timezone || 'UTC';

  // The report day ('YYYY-MM-DD'): the chosen End Date, else today in the site tz.
  const reportDay = useMemo(
    () => endDate || (fromUTC(new Date().toISOString(), timeZone) || '').slice(0, 10),
    [endDate, timeZone]
  );

  // Freeze the window so re-renders don't shift it mid-report. The window end
  // tracks `now` for the current/open period (so still-open downtime counts up to
  // the present), captured once here rather than on every render.
  const { windowStart, windowEnd } = useMemo(
    () => windowForFrequency(frequency, reportDay, timeZone, Date.now()),
    [frequency, reportDay, timeZone]
  );

  const requestKey = useMemo(
    () => (enabled && sensor?.wallfolder_id
      ? `${sensor.wallfolder_id}|${sensor.dqp_record_id ?? ''}|${windowStart.toISOString()}|${windowEnd.toISOString()}`
      : 'idle'),
    [enabled, sensor?.wallfolder_id, sensor?.dqp_record_id, windowStart, windowEnd]
  );

  useEffect(() => {
    if (!enabled || !sensor?.wallfolder_id) {
      setState({ key: 'idle', data: null, error: null });
      return undefined;
    }

    let cancelled = false;
    const warn = (what) => (err) => {
      console.warn(`[Comprehensive report] ${what} failed:`, err);
      return null;
    };

    (async () => {
      // ── Phase 1: folder-independent sections + the folder registry ─────────
      // The folder registry has to resolve before deformation / downtime / alarm
      // can query, since those now span every folder this radar has ever had.
      const [
        crosscheckersRes,
        foldersRes,
        dqpRes,
        tarpRes,
      ] = await Promise.all([
        supabase
          .rpc('get_safe_crosscheckers', { target_names: CROSSCHECKER_NAMES })
          .then((r) => r.data)
          .catch(warn('crosscheckers')),

        // Every wall folder for this RADAR (current + archived), so records logged
        // under a now-archived folder within the window are not lost. `sensor.id`
        // is the radar id (the sensor is a latest_radar_wall_folders row).
        sensor.id != null
          ? supabase
              .from('radar_wall_folders')
              .select('id, name, area, type, commenced_at, decommissioned_at, location_group')
              .eq('radar_id', sensor.id)
              .order('commenced_at', { ascending: true })
              .then((r) => { if (r.error) throw r.error; return r.data; })
              .catch(warn('wall folders'))
          : Promise.resolve(null),

        sensor.dqp_record_id
          ? supabase
              .from('dqp_values')
              .select('value, notes, appendix, caption, parameter_id, image:client_images(image_url), parameters!inner(id, name, level, parent_id)')
              .eq('dqp_record_id', sensor.dqp_record_id)
              .in('parameters.level', [0, 1, 2])
              .then((r) => { if (r.error) throw r.error; return r.data; })
              .catch(warn('data quality values'))
          : Promise.resolve(null),

        // The active TARP document carries the FULL revision history (each new
        // version copies its predecessors' rows forward — see tarp_save_revision),
        // so the one active row is enough to find every procedural update.
        sensor.site_id
          ? supabase
              .from('tarp_documents')
              .select('heading, version, revisions:tarp_revisions(id, seq, version_no, approval_date, approved_by_site, site_role, approved_by_dtg, dtg_role, modified_date, sections_modified, remark)')
              .eq('site_id', sensor.site_id)
              .eq('status', 'active')
              .maybeSingle()
              .then((r) => { if (r.error) throw r.error; return r.data; })
              .catch(warn('TARP document'))
          : Promise.resolve(null),
      ]);

      if (cancelled) return;

      // The folder set. Fall back to the current folder alone if discovery failed
      // or the sensor carries no radar id — the report must still render. The
      // fallback's location_group degrades to `area` (matching the DB backfill).
      const folders = foldersRes && foldersRes.length
        ? foldersRes
        : [{
            id: sensor.wallfolder_id,
            name: sensor.wallfoldername ?? sensor.wall_name ?? null,
            area: sensor.area ?? null,
            type: 'Live',
            commenced_at: null,
            decommissioned_at: null,
            location_group: sensor.location_group ?? sensor.area ?? null,
          }];
      const folderIds = folders.map((f) => f.id);
      const folderById = new Map(folders.map((f) => [f.id, f]));
      const currentFolderId = sensor.wallfolder_id;

      // ── Phase 2: folder-dependent sections, spanning every folder ──────────
      const [defRes, downtimeRes, regionsRes] = await Promise.all([
        supabase
          .from('def_records')
          .select(TIMELINE_SELECT)
          .in('wallfolder_id', folderIds)
          .eq('isactive', 'Yes')
          .order('created_at', { ascending: false })
          .then((r) => { if (r.error) throw r.error; return r.data; })
          .catch(warn('deformation records')),

        supabase
          .from('downtime_records')
          .select('id, reason, from, to, wallfolder')
          .in('wallfolder', folderIds)
          .or(`to.gte.${windowStart.toISOString()},to.is.null`)
          .then((r) => { if (r.error) throw r.error; return r.data; })
          .catch(warn('downtime records')),

        supabase
          .from('alarm_regions')
          .select('id, name, alarmtype, wallfolder')
          .in('wallfolder', folderIds)
          .then((r) => { if (r.error) throw r.error; return r.data; })
          .catch(warn('alarm regions')),
      ]);

      if (cancelled) return;

      // ── Alarms: regions → records (no direct wall-folder FK on alarm_records) ──
      // Always the latest 24h, regardless of report granularity (Requirement 7.1).
      const regionIds = (regionsRes ?? []).map((r) => r.id);
      const since = new Date(Date.now() - ONE_DAY_MS).toISOString();
      const alarmRecords = regionIds.length
        ? await supabase
            .from('alarm_records')
            .select('id, triggered_at, alarm_region, location, reason, cause, detected_by')
            // triggered_at, not created_at: the latter is row-insert time.
            .in('alarm_region', regionIds)
            .gte('triggered_at', since)
            .order('triggered_at', { ascending: false })
            .then((r) => { if (r.error) throw r.error; return r.data; })
            .catch(warn('alarm records'))
        : [];

      if (cancelled) return;

      // ── Deformation: head records → resolve chain → trim ───────────────────
      const defRecords = defRes ?? [];
      const referenced = new Set();
      defRecords.forEach((d) => normalizePrecursorss(d.precursors).forEach((id) => referenced.add(String(id))));
      const heads = defRecords.filter((d) => !referenced.has(String(d.id)));

      const fetchRecordById = async (id) => {
        const { data, error } = await supabase
          .from('def_records')
          .select(TIMELINE_SELECT)
          .eq('id', id)
          .single();
        if (error) throw error;
        return data;
      };

      let timelineError = null;
      const timelines = [];
      // One instant for every chain, captured once and handed to the template.
      // Trimming and the "is this node still recent" muting MUST agree on the
      // clock, or a node can be trimmed in as recent and then rendered as stale.
      const timelineNow = Date.now();
      // N+1 by nature (one round-trip per ancestor). Acceptable for a single
      // sensor's heads; would need a recursive-CTE RPC if this ever goes
      // site-wide across many radars.
      for (const head of heads) {
        try {
          const { chain, error } = await resolveTimelineChain(head, fetchRecordById);
          if (error) timelineError = error;

          // Tag the chain with the folder its head belongs to. The current folder
          // always contributes; an archived folder only when the chain has a node
          // inside the window (see shouldIncludeChain), so stale history from a
          // long-retired wall does not resurface.
          const folder = folderById.get(head.wallfolder_id) ?? null;
          const isCurrent = head.wallfolder_id === currentFolderId;
          if (!shouldIncludeChain({ isCurrent, chain, windowStart, windowEnd })) continue;

          const trimmed = trimChain(chain, timelineNow);
          timelines.push({
            chain,
            trimmed,
            headIsTrueRoot: isTrimmedHeadTrueRoot(chain, trimmed),
            folder,
            isCurrent,
          });
        } catch (err) {
          console.warn('[Comprehensive report] timeline resolution failed:', err);
          timelineError = 'Timeline may be incomplete.';
        }
      }

      if (cancelled) return;

      // ── Deformation image (best-effort) ───────────────────────────────────
      let deformationImage = null;
      try {
        const path = `${sensor.company ?? sensor.site_name}/${sensor.site_name}/${sensor.wallfoldername ?? sensor.wall_name}.jpg`;
        const { data: signed } = await supabase.storage.from('Deformation').createSignedUrl(path, 3600);
        if (signed?.signedUrl) deformationImage = await urlToDataUrl(signed.signedUrl);
      } catch (err) {
        console.warn('[Comprehensive report] deformation image unavailable:', err);
      }

      if (cancelled) return;

      // ── Derivations ───────────────────────────────────────────────────────
      const dqpRows = dqpRes ?? [];
      const radarRecord = buildRadarRecord(sensor, dqpRows);
      // Downtime spans every folder of the radar (hardware availability), so the
      // same outage logged under the old and the new folder during a changeover is
      // unioned rather than double-counted — hence mergeOverlaps.
      const availability = computeAvailability(downtimeRes ?? [], windowStart, windowEnd, {
        isOff: String(sensor.status ?? '').toLowerCase().includes('lost'),
        mergeOverlaps: true,
      });

      // Overall alarm figures (all folders) drive the KPI tile and the single-pie
      // fallback; the per-folder breakdown drives the labelled rendering.
      const alarmCauses = aggregateAlarmCauses(alarmRecords ?? []);
      const alarmCounts = countValidTotal(alarmRecords ?? []);
      // Severity lives on the region, so the tone needs both sides of the join.
      const alarmTone = deriveAlarmTone(alarmRecords ?? [], regionsRes ?? []);

      // Attribute each alarm to its wall folder (record → region → folder).
      const regionToFolder = new Map((regionsRes ?? []).map((r) => [r.id, r.wallfolder]));
      const alarmByFolder = new Map();
      for (const rec of alarmRecords ?? []) {
        const fid = regionToFolder.get(rec.alarm_region);
        if (!alarmByFolder.has(fid)) alarmByFolder.set(fid, []);
        alarmByFolder.get(fid).push(rec);
      }
      const alarmFolders = [...alarmByFolder.entries()].map(([fid, recs]) => ({
        folder: folderById.get(fid) ?? null,
        causes: aggregateAlarmCauses(recs),
        ...countValidTotal(recs),
        tone: deriveAlarmTone(recs, regionsRes ?? []),
      }));

      // Which folders actually fed this report — downtime, deformation, or alarm.
      // A single note under the KPIs fires whenever more than one contributed.
      const overlapsWindow = (d) => {
        const from = new Date(d?.from).getTime();
        const to = d?.to ? new Date(d.to).getTime() : windowEnd.getTime();
        return from <= windowEnd.getTime() && to >= windowStart.getTime();
      };
      const contributing = new Set();
      (downtimeRes ?? []).forEach((d) => {
        if (folderById.has(d.wallfolder) && overlapsWindow(d)) contributing.add(d.wallfolder);
      });
      timelines.forEach((t) => { if (t.folder?.id != null) contributing.add(t.folder.id); });
      alarmFolders.forEach((a) => { if (a.folder?.id != null && a.total > 0) contributing.add(a.folder.id); });

      const contributingFolders = [...contributing]
        .map((id) => folderById.get(id))
        .filter(Boolean);
      const wallFolders = {
        all: folders,
        contributing: contributingFolders,
        multiFolder: contributingFolders.length > 1,
        changedInWindow: folderChangedInWindow(folders, windowStart, windowEnd),
        currentFolderId,
      };

      const riskPresentation = deriveRisk(defRecords, sensor);

      // Procedural (TARP) updates dated within the report window.
      const tarpDoc = normalizeTarpDocument(tarpRes);
      const tarpUpdates = filterTarpUpdatesInWindow(
        tarpDoc?.revisions ?? [],
        windowStart,
        windowEnd,
        timeZone,
      );

      setState({
        key: requestKey,
        error: null,
        data: {
          window: { windowStart, windowEnd },
          // `risk` stays the printed label so every existing consumer keeps
          // working; `riskPresentation` carries the colour and severity behind it.
          risk: riskPresentation.label,
          riskPresentation,
          quality: {
            label: sensor.quality ?? null,
            score: typeof sensor.normalised_score === 'number' ? sensor.normalised_score : null,
          },
          availability,
          alarms: {
            causes: alarmCauses,
            ...alarmCounts,
            tone: alarmTone,
            regions: regionsRes ?? [],
            byFolder: alarmFolders,
          },
          wallFolders,
          radarRecord,
          dqpRows,
          timelines,
          timelineError,
          timelineNow,
          deformationImage,
          crosscheckers: crosscheckersRes ?? [],
          tarp: {
            heading: tarpDoc?.heading ?? null,
            version: tarpDoc?.version ?? null,
            hasDocument: Boolean(tarpDoc),
            updates: tarpUpdates,
          },
        },
      });
    })().catch((err) => {
      if (cancelled) return;
      console.error('[Comprehensive report] data load failed:', err);
      setState({ key: requestKey, data: null, error: err.message ?? 'Failed to load report data.' });
    });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  return { data: state.data, error: state.error, loading: state.key !== requestKey };
}

export { resolveDetectedBy };
export default useComprehensiveReportData;
