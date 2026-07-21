/**
 * radarGeometry vs. what recharts actually draws.
 *
 * The Data Quality severity bands are drawn by us, in a separate SVG behind the
 * chart, because recharts keeps its polar geometry in an internal context with
 * no public accessor. That means two independent implementations have to agree
 * about where the centre and the outer radius are — and if they ever stop
 * agreeing, the failure is silent and cosmetic: bands sliding out from under the
 * polygon in a PDF nobody diffs.
 *
 * So these tests measure recharts' REAL output and assert our maths reproduces
 * it. They are deliberately not snapshot tests: the point is the invariant, not
 * the pixels.
 *
 * jsdom does no layout, but recharts is handed a fixed width/height here and
 * emits SVG coordinates from pure arithmetic, so the numbers are the real ones.
 */

import { render } from '@testing-library/react';

import RadarMetricsChart from '@/components/Radars/Live/RadarMetricChart';
import { buildRadarData } from '@/components/Radars/Live/radarChart';
import {
  polarGeometry,
  polarToCartesian,
  axisAngles,
  ringPoints,
  SEVERITY_BANDS,
  SCORE_DOMAIN_MAX,
} from '@/components/admin/Radar/report/radarGeometry';

// The exact geometry DataQuality renders at.
const W = 292;
const H = 220;
const MARGIN = { top: 14, right: 54, bottom: 14, left: 54 };
const OUTER = '72%';

// buildRadarData reads the axes off the level-1 entries, so the fixture carries
// the `id` and `level` a pivoted dqp_values row always has. Ids are the
// parameters-table ids, which is also the axis order (System Health first, at
// angle 90).
const record = (overrides = {}) => ({
  radar: 'IBIS-FM',
  brand: 'GroundProbe',
  parameters: {
    Overall: { id: 1, name: 'Overall', level: 0, value: 'Sub-Optimal' },
    'System Health': { id: 2, name: 'System Health', level: 1, value: 'Optimal' },
    'Scan Area': { id: 3, name: 'Scan Area', level: 1, value: 'Sub-Optimal' },
    Photograph: { id: 4, name: 'Photograph', level: 1, value: 'Optimal' },
    Masks: { id: 5, name: 'Masks', level: 1, value: 'Optimal' },
    Alarms: { id: 6, name: 'Alarms', level: 1, value: 'Acceptable' },
    'Atmospheric Correction': {
      id: 7,
      name: 'Atmospheric Correction',
      level: 1,
      value: 'Optimal',
    },
    'Visual Data': { id: 8, name: 'Visual Data', level: 1, value: 'Critical' },
  },
  ...overrides,
});

const renderChart = (rec, extra = {}) =>
  render(
    <RadarMetricsChart record={rec} width={W} height={H} margin={MARGIN} outerRadius={OUTER} {...extra} />
  ).container;

/** Radius of a rendered grid ring, from the first point of its path. */
const ringRadius = (el, cx, cy) => {
  const m = el.getAttribute('d').match(/M\s*([\d.-]+)[, ]([\d.-]+)/);
  return Math.hypot(parseFloat(m[1]) - cx, parseFloat(m[2]) - cy);
};

const gridRings = (container) => [
  ...container.querySelectorAll('.recharts-polar-grid-concentric-polygon'),
];

