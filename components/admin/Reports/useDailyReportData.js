'use client';

/**
 * Fetch orchestrator for the Daily Radar Report.
 *
 * Deliberately NOT `useComprehensiveReportData`. That hook resolves nine
 * sections — availability, alarm causes, alarm improvements, TARP revisions,
 * multi-folder timeline chains — across a dozen round trips, and the daily
 * report prints none of them. It needs four things: what is moving, how good
 * the data is, the scan-area image to draw on, and when the site expects the
 * report. Everything else on the page is either derived from those or typed by
 * the analyst.
 *
 * What the two DO share is every derivation that produces a VERDICT — the risk
 * presentation, the quality classification, the summary sentences. Those are
 * imported, never restated, so the daily report and the comprehensive report
 * can never describe the same day differently.
 *
 * Never throws: a failed section degrades to an empty state so the rest of the
 * report still generates. Partial data is more useful than no report.
 */

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { fromUTC } from '@/utils/timezoneUtils';
import { resolveRiskPresentation, getRiskDisplayMode } from '@/config/riskDisplay';
import { resolveMovementTableStyle } from '@/config/movementTableStyle';
import { buildQualityNote, findOverallStatus } from '@/utils/reportDqp';
import { DQP_IMAGE_COLUMNS } from '@/utils/dqpImages';
import { urlToDataUrl } from '@/components/admin/Radar/report/pdfExport';
import { RADAR_TYPE } from '@/components/admin/Radar/ReportReminder/reportTypes';

/**
 * The columns the movement table and the risk card read.
 *
 * `precursors` is load-bearing, not decoration: the table lists one row per
 * CHAIN HEAD, and without this column every record looks like a head — a
 * superseded precursor would print beside the record that replaced it.
 */
const DEF_SELECT =
  'id, created_at, location, precursors, def_type, tarp_level, isactive, start, properties, wallfolder_id';

/**
 * The wall's monitoring-point roster, for the radars that print one row per
 * point rather than one row per active chain.
 *
 * Fetched only on that style — an SSR wall has no roster and asking for one
 * would be a round trip that can only ever return nothing.
 */
const AREA_SELECT = 'id, name, sort_order';

/**
 * A stored UTC instant as the SITE's wall clock, shaped for a
 * `<input type="datetime-local">`: 'YYYY-MM-DDTHH:mm'.
 *
 * Everything downstream of the Data Update card — `formatDataUpdate`, the
 * lateness rule — reads that value component-wise and treats it as site-local
 * and tz-naive, so the conversion has to happen HERE, once, rather than being
 * left to a `new Date()` somewhere that would re-project it through the
 * browser's zone.
 */
const siteLocalInput = (utc, timeZone) => {
  if (!utc) return '';
  try {
    return (fromUTC(utc, timeZone || 'UTC') || '').slice(0, 16);
  } catch {
    return '';
  }
};

/**
 * Today on the SITE's calendar, as 'YYYY-MM-DD'.
 *
 * The report day is a SITE day, never the viewer's: the Data Update lateness
 * rule compares a site wall-clock time against the site's deadline, and an
 * analyst in Jakarta reporting on a Makassar radar must not shift either.
 */
export const siteDay = (timeZone) => {
  try {
    return (fromUTC(new Date().toISOString(), timeZone || 'UTC') || '').slice(0, 10);
  } catch {
    return new Date().toLocaleDateString('en-CA');
  }
};

/**
 * @param {object} sensor    A latest_radar_wall_folders row.
 * @param {string} reportDay 'YYYY-MM-DD' on the SITE's calendar.
 * @param {boolean} enabled
 */
