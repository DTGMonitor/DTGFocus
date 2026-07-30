/**
 * Alarm improvement (recommendation) derivations for radar reports.
 *
 * Pure: no React, no Supabase, no clock access.
 *
 * An `alarm_improvement` row is a recommendation DTG raised against a specific
 * alarm record — "this region is producing excessive unwanted alarms, apply this
 * mask" — plus the site's eventual answer. It carries two instants:
 *
 *   recommendation_submission  when DTG raised it
 *   site_action                when the site resolved it (null while open)
 *
 * The report window has to test BOTH. A recommendation raised in the period is
 * news; so is one raised months ago and finally actioned in the period. Testing
 * only the submission would drop every resolution the client is waiting to read
 * about, and testing only the action would drop everything still outstanding.
 *
 * Unlike the TARP revisions (Postgres `date` columns, compared as calendar days),
 * both of these are `timestamptz` — real instants — so they are compared against
 * the window bounds directly. The SITE timezone enters only at display time.
 */

/**
 * The three statuses `improvement_status` takes, worst-outstanding first.
 *
 * Sourced from the two surfaces that write and legend them — FeedbackModal's
 * dropdown and the summary pages' statusLegendMap. Anything outside this list is
 * still rendered (an unrecognised status is real data), it just sorts last.
 */
export const IMPROVEMENT_STATUSES = ['Awaiting Feedback', 'Not Implemented', 'Modified'];

/**
 * What each status means, in the client's language.
 *
 * Verbatim from the statusLegendMap the live Alarm / Deformation / Failure
 * summary pages already show, so the printed legend and the screen legend cannot
 * drift apart.
 */
export const IMPROVEMENT_STATUS_MEANING = {
  'Awaiting Feedback': 'Recommendation requested but site has not replied.',
  'Not Implemented': 'Recommendation requested but site decided not to implement/no longer needed.',
  Modified: 'Recommendation already applied by site.',
};

/**
 * An instant in ms, or null if there isn't one.
 *
 * The nullish guard is load-bearing, not defensive noise: `new Date(null)` is
 * the epoch, not an Invalid Date, so a bare `Number.isFinite` check would read a
 * null `site_action` — every still-open recommendation — as "resolved on 1 Jan
 * 1970" and count it against any window whose start it precedes, which is all of
 * them.
 */
const ms = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
};

const inRange = (value, start, end) => {
  const t = ms(value);
  return t !== null && t >= start && t <= end;
};

/**
 * 'DD/MM/YYYY' for an instant, read on the SITE's wall clock.
 *
 * `shift` is a fromUTC-style function: it maps a real instant to a tz-naive ISO
 * string whose components are the site's wall clock. Injected rather than
 * imported so this module stays pure and the caller owns the timezone.
 *
 * @param {string} iso
 * @param {(iso: string) => (string|null)} shift
 */