describe('polarGeometry reproduces recharts', () => {
  const geo = polarGeometry({ width: W, height: H, margin: MARGIN, outerRadius: OUTER });

  test('an Optimal axis plots exactly at our computed outerRadius', () => {
    // Optimal is the domain max, so its dot sits on the outer edge — which makes
    // it a direct probe of both the centre and the radius in one assertion.
    const container = renderChart(record());
    const dots = [...container.querySelectorAll('circle')];
    const first = dots[0]; // System Health, Optimal, drawn at angle 90 (top).

    expect(parseFloat(first.getAttribute('cx'))).toBeCloseTo(geo.cx, 4);
    expect(parseFloat(first.getAttribute('cy'))).toBeCloseTo(geo.cy - geo.outerRadius, 4);
  });

  test('every dot lands where polarToCartesian says, at score/5 of outerRadius', () => {
    const rec = record();
    const data = buildRadarData(rec);
    const container = renderChart(rec);
    const dots = [...container.querySelectorAll('circle')];
    const angles = axisAngles(data.length);

    expect(dots).toHaveLength(data.length);

    data.forEach((d, i) => {
      const radius = (d.score / SCORE_DOMAIN_MAX) * geo.outerRadius;
      const want = polarToCartesian(geo.cx, geo.cy, radius, angles[i]);
      expect(parseFloat(dots[i].getAttribute('cx'))).toBeCloseTo(want.x, 3);
      expect(parseFloat(dots[i].getAttribute('cy'))).toBeCloseTo(want.y, 3);
    });
  });

  test('cx/cy follow the FULL box, not the margin box, when margins are asymmetric', () => {
    // The case a hand-rolled "centre of the content box" gets wrong. Recharts
    // resolves cx/cy against width/height and only maxRadius against the offset,
    // so with a lopsided margin the centre does NOT move to the content centre.
    const margin = { top: 4, right: 90, bottom: 30, left: 10 };
    const geoAsym = polarGeometry({ width: W, height: H, margin, outerRadius: OUTER });
    const container = render(
      <RadarMetricsChart record={record()} width={W} height={H} margin={margin} outerRadius={OUTER} />
    ).container;
    const first = [...container.querySelectorAll('circle')][0];

    expect(geoAsym.cx).toBe(W / 2);
    expect(parseFloat(first.getAttribute('cx'))).toBeCloseTo(geoAsym.cx, 4);
    expect(parseFloat(first.getAttribute('cy'))).toBeCloseTo(geoAsym.cy - geoAsym.outerRadius, 4);
  });

  test('the band edges we pass as gridRadii are the rings recharts draws', () => {
    // This is what keeps the grid tracing the severity scale instead of the
    // default ticks, which land at scores 0/2/4/5 — straight through Sub-Optimal.
    const gridRadii = SEVERITY_BANDS.map((b) => geo.outerRadius * b.fraction);
    const container = renderChart(record(), { gridRadii, gridStroke: '#d1d5db' });
    const got = gridRings(container).map((el) => ringRadius(el, geo.cx, geo.cy));

    expect(got.sort((a, b) => a - b)).toHaveLength(gridRadii.length);
    [...gridRadii].sort((a, b) => a - b).forEach((want, i) => {
      expect(got[i]).toBeCloseTo(want, 3);
    });
  });

  test('without gridRadii the default rings would bisect the Sub-Optimal score', () => {
    // Guards the REASON gridRadii exists. If recharts ever changes its default
    // ticks so this stops being true, the override may be removable — and this
    // failing test is the prompt to check.
    const container = renderChart(record());
    const defaults = gridRings(container)
      .map((el) => ringRadius(el, geo.cx, geo.cy))
      .filter((r) => r > 0);
    const subOptimalRadius = (2 / SCORE_DOMAIN_MAX) * geo.outerRadius;

    expect(defaults.some((r) => Math.abs(r - subOptimalRadius) < 0.01)).toBe(true);
  });
});

describe('severity bands', () => {
  const geo = polarGeometry({ width: W, height: H, margin: MARGIN, outerRadius: OUTER });

  test('each score falls strictly inside its own band, never on an edge', () => {
    // The whole point of the midpoint edges. A score sitting exactly on a
    // boundary would be unreadable — you could not tell which tier it was in.
    const scores = { Optimal: 5, Acceptable: 3, 'Sub-Optimal': 2, Critical: 1 };
    const edges = SEVERITY_BANDS.map((b) => b.fraction * SCORE_DOMAIN_MAX);

    SEVERITY_BANDS.forEach((band, i) => {
      const score = scores[band.label];
      const outerEdge = edges[i];
      const innerEdge = i + 1 < edges.length ? edges[i + 1] : 0;

      expect(score).toBeLessThanOrEqual(outerEdge);
      expect(score).toBeGreaterThan(innerEdge);
      // Optimal legitimately sits ON the outer rim (score 5 = domain max).
      if (band.label !== 'Optimal') expect(score).toBeLessThan(outerEdge);
    });
  });

  test('bands are ordered outermost-first, as the nested painting requires', () => {
    const fractions = SEVERITY_BANDS.map((b) => b.fraction);
    expect(fractions).toEqual([...fractions].sort((a, b) => b - a));
  });

  test('ringPoints emits one vertex per axis, all at the given radius', () => {
    // The axis count is 5–7 depending on radar model and brand — never assume six.
    [5, 6, 7].forEach((count) => {
      const pts = ringPoints({ cx: geo.cx, cy: geo.cy, radius: geo.outerRadius, count })
        .split(' ')
        .map((p) => p.split(',').map(Number));

      expect(pts).toHaveLength(count);
      pts.forEach(([x, y]) => {
        expect(Math.hypot(x - geo.cx, y - geo.cy)).toBeCloseTo(geo.outerRadius, 3);
      });
    });
  });

  test('band polygons share their vertices with the chart axes', () => {
    // If the band polygon and the grid ring disagreed on vertex angles, the
    // bands would visibly rotate away from the grid.
    const count = buildRadarData(record()).length;
    const gridRadii = SEVERITY_BANDS.map((b) => geo.outerRadius * b.fraction);
    const container = renderChart(record(), { gridRadii, gridStroke: '#d1d5db' });

    const outermost = gridRings(container)
      .map((el) => ({ el, r: ringRadius(el, geo.cx, geo.cy) }))
      .sort((a, b) => b.r - a.r)[0];

    const rechartsVertices = [...outermost.el.getAttribute('d').matchAll(/([\d.-]+)[, ]([\d.-]+)/g)]
      .map((m) => [parseFloat(m[1]), parseFloat(m[2])]);
    const ours = ringPoints({ cx: geo.cx, cy: geo.cy, radius: geo.outerRadius, count })
      .split(' ')
      .map((p) => p.split(',').map(Number));

    ours.forEach(([x, y]) => {
      const matched = rechartsVertices.some(
        ([rx, ry]) => Math.abs(rx - x) < 0.01 && Math.abs(ry - y) < 0.01
      );
      expect(matched).toBe(true);
    });
  });
});
