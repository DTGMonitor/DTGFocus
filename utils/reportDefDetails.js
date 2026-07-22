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
 * Pure: no React, no clock, no I/O.
 */

/**
 * def_types describing a discrete occurrence rather than an ongoing trend.
 * These are the ones that carry a meaningful `start` (time of event).
 */
export const EVENT_DEF_TYPES = [
  'Failure',
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

/** `DD/MM/YYYY, HH:MM`, matching the timeline's Detected line. */
export function fmtDateTime(iso) {
  if (!hasValue(iso)) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Detail rows for one timeline node, in print order.
 *
 * Rows with no data are omitted rather than printed as "—": a node that carries
 * no velocity should be shorter, not padded with placeholders the reader has to
 * scan past. An empty array is normal (e.g. Regressive defines no fields).
 *
 * @param {{def_type?: string, start?: string, properties?: object}} node
 * @returns {{label: string, value: string}[]}
 */
export function buildEventDetails(node) {
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
    push('Forecast (short VCP)', fmtDateTime(p.ForecastResult1));
    push('Forecast (long VCP)', fmtDateTime(p.ForecastResult2));
  }

  if (EVENT_DEF_TYPES.includes(type)) {
    push('Event time', fmtDateTime(node?.start));
  }

  return out;
}

export default buildEventDetails;