export function formatImprovementDay(iso, shift) {
  if (!iso) return null;
  const shifted = shift ? shift(iso) : iso;
  const m = String(shifted ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

/**
 * Flatten one joined `alarm_improvement` row into what the table prints.
 *
 * The region carries the alarm's severity colour (`alarm_regions.alarmtype`) and
 * its name; the improvement row has neither, so the region map has to be passed
 * in — the same join the alarm pie already needs (see reportAlarms).
 *
 * @param {object} row      alarm_improvement, with `alarm_records` embedded.
 * @param {Map} regionById  alarm_regions.id → row.
 * @param {(iso: string) => (string|null)} shift  fromUTC bound to the site tz.
 */
export function normalizeImprovement(row, regionById, shift) {
  const record = row?.alarm_records ?? null;
  const region = regionById?.get(record?.alarm_region) ?? null;
  const status = (row?.improvement_status ?? '').trim() || 'Unknown';

  return {
    id: row?.id,
    status,
    submittedAt: row?.recommendation_submission ?? null,
    actionedAt: row?.site_action ?? null,
    submittedDay: formatImprovementDay(row?.recommendation_submission, shift),
    actionedDay: formatImprovementDay(row?.site_action, shift),
    siteEngineer: (row?.site_engineer ?? '').trim() || null,
    type: (row?.type ?? '').trim() || null,
    issue: (row?.issue ?? '').trim() || null,
    action: (row?.action ?? '').trim() || null,
    alarmMask: (row?.alarm_mask ?? '').trim() || null,
    regionId: record?.alarm_region ?? null,
    regionName: region?.name ?? null,
    // Lowercased so the block can index the alarm palette directly; the column
    // stores 'Red' / 'red' inconsistently (see the sample rows).
    alarmType: String(region?.alarmtype ?? '').toLowerCase() || null,
    location: record?.location ?? null,
    // What the alarm was attributed to. Kept VERBATIM — alarmCauseColor is keyed
    // by the exact name (and falls back to keyword rules for the short def_type
    // values records written from the deformation side carry), so trimming to a
    // tidier label would break the colour agreement with the cause pie.
    cause: (record?.cause ?? '').trim() || null,
  };
}

/**
 * The recommendations this report period is entitled to show.
 *
 * Three ways in, and `activity` records which:
 *
 *   'raised'      submitted inside the window
 *   'resolved'    answered inside the window, however long ago it was raised
 *   'outstanding' raised BEFORE the window and still unanswered at its end
 *
 * The third is not an activity — it is the absence of one, and that is the point.
 * An unanswered recommendation is an obligation that stays open until the site
 * discharges it, so it belongs in EVERY report until it does, not only the one
 * covering the day it was raised. Filtering it to the raising period is how a
 * live 'Awaiting Feedback' item disappears from the report two days after being
 * submitted — which is exactly what happened to the two open recommendations on
 * SSR777 (L_HMQ Upper / L2_TSF2 Upper, raised 28/07/2026): they vanished from the
 * daily report on the 30th while still awaiting an answer.
 *
 * `improvement_status` decides this, not a null `site_action` alone. A row with a
 * terminal status and no action date is a data anomaly, not an open item (see
 * migration 001) — carrying it forward forever would resurrect a closed
 * recommendation in every future report.
 *
 * Ordered by the most recent thing that happened to each row, newest first, so
 * the table reads as the period's activity log rather than as a submission
 * register. Carried-over items sort by their submission and therefore settle at
 * the bottom, oldest last — the longer something has gone unanswered, the further
 * down it sits, which is the correct reading order for a backlog. Ties break on
 * id to keep the order stable across renders (two rows inserted by one batch
 * share a submission instant to the millisecond).
 *
 * @param {object[]} rows        joined alarm_improvement rows
 * @param {Date|string|number} windowStart
 * @param {Date|string|number} windowEnd
 * @param {object[]} regions     alarm_regions rows, for the name + severity join
 * @param {(iso: string) => (string|null)} shift  fromUTC bound to the site tz
 * @returns {object[]} normalized rows, each with `activity`
 */
export function selectImprovementsInWindow(rows, windowStart, windowEnd, regions = [], shift) {
  const start = ms(windowStart);
  const end = ms(windowEnd);
  if (start === null || end === null) return [];

  const regionById = new Map((regions ?? []).map((r) => [r?.id, r]));

  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const submittedAt = ms(row?.recommendation_submission);
      const raised = inRange(row?.recommendation_submission, start, end);
      const resolved = inRange(row?.site_action, start, end);

      // Still open as at the END of the window. `submittedAt <= end` is the
      // guard that keeps a report on a PAST period honest: a recommendation
      // raised after that period closed had not been asked for yet, so it
      // cannot appear as outstanding in it.
      const outstanding =
        !raised &&
        !resolved &&
        row?.site_action == null &&
        String(row?.improvement_status ?? '').trim() === 'Awaiting Feedback' &&
        submittedAt !== null &&
        submittedAt <= end;

      if (!raised && !resolved && !outstanding) return null;

      return {
        ...normalizeImprovement(row, regionById, shift),
        activity: raised && resolved ? 'raised-and-resolved' : raised ? 'raised' : resolved ? 'resolved' : 'outstanding',
        // How long the site has had this, as at the window end — NOT as at "now".
        // A report is a statement about its period; re-reading last month's
        // report should not show the number ticking up.
        daysOpen: row?.site_action == null && submittedAt !== null
          ? Math.max(0, Math.floor((end - submittedAt) / 86400000))
          : null,
        // The instant this row last moved WITHIN the window — a resolution
        // outside it must not pull an in-window submission to the top. A
        // carried-over item never moved at all, so it sorts on its submission.
        sortAt: outstanding
          ? submittedAt
          : Math.max(resolved ? ms(row.site_action) : 0, raised ? ms(row.recommendation_submission) : 0),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.sortAt - a.sortAt || (b.id ?? 0) - (a.id ?? 0));
}

/**
 * Headline counts for the section bar.
 *
 * `raised` and `resolved` overlap deliberately — a recommendation raised and
 * answered inside the same period counts toward both, because both are things
 * that happened this period. Neither counts a carried-over item: nothing was
 * raised and nothing was resolved, which is precisely the complaint.
 *
 * `outstanding` is every open item as at the end of the period — the ones raised
 * this period and still unanswered PLUS the backlog carried in. That is the
 * number the site owes an answer on, and it is the one that carries into the
 * next report.
 *
 * `statuses` spans the WHOLE period, not one printed chunk. The status key sits
 * under the last chunk of a table that may run over several pages, and keying it
 * off that chunk alone would omit the meaning of a status that only appeared on
 * page one.
 *
 * @param {object[]} rows  a selectImprovementsInWindow result
 */
export function summarizeImprovements(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    total: list.length,
    raised: list.filter((r) => r.activity === 'raised' || r.activity === 'raised-and-resolved').length,
    resolved: list.filter((r) => r.activity === 'resolved' || r.activity === 'raised-and-resolved').length,
    carriedOver: list.filter((r) => r.activity === 'outstanding').length,
    outstanding: list.filter((r) => r.status === 'Awaiting Feedback').length,
    statuses: [...new Set(list.map((r) => r.status))],
  };
}

/**
 * Chunk rows into page-sized blocks.
 *
 * The paginator never splits a block, so a block taller than one page gets a
 * page to itself AND overflows off the bottom (see useReportPagination). Every
 * other variable-length section pre-chunks for the same reason — one appendix
 * item per block. A period with thirty recommendations is unusual but not
 * impossible, and losing the tail of the table silently is the one outcome the
 * report cannot have.
 */
export const IMPROVEMENT_ROWS_PER_BLOCK = 9;

export function chunkImprovements(rows, size = IMPROVEMENT_ROWS_PER_BLOCK) {
  const list = Array.isArray(rows) ? rows : [];
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