export function useDailyReportData(sensor, reportDay, enabled = true) {
  // Keyed state rather than a `loading` flag: setting state synchronously in an
  // effect cascades renders. We are loading whenever the settled result predates
  // the current request key.
  const [state, setState] = useState({ key: null, data: null, error: null });

  const timeZone = sensor?.timezone || 'UTC';
  const day = useMemo(() => reportDay || siteDay(timeZone), [reportDay, timeZone]);

  // Which movement table this radar prints. Resolved once, here, because it
  // decides both what is FETCHED (the roster) and what is RENDERED — and those
  // two must not be able to disagree.
  const movementStyle = resolveMovementTableStyle(sensor);

  const requestKey = useMemo(
    () =>
      enabled && sensor?.wallfolder_id
        ? `${sensor.wallfolder_id}|${sensor.dqp_record_id ?? ''}|${sensor.site_id ?? ''}|${day}|${movementStyle}`
        : 'idle',
    [enabled, sensor?.wallfolder_id, sensor?.dqp_record_id, sensor?.site_id, day, movementStyle]
  );

  useEffect(() => {
    if (!enabled || !sensor?.wallfolder_id) {
      setState({ key: 'idle', data: null, error: null });
      return undefined;
    }

    let cancelled = false;
    const warn = (what) => (err) => {
      console.warn(`[Daily report] ${what} failed:`, err);
      return null;
    };

    (async () => {
      const [defRes, dqpRes, scheduleRes, areaRes, checkRes] = await Promise.all([
        // The CURRENT wall folder only. The comprehensive report spans archived
        // folders so its timeline keeps its history; a daily status board is a
        // statement about the wall being scanned right now, and a record still
        // flagged active under a retired folder would out-rank everything live.
        supabase
          .from('def_records')
          .select(DEF_SELECT)
          .eq('wallfolder_id', sensor.wallfolder_id)
          .eq('isactive', 'Yes')
          .order('created_at', { ascending: false })
          .then((r) => {
            if (r.error) throw r.error;
            return r.data;
          })
          .catch(warn('deformation records')),

        sensor.dqp_record_id
          ? supabase
              .from('dqp_values')
              .select(`value, notes, appendix, parameter_id, ${DQP_IMAGE_COLUMNS}, parameters!inner(id, name, level, parent_id)`)
              .eq('dqp_record_id', sensor.dqp_record_id)
              .in('parameters.level', [0, 1, 2])
              .then((r) => {
                if (r.error) throw r.error;
                return r.data;
              })
              .catch(warn('data quality values'))
          : Promise.resolve(null),

        // The site's radar deadline, which the Data Update card is judged
        // against. `maybeSingle` because a site that has never opened the
        // scheduler has no row at all — the default applies, exactly as the
        // reminder system does it.
        sensor.site_id
          ? supabase
              .from('site_report_schedules')
              .select('deadline, enabled')
              .eq('site_id', sensor.site_id)
              .eq('report_type', RADAR_TYPE.key)
              .maybeSingle()
              .then((r) => {
                if (r.error) throw r.error;
                return r.data;
              })
              .catch(warn('report schedule'))
          : Promise.resolve(null),

        // The monitoring-point roster, on the radars that print one. Ordered by
        // the site's own sequence; `id` breaks a tie so two points sharing a
        // sort_order do not swap places between editions of the same report.
        //
        // Degrades to null like every other section: a wall whose roster has
        // not been filled in yet still gets a report, printing whatever is
        // actually moving.
        movementStyle === 'roster'
          ? supabase
              .from('monitoring_areas')
              .select(AREA_SELECT)
              .eq('wallfolder_id', sensor.wallfolder_id)
              .eq('isactive', 'Yes')
              .order('sort_order', { ascending: true })
              .order('id', { ascending: true })
              .then((r) => {
                if (r.error) throw r.error;
                return r.data;
              })
              .catch(warn('monitoring areas'))
          : Promise.resolve(null),

        // When the wall was last checked — the newest hourly-checklist record
        // for this folder, which is exactly what the board and the sensor panel
        // call "Latest Check". It seeds the Data Update card so the analyst
        // confirms a timestamp rather than typing one from memory.
        //
        // Deliberately NOT filtered to the report day: on a day the link was
        // down the newest record IS yesterday's, and seeding it (which the
        // lateness rule then prints in red) states the problem, where seeding
        // nothing would only hide it.
        supabase
          .from('dqp_records')
          .select('created_time')
          .eq('wall_folder_id', sensor.wallfolder_id)
          .order('created_time', { ascending: false })
          .limit(1)
          .maybeSingle()
          .then((r) => {
            if (r.error) throw r.error;
            return r.data;
          })
          .catch(warn('latest checklist')),
      ]);

      if (cancelled) return;

      // ── Scan-area image (best-effort) ─────────────────────────────────────
      // Same path convention as the comprehensive report, so a wall folder that
      // already has a heatmap on file seeds both documents from one asset.
      let deformationImage = null;
      try {
        const path = `${sensor.company ?? sensor.site_name}/${sensor.site_name}/${sensor.wallfoldername ?? sensor.wall_name}.jpg`;
        const { data: signed } = await supabase.storage.from('Deformation').createSignedUrl(path, 3600);
        if (signed?.signedUrl) deformationImage = await urlToDataUrl(signed.signedUrl);
      } catch (err) {
        console.warn('[Daily report] deformation image unavailable:', err);
      }

      if (cancelled) return;

      const defRecords = defRes ?? [];
      const dqpRows = dqpRes ?? [];

      // The quality label. `sensor.quality` is the view's rolled-up value and is
      // what the rest of the app shows; the DQP level-0 row is the same verdict
      // read from the record itself, and covers a sensor row that has not been
      // refreshed since the assessment was saved.
      const qualityLabel = findOverallStatus(dqpRows) ?? sensor.quality ?? null;

      const riskPresentation = resolveRiskPresentation(defRecords, sensor);

      setState({
        key: requestKey,
        error: null,
        data: {
          reportDay: day,
          timeZone,
          defRecords,
          dqpRows,
          riskPresentation,
          riskMode: getRiskDisplayMode(sensor),
          // The movement table's shape, and the roster it needs. The roster is
          // presentation only — it is deliberately NOT fed to
          // resolveRiskPresentation above, so a wall full of quiet points still
          // resolves to "No Significant" and the Area Analysis section still
          // drops out. See config/movementTableStyle.ts.
          movementStyle,
          areaRoster: areaRes ?? [],
          // The two verdict SENTENCES are not built here: they are written in
          // the site's language, and the language is a rendering concern the
          // fetcher has no business knowing. The template asks
          // dailyRiskSentence / dailyQualitySummary, both of which delegate to
          // the shared derivations on the English path.
          quality: {
            label: qualityLabel,
            note: buildQualityNote(dqpRows),
          },
          // Falls back to the registry default when the site has no stored row,
          // so the lateness rule still applies rather than silently switching off.
          deadline: scheduleRes?.deadline || RADAR_TYPE.defaultDeadline,
          // The Data Update card's SUGGESTED value, in site wall time. An
          // initial value only: the analyst reads the true figure off the radar
          // software and the field stays theirs to correct. '' when the folder
          // has never been checked, which leaves the card blank and the report
          // ungeneratable until someone fills it in — the existing behaviour.
          lastCheck: siteLocalInput(checkRes?.created_time, timeZone),
          deformationImage,
        },
      });
    })().catch((err) => {
      if (cancelled) return;
      console.error('[Daily report] data load failed:', err);
      setState({ key: requestKey, data: null, error: err.message ?? 'Failed to load report data.' });
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  return { data: state.data, error: state.error, loading: state.key !== requestKey };
}

export default useDailyReportData;
