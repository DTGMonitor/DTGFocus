'use client';

// components/admin/Fog/ConvergenceChart.tsx
//
// Temperature and dew point over 24 hours, with the saturation window shaded.
//
// THE CONVERGENCE IS THE CHART. Fog forms where the two lines meet, so every
// decision here serves that reading:
//
//   * ONE y-axis, both series in °C. They are the same quantity in the same
//     unit; a second scale would invent a gap or close one.
//   * The y-domain is tight around the data, not zero-based. A 0-30 °C axis
//     would squash a 0.1 °C separation into nothing — which is precisely the
//     separation that decides whether there is fog.
//   * A NUMERIC TIME axis, so an hour nobody polled occupies an hour of width
//     instead of collapsing to the next sample.
//   * Lines break on gaps over 20 minutes rather than drawing straight
//     through. A continuous line across a hole asserts we know what the air
//     did; we do not.

import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Table2, LineChart as LineChartIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataAgeBadge } from './DataAgeBadge';
import { breakOnGaps, inZone, num, saturationSpans } from './fogPresentation';
import type { FogResponse } from './types';

interface Point {
  t: number;
  tempC: number | null;
  dewPointC: number | null;
  dpdC: number | null;
}

/** Ticks on local 6-hour boundaries, as the operator reads the clock. */
function sixHourlyTicks(from: number, to: number, tz: string): number[] {
  const ticks: number[] = [];
  // Step by hour and keep the ones whose local hour is a multiple of six.
  // Cheaper than zone arithmetic and correct for non-integer offsets too.
  const start = Math.ceil(from / 3_600_000) * 3_600_000;
  for (let t = start; t <= to; t += 3_600_000) {
    const hour = Number(inZone(t, tz, 'H'));
    if (hour % 6 === 0) ticks.push(t);
  }
  return ticks;
}

function ChartTooltip({
  active,
  payload,
  timezone,
  dpdSatC,
}: {
  active?: boolean;
  payload?: { payload: Point }[];
  timezone: string;
  dpdSatC: number;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  if (p.tempC === null) return null;

  const saturated = p.dpdC !== null && p.dpdC <= dpdSatC;

  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium">
        {inZone(p.t, timezone, 'd MMM HH:mm')}
      </div>
      <dl className="space-y-0.5 tabular-nums">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: 'var(--fog-temp)' }} />
          <dt className="text-muted-foreground">Temperature</dt>
          <dd className="ml-auto font-medium">{num(p.tempC, 1, '°C')}</dd>
        </div>
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: 'var(--fog-dew)' }} />
          <dt className="text-muted-foreground">Dew point</dt>
          <dd className="ml-auto font-medium">{num(p.dewPointC, 1, '°C')}</dd>
        </div>
        <div className="flex items-center gap-2 border-t border-border pt-0.5">
          <dt className="text-muted-foreground">Depression</dt>
          <dd className="ml-auto font-medium">{num(p.dpdC, 2, '°C')}</dd>
        </div>
      </dl>
      {saturated && (
        <div className="mt-1 text-[var(--fog-dew)]">Saturated</div>
      )}
    </div>
  );
}

