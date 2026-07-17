'use client';

/**
 * Key Findings — bulleted takeaways, each with an optional sub-detail line.
 *
 * Findings are supplied by the caller (buildKeyFindings), not derived here, so
 * the wording stays testable and this stays presentational.
 */

import { INK, MUTED, LINE } from '../constants';
import { severityColor, alarmToneColor, uptimeSeverityLabel, UPTIME_TARGET } from '../severity';

/**
 * @param {{text: string, detail?: string, tone?: string, color?: string}[]} findings
 *        `tone` is a severity label ('critical' | 'optimal' | …) driving the dot.
 *        `color` overrides it with an explicit hex, for scales severityColor
 *        cannot read (alarm tones — see buildKeyFindings).
 */
export function KeyFindings({ findings = [] }) {
  if (findings.length === 0) return null;

  return (
    <div style={{ border: `1px solid ${LINE}`, padding: '8px 12px' }}>
      {findings.map((f, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: i < findings.length - 1 ? 7 : 0 }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: f.color ?? severityColor(f.tone ?? 'optimal').color,
              marginTop: 5,
              flexShrink: 0,
            }}
          />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, color: INK, fontWeight: 600 }}>{f.text}</div>
            {f.detail ? <div style={{ fontSize: 9, color: MUTED, marginTop: 1 }}>{f.detail}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Derive the report's findings from the loaded data. Pure, so the wording can be
 * unit-tested without rendering.
 *
 * Each dot MUST resolve to the same colour as its Executive Summary tile — the
 * two sit inches apart on page 1 and a disagreement reads as contradictory
 * findings. So the scales are imported, never restated: data quality takes the
 * classification it already carries (`quality.label`) rather than re-deriving
 * one from the score, and uptime shares uptimeSeverityLabel with the tile.
 *
 * @param {{risk: string, quality: object, availability: object, alarms: object, timelines: array}} d
 * @returns {{text: string, detail?: string, tone?: string, color?: string}[]}
 */
export function buildKeyFindings(d) {
  const out = [];
  if (!d) return out;

  const riskLabel =
    d.risk === 'TARP 4' ? 'Critical'
      : d.risk === 'TARP 3' ? 'Sub-Optimal'
        : d.risk === 'TARP 2' ? 'Acceptable'
          : 'Optimal';
  const areas = (d.timelines ?? [])
    .map((t) => t.trimmed?.[t.trimmed.length - 1]?.location)
    .filter(Boolean);
  out.push({
    text: `Overall risk is on ${d.risk} – ${riskLabel} condition.`,
    detail: areas.length ? `Highest risk is at ${areas[0]}.` : undefined,
    tone: d.risk,
  });

  if (typeof d.quality?.score === 'number') {
    const pct = d.quality.score * 100;
    out.push({
      text: `Data quality score is ${pct.toFixed(2)}% (${d.quality.label ?? 'Unknown'}).`,
      detail: pct >= 75 ? 'Exceeding the minimum operational threshold of 75%' : 'Below the minimum operational threshold of 75%',
      // The tile colours this from the label, so the dot must too.
      tone: d.quality.label,
    });
  }

  const uptime = d.availability?.uptimePercentage;
  if (Number.isFinite(uptime)) {
    out.push({
      text: `System uptime is ${uptime.toFixed(2)}% over the reporting period.`,
      detail: uptime >= UPTIME_TARGET
        ? `Exceeding the operational target of ${UPTIME_TARGET}% uptime`
        : `Below the operational target of ${UPTIME_TARGET}% uptime`,
      tone: uptimeSeverityLabel(uptime),
    });
  }

  const { total = 0, valid = 0, tone: alarmTone } = d.alarms ?? {};
  if (total > 0) {
    const top = d.alarms?.causes?.[0];
    out.push({
      text: `${total} alarm event${total === 1 ? '' : 's'} in the last 24 hours, ${valid} assessed as valid.`,
      detail: top ? `Most frequent cause: ${top.cause} (${top.count}).` : undefined,
      // Alarm tones are region colour names ('red', 'blue', …), which
      // severityColor cannot read — resolve to hex here.
      color: alarmToneColor(alarmTone).color,
    });
  } else {
    out.push({
      text: 'No alarm events recorded in the last 24 hours.',
      color: alarmToneColor(alarmTone ?? 'none').color,
    });
  }

  return out;
}

export default KeyFindings;
