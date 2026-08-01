'use client';

/**
 * Key Findings — bulleted takeaways, each with an optional sub-detail line.
 *
 * Findings are supplied by the caller (buildKeyFindings), not derived here, so
 * the wording stays testable and this stays presentational.
 */

import { INK, MUTED, LINE } from '../constants';
import { severityColor, alarmToneColor, bandColor, uptimeSeverityLabel, UPTIME_TARGET, SEV } from '../severity';
import { folderDisplayLabel, isArchivedFolder } from '@/utils/reportWallFolders';
import { getStatusDefinition } from '@/config/statusConfig';
import { presentationFromLabel, riskSentence } from '@/config/riskDisplay';

/** 'YYYY-MM-DD' → 'DD/MM/YYYY', reformatted by parts so no timezone can shift it. */
const fmtDay = (value) => {
  const m = String(value ?? '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

/**
 * How a finding names the period it read, from the payload's window.
 *
 * A day is still worded as "the last 24 hours" — that is what the report has
 * always said and what the daily edition means. Longer spans say days; a span
 * that is not a whole number of days says hours rather than rounding a 36-hour
 * window down to "1 day". With no window at all the phrase stays true but vague:
 * a finding must never name a period it cannot substantiate.
 */
export function windowPhrase(window) {
  const hours = Number(window?.hours);
  if (!Number.isFinite(hours) || hours <= 0) return 'in the reporting period';
  if (Math.abs(hours - 24) < 0.5) return 'in the last 24 hours';

  const days = hours / 24;
  if (Math.abs(days - Math.round(days)) < 0.01) {
    const n = Math.round(days);
    return `in the last ${n} day${n === 1 ? '' : 's'}`;
  }
  return `in the last ${Math.round(hours)} hours`;
}

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
 * one from the score, and uptime shares uptimeSeverityLabel with the tile. Risk
 * takes the resolved presentation the tile is given (`riskPresentation`), so the
 * two cannot word or colour the same risk differently.
 *
 * @param {{risk: string, riskPresentation: object, quality: object, availability: object, alarms: object, timelines: array, window: object}} d
 * @returns {{text: string, detail?: string, tone?: string, color?: string}[]}
 */
export function buildKeyFindings(d) {
  const out = [];
  if (!d) return out;

  // The risk line is worded by the sensor's SITE (TARP level / band colour /
  // deformation type) and coloured by the deformation type behind it — see
  // config/riskDisplay.ts. The dot takes that colour explicitly rather than a
  // severity label, because "Red Notification" and "Regressive" are not labels
  // severityColor can read.
  const risk = d.riskPresentation ?? presentationFromLabel(d.risk);
  const areas = (d.timelines ?? [])
    .map((t) => t.trimmed?.[t.trimmed.length - 1]?.location)
    .filter(Boolean);
  const driverArea = risk.driver?.location;
  out.push({
    text: riskSentence(risk),
    detail: driverArea
      ? `Highest risk is at ${driverArea}.`
      : areas.length ? `Highest risk is at ${areas[0]}.` : undefined,
    color: bandColor(risk.colour).color,
  });

  if (typeof d.quality?.score === 'number') {
    const pct = d.quality.score * 100;
    const label = d.quality.label ?? null;
    // The sub-line reuses the DQP report's own overall assessment sentence
    // (getStatusDefinition().summary) so both documents describe the same
    // classification identically. A record with no recognised label has no such
    // sentence, so it falls back to the numeric threshold.
    const summary = label ? getStatusDefinition(label)?.summary : undefined;
    out.push({
      text: `Data quality score is ${pct.toFixed(2)}% (${label ?? 'Unknown'}).`,
      detail: summary ?? (pct >= 75
        ? 'Exceeding the minimum operational threshold of 75%'
        : 'Below the minimum operational threshold of 75%'),
      // The tile colours this from the label, so the dot must too.
      tone: label,
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
  // Alarms now cover the report window, not a fixed day, so the sentence has to
  // name the window it actually read — "the last 24 hours" printed on a two-day
  // or weekly report was simply false. Falls back to the neutral wording when the
  // payload carries no window (older callers, and the render tests' fixtures).
  const alarmPeriod = windowPhrase(d.window);
  if (total > 0) {
    const top = d.alarms?.causes?.[0];
    out.push({
      text: `${total} alarm event${total === 1 ? '' : 's'} ${alarmPeriod}, ${valid} assessed as valid.`,
      detail: top ? `Most frequent cause: ${top.cause} (${top.count}).` : undefined,
      // Alarm tones are region colour names ('red', 'blue', …), which
      // severityColor cannot read — resolve to hex here.
      color: alarmToneColor(alarmTone).color,
    });
  } else {
    out.push({
      text: `No alarm events recorded ${alarmPeriod}.`,
      color: alarmToneColor(alarmTone ?? 'none').color,
    });
  }

  // Wall folder change — a neutral note whenever more than one folder fed this
  // report (a change within the period, or an archived folder still holding
  // window-dated records). Different folders can scan different locations, so the
  // deformation and alarm sections above attribute their data per folder; this
  // line tells the reader why the report spans more than one.
  const wf = d.wallFolders;
  if (wf?.multiFolder && (wf.contributing?.length ?? 0) > 1) {
    const names = wf.contributing.map((f) => {
      const label = folderDisplayLabel(f);
      return isArchivedFolder(f) ? `${label} — archived` : label;
    });
    out.push({
      text: `This report combines ${wf.contributing.length} wall folders for this radar.`,
      detail: names.join('; '),
      // Informational provenance, not a severity verdict — the neutral grey dot.
      color: SEV.neutral,
    });
  }

  // Procedural (TARP) updates — a summary point only when the plan actually
  // changed this period; an unchanged plan contributes no bullet, matching the
  // Procedural Updates section, which drops out entirely.
  const tarpUpdates = d.tarp?.updates ?? [];
  if (tarpUpdates.length > 0) {
    const latest = tarpUpdates[0]; // pre-sorted newest-first
    const when = fmtDay(latest.modifiedDate || latest.approvalDate);
    const ver = latest.versionNo != null ? `v${latest.versionNo}` : null;
    out.push({
      text: `Trigger Action Response Plan updated ${tarpUpdates.length} time${tarpUpdates.length === 1 ? '' : 's'} this period.`,
      detail: latest.remark
        ? `Latest${ver ? ` (${ver}${when ? `, ${when}` : ''})` : when ? ` (${when})` : ''}: ${latest.remark}`
        : undefined,
      // Informational, not a severity verdict — the neutral grey dot.
      color: SEV.neutral,
    });
  }

  return out;
}

export default KeyFindings;
