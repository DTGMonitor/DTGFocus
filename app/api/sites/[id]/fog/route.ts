// app/api/sites/[id]/fog/route.ts
//
// The current fog assessment plus the 24-hour temperature / dew point series
// the chart is built from.

import { NextResponse } from 'next/server';
import { FOG_CONSTANTS } from '@/config/fogConstants';
import { fetchLatestAssessment, fetchReadings } from '@/lib/weather/repository';
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
  const since = new Date(
    now.getTime() - FOG_CONSTANTS.windowHours * 3_600_000
  ).toISOString();

  try {
    const [assessment, readings] = await Promise.all([
      fetchLatestAssessment(site.supabase, site.station.mac_address),
      fetchReadings(site.supabase, site.station.mac_address, since),
    ]);

    const newest = readings.length ? readings[readings.length - 1] : null;

    return NextResponse.json({
      station: stationSummary(site.station),

      assessment: assessment
        ? {
            assessedAt: assessment.assessed_at,
            verdict: assessment.verdict,
            rawVerdict: assessment.raw_verdict,
            hysteresisHeld: assessment.hysteresis_held,
            scoreA: assessment.score_a,
            reason: assessment.reason,
            components: assessment.components,
            gates: assessment.gates,
            minutesSaturated: assessment.minutes_saturated,
            dTdt: assessment.dt_dt,
            ktPeak: assessment.kt_peak,
            pressureDeltaHpa: assessment.pressure_delta_hpa,
            historyHours: assessment.history_hours,
            readingCount: assessment.reading_count,
            indexBAvailable: assessment.index_b_available,
            algorithmVersion: assessment.algorithm_version,
          }
        : null,

      // The chart's whole point is where these two lines converge, so both are
      // returned at full resolution rather than downsampled.
      series: readings.map((r) => ({
        observedAt: r.observed_at,
        tempC: r.temp_c,
        dewPointC: r.dew_point_c,
        dpdC: r.dpd_c,
        windKmh: r.wind_kmh,
        solarElevationDeg: r.solar_elevation_deg,
        clearnessIndex: r.clearness_index,
      })),

      // Shipped so the chart shades the saturation window against the same
      // threshold the score used, instead of hard-coding 1.0 and drifting the
      // day someone recalibrates.
      thresholds: {
        dpdSatC: FOG_CONSTANTS.dpdSatC,
        windVetoKmh: FOG_CONSTANTS.windVetoKmh,
        likelyMin: FOG_CONSTANTS.verdict.likelyMin,
        ambiguousMin: FOG_CONSTANTS.verdict.ambiguousMin,
      },

      // The assessment is only as fresh as the reading it was scored from.
      dataAge: dataAge(newest?.observed_at ?? null, now),
    });
  } catch (err) {
    return jsonError('Failed to read the fog assessment', 500, {
      detail: (err as Error).message,
    });
  }
}
