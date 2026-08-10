// lib/weather/staleness.ts
//
// One constant, in a module with no dependencies, because both sides of the
// network need it: the route handler stamps an age when it answers, and the
// browser recomputes that age while it holds the answer. Two definitions would
// eventually disagree, and the disagreement would show up as a badge saying
// "fresh" about a reading the server had already given up on.

/**
 * A reading older than this is stale.
 *
 * Three missed five-minute polls. Deliberately tight: a stale reading looks
 * exactly like a fresh one on screen — same number, same colour, same
 * confident tile — and for fog that is the dangerous failure. A status card
 * asserting "no fog" from air measured an hour ago is worse than no card.
 */
export const STALE_AFTER_MINUTES = 15;
