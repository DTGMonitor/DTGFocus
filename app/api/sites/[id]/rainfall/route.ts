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
  fetchReadings,
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

/** The window's closing instant. Absent, unparseable or future all mean "now". */
const EndSchema = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s))
  .nullable()
  .catch(null);

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

  const params = new URL(request.url).searchParams;
  const range = RangeSchema.parse(params.get('range'));

  const now = new Date();

  // `end` ANCHORS the window to an instant other than now, which is what lets a
  // report print the same weather every time it is regenerated. The live fog
  // monitor omits it and gets "now"; the daily report passes the end of the
  // report day, so reissuing last Tuesday's report reproduces last Tuesday's
  // rainfall instead of today's under last Tuesday's masthead.
  //
  // A future or unparseable value falls back to now rather than erroring: a
  // clock-skewed caller should get the live window, not a failed panel.
  const requestedEnd = EndSchema.parse(params.get('end'));
  const anchored = requestedEnd !== null && requestedEnd.getTime() < now.getTime();
  const end = anchored ? (requestedEnd as Date) : now;

  const hourlyFrom = new Date(end.getTime() - HOURS_IN_RANGE[range] * 3_600_000);
  const dailyFrom = new Date(end.getTime() - DAILY_DAYS * 24 * 3_600_000);
  const tz = site.station.timezone;

  try {
    const [hourly, daily, liveLatest, readings] = await Promise.all([
      fetchHourlyRain(
        site.supabase,
        site.station.mac_address,
        localHourStart(hourlyFrom, tz).toISOString(),
        end.toISOString()
      ),
      fetchDailyRain(
        site.supabase,
        site.station.mac_address,
        dailyFrom.toISOString(),
        end.toISOString()
      ),
      // Skipped entirely when anchored — "the newest reading that exists" is
      // the wrong answer for a window that closed days ago.
      anchored ? null : fetchLatestReading(site.supabase, site.station.mac_address),
      fetchReadings(
        site.supabase,
        site.station.mac_address,
        hourlyFrom.toISOString(),
        end.toISOString()
      ),
    ]);

    // Anchored, the window's own last reading IS the latest: it is what the
    // station knew when the window closed.
    const latest = anchored
      ? (readings.length ? readings[readings.length - 1] : null)
      : liveLatest;

    // Both columns exactly as the station reports them, with no derivation in
    // between. `rain_daily_mm` IS the station's calendar-day accumulator: it
    // climbs through the day and drops to zero at local midnight, and that
    // reset is part of the reading, not an artefact to smooth away.
    //
    // Verified against the vendor's own export (public/Ambient_Exported.csv)
    // across 2213 readings: these two columns reproduce its "Daily Rain" and
    // "Rain Rate" series, so the chart and the vendor's agree by construction
    // rather than by coincidence.
    const series = readings.map((r) => ({
      observedAt: r.observed_at,
      rainDailyMm: r.rain_daily_mm,
      rainRateMmh: r.rain_rate_mmh,
    }));

    return NextResponse.json({
      station: stationSummary(site.station),
      range,

      hourly: fillHourGrid(hourly, hourlyFrom, now, tz),

      // The chart's two lines, at reading cadence. Kept at full resolution
      // for the same reason the convergence chart is: a rain rate spike is
      // often a single five-minute sample, and downsampling would delete the
      // one reading that mattered.
      series,

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
