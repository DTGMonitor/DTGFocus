// components/admin/Fog/types.ts
//
// Shapes returned by the fog API routes. Hand-written rather than inferred,
// because these cross a network boundary and the client should state what it
// expects rather than mirror whatever the server happened to send.

import type { Verdict } from './fogPresentation';

export interface StationSummary {
  macAddress: string;
  name: string | null;
  latitude: number;
  longitude: number;
  elevationM: number | null;
  distanceKm: number | null;
  timezone: string;
  stationType: string | null;
}

export interface DataAge {
  observedAt: string | null;
  ageMinutes: number | null;
  stale: boolean;
}

export interface ComponentScore {
  component: string;
  points: number;
  max: number;
  detail: string;
  available: boolean;
}

export interface Gate {
  gate: string;
  detail: string;
}

export interface Assessment {
  assessedAt: string;
  verdict: Verdict;
  rawVerdict: Verdict | null;
  hysteresisHeld: boolean;
  scoreA: number | null;
  reason: string | null;
  components: ComponentScore[];
  gates: Gate[];
  minutesSaturated: number | null;
  dTdt: number | null;
  ktPeak: number | null;
  pressureDeltaHpa: number | null;
  historyHours: number | null;
  readingCount: number | null;
  indexBAvailable: boolean;
  algorithmVersion: string | null;
}

export interface SeriesPoint {
  observedAt: string;
  tempC: number | null;
  dewPointC: number | null;
  dpdC: number | null;
  windKmh: number | null;
  solarElevationDeg: number | null;
  clearnessIndex: number | null;
}

export interface FogResponse {
  station: StationSummary;
  assessment: Assessment | null;
  series: SeriesPoint[];
  thresholds: {
    dpdSatC: number;
    windVetoKmh: number;
    likelyMin: number;
    ambiguousMin: number;
  };
  dataAge: DataAge;
}

export interface Conditions {
  observedAt: string;
  tempC: number | null;
  dewPointC: number | null;
  dpdC: number | null;
  humidity: number | null;
  windKmh: number | null;
  windGustKmh: number | null;
  windDir: number | null;
  pressureHpa: number | null;
  solarWm2: number | null;
  uv: number | null;
  rainRateMmh: number | null;
  rainDailyMm: number | null;
  solarElevationDeg: number | null;
  clearnessIndex: number | null;
}

export interface WeatherResponse {
  station: StationSummary;
  conditions: Conditions | null;
  dataAge: DataAge;
  note?: string;
}

export interface HourlyBucket {
  hourStart: string;
  rainMm: number | null;
  coveredMinutes: number;
  sampleCount: number;
  hadReset: boolean;
  missing: boolean;
}

export interface DailyBucket {
  dayStart: string;
  rainMm: number | null;
  sampleCount: number;
  hoursObserved: number;
  complete: boolean;
}

export interface RainfallResponse {
  station: StationSummary;
  range: '24h' | '7d';
  hourly: HourlyBucket[];
  daily: DailyBucket[];
  currentRate: { rainRateMmh: number | null; raining: boolean };
  coverageRule: { minCoveredMinutes: number; note: string };
  dataAge: DataAge;
}

export interface StationCandidate {
  macAddress: string;
  name: string;
  latitude: number;
  longitude: number;
  elevationM: number | null;
  distanceKm: number;
  timezone: string | null;
  stationType: string | null;
  capabilities: {
    temperature: boolean;
    dewPoint: boolean;
    humidity: boolean;
    wind: boolean;
    pressure: boolean;
    rain: boolean;
    solar: boolean;
    uv: boolean;
  };
  indexBCapable: boolean;
  lastReportAt: string | null;
}

export interface DiscoverResponse {
  site: { id: number; name: string; latitude: number; longitude: number };
  radiusKm: number;
  count: number;
  candidates: StationCandidate[];
}
