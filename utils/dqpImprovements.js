/**
 * Resolving alarm improvements from the DQP surfaces.
 *
 * An `alarm_improvement` row is a recommendation DTG raised against a specific
 * alarm (see utils/reportAlarmImprovements.js, which reads the same table for
 * the report). It sits at `improvement_status: 'Awaiting Feedback'` until the
 * site comes back on it, at which point it is stamped with what the site did
 * and when.
 *
 * Until now the only way to stamp one was the "→ Optimal" gate, which resolved
 * EVERY open recommendation in one go — correct there, because Optimal is a
 * claim that nothing is outstanding. But recommendations do not clear together:
 * a radar can move Critical → Sub-Optimal because the site actioned one of three
 * raised alarms, and an analyst correcting a row afterwards may be doing so
 * precisely because feedback arrived on one of them. Both left the analyst with
 * no way to record that except by declaring the row Optimal, which it is not.
 *
 * So resolution is per-row: each open recommendation is independently left open,
 * Modified, or Not Implemented. Only the ones actually answered are written —
 * "leave open" is the default everywhere partial resolution is offered, so
 * submitting a form without touching this section changes nothing.
 *
 * Pure: no React, no Supabase. The `at` instant is supplied by the caller.
 */

/** `improvement_status` of a recommendation the site has not answered yet. */
export const OPEN_STATUS = 'Awaiting Feedback';

/** The sentinel for "the site has not answered this one — leave it open". */
export const LEAVE_OPEN = 'open';

/** What a resolved recommendation can be stamped as. */
export const RESOLUTION_STATUSES = ['Modified', 'Not Implemented'];

/** Only 'Modified' names a person; 'Not Implemented' has no engineer to credit. */
export const NAMES_ENGINEER = 'Modified';

/** Does this choice actually answer the recommendation? */
export const isResolved = (choice) =>
  RESOLUTION_STATUSES.includes(String(choice?.status ?? '').trim());

/**
 * The `alarm_improvement` patches a set of choices implies, keyed by row id.
 *
 * Anything left open — the default, an unknown status, a half-filled row — is
 * dropped rather than written, so a form the analyst never touched produces no
 * updates at all. `site_engineer` is cleared on 'Not Implemented': there is no
 * one to credit for a recommendation the site declined.
 *
 * @param {Record<string|number, {status?: string, site_engineer?: string}>} resolutions
 * @param {string} at  ISO instant to stamp `site_action` with.
 * @returns {Array<{id: string, patch: object}>}
 */
export function resolutionUpdates(resolutions, at) {
  return Object.entries(resolutions ?? {})
    .filter(([, choice]) => isResolved(choice))
    .map(([id, choice]) => {
      const status = String(choice.status).trim();
      return {
        id,
        patch: {
          improvement_status: status,
          site_action: at,
          site_engineer: status === NAMES_ENGINEER ? String(choice.site_engineer ?? '').trim() : '',
        },
      };
    });
}

/**
 * The open recommendations a set of choices does NOT answer.
 *
 * Drives the "→ Optimal" gate, which may not let a row claim Optimal while a
 * recommendation is still awaiting feedback, and the counters the partial
 * surfaces print ("1 of 3 resolved").
 *
 * @param {Array<{id: string|number}>} improvements
 * @param {Record<string|number, object>} resolutions
 */
export function unresolved(improvements, resolutions) {
  return (improvements ?? []).filter((row) => !isResolved(resolutions?.[row?.id]));
}

/**
 * The starting choice for every listed recommendation.
 *
 * `requireAll` is the "→ Optimal" gate: there is no leaving one open, so the
 * form opens already reading 'Modified' — the common answer, and the one the
 * gate has always defaulted to. Everywhere else the default must be inert, or
 * an analyst fixing a typo would silently close recommendations they never read.
 */
export function initialResolutions(improvements, { requireAll = false } = {}) {
  return Object.fromEntries(
    (improvements ?? []).map((row) => [
      row.id,
      { status: requireAll ? NAMES_ENGINEER : LEAVE_OPEN, site_engineer: '' },
    ])
  );
}
