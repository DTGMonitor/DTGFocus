// app/api/stations/discover/route.ts
//
// Find public Ambient Weather stations near a site.
//
// Returns candidates and their distances. DOES NOT BIND. Picking a station is
// an operator decision — "nearest" is not the same as "best", and a station
// three kilometres away with no pyranometer is worth less than one at eight
// kilometres that can run Index B.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticate } from '@/lib/supabaseRoute';
import { AmbientError, discoverStations } from '@/lib/weather/ambient';
import { jsonError } from '@/lib/weather/routeHelpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BodySchema = z.object({
  siteId: z.coerce.number().int().positive(),
  // 40 km matches the prototype's default scan. Capped at 200: the endpoint
  // takes a bounding box, and past a few hundred kilometres the box stops
  // approximating a circle in any useful way.
  radiusKm: z.coerce.number().positive().max(200).default(40),
});

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authenticate();
  if (!auth) return jsonError('Not authenticated', 401);
  // Admin-gated because the only reason to discover is to bind, and binding
  // is an admin action. It also makes an outbound request to a third-party
  // endpoint we do not own, which is not something to leave open.
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

  const { siteId, radiusKm } = parsed.data;

  const { data: site, error } = await auth.supabase
    .from('clients')
    .select('id, site_name, latitude, longitude, timezone')
    .eq('id', siteId)
    .maybeSingle();

  if (error) return jsonError('Failed to read the site', 500, { detail: error.message });
  if (!site) return jsonError('Site not found', 404, { siteId });

  if (site.latitude === null || site.longitude === null) {
    return jsonError('Site has no coordinates', 400, {
      siteId,
      hint: 'Set latitude and longitude on the site before searching for stations.',
    });
  }

  try {
    const candidates = await discoverStations(
      { latitude: site.latitude, longitude: site.longitude },
      radiusKm
    );

    return NextResponse.json({
      site: {
        id: site.id,
        name: site.site_name,
        latitude: site.latitude,
        longitude: site.longitude,
      },
      radiusKm,
      count: candidates.length,
      candidates: candidates.map((c) => ({
        ...c,
        distanceKm: Number(c.distanceKm.toFixed(2)),
        // Surfaced explicitly: without a pyranometer this station can never
        // run Index B, which means its score is never cross-checked against an
        // observation. That is the single most important thing to know when
        // choosing between two candidates.
        indexBCapable: c.capabilities.solar,
      })),
    });
  } catch (err) {
    if (err instanceof AmbientError) {
      return jsonError('Station discovery failed', 502, {
        kind: err.kind,
        detail: err.message,
      });
    }
    return jsonError('Station discovery failed', 500, {
      detail: (err as Error).message,
    });
  }
}
