// utils/rainfallTarp.ts
//
// Does the rain now exceed what the site's TARP says it may, and what does the
// work-log entry for acknowledging that say?
//
// Pure. No network, no clock of its own — `now` is always passed in. Everything
// the popup decides is decided here, so the rule can be read in one place and
// tested without a Postgres or a browser.
//
// WHICH SERIES EACH THRESHOLD IS MEASURED AGAINST
// -----------------------------------------------
// Sorowako's TARP row reads:
//
//   "1. Intensitas hujan per jam (hourly) >20 mm/jam, atau
//    2. Intensitas hujan harian (daily) >100 mm/hari."
//
//   rate  -> the gauge's OWN RATE, `series[].rainRateMmh` — the vendor's
//            "Rain Rate" column, as the site reads the row.
//   daily -> `daily[]`, the max of the station's own calendar-day accumulator
//            (weather_rain_daily).
//
// THE ALARM IS EDGE-TRIGGERED, NOT LEVEL-TRIGGERED
// ------------------------------------------------
// This is the rule, and it is the whole shape of the file:
//
//   AN ALARM IS RAISED WHEN THE RATE CROSSES THE THRESHOLD FROM BELOW.
//   It is not raised again while the rate STAYS above, however high it climbs.
//   It can only be raised again after the rate has been SEEN at or below the
//   threshold and then rises past it once more.
//
// Walked through the sequence that specified it, at a threshold of >20:
//
//   0   10   20   21   22   24   19   21   30   40   0
//   ·   ·    ·    ↑A   A    A    ·    ↑B   B    B    ·
//
//   21  crosses from below           -> EPISODE A opens, alarm raised
//   22, 24  still above              -> same episode, silent (A was signed)
//   19  at or below                  -> episode A closes
//   21  crosses from below AGAIN     -> EPISODE B opens, a NEW alarm
//   30, 40  still above              -> same episode, silent
//   0   at or below                  -> episode B closes
//
// Two alarms from that sequence, not nine. 20 itself does not cross: the TARP
// says ">20", so 20.0 is not an exceedance and 20.1 is.
//
// WHAT IDENTIFIES AN EPISODE is the instant of its FIRST exceeding reading. That
// is what goes in `rainfall_tarp_acks.bucket_start`, and it is stable: the same
// readings always produce the same onset, so a page reload, the other shift's
// browser and a refetch five minutes later all compute the key the acknowledgement
// was filed under. A rate that keeps climbing does not change it — which is
// exactly what makes 30 and 40 silent after B was signed.
//
// THE DAILY THRESHOLD NEEDS NONE OF THIS. The daily accumulator only climbs and
// resets at local midnight, so it can cross 100 mm once per day and never fall
// back through it. Its episode IS its day, and the day is its identity.
//
// WHAT NEVER FIRES, AND NEVER CLOSES AN EPISODE
// ---------------------------------------------
// A reading with no rate. An unmeasured reading is not a low one: reading it as
// 0 mm/h would close an episode that never ended and re-alarm on the next
// measurement, and treating it as high would alarm on nothing. It is skipped
// entirely, so an episode is opened and closed only by rates somebody actually
// measured.
//
// The cost of that, stated: if the station goes dark mid-episode and returns
// still above the threshold, this calls it the same episode and stays silent,
// because the rate was never OBSERVED to come down. An episode running longer
// than the series window is the one case where that bites — see the note on
// `rateEpisodes`.
//
// An INCOMPLETE DAY does fire. A day with fewer than 24 hours observed reports a
// total that is a floor rather than a fact — but a floor already past 100 mm is
// past 100 mm, and waiting for midnight to say so would be waiting until the
// rain no longer matters.

import { getWorkLogDetails } from '@/config/formConfig';
import { tarpLevelLabel } from '@/config/tarpDocument';
import type { DailyBucket, RainSeriesPoint } from '@/components/admin/Fog/types';

