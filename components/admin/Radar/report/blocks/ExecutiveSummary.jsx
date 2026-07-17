'use client';

/**
 * Executive Summary — four KPI tiles: Risk, Data Quality, System Uptime, Alarms.
 *
 * Every value is guarded. The existing Data Quality template crashes on a record
 * set with no level-0 row (`overallStatus.toLowerCase()` with no guard); a report
 * should render "—" and carry on rather than take the whole PDF down.
 */

import { INK, MUTED, LINE } from '../constants';
import { severityColor, alarmToneColor, uptimeSeverityLabel, UPTIME_TARGET, tint } from '../severity';

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
 * @param {string} risk        e.g. 'TARP 4'
 * @param {{label: string|null, score: number|null}} quality  score is 0..1
 * @param {number} uptime      percentage 0..100
 * @param {{valid: number, total: number, tone: string}} alarms  `tone` per deriveAlarmTone.
 */
export function ExecutiveSummary({ risk, quality, uptime, alarms }) {
  const riskSev = severityColor(risk);
  const qualitySev = severityColor(quality?.label);
  const alarmSev = alarmToneColor(alarms?.tone);

  const qualityPct =
    typeof quality?.score === 'number' && Number.isFinite(quality.score)
      ? `${(quality.score * 100).toFixed(2)}%`
      : '—';

  const uptimeText = Number.isFinite(uptime) ? `${uptime.toFixed(2)}%` : '—';
  const uptimeLabel = uptimeSeverityLabel(uptime);
  const uptimeColor = uptimeLabel ? severityColor(uptimeLabel).color : MUTED;

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <Tile
        label="Risk Level"
        value={risk || '—'}
        sub={risk === 'TARP 4' ? 'Critical' : risk === 'TARP 3' ? 'Moderate Risk' : risk === 'TARP 2' ? 'Intermediate Risk' : risk ? 'No Significant' : ''}
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
        sub="Valid / Total (24h)"
        accent={alarmSev.color}
        valueColor={alarmSev.color}
      />
    </div>
  );
}

export default ExecutiveSummary;
