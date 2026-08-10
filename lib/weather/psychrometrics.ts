// lib/weather/psychrometrics.ts
//
// Dew point from temperature and relative humidity.
//
// WHY THIS EXISTS
// ---------------
// The written specification's sample response carries a `dewPoint` field, and
// notes that Ambient computes it server-side from `tempf` and `humidity`. The
// live station does NOT return it:
//
//   lastData keys: stationtype, dateutc, tempf, humidity, windspeedmph,
//   windgustmph, maxdailygust, winddir, winddir_avg10m, uv, solarradiation,
//   hourlyrainin, eventrainin, dailyrainin, weeklyrainin, monthlyrainin,
//   yearlyrainin, battrain, baromrelin, baromabsin, type, created_at,
//   feelsLike, dateutc5, tz, hl
//
// Without a dew point there is no dew point depression, and DPD is the
// quantity every gate and every component of Index A keys off. The scorer would
// discard all readings as unusable and report INSUFFICIENT_HISTORY forever.
//
// So it is reconstructed here. This is NOT an invented signal: the
// specification states dew point is derived from temperature and humidity
// rather than measured, so computing it locally preserves exactly the
// semantics it already had. In particular the rule still holds and is now
// plainer than before — DPD and relative humidity are ONE measurement, never
// two corroborating ones.
//
// Pure. No clock, no I/O.

/**
 * Magnus-Tetens with the Alduchov & Eskridge (1996) coefficients.
 *
 *   gamma = ln(RH/100) + (b*T)/(c+T)
 *   Td    = (c*gamma) / (b - gamma)
 *
 * Accurate to about 0.1 degC over 0-60 degC, which is well inside the noise of
 * the sensors involved and far finer than the 0.3/0.8/1.5 degC saturation
 * tiers care about.
 */
const B = 17.625;
const C = 243.04;

/**
 * Returns dew point in °C, or null when it cannot be computed.
 *
 * Humidity is clamped to a 0.1% floor: the logarithm diverges at zero, and a
 * station reporting exactly 0% RH is reporting a fault, not desert air.
 * Humidity above 100% (sensors do drift) is clamped rather than rejected —
 * saturated air is the case this whole feature is about, and discarding a
 * 100.4% reading would blind it at precisely the wrong moment.
 */
export function dewPointFromHumidity(
  tempC: number | null | undefined,
  relativeHumidity: number | null | undefined
): number | null {
  if (tempC === null || tempC === undefined || !Number.isFinite(tempC)) {
    return null;
  }
  if (
    relativeHumidity === null ||
    relativeHumidity === undefined ||
    !Number.isFinite(relativeHumidity)
  ) {
    return null;
  }

  const rh = Math.min(100, Math.max(0.1, relativeHumidity));
  const gamma = Math.log(rh / 100) + (B * tempC) / (C + tempC);

  // gamma reaches B only in physically impossible input; guard the division.
  if (!Number.isFinite(gamma) || gamma >= B) return null;

  const dewPoint = (C * gamma) / (B - gamma);
  if (!Number.isFinite(dewPoint)) return null;

  // Dew point cannot exceed temperature. Sensor drift at high humidity can push
  // the computation a hair over; clamping keeps DPD non-negative so a rounding
  // artefact never reads as supersaturated air.
  return Math.min(dewPoint, tempC);
}
