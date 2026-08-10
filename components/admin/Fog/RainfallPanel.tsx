'use client';

// components/admin/Fog/RainfallPanel.tsx
//
// Hourly rainfall bars and seven days of daily totals.
//
// The rule this whole panel exists to honour: A MISSING HOUR AND A DRY HOUR
// MUST NOT LOOK THE SAME. A dry hour is a real measurement of zero and draws a
// flat bar at the baseline. An hour nobody polled has no bar at all and gets a
// muted band across the plot, because "no rain fell" and "we were not watching"
// are opposite operational facts and only one of them is reassuring.
//
// Both series are magnitude with no identity to encode, so each is a SINGLE
// colour for every bar. Colouring bars darker-where-bigger would spend the
// identity channel re-encoding what bar height already shows.

import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CloudRain, Table2, BarChart3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataAgeBadge } from './DataAgeBadge';
import { inZone, num } from './fogPresentation';
import type { RainfallResponse } from './types';

interface HourPoint {
  key: string;
  t: number;
  rainMm: number | null;
  missing: boolean;
  coveredMinutes: number;
}

/** Merge consecutive unobserved hours into spans, for a single muted band. */
function missingSpans(points: HourPoint[]): { from: string; to: string }[] {
  const spans: { from: string; to: string }[] = [];
  let start: string | null = null;
  let previous: string | null = null;

  for (const p of points) {
    if (p.missing && start === null) start = p.key;
    if (!p.missing && start !== null && previous !== null) {
      spans.push({ from: start, to: previous });
      start = null;
    }
    previous = p.key;
  }
  if (start !== null && previous !== null) spans.push({ from: start, to: previous });
  return spans;
}

function HourTooltip({
  active,
  payload,
  timezone,
  minCovered,
}: {
  active?: boolean;
  payload?: { payload: HourPoint }[];
  timezone: string;
  minCovered: number;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;

  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
      <div className="font-medium">{inZone(p.t, timezone, 'd MMM HH:mm')}</div>
      {p.rainMm === null ? (
        <div className="mt-1 text-muted-foreground">
          Not measured — only {Math.round(p.coveredMinutes)} of the 60 minutes
          were observed ({minCovered} needed).
        </div>
      ) : (
        <div className="mt-1 tabular-nums">
          <span className="font-medium">{p.rainMm.toFixed(2)} mm</span>
          {p.rainMm === 0 && (
            <span className="text-muted-foreground"> — dry, and measured as dry</span>
          )}
        </div>
      )}
    </div>
  );
}

