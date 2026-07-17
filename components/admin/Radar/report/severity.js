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
