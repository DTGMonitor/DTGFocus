/**
 * Severity → print-safe colour.
 *
 * NOT sourced from config/statusConfig.ts: those helpers return Tailwind class
 * strings ("bg-red-500/20 text-red-400 border-red-500/30"). The export paths
 * render into a bare print iframe / detached container with no stylesheet, so
 * Tailwind classes resolve to nothing and html2canvas rasterizes them as
 * transparent. Colours in a report must be inline hex.
 *
 * The values mirror the `C` map in components/admin/Reports/RadarReportTemplates.jsx,
 * which is the palette the existing Data Quality PDF already prints, so the two
 * radar reports stay visually consistent.
 */

export const SEV = {
  critical: '#C00000',
  subOptimal: '#F78E1E',
  acceptable: '#FFC000',
  optimal: '#008000',
  neutral: '#6b7280',
  // Not a DQP tier — the risk band ABOVE critical (Rapid Movement). See
  // COLOUR_RANK in config/riskDisplay.ts and bandColor() below. Kept in SEV so
  // that a rapid movement prints the same ink wherever it appears, but it is
  // deliberately absent from SEVERITY_LEGEND: no parameter can be assessed at it.
  extreme: '#7F0000',
  // Also not a DQP tier — the risk band BELOW every other finding (Data
  // Contamination). Deliberately off the red-to-green ramp: the band makes no
  // claim about the slope, and any ramp colour would read as one. Absent from
  // SEVERITY_LEGEND for the same reason `extreme` is.
  contaminated: '#FF33CC',
};

/**
 * The four printed severity tiers, best-first, for the section-bar legend.
 *
 * Every status in the report is encoded as a colour and nothing stated what the
 * colours meant, so the reader was asked to infer a four-tier scale from
 * context. This is that scale, printed once.
 *
 * SEV.neutral is deliberately absent: it is severityColor()'s fallback for an
 * unrecognised label, not a verdict the assessment can legitimately reach, and
 * printing it would invite the reader to hunt for a fifth meaning.
 */
export const SEVERITY_LEGEND = [
  { label: 'Optimal', color: SEV.optimal },
  { label: 'Acceptable', color: SEV.acceptable },
  { label: 'Sub-Optimal', color: SEV.subOptimal },
  { label: 'Critical', color: SEV.critical },
];

/**
 * A severity colour darkened enough to carry as TEXT on white.
 *
 * SEV.acceptable (#FFC000) and SEV.subOptimal (#F78E1E) are picked to be read as
 * FILLS. As 8px text on white they sit near 1.8:1 and 2.4:1 contrast and print
 * as haze — the same hues at a luminance that survives both screen and toner.
 * Critical and optimal are already dark enough and pass through unchanged.
 */
const SEV_TEXT = {
  [SEV.acceptable]: '#8a6800',
  [SEV.subOptimal]: '#b5620a',
};

export const severityTextColor = (hex) => SEV_TEXT[hex] ?? hex;

/**
 * `hex` mixed toward white by `amount` (0 = white, 1 = hex), as a SOLID colour.
 *
 * Solid, not rgba, because the radar's severity bands are drawn as nested filled
 * polygons: an alpha fill would composite each band over the one beneath it and
 * the inner tiers would come out muddied and wrong. tint() stays for tiles that
 * sit on a single known background.
 */
export function wash(hex, amount) {
  const m = String(hex).replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const n = parseInt(full, 16);
  const mix = (channel) => Math.round(255 + (channel - 255) * amount);
  const hx = (v) => v.toString(16).padStart(2, '0');
  return `#${hx(mix((n >> 16) & 255))}${hx(mix((n >> 8) & 255))}${hx(mix(n & 255))}`;
}

/**
 * Alarm-region `alarmtype` → print colour.
 *
 * alarm_regions.alarmtype is a COLOUR NAME ('red' | 'orange' | 'yellow' |
 * 'blue' | 'purple'), not a severity word, so severityColor() cannot read it —
 * 'blue' and 'purple' would both fall through to neutral grey.
 *
 * red/orange/yellow reuse the SEV values so an alarm and a TARP badge of the
 * same rank print as the same ink. Blue and purple have no SEV equivalent;
 * these are the Office-palette tones that sit alongside them.
 */
