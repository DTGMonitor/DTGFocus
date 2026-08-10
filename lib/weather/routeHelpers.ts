// lib/weather/routeHelpers.ts
//
// Shared plumbing for the fog route handlers: authentication, site resolution,
// and the data-age envelope every response carries.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authenticate } from '@/lib/supabaseRoute';
import { getStationForSite, type StationRow } from './repository';

// An operations threshold, not a meteorological one, so it lives outside
// config/fogConstants.ts — and in its own dependency-free module, because the
// browser recomputes the same age while it holds a response.
export { STALE_AFTER_MINUTES } from './staleness';
import { STALE_AFTER_MINUTES } from './staleness';

export interface DataAge {
  observedAt: string | null;
  ageMinutes: number | null;
  stale: boolean;
}

export function dataAge(observedAt: string | null | undefined, now: Date): DataAge {
  if (!observedAt) {
    // No reading at all is the most stale state there is, not an unknown one.
    return { observedAt: null, ageMinutes: null, stale: true };
  }
  const ageMinutes = (now.getTime() - new Date(observedAt).getTime()) / 60_000;
  return {
    observedAt,
    ageMinutes: Number(ageMinutes.toFixed(1)),
    stale: ageMinutes > STALE_AFTER_MINUTES,
  };
}

export const jsonError = (message: string, status: number, extra?: object) =>
  NextResponse.json({ error: message, ...extra }, { status });

/**
 * Parse a site id from a route segment.
 *
 * `clients.id` is a bigint, so anything non-integral is a malformed request
 * rather than a missing site — worth a 400 instead of letting Postgres reject
 * it as a 500.
 */
export function parseSiteId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export interface SiteContext {
  supabase: SupabaseClient;
  siteId: number;
  station: StationRow;
}

/**
 * Authenticate, resolve the site, and find its bound station.
 *
 * Returns a NextResponse on any failure so callers can `if (… instanceof
 * NextResponse) return …` and get consistent status codes across all three
 * site routes.
 *
 * Queries run through the CALLER's session client, so row level security
 * decides what they can see. Reaching for the service-role client here would
 * make these routes publicly readable behind an auth check that looks present.
 */
export async function resolveSite(
  rawSiteId: string
): Promise<SiteContext | NextResponse> {
  const auth = await authenticate();
  if (!auth) return jsonError('Not authenticated', 401);

  const siteId = parseSiteId(rawSiteId);
  if (siteId === null) return jsonError('Invalid site id', 400);

  const station = await getStationForSite(auth.supabase, siteId);
  if (!station) {
    // A machine-readable code, not just a 404. "No station bound" is a SETUP
    // STATE and the UI answers it with the binding panel — but a missing or
    // misnamed route also returns 404, and a client that cannot tell them apart
    // would sit on "bind a station" forever while the real fault went unnoticed.
    return jsonError('No weather station is bound to this site', 404, {
      code: 'NO_STATION_BOUND',
      siteId,
      hint: 'Bind one via POST /api/stations/discover then POST /api/stations/bind',
    });
  }

  return { supabase: auth.supabase, siteId, station };
}

/** The station fields every response repeats, so the UI can label its source. */
export function stationSummary(station: StationRow) {
  return {
    macAddress: station.mac_address,
    name: station.name,
    latitude: station.latitude,
    longitude: station.longitude,
    elevationM: station.elevation_m,
    distanceKm: station.distance_km,
    timezone: station.timezone,
    stationType: station.station_type,
  };
}
