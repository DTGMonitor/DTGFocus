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
    // `local` is a tz-naive ISO whose clock components are the site wall time;
    // read them back in UTC so the runtime timezone never shifts them again.
    return new Date(local).toLocaleString('en-AU', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'UTC',
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
 * Normalize a `precursors` value into a plain array of ids.
 *
 * The column is `INT[]`, but historic rows (and the odd caller) may still hold a
 * bare scalar or null. This coerces every shape to `number[]`:
 *   null / undefined → []
 *   scalar id        → [id]
 *   array            → array with null/undefined entries stripped
 *
 * @param {number|number[]|null|undefined} value
 * @returns {Array<number|string>}
 */
export function normalizePrecursorss(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.filter((v) => v !== null && v !== undefined);
  return [value];
}

/**
 * Resolve the precursors chain for a deformation record.
 *
 * `precursors` is now `INT[]`, so a record can point at several predecessors. We
 * keep the display linear ("keep linear + list extras"): the FIRST precursors id
 * is the primary spine parent that the timeline walks root → current; any
 * remaining ids are the record's `related` precursorss (e.g. Blast/Rainfall
 * events) resolved one level deep and attached to that node, not walked.
 *
 * Each returned chain node is a shallow copy of the record with an added
 * `related: object[]` array (the resolved non-primary precursorss; `[]` when
 * there are none).
 *
 * `fetchFn(id)` must resolve a single def_record by id (or reject/throw on error).
 * Resolution stops when a node has no precursorss, depth reaches `maxDepth`, or a
 * spine fetch fails. On any fetch failure the nodes resolved so far are returned
 * with `error` set; the chain still terminates with `latestRecord` at the end.
 *
 * @param {object} latestRecord            The current/latest record (chain tail)
 * @param {(id: any) => Promise<object>} fetchFn
 * @param {number} [maxDepth=50]
 * @returns {Promise<{ chain: object[], error: string|null }>}
 */
export async function resolveTimelineChain(latestRecord, fetchFn, maxDepth = 50) {
  if (!latestRecord) return { chain: [], error: null };

  let error = null;

  // Resolve the non-primary precursors ids of a record one level deep. Records
  // that fail to resolve are skipped and flagged via `error`.
  const resolveRelated = async (ids) => {
    const related = [];
    for (const id of ids) {
      try {
        const rec = await fetchFn(id);
        if (rec) related.push(rec);
        else error = 'Timeline may be incomplete.';
      } catch {
        error = 'Timeline may be incomplete.';
      }
    }
    return related;
  };

  // Attach `related` (every precursors after the primary spine parent) to a node.
  const decorate = async (record) => {
    const ids = normalizePrecursorss(record.precursors);
    const extraIds = ids.slice(1);
    const related = extraIds.length ? await resolveRelated(extraIds) : [];
    return { ...record, related };
  };

  const latestIds = normalizePrecursorss(latestRecord.precursors);

  // No precursors → single-node timeline (still resolve `related` for symmetry).
  if (latestIds.length === 0) {
    return { chain: [await decorate(latestRecord)], error };
  }

  const ancestors = [];
  let currentId = latestIds[0]; // primary spine parent
  let depth = 0;

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
    ancestors.unshift(await decorate(fetched)); // prepend (oldest first)
    const parentIds = normalizePrecursorss(fetched.precursors);
    currentId = parentIds.length ? parentIds[0] : null;
    depth += 1;
  }

  return { chain: [...ancestors, await decorate(latestRecord)], error };
}

/**
 * Execute the deformation "Update" flow as a two-step compensating transaction:
 *   1. Archive the original record (isactive = 'No').
 *   2. Insert a new record with `precursors` set to the original record's id.
 *
 * If the insert fails after a successful archive, a compensating update restores
 * the original record's isactive to 'Yes', leaving the database in its pre-update
 * state (Requirement 11.8).
 *
 * The `precursors` column is `INT[]`. The archived original id is always the
 * first (primary spine) element; any additional precursors ids the caller placed
 * on `insertPayload.precursors` (e.g. related Blast/Rainfall events picked in the
 * form) are appended after it, de-duplicated.
 *
 * @param {object} client       Supabase-like client (has .from(table) chain API)
 * @param {string|number} originalId   id of the record being archived (primary precursors)
 * @param {object} insertPayload       columns for the new record (its `precursors` is merged, not overwritten)
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

  // Merge the archived original (primary) with any extra precursorss the caller
  // supplied, keeping the original first and dropping duplicates.
  const { precursors: extraPrecursors, ...rest } = insertPayload || {};
  const precursors = [
    originalId,
    ...normalizePrecursorss(extraPrecursors).filter((id) => id !== originalId),
  ];

  // Step 2: insert the new record with the precursors linkage.
  const insertRes = await client
    .from('def_records')
    .insert([{ ...rest, precursors }])
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

/**
 * Report a trend and the data contamination behind it in ONE submit — the
 * checkbox on the deformation form (approach 1).
 *
 * The trend record already exists by the time this runs; the engineer filled it
 * in and it was inserted the usual way. What is left is the caveat, and the
 * caveat is the record that stands: the site is being told that the numbers
 * behind that trend are interfered with, so the trend is archived behind it
 * exactly as the Update flow archives the record it supersedes. Reporting the
 * two together and reporting the contamination a day later therefore leave the
 * database in the same state, which is the only way the client can be sure the
 * two routes mean the same thing.
 *
 * Compensating, in the same shape as `performDeformationUpdateFlow`: the
 * contamination goes in FIRST and the trend is archived only once it is safely
 * stored, so a failure here leaves the trend record active and reportable
 * rather than stranding it archived with nothing standing in its place.
 *
 * @param {object} client            Supabase-like client
 * @param {string|number} trendId    id of the trend record just inserted
 * @param {object} insertPayload     columns for the contamination record
 *   (its `precursors` is merged with `trendId`, not overwritten)
 * @returns {Promise<{ ok: boolean, stage?: 'insert'|'archive', error?: any, inserted?: any }>}
 */
export async function performContaminationSplit(client, trendId, insertPayload) {
  const { precursors: extraPrecursors, ...rest } = insertPayload || {};
  const precursors = [
    trendId,
    ...normalizePrecursorss(extraPrecursors).filter((id) => id !== trendId),
  ];

  const insertRes = await client
    .from('def_records')
    .insert([{ ...rest, precursors }])
    .select('id')
    .single();

  if (insertRes && insertRes.error) {
    return { ok: false, stage: 'insert', error: insertRes.error, inserted: null };
  }

  const archiveRes = await client
    .from('def_records')
    .update({ isactive: 'No' })
    .eq('id', trendId);

  if (archiveRes && archiveRes.error) {
    // The contamination record is stored and points at the trend, so nothing is
    // lost — but both are active, and the board would show the trend twice.
    return {
      ok: false,
      stage: 'archive',
      error: archiveRes.error,
      inserted: insertRes ? insertRes.data : null,
    };
  }

  return { ok: true, inserted: insertRes ? insertRes.data : null };
}