export const ALARM_SEV = {
  red: SEV.critical,
  orange: SEV.subOptimal,
  yellow: SEV.acceptable,
  blue: '#0070C0',
  purple: '#7030A0',
};

/**
 * Alarm tone (a `deriveAlarmTone` result) → print colour.
 *
 * 'none'    — no alarms at all        → grey
 * 'false'   — every alarm a false one → green
 * 'unknown' — alarms, none assessed valid, and not all false → grey
 * otherwise — the alarmtype colour name of the worst VALID alarm.
 *
 * @param {string} tone
 * @returns {{ color: string, onColor: string }}
 */
export function alarmToneColor(tone) {
  const t = String(tone ?? '').toLowerCase();
  if (t === 'false') return { color: SEV.optimal, onColor: '#ffffff' };
  const hex = ALARM_SEV[t];
  if (!hex) return { color: SEV.neutral, onColor: '#ffffff' };
  // Yellow and orange are too light to carry white text.
  return { color: hex, onColor: t === 'yellow' || t === 'orange' ? '#1f2937' : '#ffffff' };
}

/**
 * Alarm CAUSE → print colour, fixed per cause.
 *
 * Previously the cause pie coloured slices by their INDEX in the aggregated
 * list, which is sorted by count. The same cause therefore changed colour
 * between two reports — "Progressive Deformation Trend" could be orange on
 * Monday and green on Tuesday — and a reader comparing editions was reading a
 * palette that carried no meaning. These bindings are by name, so a cause looks
 * the same in every report and its colour states its severity.
 *
 * The scheme follows the risk ranking in config/riskDisplay.ts, so a cause and
 * the deformation band of the same name print as the same ink:
 *
 *   VALID — ranked by what the movement implies
 *     Rapid Movement               dark red   (SEV.extreme) — above everything
 *     Progressive trend            red        (the SEV.critical red)
 *     Linear trend                 orange     (SEV.subOptimal)
 *     Regressive trend             yellow     (SEV.acceptable)
 *     Failure / Slip / Material
 *       Detachment / Rock Fall     greys      — Fall of Ground: past a trend,
 *                                              the ground has already moved and
 *                                              there is nothing left to escalate
 *
 *   FALSE — one cool family, so any false alarm is distinguishable from a valid
 *     one at a glance without reading the legend. The individual hues are only
 *     required to be stable and mutually distinct.
 *
 * The Fall of Ground greys are spread across the ramp rather than clustered,
 * because these four are the causes most often present in the same pie and every
 * slice still has to be tellable from its neighbour.
 */
export const ALARM_CAUSE_COLORS = {
  // Valid — the extreme.
  'Rapid Movement': SEV.extreme,
  // Valid — deformation trends.
  'Progressive Deformation Trend': SEV.critical,
  'Linear Deformation Trend': SEV.subOptimal,
  'Regressive Deformation Trend': SEV.acceptable,
  // Valid — the caveat band: the reading, not the slope.
  'Data Contamination': SEV.contaminated,
  // Valid — Fall of Ground.
  'Failure Pattern Indication': '#3F3F46',
  'Slip Pattern Indication': '#57534E',
  'Material Detachment Indication': '#8A8A93',
  'Rock Fall': '#A8A29E',
  // False — cool family.
  'Machinery Activity': '#2563eb',
  'Rapid Atmospheric Changes': '#0891b2',
  'Rainfall Event': '#0ea5e9',
  'Riling Material': '#64748b',
  'Vegetation': '#65a30d',
  'Pushed Material': '#0d9488',
  'Water Refraction': '#155e75',
  'Sandstorm Event': '#94a3b8',
  'Blasting Event': '#7c3aed',
  'Diurnal Pattern': '#a855f7',
  'Wire Mesh': '#475569',
  'Mine Facility': '#334155',
  'Pipeline': '#4338ca',
  'Step After Link Down': '#1e40af',
  // aggregateAlarmCauses' bucket for records with no cause.
  Uncategorised: SEV.neutral,
};