export function ConvergenceChart({
  data,
  loading,
}: {
  data: FogResponse | null;
  loading: boolean;
}) {
  const [showTable, setShowTable] = useState(false);

  const { points, spans, domain, ticks, latest } = useMemo(() => {
    const raw: Point[] = (data?.series ?? [])
      .map((s) => ({
        t: new Date(s.observedAt).getTime(),
        tempC: s.tempC,
        dewPointC: s.dewPointC,
        dpdC: s.dpdC,
      }))
      .sort((a, b) => a.t - b.t);

    const tz = data?.station.timezone ?? 'UTC';
    const dpdSat = data?.thresholds.dpdSatC ?? 1;

    const values = raw.flatMap((p) =>
      [p.tempC, p.dewPointC].filter((v): v is number => v !== null)
    );
    const lo = values.length ? Math.min(...values) : 0;
    const hi = values.length ? Math.max(...values) : 1;
    // At least 1.2 °C of visible range: without a floor, a night where the two
    // lines sit 0.1 °C apart would be drawn as two lines with wild noise
    // between them.
    const pad = Math.max((hi - lo) * 0.12, 0.6);

    return {
      points: breakOnGaps(raw, ['tempC', 'dewPointC', 'dpdC']),
      spans: saturationSpans(raw, dpdSat),
      domain: [lo - pad, hi + pad] as [number, number],
      ticks: raw.length
        ? sixHourlyTicks(raw[0].t, raw[raw.length - 1].t, tz)
        : [],
      latest: raw.length ? raw[raw.length - 1] : null,
    };
  }, [data]);

  if (!data) return null;
  const tz = data.station.timezone;

  return (
    <Card className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base font-semibold">
              Temperature and dew point · 24 hours
            </CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Fog forms where the lines meet. Shaded bands mark air within{' '}
              {data.thresholds.dpdSatC} °C of saturation.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <DataAgeBadge age={data.dataAge} timezone={tz} />
            <button
              type="button"
              onClick={() => setShowTable((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-accent"
              aria-pressed={showTable}
            >
              {showTable ? (
                <LineChartIcon className="size-3.5" aria-hidden />
              ) : (
                <Table2 className="size-3.5" aria-hidden />
              )}
              {showTable ? 'Chart' : 'Table'}
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {/* Legend: always present for two series, and each swatch carries the
            current value so identity is never colour-alone and the endpoint is
            directly labelled without crowding the plot. */}
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-2">
            <span className="h-0.5 w-4 rounded-full" style={{ background: 'var(--fog-temp)' }} />
            Temperature
            <span className="font-medium tabular-nums">
              {num(latest?.tempC, 1, '°C')}
            </span>
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-0.5 w-4 rounded-full" style={{ background: 'var(--fog-dew)' }} />
            Dew point
            <span className="font-medium tabular-nums">
              {num(latest?.dewPointC, 1, '°C')}
            </span>
          </span>
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <span
              className="h-3 w-4 rounded-sm"
              style={{ background: 'var(--fog-sat-band)', opacity: 0.16 }}
            />
            Saturation window
          </span>
        </div>

        {showTable ? (
          <div className="max-h-[320px] overflow-auto rounded-lg border border-border">
            <table className="w-full text-xs tabular-nums">
              <caption className="sr-only">
                Every reading in the window, with temperature, dew point and
                depression
              </caption>
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border text-left">
                  <th className="px-3 py-2 font-medium">Time ({tz})</th>
                  <th className="px-3 py-2 text-right font-medium">T °C</th>
                  <th className="px-3 py-2 text-right font-medium">Td °C</th>
                  <th className="px-3 py-2 text-right font-medium">DPD °C</th>
                </tr>
              </thead>
              <tbody>
                {data.series.map((s) => (
                  <tr key={s.observedAt} className="border-b border-border/50 last:border-0">
                    <td className="px-3 py-1.5">
                      {inZone(s.observedAt, tz, 'd MMM HH:mm')}
                    </td>
                    <td className="px-3 py-1.5 text-right">{num(s.tempC, 1)}</td>
                    <td className="px-3 py-1.5 text-right">{num(s.dewPointC, 1)}</td>
                    <td className="px-3 py-1.5 text-right">{num(s.dpdC, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : points.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No readings in the last 24 hours.
          </p>
        ) : (
          // Height includes the x-axis band, so the card never grows a nested
          // scrollbar to reach its own labels.
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                {/* Shading first, so the lines sit above it. */}
                {spans.map((s) => (
                  <ReferenceArea
                    key={`${s.from}-${s.to}`}
                    x1={s.from}
                    x2={s.to}
                    fill="var(--fog-sat-band)"
                    fillOpacity={0.16}
                    strokeOpacity={0}
                    ifOverflow="hidden"
                  />
                ))}

                {/* Solid hairlines, never dashed — a dashed grid reads as a
                    threshold or a projection when it is only a grid. */}
                <CartesianGrid
                  stroke="var(--fog-grid)"
                  strokeWidth={1}
                  vertical={false}
                />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={['dataMin', 'dataMax']}
                  ticks={ticks}
                  tickFormatter={(t: number) => inZone(t, tz, 'HH:mm')}
                  tick={{ fontSize: 11, fill: 'var(--fog-ink-muted)' }}
                  stroke="var(--fog-axis)"
                  tickLine={false}
                />
                <YAxis
                  domain={domain}
                  tickFormatter={(v: number) => v.toFixed(1)}
                  tick={{ fontSize: 11, fill: 'var(--fog-ink-muted)' }}
                  stroke="var(--fog-axis)"
                  tickLine={false}
                  axisLine={false}
                  width={44}
                  label={{
                    value: '°C',
                    position: 'insideTopLeft',
                    fontSize: 10,
                    fill: 'var(--fog-ink-muted)',
                  }}
                />
                <Tooltip
                  content={
                    <ChartTooltip timezone={tz} dpdSatC={data.thresholds.dpdSatC} />
                  }
                  cursor={{ stroke: 'var(--fog-axis)', strokeWidth: 1 }}
                />

                <Line
                  type="monotone"
                  dataKey="dewPointC"
                  name="Dew point"
                  stroke="var(--fog-dew)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="tempC"
                  name="Temperature"
                  stroke="var(--fog-temp)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
                  connectNulls={false}
                  isAnimationActive={false}
                />

                {/* Anchor the eye at the current values. 2px surface ring so
                    the two markers stay separable where the lines converge. */}
                {latest?.tempC !== null && latest !== null && (
                  <ReferenceDot
                    x={latest.t}
                    y={latest.tempC as number}
                    r={4}
                    fill="var(--fog-temp)"
                    stroke="var(--card)"
                    strokeWidth={2}
                    ifOverflow="visible"
                  />
                )}
                {latest?.dewPointC !== null && latest !== null && (
                  <ReferenceDot
                    x={latest.t}
                    y={latest.dewPointC as number}
                    r={4}
                    fill="var(--fog-dew)"
                    stroke="var(--card)"
                    strokeWidth={2}
                    ifOverflow="visible"
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
