'use client';

/**
 * Executive Summary — four KPI tiles: Risk, Data Quality, System Uptime, Alarms.
 *
 * Every value is guarded. The existing Data Quality template crashes on a record
 * set with no level-0 row (`overallStatus.toLowerCase()` with no guard); a report
 * should render "—" and carry on rather than take the whole PDF down.
 */

import { INK, MUTED, LINE } from '../constants';
import { severityColor, alarmToneColor, bandColor, uptimeSeverityLabel, UPTIME_TARGET, tint } from '../severity';
import { presentationFromLabel } from '@/config/riskDisplay';

const Tile = ({ label, value, sub, accent, valueColor, background }) => (
  <div
    style={{
      flex: 1,
      minWidth: 0,
      border: `1px solid ${accent ?? LINE}`,
      borderLeft: `5px solid ${accent ?? LINE}`,
      background: background ?? '#fff',
      padding: '8px 10px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      minHeight: 62,
    }}
  >
    <div style={{ fontSize: 9, color: MUTED, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
      {label}
    </div>
    <div style={{ fontSize: 20, fontWeight: 800, color: valueColor ?? INK, lineHeight: 1.1 }}>{value}</div>
    {sub ? <div style={{ fontSize: 9, color: MUTED, fontWeight: 600 }}>{sub}</div> : null}
  </div>
);

/**
 * @param {string} risk        the printed label — 'TARP 4', 'Red Notification', 'Regressive'
 * @param {import('@/config/riskDisplay').RiskPresentation} riskPresentation
 *        The resolved risk. Carries the band colour, which follows the
 *        deformation TYPE, not the TARP level — a site that quotes no TARP
 *        numbers still has a red trend. Falls back to reading the label when a
 *        caller has only that.
 * @param {{label: string|null, score: number|null}} quality  score is 0..1
 * @param {number} uptime      percentage 0..100
 * @param {{valid: number, total: number, tone: string}} alarms  `tone` per deriveAlarmTone.
 * @param {{hours: number}} reportWindow  The report window (data.window). The
 *        alarm tile names the span it counted over; it used to be captioned
 *        "(24h)" unconditionally, which was wrong for every non-daily edition.
 *        Omitted falls back to the plain caption rather than asserting a span.
 *        Not named `window` — that shadows the global in a client component.
 */
export function ExecutiveSummary({ risk, riskPresentation, quality, uptime, alarms, reportWindow }) {
  // No risk at all is "unknown", not "nothing active" — a report still loading
  // must not assert a verdict it has not read yet.
  const riskInfo = riskPresentation ?? (risk ? presentationFromLabel(risk) : null);
  const riskSev = riskInfo ? bandColor(riskInfo.colour) : { color: MUTED };
  const qualitySev = severityColor(quality?.label);
  const alarmSev = alarmToneColor(alarms?.tone);

  const qualityPct =
    typeof quality?.score === 'number' && Number.isFinite(quality.score)
      ? `${(quality.score * 100).toFixed(2)}%`
      : '—';

  // '24h' / '48h' / '7d' — hours while they stay short enough to read, days
  // beyond that, so the caption never becomes '720h'.
  const windowHours = Number(reportWindow?.hours);
  const windowTag = !Number.isFinite(windowHours) || windowHours <= 0
    ? null
    : windowHours <= 72
      ? `${Math.round(windowHours)}h`
      : `${Math.round(windowHours / 24)}d`;

  const uptimeText = Number.isFinite(uptime) ? `${uptime.toFixed(2)}%` : '—';
  const uptimeLabel = uptimeSeverityLabel(uptime);
  const uptimeColor = uptimeLabel ? severityColor(uptimeLabel).color : MUTED;

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <Tile
        label="Risk Level"
        value={riskInfo?.label || '—'}
        sub={riskInfo?.subtitle ?? ''}
        accent={riskSev.color}
        valueColor={riskSev.color}
        background={tint(riskSev.color, 0.1)}
      />
      <Tile
        label="Data Quality"
        value={qualityPct === '—' ? '' : qualityPct}
        sub={quality?.label || '—'}
        accent={qualitySev.color}
        valueColor={qualitySev.color}
      />
      <Tile
        label="System Uptime"
        value={uptimeText}
        sub={`Target ${UPTIME_TARGET}%`}
        accent={uptimeColor}
        valueColor={uptimeColor}
      />
      <Tile
        label="Alarm Events"
        value={`${alarms?.valid ?? 0}/${alarms?.total ?? 0}`}
        sub={windowTag ? `Valid / Total (${windowTag})` : 'Valid / Total'}
        accent={alarmSev.color}
        valueColor={alarmSev.color}
      />
    </div>
  );
}

export default ExecutiveSummary;
