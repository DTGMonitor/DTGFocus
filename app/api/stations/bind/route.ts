// app/api/stations/bind/route.ts
//
// Bind a discovered station to a site.
//
// NOT IN THE ORIGINAL ROUTE LIST, but the station-binding UI in section 6
// requires it and /discover deliberately does not auto-bind. Writes go through
// the service-role client, because migration 001 grants `authenticated` read
// access only — there is no write policy, by design.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supaBaseServer';
import { authenticate } from '@/lib/supabaseRoute';
import { AmbientError, fetchStationRecords } from '@/lib/weather/ambient';
import { bindStation } from '@/lib/weather/repository';
import { jsonError } from '@/lib/weather/routeHelpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BodySchema = z.object({
  siteId: z.coerce.number().int().positive(),
  macAddress: z
    .string()
    .trim()
    .regex(
      /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/,
      'Expected a MAC address like C8:C9:A3:0F:C7:FD'
    ),
  name: z.string().trim().min(1).max(200).optional(),
  // Coordinates come from the discovery response — the per-device endpoint
  // returns measurements only, with no position in the payload.
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  // Operator-entered. Not reported by the endpoint, but inferable from
  // absolute pressure: ASBSAR1 reads 26.639 inHg = 902 hPa, which puts it near
  // 950 m and marks it as a highland radiation-fog site rather than a coastal
  // advection one.
  elevationM: z.coerce.number().min(-500).max(9000).optional(),
  distanceKm: z.coerce.number().min(0).optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authenticate();
  if (!auth) return jsonError('Not authenticated', 401);
  if (!auth.isAdmin) return jsonError('Admin role required', 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('Body must be JSON', 400);
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError('Invalid request', 400, {
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
  }

  const input = parsed.data;
  const macAddress = input.macAddress.toUpperCase();

  // Probe the station before binding. An unknown MAC answers HTTP 204 with an
  // empty body, and binding one would leave the poller failing every five
  // minutes against an address that was never going to work. Better to refuse
  // now, while the operator is still looking at the screen.
  //
  // The probe also yields the two fields discovery cannot be trusted for: the
  // station's OWN timezone, which is what `dailyrainin` resets against, and
  // its hardware string.
  let timezone = 'UTC';
  let stationType: string | null = null;
  let probedAt: string | null = null;

  try {
    const { parsed: records } = await fetchStationRecords(macAddress);
    const newest = records[records.length - 1];
    timezone = newest.record.tz ?? 'UTC';
    stationType = newest.record.stationtype ?? null;
    probedAt = new Date(newest.record.dateutc).toISOString();
  } catch (err) {
    if (err instanceof AmbientError) {
      const status = err.kind === 'station_not_found' ? 404 : 502;
      return jsonError('Station did not respond; not binding', status, {
        kind: err.kind,
        detail: err.message,
      });
    }
    return jsonError('Station probe failed; not binding', 500, {
      detail: (err as Error).message,
    });
  }

  try {
    // Atomic: the RPC stands the site's current station down and brings the
    // new one up inside one transaction. Two statements from here could leave
    // the site with no active station, and a site nobody is polling silently
    // loses history that cannot be recovered.
    const station = await bindStation(supabaseServer, {
      siteId: input.siteId,
      macAddress,
      name: input.name ?? null,
      latitude: input.latitude,
      longitude: input.longitude,
      elevationM: input.elevationM ?? null,
      distanceKm: input.distanceKm ?? null,
      timezone,
      stationType,
    });

    return NextResponse.json(
      {
        station,
        probe: { timezone, stationType, lastReportAt: probedAt },
        note: 'History starts accumulating at the next poll. The index needs 8 readings before it will score.',
      },
      { status: 201 }
    );
  } catch (err) {
    return jsonError('Failed to bind the station', 500, {
      detail: (err as Error).message,
    });
  }
}
