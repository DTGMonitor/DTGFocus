// geoUtils.ts

// 1. Set an anchor point near your site's minimum Easting/Northing
const ANCHOR_EASTING = 58000;
const ANCHOR_NORTHING = 13000;
const METRES_PER_DEGREE = 111320;

// Convert Mine Grid to MapLibre Lng/Lat
export const toLngLat = (easting: number, northing: number): [number, number] => {
  const lng = (easting - ANCHOR_EASTING) / METRES_PER_DEGREE;
  const lat = (northing - ANCHOR_NORTHING) / METRES_PER_DEGREE;
  return [lng, lat];
};

// 2. Generate the GeoJSON for your Coordinate Grid
export const generateCoordinateGrid = (
  minE: number, maxE: number, 
  minN: number, maxN: number, 
  interval: number = 50 // Grid line every 50 metres
) => {
  const features = [];

  // Vertical Lines (Easting)
  for (let e = Math.floor(minE / interval) * interval; e <= maxE; e += interval) {
    features.push({
      type: 'Feature',
      properties: { label: `${e}E` },
      geometry: {
        type: 'LineString',
        coordinates: [toLngLat(e, minN), toLngLat(e, maxN)]
      }
    });
  }

  // Horizontal Lines (Northing)
  for (let n = Math.floor(minN / interval) * interval; n <= maxN; n += interval) {
    features.push({
      type: 'Feature',
      properties: { label: `${n}N` },
      geometry: {
        type: 'LineString',
        coordinates: [toLngLat(minE, n), toLngLat(maxE, n)]
      }
    });
  }

  return {
    type: 'FeatureCollection',
    features
  };
};