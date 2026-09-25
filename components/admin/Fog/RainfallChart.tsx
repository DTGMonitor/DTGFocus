'use client';

// components/admin/Fog/RainfallChart.tsx
//
// The rainfall plot itself, shared by the live fog monitor and the printed
// daily report.
//
// ONE COMPONENT, TWO RENDER TARGETS, because the alternative is two charts that
// drift. A client reading the Tabulation report and an analyst reading the fog
// monitor are looking at the same station on the same day; if the two ever
// disagreed about a rain event, neither would be trusted again. So the series,
// the gap rule, the tick ladder and the axis headroom live here once, and the
// caller chooses only where it is drawn.
//
// THE PRINT PATH IS NOT A STYLE VARIANT — it is a different renderer with
// different rules, and all three of these are load-bearing (see
// components/admin/Radar/report/blocks/DataQuality.jsx, which learned them):
//
//   1. FIXED PIXEL SIZE, never ResponsiveContainer. The report mounts every
//      block a second time in a hidden measurement layer with no resolved
//      height, where ResponsiveContainer measures 0 and the chart rasterizes
//      BLANK into the PDF.
//   2. INLINE HEX, never a CSS custom property. html2canvas 1.x resolves
//      neither `var()` nor oklch() and silently paints them transparent — a
//      hole in the page rather than a visible failure.
//   3. NO TOOLTIP AND NO ANIMATION. The measured pass and the printed pass must
//      render identically, and neither hover nor a transition survives to
//      paper anyway.
//
// The chart's own reasoning — why the accumulator is drawn with its midnight
// reset intact, why two units share one axis, why the lines break on gaps —
// is in RainfallPanel.tsx, which is where a reader meets it first.

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { breakOnGaps, inZone } from './fogPresentation';
import type { HourlyBucket, RainSeriesPoint } from './types';

export interface RainPoint {
  t: number;
  rainDailyMm: number | null;
  rainRateMmh: number | null;
}

/**
 * The two palettes.
 *
 * Screen reads the theme tokens so the chart follows dark mode. Print cannot:
 * the values below are the tokens' own LIGHT-MODE hex, resolved by hand,
 * because the report is always a white page whatever the browser theme is. If
 * --fog-rain-daily or --fog-rain ever moves in globals.css, move it here too —
 * these are the same two colours, written twice for two renderers that cannot
 * share one spelling.
 */
export const SCREEN_PALETTE = {
  daily: 'var(--fog-rain-daily)',
  rate: 'var(--fog-rain)',
  grid: 'var(--fog-grid)',
  axis: 'var(--fog-axis)',
  ink: 'var(--fog-ink-muted)',
  missing: 'var(--fog-missing)',
};

export const PRINT_PALETTE = {
  daily: '#0f9b93',
  rate: '#3498db',
  grid: '#e5e7eb',
  axis: '#d1d5db',
  ink: '#6b7280',
  missing: '#898781',
};

export type RainPalette = typeof SCREEN_PALETTE;

/** Headroom above the peak, as a fraction of the range. */
const HEADROOM = 0.08;

/**
 * Y ticks the vendor's way — a round step, plus the exact maximum on top — and
 * the domain that has to go with them.
 *
 * The top tick being the real peak rather than a rounded ceiling is the one
 * detail that makes the vendor chart readable at a glance: "how hard did it
 * rain" is answered by the axis without a tooltip. That matters more in print
 * than on screen, where there is no tooltip to fall back on.
 *
 * The domain is returned ALONGSIDE the ticks because the two constrain each
 * other and drift apart if they are computed in two places. A domain that ends
 * AT the peak puts the peak vertex on the plot's top edge, where half the
 * stroke and half the marker fall outside the drawing area.
 */