// The window selector lives in the page's single filter row, not in this card —
// a filter inside a chart card scopes only itself and invites two panels to
// disagree about what "now" covers.
export function RainfallPanel({
  data,
  loading,
  range,
}: {
  data: RainfallResponse | null;
  loading: boolean;
  range: '24h' | '7d';
}) {
  const [showTable, setShowTable] = useState(false);

  const { hours, gaps, ticks, observedTotal, missingCount } = useMemo(() => {
    const tz = data?.station.timezone ?? 'UTC';
    const points: HourPoint[] = (data?.hourly ?? []).map((h) => ({
      key: h.hourStart,
      t: new Date(h.hourStart).getTime(),
      rainMm: h.rainMm,
      missing: h.missing || h.rainMm === null,
      coveredMinutes: h.coveredMinutes,
    }));

    const every = range === '24h' ? 3 : 24;
    return {
      hours: points,
      gaps: missingSpans(points),
      ticks: points
        .filter((p) => Number(inZone(p.t, tz, 'H')) % every === 0)
        .map((p) => p.key),
      observedTotal: points.reduce((s, p) => s + (p.rainMm ?? 0), 0),
      missingCount: points.filter((p) => p.missing).length,
    };
  }, [data, range]);

  if (!data) return null;
  const tz = data.station.timezone;

  return (
    <Card className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base font-semibold">Rainfall</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Hourly totals from the station&apos;s daily accumulator, not from its
              instantaneous rate.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {data.currentRate.raining && (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--fog-rain)]/35 bg-[var(--fog-rain)]/12 px-2 py-0.5 text-xs font-medium text-[var(--fog-rain)]">
                <CloudRain className="size-3" aria-hidden />
                Raining · {num(data.currentRate.rainRateMmh, 1, 'mm/h')}
              </span>
            )}
            <DataAgeBadge age={data.dataAge} timezone={tz} />
            <button
              type="button"
              onClick={() => setShowTable((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-accent"
              aria-pressed={showTable}
            >
              {showTable ? (
                <BarChart3 className="size-3.5" aria-hidden />
              ) : (
                <Table2 className="size-3.5" aria-hidden />
              )}
              {showTable ? 'Chart' : 'Table'}
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Hourly · last {range === '24h' ? '24 hours' : '7 days'}
            </h4>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="h-3 w-3 rounded-sm"
                  style={{ background: 'var(--fog-rain)' }}
                />
                Measured
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="h-3 w-3 rounded-sm"
                  style={{ background: 'var(--fog-missing)', opacity: 0.35 }}
                />
                Not observed
              </span>
              <span className="tabular-nums">
                {observedTotal.toFixed(1)} mm observed
                {missingCount > 0 && ` · ${missingCount} h unwatched`}
              </span>
            </div>
          </div>

          {showTable ? (
            <div className="max-h-[280px] overflow-auto rounded-lg border border-border">
              <table className="w-full text-xs tabular-nums">
                <caption className="sr-only">
                  Hourly rainfall totals with observation coverage
                </caption>
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border text-left">
                    <th className="px-3 py-2 font-medium">Hour ({tz})</th>
                    <th className="px-3 py-2 text-right font-medium">Rain mm</th>
                    <th className="px-3 py-2 text-right font-medium">Covered min</th>
                  </tr>
                </thead>
                <tbody>
                  {hours.map((h) => (
                    <tr key={h.key} className="border-b border-border/50 last:border-0">
                      <td className="px-3 py-1.5">{inZone(h.t, tz, 'd MMM HH:mm')}</td>
                      <td className="px-3 py-1.5 text-right">
                        {h.rainMm === null ? (
                          <span className="text-muted-foreground">not measured</span>
                        ) : (
                          h.rainMm.toFixed(2)
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right text-muted-foreground">
                        {Math.round(h.coveredMinutes)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hours} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
                  {gaps.map((g) => (
                    <ReferenceArea
                      key={g.from}
                      x1={g.from}
                      x2={g.to}
                      fill="var(--fog-missing)"
                      fillOpacity={0.14}
                      strokeOpacity={0}
                    />
                  ))}
                  <CartesianGrid stroke="var(--fog-grid)" strokeWidth={1} vertical={false} />
                  <XAxis
                    dataKey="key"
                    ticks={ticks}
                    tickFormatter={(k: string) => inZone(k, tz, range === '24h' ? 'HH:mm' : 'd MMM')}
                    tick={{ fontSize: 11, fill: 'var(--fog-ink-muted)' }}
                    stroke="var(--fog-axis)"
                    tickLine={false}
                    interval={0}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: 'var(--fog-ink-muted)' }}
                    stroke="var(--fog-axis)"
                    tickLine={false}
                    axisLine={false}
                    width={40}
                    label={{
                      value: 'mm',
                      position: 'insideTopLeft',
                      fontSize: 10,
                      fill: 'var(--fog-ink-muted)',
                    }}
                  />
                  <Tooltip
                    content={
                      <HourTooltip
                        timezone={tz}
                        minCovered={data.coverageRule.minCoveredMinutes}
                      />
                    }
                    cursor={{ fill: 'var(--fog-axis)', fillOpacity: 0.12 }}
                  />
                  {/* A null value renders no bar at all — which is the point.
                      minPointSize forces a MEASURED zero to draw a 2px mark at
                      the baseline: without it recharts drops zero-height bars
                      entirely, and a dry hour becomes pixel-identical to an
                      hour nobody watched. That is the one confusion this whole
                      panel exists to prevent. */}
                  <Bar
                    dataKey="rainMm"
                    fill="var(--fog-rain)"
                    radius={[3, 3, 0, 0]}
                    minPointSize={2}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Daily totals · 7 days
          </h4>
          <div className="h-[160px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.daily.map((d) => ({
                  ...d,
                  label: inZone(d.dayStart, tz, 'd MMM'),
                }))}
                margin={{ top: 16, right: 8, bottom: 4, left: 0 }}
                barCategoryGap="22%"
              >
                <CartesianGrid stroke="var(--fog-grid)" strokeWidth={1} vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: 'var(--fog-ink-muted)' }}
                  stroke="var(--fog-axis)"
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: 'var(--fog-ink-muted)' }}
                  stroke="var(--fog-axis)"
                  tickLine={false}
                  axisLine={false}
                  width={40}
                />
                <Bar
                  dataKey="rainMm"
                  fill="var(--fog-rain)"
                  radius={[3, 3, 0, 0]}
                  minPointSize={2}
                  isAnimationActive={false}
                >
                  {/* Only seven bars, so every one is directly labelled and the
                      tooltip is an enhancement rather than the only way in. */}
                  <LabelList
                    dataKey="rainMm"
                    position="top"
                    fontSize={10}
                    fill="var(--fog-ink-muted)"
                    formatter={(v: unknown) =>
                      typeof v === 'number' ? v.toFixed(1) : ''
                    }
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {data.daily.some((d) => !d.complete) && (
            <p className="mt-1 text-xs text-muted-foreground">
              Days with fewer than 24 observed hours are a floor, not a total —
              the station&apos;s counter resets at local midnight, so we can only
              report the highest value we saw before it did.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
