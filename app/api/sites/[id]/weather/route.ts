// app/api/sites/[id]/weather/route.ts
//
// Current conditions for a site's bound station.

import { NextResponse } from 'next/server';
import { fetchLatestReading } from '@/lib/weather/repository';
import {
  dataAge,
  jsonError,
  resolveSite,
  stationSummary,
} from '@/lib/weather/routeHelpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await context.params;

  const site = await resolveSite(id);
  if (site instanceof NextResponse) return site;

  const now = new Date();

  try {
    const latest = await fetchLatestReading(site.supabase, site.station.mac_address);

    if (!latest) {
      return NextResponse.json({
        station: stationSummary(site.station),
        conditions: null,
        dataAge: dataAge(null, now),
        note: 'The station is bound but has not been polled yet.',
      });
    }

    return NextResponse.json({
      station: stationSummary(site.station),
      conditions: {
        observedAt: latest.observed_at,
        tempC: latest.temp_c,
        dewPointC: latest.dew_point_c,
        dpdC: latest.dpd_c,
        humidity: latest.humidity,
        windKmh: latest.wind_kmh,
        windGustKmh: latest.wind_gust_kmh,
        windDir: latest.wind_dir,
        // Absolute pressure on any station whose owner never applied a
        // sea-level offset — ASBSAR1 among them, where baromrelin equals
        // baromabsin. Label it "station pressure", never MSLP.
        pressureHpa: latest.pressure_hpa,
        solarWm2: latest.solar_wm2,
        uv: latest.uv,
        rainRateMmh: latest.rain_rate_mmh,
        rainDailyMm: latest.rain_daily_mm,
        solarElevationDeg: latest.solar_elevation_deg,
        clearnessIndex: latest.clearness_index,
      },
      dataAge: dataAge(latest.observed_at, now),
    });
  } catch (err) {
    return jsonError('Failed to read conditions', 500, {
      detail: (err as Error).message,
    });
  }
}