export function rainScale(max: number): { ticks: number[]; domainMax: number } {
  if (!(max > 0)) return { ticks: [0, 1], domainMax: 1 };

  // Four gaps is what the plot height affords. The ladder includes 3, 4 and 6
  // as well as the usual 1/2/5, because a 23.4 mm peak wants ticks every 6 —
  // rounding that up to 10 would leave two labels on a plot this tall.
  const rough = max / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const nice =
    ([1, 2, 2.5, 3, 4, 5, 6, 8, 10].find((m) => m * magnitude >= rough) ?? 10) *
    magnitude;

  const ticks: number[] = [];
  // Indexed rather than accumulated, so a 0.5 step does not drift into
  // 1.4999999, and stopping short of the peak keeps the last round tick from
  // colliding with the exact max a few pixels away.
  for (let i = 0; i * nice < max * 0.9; i += 1) {
    ticks.push(Math.round(i * nice * 1000) / 1000);
  }

  const peak = Math.round(max * 10) / 10;
  ticks.push(peak);

  return { ticks, domainMax: Math.max(peak, max) * (1 + HEADROOM) };
}

/** Ticks on local hour boundaries, as the operator reads the clock. */
export function hourlyTicks(
  from: number,
  to: number,
  tz: string,
  every: number
): number[] {
  const ticks: number[] = [];
  const start = Math.ceil(from / 3_600_000) * 3_600_000;
  for (let t = start; t <= to; t += 3_600_000) {
    if (Number(inZone(t, tz, 'H')) % every === 0) ticks.push(t);
  }
  return ticks;
}

/**
 * An hour we cannot stand behind.
 *
 * Two different absences, one band: `missing` is an hour with NO row at all,
 * and a null `rainMm` is an hour with a row too thin to report. Both mean the
 * same thing to a reader, and banding only the first would leave the thin hour
 * looking measured.
 */
export function unwatched(h: HourlyBucket): boolean {
  return h.missing || h.rainMm === null;
}

/** Merge consecutive unobserved hours into spans, for a single muted band. */
export function missingSpans(
  hours: HourlyBucket[]
): { from: number; to: number }[] {
  const spans: { from: number; to: number }[] = [];
  let start: number | null = null;
  let previous: number | null = null;

  for (const h of hours) {
    const t = new Date(h.hourStart).getTime();
    if (unwatched(h) && start === null) start = t;
    if (!unwatched(h) && start !== null && previous !== null) {
      spans.push({ from: start, to: previous + 3_600_000 });
      start = null;
    }
    previous = t;
  }
  if (start !== null && previous !== null) {
    spans.push({ from: start, to: previous + 3_600_000 });
  }
  return spans;
}

/**
 * Everything the plot needs, derived once.
 *
 * Pure and exported so the panel's legend, summary line and table read the same
 * numbers the chart drew, rather than recomputing a peak or a latest value that
 * could disagree with the picture beside it.
 */
export function prepareRain(
  series: RainSeriesPoint[],
  hourly: HourlyBucket[],
  timezone: string,
  range: '24h' | '7d'
) {
  const raw: RainPoint[] = series
    .map((s) => ({
      t: new Date(s.observedAt).getTime(),
      rainDailyMm: s.rainDailyMm,
      rainRateMmh: s.rainRateMmh,
    }))
    .sort((a, b) => a.t - b.t);

  // Reduced rather than spread into Math.max: a 7-day window at reading
  // cadence is thousands of values, and the argument list has a ceiling.
  let max = 0;
  for (const p of raw) {
    if (p.rainDailyMm !== null && p.rainDailyMm > max) max = p.rainDailyMm;
    if (p.rainRateMmh !== null && p.rainRateMmh > max) max = p.rainRateMmh;
  }

  const scale = rainScale(max);

  return {
    // Lines break where polling stopped rather than running straight across. A
    // continuous line over a hole asserts we know what fell.
    points: breakOnGaps(raw, ['rainDailyMm', 'rainRateMmh']),
    gaps: missingSpans(hourly),
    xTicks: raw.length
      ? hourlyTicks(raw[0].t, raw[raw.length - 1].t, timezone, range === '24h' ? 3 : 6)
      : [],
    yTicks: scale.ticks,
    yMax: scale.domainMax,
    latest: raw.length ? raw[raw.length - 1] : null,
    missingCount: hourly.filter(unwatched).length,
  };
}

