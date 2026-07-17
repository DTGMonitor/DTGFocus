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
import { aggregateAlarmCauses, countValidTotal, deriveAlarmTone } from '@/utils/reportAlarms';
import { buildRadarRecord } from '@/utils/buildRadarRecord';
import { urlToDataUrl } from '@/components/admin/Radar/report/pdfExport';

const TIMELINE_SELECT =
  'id, created_at, location, precursors, def_type, tarp_level, isactive, start, detected_by, alarm, crosschecked_by, notification_time, site_engineer, properties';

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

/** TARP label → priority. Mirrors SensorDetail's getRiskPriority. */
export function getRiskPriority(tarpString) {
  if (!tarpString) return 0;
  const clean = String(tarpString).toUpperCase();
  if (clean === 'TARP 4') return 4;
  if (clean === 'TARP 3') return 3;
  if (clean === 'TARP 2') return 2;
  if (clean === 'TARP 1') return 1;
  return 0;
}

/**
 * Highest TARP among active records; 'TARP 1' when there are none.
 * Mirrors SensorDetail's localRisk derivation.
 */
export function deriveRisk(records) {
  let maxPriority = 0;
  let maxLabel = 'TARP 1';
  for (const r of records ?? []) {
    const p = getRiskPriority(r?.tarp_level);
    if (p > maxPriority) {
      maxPriority = p;
      maxLabel = r.tarp_level;
    }
  }
  return maxPriority > 0 ? maxLabel : 'TARP 1';
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

  // Freeze the window so re-renders don't shift it mid-report.
  const { windowStart, windowEnd } = useMemo(
    () => windowForFrequency(frequency, endDate ? new Date(`${endDate}T23:59:59`) : new Date()),
    [frequency, endDate]
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
      // ── Fetch every independent section in parallel ────────────────────────
      const [
        crosscheckersRes,
        defRes,
        dqpRes,
        downtimeRes,
        regionsRes,
      ] = await Promise.all([
        supabase
          .rpc('get_safe_crosscheckers', { target_names: CROSSCHECKER_NAMES })
          .then((r) => r.data)
          .catch(warn('crosscheckers')),

        supabase
          .from('def_records')
          .select(TIMELINE_SELECT)
          .eq('wallfolder_id', sensor.wallfolder_id)
          .eq('isactive', 'Yes')
          .order('created_at', { ascending: false })
          .then((r) => { if (r.error) throw r.error; return r.data; })
          .catch(warn('deformation records')),

        sensor.dqp_record_id
          ? supabase
              .from('dqp_values')
              .select('value, notes, appendix, caption, parameter_id, image:client_images(image_url), parameters!inner(id, name, level, parent_id)')
              .eq('dqp_record_id', sensor.dqp_record_id)
              .in('parameters.level', [0, 1, 2])
              .then((r) => { if (r.error) throw r.error; return r.data; })
              .catch(warn('data quality values'))
          : Promise.resolve(null),

        supabase
          .from('downtime_records')
          .select('id, reason, from, to, wallfolder')
          .eq('wallfolder', sensor.wallfolder_id)
          .or(`to.gte.${windowStart.toISOString()},to.is.null`)
          .then((r) => { if (r.error) throw r.error; return r.data; })
          .catch(warn('downtime records')),

        supabase
          .from('alarm_regions')
          .select('id, name, alarmtype')
          .eq('wallfolder', sensor.wallfolder_id)
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
          const trimmed = trimChain(chain, timelineNow);
          timelines.push({
            chain,
            trimmed,
            headIsTrueRoot: isTrimmedHeadTrueRoot(chain, trimmed),
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
      const availability = computeAvailability(downtimeRes ?? [], windowStart, windowEnd, {
        isOff: String(sensor.status ?? '').toLowerCase().includes('lost'),
      });
      const alarmCauses = aggregateAlarmCauses(alarmRecords ?? []);
      const alarmCounts = countValidTotal(alarmRecords ?? []);
      // Severity lives on the region, so the tone needs both sides of the join.
      const alarmTone = deriveAlarmTone(alarmRecords ?? [], regionsRes ?? []);

      setState({
        key: requestKey,
        error: null,
        data: {
          window: { windowStart, windowEnd },
          risk: deriveRisk(defRecords),
          quality: {
            label: sensor.quality ?? null,
            score: typeof sensor.normalised_score === 'number' ? sensor.normalised_score : null,
          },
          availability,
          alarms: { causes: alarmCauses, ...alarmCounts, tone: alarmTone, regions: regionsRes ?? [] },
          radarRecord,
          dqpRows,
          timelines,
          timelineError,
          timelineNow,
          deformationImage,
          crosscheckers: crosscheckersRes ?? [],
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
