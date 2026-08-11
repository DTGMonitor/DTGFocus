// app/api/sites/[id]/summary/route.ts
//
// The three report lines — Kondisi Cuaca, Kondisi Kabut, Rekaman Curah Hujan —
// summarised over an arbitrary window.
//
// The window is a parameter, not a mode. A daily report asks for one day and a
// weekly report asks for seven; nothing else about the request differs, which
// is exactly the relationship between those two reports.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { WEATHER_CONSTANTS } from '@/config/weatherConditions';
import {
  fetchAssessments,
  fetchDailyRain,
  fetchHourlyRain,
  fetchReadings,
} from '@/lib/weather/repository';
import { summarisePeriod } from '@/lib/weather/summary';
import {
  dataAge,
  jsonError,
  resolveSite,
  stationSummary,
} from '@/lib/weather/routeHelpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const QuerySchema = z
  .object({
    start: z.string().datetime({ offset: true }).optional(),
    end: z.string().datetime({ offset: true }).optional(),
    /** Fallback when no explicit start: N days back from `end`. */
    days: z.coerce.number().positive().max(366).optional(),
    locale: z.enum(['id', 'en']).catch('id'),
  })
  .transform((q) => {
    const end = q.end ? new Date(q.end) : new Date();
    const start = q.start
      ? new Date(q.start)
      : new Date(end.getTime() - (q.days ?? 1) * 86_400_000);
    return { start, end, locale: q.locale };
  })
  .refine((w) => w.start.getTime() < w.end.getTime(), {
    message: 'start must be before end',
  });

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await context.params;

  const site = await resolveSite(id);
  if (site instanceof NextResponse) return site;

  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    start: url.searchParams.get('start') ?? undefined,
    end: url.searchParams.get('end') ?? undefined,
    days: url.searchParams.get('days') ?? undefined,
    locale: url.searchParams.get('locale') ?? undefined,
  });

  if (!parsed.success) {
    return jsonError('Invalid window', 400, {
      issues: parsed.error.issues.map((i) => i.message),
    });
  }

  const { start, end, locale } = parsed.data;
  const mac = site.station.mac_address;

  try {
    const [readings, assessments, hourly, daily] = await Promise.all([
      fetchReadings(site.supabase, mac, start.toISOString(), end.toISOString()),
      fetchAssessments(site.supabase, mac, start.toISOString(), end.toISOString()),
      fetchHourlyRain(site.supabase, mac, start.toISOString()),
      fetchDailyRain(site.supabase, mac, start.toISOString()),
    ]);

    const summary = summarisePeriod({
      windowStart: start,
      windowEnd: end,
      // The STATION's zone. Every hour and date in the output is written on the
      // clock the data was recorded against, not the analyst's.
      timeZone: site.station.timezone,
      locale,
      readings: readings.map((r) => ({
        observedAt: new Date(r.observed_at),
        clearnessIndex: r.clearness_index,
        solarElevationDeg: r.solar_elevation_deg,
      })),
      assessments: assessments.map((a) => ({
        assessedAt: new Date(a.assessed_at),
        verdict: a.verdict,
        reason: a.reason,
      })),
      hourly: hourly.map((h) => ({
        start: new Date(h.hour_start),
        rainMm: h.rain_mm,
      })),
      daily: daily.map((d) => ({
        start: new Date(d.day_start),
        rainMm: d.rain_mm,
      })),
    });

    const newest = readings.length ? readings[readings.length - 1] : null;

    return NextResponse.json({
      station: stationSummary(site.station),
      window: {
        start: start.toISOString(),
        end: end.toISOString(),
        hours: summary.hours,
        timeZone: site.station.timezone,
      },
      locale,

      // What the report prints. Ready to drop straight into the three rows.
      lines: {
        weather: summary.weather.text,
        fog: summary.fog.text,
        rainfall: summary.rainfall.text,
      },

      // The workings, so a value can be questioned without re-deriving it.
      detail: {
        weather: summary.weather,
        fog: summary.fog,
        rainfall: summary.rainfall,
      },

      // The clearness bands are literature defaults nobody has calibrated here,
      // exactly like the fog thresholds. Shipped with the answer so a reader
      // can see what produced it.
      thresholds: {
        version: WEATHER_CONSTANTS.version,
        skyTiers: WEATHER_CONSTANTS.skyTiers,
        rainTiers: WEATHER_CONSTANTS.rainTiers,
        calibrated: false,
      },

      dataAge: dataAge(newest?.observed_at ?? null, new Date()),
    });
  } catch (err) {
    return jsonError('Failed to summarise the period', 500, {
      detail: (err as Error).message,
    });
  }
}