export function RainfallChart({
  series,
  hourly,
  timezone,
  range,
  width,
  height = 280,
  palette = SCREEN_PALETTE,
  tooltip,
}: {
  series: RainSeriesPoint[];
  hourly: HourlyBucket[];
  timezone: string;
  range: '24h' | '7d';
  /**
   * Fixed pixel width. Omit on the live dashboard, which fills its card via
   * ResponsiveContainer. REQUIRED on the report and export paths — see the
   * file header for what happens without it.
   */
  width?: number;
  height?: number;
  palette?: RainPalette;
  /** Screen only. The report renders no tooltip: paper has no hover. */
  tooltip?: React.ReactElement;
}) {
  const { points, gaps, xTicks, yTicks, yMax } = prepareRain(
    series,
    hourly,
    timezone,
    range
  );

  const fixed = Number.isFinite(width);
  const fontSize = fixed ? 8 : 11;

  const chart = (
    <LineChart
      data={points}
      {...(fixed ? { width, height } : {})}
      margin={{ top: 8, right: 16, bottom: 4, left: 0 }}
    >
      {/* Bands first, so the lines sit above them. */}
      {gaps.map((g) => (
        <ReferenceArea
          key={g.from}
          x1={g.from}
          x2={g.to}
          fill={palette.missing}
          fillOpacity={0.14}
          strokeOpacity={0}
          ifOverflow="hidden"
        />
      ))}

      <CartesianGrid stroke={palette.grid} strokeWidth={1} vertical={false} />

      {/* A NUMERIC time axis, so an hour nobody polled occupies an hour of
          width instead of collapsing to the next sample. */}
      <XAxis
        dataKey="t"
        type="number"
        scale="time"
        domain={['dataMin', 'dataMax']}
        ticks={xTicks}
        tickFormatter={(t: number) =>
          inZone(t, timezone, range === '24h' ? 'HH:mm' : 'M/d')
        }
        tick={{ fontSize, fill: palette.ink }}
        stroke={palette.axis}
        tickLine={false}
      />

      {/* Zero-based, unlike the convergence chart: these are depths and rates,
          where the distance from nothing IS the reading. */}
      <YAxis
        domain={[0, yMax]}
        ticks={yTicks}
        tickFormatter={(v: number) => v.toFixed(1)}
        tick={{ fontSize, fill: palette.ink }}
        stroke={palette.axis}
        tickLine={false}
        axisLine={false}
        width={fixed ? 34 : 44}
      />

      {tooltip && (
        <Tooltip
          content={tooltip}
          cursor={{ stroke: palette.axis, strokeWidth: 1 }}
        />
      )}

      {/* Straight segments, never smoothed. A rain rate spike is often one
          five-minute sample, and a monotone curve would round its peak down to
          a value never recorded. */}
      <Line
        type="linear"
        dataKey="rainDailyMm"
        name="Daily Rain"
        stroke={palette.daily}
        strokeWidth={fixed ? 1.2 : 2}
        dot={false}
        activeDot={tooltip ? { r: 4, strokeWidth: 0 } : false}
        connectNulls={false}
        isAnimationActive={false}
      />
      <Line
        type="linear"
        dataKey="rainRateMmh"
        name="Rain Rate"
        stroke={palette.rate}
        strokeWidth={fixed ? 1.2 : 2}
        dot={false}
        activeDot={tooltip ? { r: 4, strokeWidth: 0 } : false}
        connectNulls={false}
        isAnimationActive={false}
      />
    </LineChart>
  );

  if (fixed) return chart;

  return (
    <ResponsiveContainer width="100%" height="100%">
      {chart}
    </ResponsiveContainer>
  );
}

export default RainfallChart;
