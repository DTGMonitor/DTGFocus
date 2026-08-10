// lib/weather/solar.ts
//
// Solar geometry and clear-sky irradiance. Pure — no clock, no I/O.
//
// Two jobs:
//
//   1. Solar elevation, which gates Index B. Index B compares measured solar
//      radiation against what a clear sky would deliver, and that comparison
//      is only meaningful once the sun is properly up (> 8 degrees).
//
//   2. The clearness index kt = measured / clear-sky. Fog suppresses shortwave
//      radiation hard, so a low kt under saturated air is the strongest
//      daytime confirmation available from a single weather station.
//
// Both are computed at the STATION's coordinates. If the station sits some
// kilometres from the pit it reports for, the sun the pyranometer saw is the
// sun at the pyranometer, not the sun at the pit.

const DEG = Math.PI / 180;

export interface SolarPosition {
  /** Degrees above the horizon. Negative at night. */
  elevationDeg: number;
  /** cos(zenith angle) == sin(elevation). Drives the Haurwitz model. */
  cosZenith: number;
}

/**
 * NOAA approximate solar position, ported verbatim from the Python prototype
 * (fog_report.solar_elevation).
 *
 * `when` must be a real instant; the maths reads its UTC parts. Passing a Date
 * built from a local wall-clock string will silently shift the sun.
 *
 * Note this uses seconds as well as minutes in the hour fraction, as the
 * prototype does. Station timestamps land on whole minutes in practice, so the
 * seconds term is almost always zero; it is kept so a re-score of a
 * sub-minute-resolution series matches the prototype exactly.
 */
export function solarPosition(
  when: Date,
  latitude: number,
  longitude: number
): SolarPosition {
  // Day of year, 1-based, in UTC.
  const startOfYear = Date.UTC(when.getUTCFullYear(), 0, 1);
  const doy =
    Math.floor((Date.UTC(
      when.getUTCFullYear(),
      when.getUTCMonth(),
      when.getUTCDate()
    ) - startOfYear) / 86_400_000) + 1;

  const hour =
    when.getUTCHours() +
    when.getUTCMinutes() / 60 +
    when.getUTCSeconds() / 3600;

  // Fractional year angle.
  const g = ((2 * Math.PI) / 365.25) * (doy - 1 + (hour - 12) / 24);

  // Equation of time, minutes.
  const eqtime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g));

  // Solar declination, radians.
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.001480 * Math.sin(3 * g);

  // True solar time (minutes) and hour angle.
  const tst = hour * 60 + eqtime + 4 * longitude;
  const ha = (tst / 4 - 180) * DEG;
  const latRad = latitude * DEG;

  // cos(zenith) == sin(elevation), hence asin below.
  const raw =
    Math.sin(latRad) * Math.sin(decl) +
    Math.cos(latRad) * Math.cos(decl) * Math.cos(ha);
  const cosZenith = Math.max(-1, Math.min(1, raw));

  return { elevationDeg: Math.asin(cosZenith) / DEG, cosZenith };
}

/**
 * Haurwitz clear-sky global horizontal irradiance, W/m^2.
 *
 * Returns 0 below cosZ = 0.02 (about 1.1 degrees elevation), where the model's
 * exp(-0.059/cosZ) term collapses and the result stops meaning anything.
 */
export function haurwitzClearSkyGhi(cosZenith: number): number {
  if (!Number.isFinite(cosZenith) || cosZenith <= 0.02) return 0;
  return 1098 * cosZenith * Math.exp(-0.059 / cosZenith);
}

/**
 * kt = measured GHI / clear-sky GHI.
 *
 * Null unless clear-sky exceeds 20 W/m^2. Near sunrise and sunset the
 * denominator approaches zero and the ratio explodes into noise; the floor is
 * what keeps twilight from reading as dense fog.
 *
 * kt above 1.0 is NOT an error and must not be clamped. Cloud-edge
 * enhancement — direct beam plus bright reflection off an adjacent cloud face
 * — genuinely delivers more than the clear-sky model predicts. Only LOW kt
 * carries information for this feature; a high value simply means "not fog".
 */
export function clearnessIndex(
  solarWm2: number | null | undefined,
  ghiClearWm2: number
): number | null {
  if (solarWm2 === null || solarWm2 === undefined) return null;
  if (!Number.isFinite(solarWm2)) return null;
  if (!(ghiClearWm2 > 20)) return null;
  return solarWm2 / ghiClearWm2;
}
