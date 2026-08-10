// lib/weather/units.ts
//
// The Ambient Weather endpoint speaks imperial. Everything downstream of
// ingest — the scoring function, the database, the charts — speaks SI.
//
// Conversion happens exactly once, here, at the ingest boundary. The scoring
// function must never see a Fahrenheit value, and the UI must never convert:
// a unit conversion that appears in two places will eventually disagree with
// itself.
//
// Every helper propagates null rather than coercing a missing reading to zero.
// A station that stopped reporting wind is not a station reporting calm.

/** A value that may be absent from an untrusted payload. */
type Maybe = number | null | undefined;

const nullish = (v: Maybe): v is null | undefined =>
  v === null || v === undefined || !Number.isFinite(v);

/** Fahrenheit -> Celsius. */
export function fToC(f: Maybe): number | null {
  return nullish(f) ? null : ((f as number) - 32) * (5 / 9);
}

/** Miles per hour -> kilometres per hour. */
export function mphToKmh(v: Maybe): number | null {
  return nullish(v) ? null : (v as number) * 1.609344;
}

/** Inches of mercury -> hectopascals. */
export function inHgToHpa(v: Maybe): number | null {
  return nullish(v) ? null : (v as number) * 33.86389;
}

/** Inches -> millimetres. Also converts in/h -> mm/h, the units being a ratio. */
export function inToMm(v: Maybe): number | null {
  return nullish(v) ? null : (v as number) * 25.4;
}