/**
 * Keyword fallback, most specific first.
 *
 * The exact map above covers CAUSE_OPTIONS, but `alarm_records.cause` is NOT
 * restricted to it — records written from the deformation side carry the bare
 * def_type ('Linear', 'Progressive', 'Rock Fall') instead of the long taxonomy
 * name ('Linear Deformation Trend'). Those missed the map entirely and hashed to
 * an arbitrary cool colour, so a Linear alarm printed green.
 *
 * Order is load-bearing:
 *   - 'linear accelerating' before 'linear', or the accelerating case would be
 *     caught by the plain-linear rule and printed a tier too calm.
 *   - 'failure' before 'forecast' is irrelevant (they get the same family), but
 *     both must precede nothing else — 'Failure Forecast' should read as failure.
 */
const CAUSE_KEYWORD_RULES = [
  ['rapid movement', SEV.extreme],
  ['rock fall', '#A8A29E'],
  ['material detachment', '#8A8A93'],
  ['failure', '#3F3F46'],
  // A forecast is a prediction about a failure — same family, its own grey.
  ['forecast', '#4B5563'],
  ['slip', '#57534E'],
  ['regressive', SEV.acceptable],
  ['progressive', SEV.critical],
  // Accelerating is TARP 4, the same tier as Progressive — printing it the
  // orange of a TARP 3 Linear would understate it.
  ['linear accelerating', SEV.critical],
  ['linear', SEV.subOptimal],
  ['contamination', SEV.contaminated],
  // False-alarm causes, so the short forms land in the cool family too.
  ['machinery', '#2563eb'],
  ['atmospheric', '#0891b2'],
  ['rainfall', '#0ea5e9'],
  ['riling', '#64748b'],
  ['vegetation', '#65a30d'],
  ['pushed material', '#0d9488'],
  ['water refraction', '#155e75'],
  ['sandstorm', '#94a3b8'],
  ['blast', '#7c3aed'],
  ['diurnal', '#a855f7'],
  ['wire mesh', '#475569'],
  ['mine facility', '#334155'],
  ['pipeline', '#4338ca'],
  ['link down', '#1e40af'],
];

/**
 * Colours for a cause outside the taxonomy. Cool, like the false-alarm family:
 * an unrecognised cause must not borrow the warm ink that means "the ground
 * moved" — that would be a severity claim the report cannot support.
 */
const UNKNOWN_CAUSE_COLORS = ['#3b82f6', '#14b8a6', '#8b5cf6', '#22c55e', '#6366f1', '#78716c'];

/**
 * @param {string} cause  An alarm_records.cause value.
 * @returns {string} hex. Unknown causes hash to a stable cool colour rather than
 *   falling to a shared grey, so two unrecognised causes stay tellable apart.
 */
export function alarmCauseColor(cause) {
  const key = String(cause ?? '').trim();
  const known = ALARM_CAUSE_COLORS[key];
  if (known) return known;

  const lower = key.toLowerCase();
  for (const [needle, hex] of CAUSE_KEYWORD_RULES) {
    if (lower.includes(needle)) return hex;
  }

  // Hash the name, not the position: stable across reports and orderings.
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return UNKNOWN_CAUSE_COLORS[h % UNKNOWN_CAUSE_COLORS.length];
}

/**
 * Map a status / TARP / quality label to a print colour.
 * Mirrors getStatusStyle's keyword matching in RadarReportTemplates.
 *
 * @param {string} label
 * @returns {{ color: string, onColor: string }} `onColor` is readable text on `color`.
 */
