// app/api/sites/[id]/rainfall/route.ts
//
// Hourly buckets and daily totals, derived by the SQL views from migration
// 002 — never by summing `hourlyrainin`, which is a rate and not an
// accumulation.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  fetchDailyRain,
  fetchHourlyRain,
  fetchLatestReading,
} from '@/lib/weather/repository';
import { localHourStart, MIN_COVERED_MINUTES } from '@/lib/weather/rainfall';
import {
  dataAge,
  jsonError,
  resolveSite,
  stationSummary,
} from '@/lib/weather/routeHelpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RangeSchema = z.enum(['24h', '7d']).catch('24h');

const HOURS_IN_RANGE = { '24h': 24, '7d': 24 * 7 } as const;

/** Daily totals always cover a week, whatever the hourly range is. */
const DAILY_DAYS = 7;

export interface HourlyBucket {
  hourStart: string;
  /** Null means NOT MEASURED. It is never a stand-in for a dry hour. */
  rainMm: number | null;
  coveredMinutes: number;
  sampleCount: number;
  hadReset: boolean;
  /** True when the hour has no data at all, as opposed to thin data. */
  missing: boolean;
}

/**
 * Fill the gaps the view cannot.
 *
 * `weather_rain_hourly` only emits hours that contain at least one reading, so
 * an hour the poller never saw produces NO ROW — and a chart that plots the
 * rows it receives would silently close the gap, drawing an unwatched hour as
 * adjacent to the one before it.
 *
 * Emitting the full grid with explicit nulls is what lets the UI honour the
 * rule that a missing hour and a dry hour must never look the same.
 */
function fillHourGrid(
  rows: { hour_start: string; rain_mm: number | null; covered_minutes: number; sample_count: number; had_reset: boolean }[],
  from: Date,
  to: Date,
  timeZone: string
): HourlyBucket[] {
  const byHour = new Map(
    rows.map((r) => [new Date(r.hour_start).getTime(), r])
  );

  const out: HourlyBucket[] = [];
  let cursor = localHourStart(from, timeZone).getTime();
  const end = to.getTime();

  while (cursor <= end) {
    const row = byHour.get(cursor);
    out.push({
      hourStart: new Date(cursor).toISOString(),
      rainMm: row?.rain_mm ?? null,
      coveredMinutes: row?.covered_minutes ?? 0,
      sampleCount: row?.sample_count ?? 0,
      hadReset: row?.had_reset ?? false,
      missing: row === undefined,
    });
    cursor += 3_600_000;
  }

  return out;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await context.params;

  const site = await resolveSite(id);
  if (site instanceof NextResponse) return site;

  const range = RangeSchema.parse(
    new URL(request.url).searchParams.get('range')
  );

  const now = new Date();
  const hourlyFrom = new Date(now.getTime() - HOURS_IN_RANGE[range] * 3_600_000);
  const dailyFrom = new Date(now.getTime() - DAILY_DAYS * 24 * 3_600_000);
  const tz = site.station.timezone;

  try {
    const [hourly, daily, latest] = await Promise.all([
      fetchHourlyRain(
        site.supabase,
        site.station.mac_address,
        localHourStart(hourlyFrom, tz).toISOString()
      ),
      fetchDailyRain(
        site.supabase,
        site.station.mac_address,
        dailyFrom.toISOString()
      ),
      fetchLatestReading(site.supabase, site.station.mac_address),
    ]);

    return NextResponse.json({
      station: stationSummary(site.station),
      range,

      hourly: fillHourGrid(hourly, hourlyFrom, now, tz),

      daily: daily.map((d) => ({
        dayStart: d.day_start,
        rainMm: d.rain_mm,
        sampleCount: d.sample_count,
        hoursObserved: d.hours_observed,
        // Below 24 the total is a floor, not a fact: the station's accumulator
        // is authoritative, but we can only read the maximum we happened to
        // observe before it reset.
        complete: d.hours_observed >= 24,
      })),

      // The instantaneous rate, which is the ONLY thing hourlyrainin is good
      // for. Kept separate from the totals so nothing downstream is tempted to
      // add it to them.
      currentRate: {
        rainRateMmh: latest?.rain_rate_mmh ?? null,
        raining: (latest?.rain_rate_mmh ?? 0) > 0,
      },

      // So the UI can explain a null bucket rather than just leaving a hole.
      coverageRule: {
        minCoveredMinutes: MIN_COVERED_MINUTES,
        note: 'Hours below the coverage threshold report null, not zero.',
      },

      dataAge: dataAge(latest?.observed_at ?? null, now),
    });
  } catch (err) {
    return jsonError('Failed to read rainfall', 500, {
      detail: (err as Error).message,
    });
  }
}
