/**
 * Per-event detail lines for the report's deformation timeline.
 *
 * The timeline used to print only type / location / detected / by, which says
 * that a trend exists but not what it is doing. These are the numbers the reader
 * actually needs: how fast a trend is moving, when a discrete event happened,
 * and what a forecast predicts.
 *
 * Unit conventions mirror `generateEmailBody` in config/formConfig.ts — VCP is
 * in MINUTES, and under a day velocities read mm/h, at or over a day mm/d. They
 * are duplicated rather than imported because that module is a large TS config
 * whose helpers are local to the email builder; the invariant that matters is
 * that the printed report and the notification email never state the same event
 * in different units.
 *
 * TWO KINDS OF TIMESTAMP LIVE ON A RECORD, AND THEY ARE NOT FORMATTED ALIKE.
 *
 *   `start`            — a real instant. AddDeformationForm writes it through
 *                        toUTC(), so it is stored in UTC and must be rendered
 *                        on the SITE's clock.
 *   ForecastResult1/2  — tz-naive wall clock. The same form writes the
 *                        datetime-local value into `properties` verbatim, so it
 *                        is already site time and converting it would shift it
 *                        by the offset (the -8h bug patternRecognitionMapper
 *                        documents).
 *
 * Pure: no React, no clock, no I/O.
 */

import { formatSiteDayTime } from './siteTime';

/**
 * def_types describing a discrete occurrence rather than an ongoing trend.
 * These are the ones that carry a meaningful `start` (time of event).
 */
export const EVENT_DEF_TYPES = [
  'Failure',
  'Slumping Type Failure',
  'Blast Event',
  'Rainfall Event',
  'Rock Fall',
  'Material Detachment',
  'Rapid Movement',
];

const MINUTES_PER_DAY = 1440;

/** Velocity unit implied by a VCP in minutes. Matches getVelocityUnit(). */
export const velocityUnit = (vcp) => (Number(vcp) < MINUTES_PER_DAY ? 'mm/h' : 'mm/d');

const hasValue = (v) => v !== null && v !== undefined && v !== '';

/** Numbers without trailing-zero noise; anything unparseable passes through. */
const fmtNumber = (v) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? String(n) : String(v);
};

/**
 * A stored UTC instant as `DD/MM/YYYY, HH:MM` on the SITE's clock, matching the
 * timeline's Detected line.
 *
 * This is the one a Fall of Ground goes through: `start` is the moment the
 * ground actually came away, and the reader is on site. Formatting it with
 * `getHours()` rendered it on whichever clock the render happened to run on —
 * UTC on the server, the analyst's own zone in the browser — and never the
 * site's.
 *
 * An unparseable value is handed back untouched rather than dropped, as before.
 */
export function fmtDateTime(iso, timeZone) {
  if (!hasValue(iso)) return null;
  return formatSiteDayTime(iso, timeZone) ?? String(iso);
}

/**
 * A tz-naive wall-clock string as `DD/MM/YYYY, HH:MM`, with no conversion.
 *
 * Read by parts rather than through `new Date`, which resolves a naive string
 * against the runtime's zone and would make the printed forecast depend on
 * where the report was generated.
 */
export function fmtNaiveDateTime(value) {
  if (!hasValue(value)) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(value).trim());
  if (!m) return String(value);
  const [, year, month, day, hour, minute] = m;
  return `${day}/${month}/${year}, ${hour}:${minute}`;
}

/**
 * Detail rows for one timeline node, in print order.
 *
 * Rows with no data are omitted rather than printed as "—": a node that carries
 * no velocity should be shorter, not padded with placeholders the reader has to
 * scan past. An empty array is normal (e.g. Regressive defines no fields).
 *
 * @param {{def_type?: string, start?: string, properties?: object}} node
 * @param {string|null} timeZone  The site's IANA zone, for `start` only. Omitted
 *   falls back to UTC — timezoneUtils' own fallback, and better than silently
 *   adopting whichever clock the render runs on.
 * @returns {{label: string, value: string}[]}
 */
export function buildEventDetails(node, timeZone = null) {
  const type = String(node?.def_type ?? '').trim();
  const p = node?.properties ?? {};
  const out = [];
  const push = (label, value) => {
    if (hasValue(value)) out.push({ label, value: String(value) });
  };
  const velocity = (v, vcp) => (hasValue(v) ? `${fmtNumber(v)} ${velocityUnit(vcp)}` : null);
  const vcpRow = (vcp) => (hasValue(vcp) ? `${fmtNumber(vcp)} min` : null);

  if (type === 'Linear') {
    push('Velocity', velocity(p.AverageVelocity, p.VCP));
    push('VCP', vcpRow(p.VCP));
  } else if (type === 'Progressive' || type === 'Linear Accelerating') {
    // One range row, not two: Vmin and Vmax describe a single band, and two
    // rows read as two independent measurements.
    if (hasValue(p.Vmin) || hasValue(p.Vmax)) {
      const lo = hasValue(p.Vmin) ? fmtNumber(p.Vmin) : '—';
      const hi = hasValue(p.Vmax) ? fmtNumber(p.Vmax) : '—';
      push('Velocity', `${lo} – ${hi} ${velocityUnit(p.VCP)}`);
    }
    push('VCP', vcpRow(p.VCP));
  } else if (type === 'Failure') {
    // Failure carries the two-VCP set rather than a single velocity.
    push('Vmax (short VCP)', velocity(p.Vmax1, p.VCP1));
    push('Vmax (long VCP)', velocity(p.Vmax2, p.VCP2));
  } else if (type === 'Forecast') {
    // Naive, not site-converted — see the header note.
    push('Forecast (short VCP)', fmtNaiveDateTime(p.ForecastResult1));
    push('Forecast (long VCP)', fmtNaiveDateTime(p.ForecastResult2));
  }

  if (EVENT_DEF_TYPES.includes(type)) {
    push('Event time', fmtDateTime(node?.start, timeZone));
  }

  return out;
}

export default buildEventDetails;