export function severityColor(label) {
  const s = String(label ?? '').toLowerCase();

  if (['critical', 'tarp 4', 'high', 'offline', 'error', 'down', 'lost'].some((k) => s.includes(k))) {
    return { color: SEV.critical, onColor: '#ffffff' };
  }
  if (['sub-optimal', 'suboptimal', 'tarp 3', 'moderate', 'warning', 'action required'].some((k) => s.includes(k))) {
    return { color: SEV.subOptimal, onColor: '#1f2937' };
  }
  if (['acceptable', 'tarp 2', 'intermittent'].some((k) => s.includes(k))) {
    return { color: SEV.acceptable, onColor: '#1f2937' };
  }
  if (['optimal', 'tarp 1', 'low', 'online', 'live', 'completed'].some((k) => s.includes(k))) {
    return { color: SEV.optimal, onColor: '#ffffff' };
  }
  return { color: SEV.neutral, onColor: '#ffffff' };
}

/**
 * Risk band ('darkred' | 'red' | 'orange' | 'yellow' | 'grey' | 'green') → print colour.
 *
 * The band a deformation sits in is resolved from its TYPE (config/riskDisplay.ts)
 * and is the same fact at every site, whether or not that site quotes a TARP
 * number for it. Reusing the SEV values keeps a red band, a red alarm and a
 * TARP 4 badge printing as the same ink.
 *
 * 'darkred' is Rapid Movement, the one band above red. SEV.extreme is a genuinely
 * darker red rather than a different hue, so on a page printed in greyscale it
 * still reads as the heavier of the two.
 *
 * @param {string} colour
 * @returns {{ color: string, onColor: string }} `onColor` is readable text on `color`.
 */
export function bandColor(colour) {
  const c = String(colour ?? '').toLowerCase();
  if (c === 'darkred') return { color: SEV.extreme, onColor: '#ffffff' };
  if (c === 'red') return { color: SEV.critical, onColor: '#ffffff' };
  if (c === 'orange') return { color: SEV.subOptimal, onColor: '#1f2937' };
  if (c === 'yellow') return { color: SEV.acceptable, onColor: '#1f2937' };
  // Magenta carries dark text far better than white — 6.6:1 against near-black,
  // 3.2:1 against white — so it follows yellow and orange, not red.
  if (c === 'pink') return { color: SEV.contaminated, onColor: '#1f2937' };
  if (c === 'green') return { color: SEV.optimal, onColor: '#ffffff' };
  return { color: SEV.neutral, onColor: '#ffffff' };
}

/**
 * `alarm_improvement.improvement_status` → print colour.
 *
 * severityColor() cannot read these: "Modified" and "Not Implemented" match none
 * of its keywords and would both fall through to neutral grey, printing a
 * declined recommendation and an applied one as the same ink.
 *
 * The live summary pages colour this scale green / amber / red
 * (statusColorMap — #22C55E, #FACC15, #EF4444). Those are screen tones; the
 * report reuses its own SEV values so an applied recommendation prints as the
 * same green as an Optimal parameter, which is the whole point of a shared
 * palette. Same three-step meaning, print-safe ink.
 *
 * @param {string} status
 * @returns {{ color: string, onColor: string }} `onColor` is readable text on `color`.
 */
export function improvementStatusColor(status) {
  const s = String(status ?? '').trim().toLowerCase();
  if (s === 'modified') return { color: SEV.optimal, onColor: '#ffffff' };
  if (s === 'awaiting feedback') return { color: SEV.acceptable, onColor: '#1f2937' };
  if (s === 'not implemented') return { color: SEV.critical, onColor: '#ffffff' };
  return { color: SEV.neutral, onColor: '#ffffff' };
}

/** The operational uptime target the reports cite, as a percentage. */
export const UPTIME_TARGET = 95;

/**
 * Uptime percentage → severity label.
 *
 * Shared so the Executive Summary tile and the Key Findings dot cannot drift
 * apart: the dot used to be a two-tier pass/fail against the 95% target, which
 * painted an 88% uptime red under a tile that called it amber.
 *
 * @param {number} uptime  0..100
 * @returns {string|null}  null when there is no number to judge.
 */
export function uptimeSeverityLabel(uptime) {
  if (!Number.isFinite(uptime)) return null;
  if (uptime >= UPTIME_TARGET) return 'optimal';
  return uptime >= 85 ? 'acceptable' : 'critical';
}

/** rgba tint of a hex colour — for tile backgrounds. */
export function tint(hex, alpha) {
  const m = String(hex).replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