/**
 * `rate` is a crossing episode of the instantaneous rain rate; `daily` is a
 * local day whose accumulated total passed the daily threshold. The strings
 * match `rainfall_tarp_acks.kind`.
 */
export type RainfallTarpKind = 'rate' | 'daily';

/**
 * How far back a breach still counts as an ALARM.
 *
 * The popup is a call to act now, not a ledger of everything that ever crossed
 * the line — the rainfall panel is where the history lives. Without a floor the
 * first load after deployment would stack up every crossing in the fetch window
 * and demand a signature for each, which teaches operators to clear the popup
 * without reading it.
 *
 * A breach that ages out unacknowledged therefore stops asking. That is
 * deliberate: after a day, acknowledging it is bookkeeping, and the data is
 * still on the panel and still in the report.
 */
export const ALARM_WINDOW_HOURS = 24;

/** The rainfall thresholds on a site's active TARP. Null = no such threshold. */
export interface RainfallTarpTrigger {
  siteId: number;
  siteName: string;
  /**
   * `tarp_triggers.rain_rate_mmh` — the gauge's instantaneous rate, mm/h.
   * Exclusive: ">20" means 20.0 does not cross and 20.1 does.
   */
  rateMmh: number | null;
  /** `tarp_triggers.rain_daily_mm`, mm. Exclusive, as above. */
  dailyMm: number | null;
  tarpLevel: number | null;
  bandLabel: string | null;
  /** The row's own printed wording, quoted to the operator verbatim. */
  description: string | null;
  dayShift: string | null;
  nightShift: string | null;
  comments: string[];
}

export interface RainfallBreach {
  /** Stable event identity — site, kind and bucket. See migration 007. */
  key: string;
  siteId: number;
  siteName: string;
  kind: RainfallTarpKind;
  /**
   * The event's identity as an instant: for `rate`, the moment the threshold was
   * crossed; for `daily`, the start of the local day. ISO.
   */
  bucketStart: string;
  /**
   * The worst the gauge has read so far in this event. mm/h for `rate` — the
   * episode's PEAK — and mm for `daily`. The unit follows the kind, as it does
   * on the ack row; `unitLabel` carries the site's own wording for it.
   */
  measuredValue: number;
  thresholdValue: number;
  /** "mm/jam" or "mm/hari" — the TARP's wording, not an SI rendering. */
  unitLabel: string;
  tarpLevel: number | null;
  bandLabel: string | null;

  /** Rate only: the reading that crossed, which is rarely the peak. */
  onsetValue: number | null;
  /** Rate only: when the peak was read, so it can be found on the chart. */
  peakAt: string | null;
  /** Rate only: the newest reading still above the threshold. */
  latestAt: string | null;
  /**
   * Rate only: how long the rate has been continuously above, in minutes. Zero
   * means a single reading — and that is the number that separates a two-minute
   * burst from an hour of downpour, which is the first thing an operator needs
   * to know and the one thing a peak rate cannot tell them.
   */
  minutesAbove: number | null;
  /** Rate only: readings taken while above, including any with no rate. */
  readingCount: number | null;
  /**
   * Rate only: true when the series ends with the rate still above. An episode
   * that has already closed is a thing that happened; one still open is
   * happening.
   */
  ongoing: boolean | null;
  /**
   * Daily only: false when fewer than 24 hours were observed, so the total is a
   * floor. The breach is real either way; the popup says which it is.
   */
  dayComplete: boolean | null;
}

