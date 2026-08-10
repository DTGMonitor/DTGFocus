// lib/weather/geo.ts
//
// Distance and bounding-box helpers for station discovery. Pure.
//
// Distinct from utils/geoUtils.ts, which converts mine-grid eastings and
// northings for the MapLibre overlays. This file deals in real WGS84 degrees.

const EARTH_RADIUS_KM = 6371.0088;
const DEG = Math.PI / 180;

export interface LatLon {
  latitude: number;
  longitude: number;
}

/** Great-circle distance in kilometres. */
export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = (b.latitude - a.latitude) * DEG;
  const dLon = (b.longitude - a.longitude) * DEG;
  const lat1 = a.latitude * DEG;
  const lat2 = b.latitude * DEG;

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * A latitude/longitude box that circumscribes a radius around a centre.
 *
 * Deliberately generous: the box's corners sit further out than the radius, so
 * discovery over-fetches and the caller filters by true haversine distance.
 * Under-fetching would silently hide a station; over-fetching costs nothing
 * because the results are filtered anyway.
 *
 * The longitude span widens with latitude (a degree of longitude shrinks
 * towards the poles). Clamped so a site near a pole cannot produce an infinite
 * span, and latitude is clipped to the valid range.
 */
export function boundingBox(
  centre: LatLon,
  radiusKm: number
): { minLat: number; minLon: number; maxLat: number; maxLon: number } {
  const latSpan = radiusKm / 110.574;
  const cosLat = Math.max(0.01, Math.cos(centre.latitude * DEG));
  const lonSpan = radiusKm / (111.32 * cosLat);

  return {
    minLat: Math.max(-90, centre.latitude - latSpan),
    maxLat: Math.min(90, centre.latitude + latSpan),
    minLon: centre.longitude - lonSpan,
    maxLon: centre.longitude + lonSpan,
  };
}
