/**
 * Recharts' polar layout, recomputed.
 *
 * The Data Quality severity bands have to sit exactly under the polygon recharts
 * draws, and recharts does not hand out the geometry it used: PolarGrid reads it
 * from an internal PolarViewBoxContext that is not in the public API (recharts
 * 3.8), and deep-importing `recharts/es6/context/...` would break on any bump.
 *
 * So it is mirrored here, following generateCategoricalChart's polar branch:
 *
 *   maxRadius = min(width - marginX, height - marginY) / 2   ← uses the margins
 *   cx        = 50% of the FULL width                        ← does NOT
 *   cy        = 50% of the FULL height                       ← does NOT
 *
 * That asymmetry looks like a bug and is not: recharts resolves cx/cy against
 * the raw width/height and only maxRadius against the offset box. The two agree
 * whenever the margins are symmetric — which the report's are — and diverge the
 * moment they aren't. A hand-rolled "centre of the content box" would silently
 * get that case wrong, so the real formula is the one reproduced.
 *
 * radarGeometry.test.js pins all of this against what recharts actually renders,
 * so a layout change upstream fails the suite rather than quietly sliding the
 * bands out from under the polygon.
 */

import { SEV } from './severity';

/** Recharts' getPercentValue: a number passes through, "72%" resolves against `total`. */
function percentValue(value, total, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const s = String(value).trim();
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return fallback;
  return s.endsWith('%') ? (n / 100) * total : n;
}

/**
 * @param {{width: number, height: number, margin?: object, outerRadius?: number|string}} p
 * @returns {{cx: number, cy: number, maxRadius: number, outerRadius: number}}
 */
export function polarGeometry({ width, height, margin, outerRadius = '80%' }) {
  const m = { top: 0, right: 0, bottom: 0, left: 0, ...(margin ?? {}) };
  const maxRadius =
    Math.min(
      Math.abs(width - (m.left + m.right)),
      Math.abs(height - (m.top + m.bottom))
    ) / 2;

  return {
    cx: width / 2,
    cy: height / 2,
    maxRadius,
    // Recharts' own default when outerRadius is unparseable is 80% of maxRadius.
    outerRadius: percentValue(outerRadius, maxRadius, maxRadius * 0.8),
  };
}

/**
 * Recharts' polarToCartesian. Angles are degrees, counter-clockwise, 0° = east —
 * hence the negated radian, which is what puts 90° at the TOP of the chart.
 */
export function polarToCartesian(cx, cy, radius, angleDeg) {
  const rad = (-angleDeg * Math.PI) / 180;
  return { x: cx + Math.cos(rad) * radius, y: cy + Math.sin(rad) * radius };
}

/**
 * The angle of each axis, in RadarChart's default sweep (startAngle 90 →
 * endAngle -270), for `count` axes. The count is 5–7 depending on radar model
 * and brand, never fixed — see buildRadarData.
 */
export function axisAngles(count) {
  if (!Number.isFinite(count) || count <= 0) return [];
  const step = 360 / count;
  return Array.from({ length: count }, (_, i) => 90 - i * step);
}

/**
 * The polygon points string for a ring at `radius`, matching PolarGrid's default
 * `gridType="polygon"` — so a band edge lands exactly on a grid ring rather than
 * a circle cutting across one.
 */
export function ringPoints({ cx, cy, radius, count }) {
  return axisAngles(count)
    .map((a) => {
      const { x, y } = polarToCartesian(cx, cy, radius, a);
      return `${x.toFixed(3)},${y.toFixed(3)}`;
    })
    .join(' ');
}

/** PolarRadiusAxis domain max — buildRadarData's Optimal score. */
export const SCORE_DOMAIN_MAX = 5;

/**
 * The severity bands, OUTERMOST FIRST — the order they must be painted, since
 * each is a filled polygon laid over the previous one.
 *
 * buildRadarData scores Optimal 5, Acceptable 3, Sub-Optimal 2, Critical 1 and
 * N/A 0 against PolarRadiusAxis domain [0,5]. Each band edge sits at the
 * MIDPOINT between adjacent scores, so every score lands inside a band instead
 * of on a boundary:
 *
 *   Optimal      5    band 4.0 – 5.0  →  0.80 – 1.00 R
 *   Acceptable   3    band 2.5 – 4.0  →  0.50 – 0.80 R
 *   Sub-Optimal  2    band 1.5 – 2.5  →  0.30 – 0.50 R
 *   Critical     1    band 0.0 – 1.5  →  0.00 – 0.30 R
 *
 * N/A (0) falls inside the Critical band, dead centre. That is where it has
 * always plotted, and its dot stays grey rather than red, so it still reads as
 * "not assessed" rather than as a failure.
 *
 * These edges deliberately do NOT match recharts' default grid rings: for this
 * domain those land at scores 0/2/4/5, which would draw a line straight through
 * the Sub-Optimal score. DataQuality passes `gridRadii` to move the rings onto
 * the band edges, so the grid traces the scale instead of competing with it.
 */
export const SEVERITY_BANDS = [
  { label: 'Optimal', fraction: 1, color: SEV.optimal },
  { label: 'Acceptable', fraction: 0.8, color: SEV.acceptable },
  { label: 'Sub-Optimal', fraction: 0.5, color: SEV.subOptimal },
  { label: 'Critical', fraction: 0.3, color: SEV.critical },
];

/** How far each band colour is mixed toward white. Enough to read, faint enough to sit under the polygon. */
export const BAND_WASH = 0.13;
