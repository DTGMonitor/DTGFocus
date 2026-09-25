'use client';

// components/admin/Fog/RainfallPanel.tsx
//
// Rainfall as two lines, laid out the way the station vendor's own chart lays
// them out: the daily accumulator and the instantaneous rate, on one plot, one
// axis, and a legend in the top right.
//
// BOTH SERIES ARE THE STATION'S OWN COLUMNS, UNDERIVED. "Daily Rain" is
// `rain_daily_mm` exactly as reported — a CALENDAR-DAY accumulator that climbs
// through the local day and drops to zero at local midnight. The drop is a
// real feature of the instrument and is drawn, not smoothed: an operator
// comparing this panel against the vendor's app must see the same shape, and a
// cleverer series here would be a second opinion nobody asked for. Checked
// against the vendor's export in public/Ambient_Exported.csv over 2213
// readings.
//
// The consequence to know when reading it: at 00:05 the line says 0 mm even if
// 40 mm fell six hours earlier. That is what the vendor's chart says too. Use
// the hourly totals, which are reset-aware, for "how much rain has this slope
// taken lately".
//
// WHY ONE AXIS FOR TWO UNITS. mm and mm/h are not the same quantity, and on a
// chart of our own design they would get two scales or two plots. This panel
// deliberately mirrors the vendor chart the site team already reads, so the
// shared axis is kept: the two quantities are related (a rate integrates to a
// depth) and similarly scaled in practice, and the cost is that the crossing
// of the two lines means nothing. Nothing in the panel invites reading it.
//
// THE RULE THIS PANEL HAS ALWAYS EXISTED TO HONOUR still holds, and the line
// form makes it sharper rather than softer: A MISSING HOUR AND A DRY HOUR MUST
// NOT LOOK THE SAME. A dry hour is a measurement and draws a line along the
// baseline. An hour nobody polled breaks the line and gets a muted band.

import { useMemo, useState } from 'react';
import { CloudRain, Table2, LineChart as LineChartIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataAgeBadge } from './DataAgeBadge';
import { inZone, num } from './fogPresentation';
import {
  prepareRain,
  RainfallChart,
  SCREEN_PALETTE,
  type RainPoint,
} from './RainfallChart';
import type { RainfallResponse } from './types';

const RAIN_DAILY = SCREEN_PALETTE.daily;
const RAIN_RATE = SCREEN_PALETTE.rate;

/** Trailing zeros are noise: 14 mm is 14 mm, not 14.00 mm. */
function trim(v: number): string {
  return String(Math.round(v * 100) / 100);
}

function RainTooltip({
  active,
  payload,
  timezone,
}: {
  active?: boolean;
  payload?: { payload: RainPoint }[];
  timezone: string;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  if (p.rainDailyMm === null && p.rainRateMmh === null) return null;

  return (
    <div className="rounded-lg border border-border bg-[var(--dtg-bg-card)] px-3 py-2 text-xs shadow-md">
      {/* The offset is part of the timestamp. The station is not necessarily
          on the reader's clock, and a bare "23:30" would not say so. */}
      <div className="mb-1 text-[var(--dtg-text-muted)]">
        {inZone(p.t, timezone, 'MMM d HH:mm X')}
      </div>
      <div className="space-y-0.5 tabular-nums">
        <div style={{ color: RAIN_DAILY }}>
          Daily Rain :{' '}
          {p.rainDailyMm === null ? 'not measured' : `${trim(p.rainDailyMm)} mm`}
        </div>
        <div style={{ color: RAIN_RATE }}>
          Rain Rate :{' '}
          {p.rainRateMmh === null
            ? 'not measured'
            : `${trim(p.rainRateMmh)} mm/hr`}
        </div>
      </div>
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

  const { points, latest, missingCount } = useMemo(
    () =>
      prepareRain(
        data?.series ?? [],
        data?.hourly ?? [],
        data?.station.timezone ?? 'UTC',
        range
      ),
    [data, range]
  );

  if (!data) return null;
  const tz = data.station.timezone;

  return (
    <Card className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base text-[var(--dtg-text-muted)] font-semibold">Rainfall</CardTitle>
            <p className="mt-0.5 text-xs text-[var(--dtg-text-muted)]">
              The station&apos;s own two series, unmodified. Daily rain is its
              calendar-day accumulator, so it drops to zero at local midnight.
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
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-[var(--dtg-text-muted)] font-medium hover:bg-accent"
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
        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--dtg-text-muted)]">
            <h4 className="font-semibold uppercase tracking-wider">
              Last {range === '24h' ? '24 hours' : '7 days'}
            </h4>
            <span className="tabular-nums">
              {latest?.rainDailyMm !== null && latest !== null
                ? `${trim(latest.rainDailyMm as number)} mm so far today`
                : 'no current daily total'}
            </span>
            {missingCount > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="h-3 w-3 rounded-sm"
                  style={{ background: 'var(--fog-missing)', opacity: 0.35 }}
                />
                {missingCount} h unwatched
              </span>
            )}
          </div>

          {/* Legend where the vendor chart puts it, and the only place the
              two series are named outside the tooltip — so the pair is never
              distinguished by hue alone. */}
          <div className="flex items-center gap-4 text-xs">
            <span className="inline-flex items-center gap-1.5">
              <span
                className="size-2.5 rounded-full"
                style={{ background: RAIN_DAILY }}
              />
              <span style={{ color: RAIN_DAILY }}>Daily Rain</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="size-2.5 rounded-full"
                style={{ background: RAIN_RATE }}
              />
              <span style={{ color: RAIN_RATE }}>Rain Rate</span>
            </span>
          </div>
        </div>

        {showTable ? (
          <div className="max-h-[320px] overflow-auto rounded-lg border border-border">
            <table className="w-full text-xs tabular-nums">
              <caption className="sr-only">
                Every reading in the window, with the station&apos;s daily
                accumulator and its instantaneous rate
              </caption>
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border text-left">
                  <th className="px-3 py-2 font-medium">Time ({tz})</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Daily rain mm
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Rate mm/hr</th>
                </tr>
              </thead>
              <tbody>
                {data.series.map((s) => (
                  <tr
                    key={s.observedAt}
                    className="border-b border-border/50 last:border-0"
                  >
                    <td className="px-3 py-1.5">
                      {inZone(s.observedAt, tz, 'd MMM HH:mm')}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {s.rainDailyMm === null ? (
                        <span className="text-[var(--dtg-text-muted)]">not measured</span>
                      ) : (
                        s.rainDailyMm.toFixed(2)
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {s.rainRateMmh === null ? (
                        <span className="text-[var(--dtg-text-muted)]">not measured</span>
                      ) : (
                        s.rainRateMmh.toFixed(2)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : points.length === 0 ? (
          <p className="py-12 text-center text-sm text-[var(--dtg-text-muted)]">
            No readings in the last {range === '24h' ? '24 hours' : '7 days'}.
          </p>
        ) : (
          <div className="h-[280px] w-full">
            <RainfallChart
              series={data.series}
              hourly={data.hourly}
              timezone={tz}
              range={range}
              tooltip={<RainTooltip timezone={tz} />}
            />
          </div>
        )}

        {missingCount > 0 && (
          <p className="mt-2 text-xs text-[var(--dtg-text-muted)]">
            Banded stretches are hours nobody polled. The lines break across
            them rather than running through — rain may have fallen unseen, and
            the accumulator only tells us where it ended up, not when.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
