// utils/tabHelpers.js
//
// Pure helper functions shared across the SensorDetail tab components
// (Deformation, Alarm, Data Quality, Downtime).
//
// These are deliberately framework-free so they can be unit/property tested
// in isolation. See __tests__/sensor-detail-tabs-redesign.pbt.test.js.

import { fromUTC } from '@/utils/timezoneUtils';
import { CAUSE_OPTIONS } from '@/config/formConfig';

/**
 * Resolve a `detected_by` UUID to a full_name from the crosscheckers list.
 * Falls back to the raw UUID string if no match is found.
 *
 * @param {string} uuid
 * @param {Array<{id: string, full_name: string}>} crosscheckers
 * @returns {string}
 */
export function resolveDetectedBy(uuid, crosscheckers = []) {
  if (!uuid) return '—';
  const match = (crosscheckers || []).find((c) => String(c.id) === String(uuid));
  return match ? match.full_name : uuid;
}

/**
 * Format a nullable ISO timestamp for display using `fromUTC`.
 * Returns '—' for null/undefined values. Never returns the raw UTC string
 * (unless fromUTC throws, in which case the original string is returned).
 *
 * @param {string|null} isoString
 * @param {string} timezone
 * @returns {string}
 */
export function formatTimestamp(isoString, timezone) {
  if (!isoString) return '—';
  try {
    const local = fromUTC(isoString, timezone);
    if (!local) return '—';
    return new Date(local).toLocaleString('en-AU', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return isoString;
  }
}

/**
 * Convert a stored UTC ISO string to a value suitable for a
 * <input type="datetime-local"> ("YYYY-MM-DDTHH:mm"), expressed in `timezone`.
 *
 * @param {string|null} isoString
 * @param {string} timezone
 * @returns {string}
 */
export function isoToDatetimeLocal(isoString, timezone) {
  if (!isoString) return '';
  try {
    const local = fromUTC(isoString, timezone);
    if (!local) return '';
    return new Date(local).toISOString().slice(0, 16);
  } catch {
    return '';
  }
}

/**
 * Sort downtime records by `from` descending, with null-`from` records last.
 * Does not mutate the input array.
 *
 * @param {Array<{from: string|null}>} records
 * @returns {Array}
 */
export function sortDowntimeRecords(records = []) {
  return [...records].sort((a, b) => {
    const aNull = a.from === null || a.from === undefined;
    const bNull = b.from === null || b.from === undefined;
    if (aNull && bNull) return 0;
    if (aNull) return 1; // nulls after non-nulls
    if (bNull) return -1;
    return new Date(b.from) - new Date(a.from); // descending
  });
}

/**
 * Sort alarm records by `created_at` descending. Does not mutate the input.
 *
 * @param {Array<{created_at: string}>} records
 * @returns {Array}
 */
export function sortAlarmRecords(records = []) {
  return [...records].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

/**
 * Get the Cause options for a given alarm Reason value.
 * Returns exactly CAUSE_OPTIONS[reason], or an empty array for unknown reasons.
 *
 * @param {string} reason
 * @returns {string[]}
 */
export function getCauseOptions(reason) {
  return CAUSE_OPTIONS[reason] || [];
}

/**
 * Resolve the full precursor chain for a deformation record, ordered from the
 * root (precursor === null) at index 0 to `latestRecord` at the last index.
 *
 * `fetchFn(id)` must resolve a single def_record by id (or reject/throw on error).
 * Resolution stops when a node has `precursor === null`, depth reaches `maxDepth`,
 * or a fetch fails. On fetch failure the nodes resolved so far are returned with
 * `error` set; the chain still terminates with `latestRecord` at the end.
 *
 * @param {object} latestRecord            The current/latest record (chain tail)
 * @param {(id: any) => Promise<object>} fetchFn
 * @param {number} [maxDepth=50]
 * @returns {Promise<{ chain: object[], error: string|null }>}
 */
export async function resolveTimelineChain(latestRecord, fetchFn, maxDepth = 50) {
  if (!latestRecord) return { chain: [], error: null };

  // No precursor → single-node timeline, no fetches.
  if (latestRecord.precursor === null || latestRecord.precursor === undefined) {
    return { chain: [latestRecord], error: null };
  }

  const ancestors = [];
  let currentId = latestRecord.precursor;
  let depth = 0;
  let error = null;

  while (currentId !== null && currentId !== undefined && depth < maxDepth) {
    let fetched;
    try {
      fetched = await fetchFn(currentId);
    } catch {
      error = 'Timeline may be incomplete.';
      break;
    }
    if (!fetched) {
      error = 'Timeline may be incomplete.';
      break;
    }
    ancestors.unshift(fetched); // prepend (oldest first)
    currentId = fetched.precursor;
    depth += 1;
  }

  return { chain: [...ancestors, latestRecord], error };
}

/**
 * Execute the deformation "Update" flow as a two-step compensating transaction:
 *   1. Archive the original record (isactive = 'No').
 *   2. Insert a new record with `precursor` set to the original record's id.
 *
 * If the insert fails after a successful archive, a compensating update restores
 * the original record's isactive to 'Yes', leaving the database in its pre-update
 * state (Requirement 11.8).
 *
 * @param {object} client       Supabase-like client (has .from(table) chain API)
 * @param {string|number} originalId   id of the record being archived (precursor)
 * @param {object} insertPayload       columns for the new record (precursor is added here)
 * @returns {Promise<{ ok: boolean, stage?: 'archive'|'insert', error?: any, compensated?: boolean, inserted?: any }>}
 */
export async function performDeformationUpdateFlow(client, originalId, insertPayload) {
  // Step 1: archive the original record.
  const archiveRes = await client
    .from('def_records')
    .update({ isactive: 'No' })
    .eq('id', originalId);

  if (archiveRes && archiveRes.error) {
    return { ok: false, stage: 'archive', error: archiveRes.error, inserted: null };
  }

  // Step 2: insert the new record with the precursor linkage.
  const insertRes = await client
    .from('def_records')
    .insert([{ ...insertPayload, precursor: originalId }])
    .select('id')
    .single();

  if (insertRes && insertRes.error) {
    // Compensate: restore the original record.
    await client
      .from('def_records')
      .update({ isactive: 'Yes' })
      .eq('id', originalId);
    return {
      ok: false,
      stage: 'insert',
      error: insertRes.error,
      compensated: true,
      inserted: null,
    };
  }

  return { ok: true, inserted: insertRes ? insertRes.data : null };
}