/** The event identity, in the one form both the client and the ack table use. */
export function breachKey(
  siteId: number,
  kind: RainfallTarpKind,
  bucketStart: string
): string {
  return `${siteId}:${kind}:${new Date(bucketStart).toISOString()}`;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export const RATE_UNIT_LABEL = 'mm/jam';
export const DAILY_UNIT_LABEL = 'mm/hari';

/** One continuous stretch of readings above the threshold. */
export interface RateEpisode {
  /** The first exceeding reading. This is the episode's identity. */
  onsetAt: string;
  onsetValue: number;
  peakValue: number;
  peakAt: string;
  /** The newest exceeding reading seen so far. */
  latestAt: string;
  readingCount: number;
  /** The series ends with the rate still above — the episode has not closed. */
  ongoing: boolean;
}

/**
 * Every crossing episode in a series, oldest first.
 *
 * The state machine is two lines long and the comments are longer than it,
 * because what it does is obvious and WHEN IT DOES IT is not — see the header.
 *
 * ONE KNOWN EDGE. The series is a window (24 h), so an episode that began before
 * the window opened has its onset outside it: the first reading is already above,
 * with no crossing to see, and this reports it as a fresh episode under a new
 * key. That re-alarms something possibly already signed for. It is left that way
 * deliberately — the alternative is to assume an unseen crossing is old and stay
 * silent, and of the two mistakes, alarming twice about real rain beats going
 * quiet about it. A rate holding above 20 mm/h continuously for a day is close to
 * meteorologically impossible, so the case is theoretical for this site.
 */
export function rateEpisodes(
  series: readonly RainSeriesPoint[],
  threshold: number
): RateEpisode[] {
  // Sorted rather than trusted: the rule reads the series as a sequence in time,
  // and one row out of order would split an episode in two.
  const ordered = [...series].sort(
    (a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime()
  );

  const episodes: RateEpisode[] = [];
  let open: RateEpisode | null = null;

  for (const point of ordered) {
    // Unmeasured. Neither opens nor closes — see the header.
    if (point.rainRateMmh === null) {
      if (open) open.readingCount += 1;
      continue;
    }

    if (point.rainRateMmh > threshold) {
      if (open === null) {
        // THE CROSSING. Everything the alarm is keyed on is fixed here.
        open = {
          onsetAt: point.observedAt,
          onsetValue: point.rainRateMmh,
          peakValue: point.rainRateMmh,
          peakAt: point.observedAt,
          latestAt: point.observedAt,
          readingCount: 1,
          ongoing: true,
        };
        episodes.push(open);
      } else {
        // Still above. The episode grows; its identity does not move, which is
        // what keeps an acknowledged episode silent as the rate climbs.
        open.readingCount += 1;
        open.latestAt = point.observedAt;
        if (point.rainRateMmh > open.peakValue) {
          open.peakValue = point.rainRateMmh;
          open.peakAt = point.observedAt;
        }
      }
    } else if (open !== null) {
      // At or below: the rate came back down where somebody could see it. The
      // next exceedance is a new event and gets its own signature.
      open.ongoing = false;
      open = null;
    }
  }

  return episodes;
}

export interface EvaluateInput {
  trigger: RainfallTarpTrigger;
  /** Full-resolution readings — where the rate, and so every crossing, lives. */
  series: RainSeriesPoint[];
  daily: DailyBucket[];
  now: Date;
  /** Event keys already signed for — from `rainfall_tarp_acks`. */
  acknowledged?: ReadonlySet<string>;
  windowHours?: number;
}

/**
 * Every unacknowledged rainfall breach at one site, newest first.
 *
 * Newest first because that is the order they matter in: the crossing that just
 * happened is the one the site needs a call about, and an older one further down
 * the list is context.
 */
export function evaluateRainfallTarp({
  trigger,
  series,
  daily,
  now,
  acknowledged,
  windowHours = ALARM_WINDOW_HOURS,
}: EvaluateInput): RainfallBreach[] {
  const out: RainfallBreach[] = [];
  const signed = acknowledged ?? new Set<string>();
  const windowFloor = now.getTime() - windowHours * 3_600_000;

  const { rateMmh, dailyMm } = trigger;

  if (rateMmh !== null && Number.isFinite(rateMmh)) {
    for (const episode of rateEpisodes(series, rateMmh)) {
      // Aged out on its LAST reading, not its first: an episode that started 25
      // hours ago and is still running is happening now.
      if (new Date(episode.latestAt).getTime() <= windowFloor) continue;

      const key = breachKey(trigger.siteId, 'rate', episode.onsetAt);
      if (signed.has(key)) continue;

      out.push({
        key,
        siteId: trigger.siteId,
        siteName: trigger.siteName,
        kind: 'rate',
        bucketStart: new Date(episode.onsetAt).toISOString(),
        measuredValue: episode.peakValue,
        thresholdValue: rateMmh,
        unitLabel: RATE_UNIT_LABEL,
        tarpLevel: trigger.tarpLevel,
        bandLabel: trigger.bandLabel,
        onsetValue: episode.onsetValue,
        peakAt: episode.peakAt,
        latestAt: episode.latestAt,
        minutesAbove: Math.round(
          (new Date(episode.latestAt).getTime() -
            new Date(episode.onsetAt).getTime()) /
            60_000
        ),
        readingCount: episode.readingCount,
        ongoing: episode.ongoing,
        dayComplete: null,
      });
    }
  }

  if (dailyMm !== null && Number.isFinite(dailyMm)) {
    for (const bucket of daily) {
      if (bucket.rainMm === null) continue;
      if (!(bucket.rainMm > dailyMm)) continue;
      // Measured from the day's END, so a day that is still running always
      // counts and yesterday counts until this time tomorrow.
      if (new Date(bucket.dayStart).getTime() + DAY_MS <= windowFloor) continue;

      const key = breachKey(trigger.siteId, 'daily', bucket.dayStart);
      if (signed.has(key)) continue;

      out.push({
        key,
        siteId: trigger.siteId,
        siteName: trigger.siteName,
        kind: 'daily',
        bucketStart: new Date(bucket.dayStart).toISOString(),
        measuredValue: bucket.rainMm,
        thresholdValue: dailyMm,
        unitLabel: DAILY_UNIT_LABEL,
        tarpLevel: trigger.tarpLevel,
        bandLabel: trigger.bandLabel,
        onsetValue: null,
        peakAt: null,
        latestAt: null,
        minutesAbove: null,
        readingCount: null,
        ongoing: null,
        dayComplete: bucket.complete,
      });
    }
  }

  return out.sort(
    (a, b) => new Date(b.bucketStart).getTime() - new Date(a.bucketStart).getTime()
  );
}

// ---------------------------------------------------------------------------
// The work-log entry
// ---------------------------------------------------------------------------

/**
 * Whether the station's local clock makes this the day or the night shift.
 *
 * 06:00–17:59 is day. A crude split, and the honest reason it is crude: the
 * shift boundary this needs to answer is "which of the TARP's two response cells
 * applies", and for Sorowako both cells say the same thing. If a site ever gives
 * its night shift a different rainfall response, this should read the roster
 * rather than the clock.
 */
export function isDayShift(localHour: number): boolean {
  return localHour >= 6 && localHour < 18;
}

/** The TARP's response for this shift, flattened onto one line for the log. */
export function responseForShift(
  trigger: RainfallTarpTrigger,
  dayShift: boolean
): string {
  const cell = (dayShift ? trigger.dayShift : trigger.nightShift) ?? trigger.dayShift;
  if (!cell) return 'Respond per site TARP';
  return cell
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('; ');
}

/** "a single reading", "25 minutes" — what the log and the popup both say. */
export function describeDuration(minutesAbove: number | null): string {
  if (minutesAbove === null) return '';
  if (minutesAbove <= 0) return 'a single reading';
  if (minutesAbove < 60) return `${minutesAbove} minutes`;
  const hours = Math.floor(minutesAbove / 60);
  const rest = minutesAbove % 60;
  return rest === 0
    ? `${hours} hour${hours === 1 ? '' : 's'}`
    : `${hours} h ${rest} min`;
}

export interface WorkLogDraft {
  /** `work_log.subject` — through the same mapping every other entry uses. */
  subjectId: number;
  location: string;
  action: string;
  notes: string;
}

export interface ComposeInput {
  breach: RainfallBreach;
  trigger: RainfallTarpTrigger;
  /** Station name, so the log says which gauge measured it. */
  stationName: string | null;
  /** Bucket start already formatted in the station's zone, offset included. */
  bucketLabel: string;
  /** Rate only: the peak's instant, formatted in the station's zone. */
  peakLabel?: string | null;
  /** The station's local hour of the event, for the shift split. */
  localHour: number;
}

/**
 * What acknowledging this breach writes into the work log.
 *
 * The SUBJECT comes from getWorkLogDetails, keyed on the TARP level the site's
 * own row carries — the identical mapping a deformation record goes through. A
 * site that rates rainfall TARP 3 gets MODERATE RISK here without anything in
 * this file knowing that, because the level is the site's data and the mapping
 * is shared.
 *
 * The NOTES name the threshold, the measurement and the window, in that order,
 * because the first question asked of this entry weeks later is "what fired, and
 * was it really over the line". A bare "rainfall alarm acknowledged" would send
 * the reader back to a rain series that has since been pruned — and readings are
 * pruned at 90 days, so anything not written here is gone.
 *
 * For a rate crossing the entry records BOTH the moment it crossed and how long
 * it stayed above, because those are what distinguish a two-minute burst from an
 * hour of downpour, and a peak rate on its own cannot.
 */
export function composeRainfallWorkLog({
  breach,
  trigger,
  stationName,
  bucketLabel,
  peakLabel,
  localHour,
}: ComposeInput): WorkLogDraft {
  const logSubject = getWorkLogDetails(tarpLevelLabel(breach.tarpLevel), null);

  // The site's own name for the band, when it has one. Sorowako prints "TARP
  // Trigger 2 (Yellow)"; a site that names its bands by colour prints that
  // instead, and the log should read the way the client's chart reads.
  const band = breach.bandLabel ?? logSubject.subject;
  const measured = trimMm(breach.measuredValue);
  const threshold = trimMm(breach.thresholdValue);
  const station = stationName ? ` (station ${stationName})` : '';

  let notes: string;

  if (breach.kind === 'rate') {
    const onset = breach.onsetValue === null ? '' : `${trimMm(breach.onsetValue)} mm/h`;
    const peaked =
      breach.peakAt !== null && breach.peakAt !== breach.bucketStart && peakLabel
        ? `, peaking at ${measured} mm/h at ${peakLabel}`
        : '';
    const held = ` Stayed above for ${describeDuration(breach.minutesAbove)}`;
    const still = breach.ongoing ? ' and was still above when acknowledged.' : '.';

    notes =
      `${band}: rain rate crossed the site TARP threshold of >${threshold} ` +
      `${breach.unitLabel} at ${bucketLabel}, reading ${onset}${peaked}` +
      `${station}.${held}${still} Acknowledged on the rainfall alarm.`;
  } else {
    // Said out loud rather than left to be inferred from a timestamp: a total
    // taken over a part-watched day is a floor, and an entry that does not say
    // so reads as a complete measurement.
    const caveat =
      breach.dayComplete === false
        ? ' Day still in progress, so the total is a floor rather than a final figure.'
        : '';

    notes =
      `${band}: rainfall ${measured} mm over the local day beginning ` +
      `${bucketLabel} exceeded the site TARP threshold of >${threshold} ` +
      `${breach.unitLabel}${station}.${caveat} Acknowledged on the rainfall alarm.`;
  }

  return {
    subjectId: logSubject.id,
    location: trigger.siteName,
    action: responseForShift(trigger, isDayShift(localHour)),
    notes,
  };
}

/** Trailing zeros are noise: 14 mm is 14 mm, not 14.00 mm. Mirrors RainfallPanel. */
export function trimMm(v: number): string {
  return String(Math.round(v * 100) / 100);
}
