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
 * Deformation types that MERGE several chains into one record: a rainfall or a
 * blast is one event the whole wall lived through, so every trend that was
 * standing at the time is listed on it as a precursor.
 *
 * Everything else supersedes exactly one predecessor, which is why only these
 * two types need a branch to be chosen when their chain is continued.
 */
export const MERGE_EVENT_TYPES = ['Rainfall Event', 'Blast Event'];

/**
 * True for a `def_type` that merges several chains (see MERGE_EVENT_TYPES).
 *
 * @param {string|null|undefined} defType
 * @returns {boolean}
 */
export function isMergeEventType(defType) {
  return MERGE_EVENT_TYPES.includes(defType);
}

/**
 * True when a record merges several chains (see MERGE_EVENT_TYPES).
 *
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
export function isMergeEventRecord(record) {
  return isMergeEventType(record?.def_type);
}

/**
 * `properties` key naming which of a merge event's precursors the record
 * continues.
 *
 * A record whose parent is a Rainfall/Blast event cannot say which trend it
 * carries forward through `precursors` alone — that column points at the event,
 * and the event points back at every trend it swallowed. This key is the answer
 * to "and which of those is mine": it is written by the Update flow and by the
 * archive continuation, and read by `resolveTimelineChain` when it walks back
 * through the event.
 */
export const CHAIN_BRANCH_KEY = 'chain_branch_id';

/**
 * Read a record's chain branch hint, or null when it carries none (every record
 * written before this existed, and every record whose parent is unambiguous).
 *
 * @param {object|null|undefined} record
 * @returns {number|string|null}
 */
export function getChainBranchId(record) {
  const raw = record?.properties?.[CHAIN_BRANCH_KEY];
  if (raw === null || raw === undefined || raw === '') return null;
  return raw;
}

/**
 * Choose which of `parentIds` the spine walks through.
 *
 * `branchHint` wins when it actually names one of them; otherwise the first id
 * is the spine, exactly as it was before branches existed.
 *
 * @param {Array<number|string>} parentIds
 * @param {number|string|null} branchHint
 * @returns {number|string|null}
 */
/**
 * Point a PostgREST update/delete at a set of ids.
 *
 * One id stays `.eq('id', …)` — the shape every caller here has always used, and
 * the only one a single-row write needs. Several become `.in('id', […])`, which
 * is one round trip rather than one per row.
 *
 * @param {object} query   a supabase update()/delete() builder
 * @param {Array<number|string>} ids
 * @returns {object} the filtered builder
 */
function filterByIds(query, ids) {
  return ids.length === 1 ? query.eq('id', ids[0]) : query.in('id', ids);
}

export function pickSpineParentId(parentIds = [], branchHint = null) {
  if (branchHint !== null && branchHint !== undefined) {
    const match = parentIds.find((id) => String(id) === String(branchHint));
    if (match !== undefined) return match;
  }
  return parentIds.length ? parentIds[0] : null;
}

/**
 * Resolve the precursors chain for a deformation record.
 *
 * `precursors` is `INT[]`, so a record can point at several predecessors. We
 * keep the display linear ("keep linear + list extras"): ONE of the precursors
 * ids is the spine parent the timeline walks root → current; the rest are the
 * node's `related` precursorss (e.g. Blast/Rainfall events) resolved one level
 * deep and attached to that node, not walked.
 *
 * Which one is the spine is normally `precursors[0]`. The exception is a merge
 * event (Rainfall/Blast): several trends run INTO it, so a record that continues
 * one of them records that trend's id under `properties.chain_branch_id` and the
 * walk follows THAT branch back out of the event. Without it every chain
 * descending from one rainfall collapses onto whichever trend happened to be
 * listed first.
 *
 * Each returned chain node is a shallow copy of the record with an added
 * `related: object[]` array (its non-spine precursorss; `[]` when there are none).
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

  // Resolve the non-spine precursors ids of a record one level deep. Records
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

  // Attach `related` — every precursors id EXCEPT the one the spine walks out of.
  const decorate = async (record, spineId) => {
    const ids = normalizePrecursorss(record.precursors);
    const extraIds = ids.filter((id) => String(id) !== String(spineId));
    const related = extraIds.length ? await resolveRelated(extraIds) : [];
    return { ...record, related };
  };

  const latestIds = normalizePrecursorss(latestRecord.precursors);

  // No precursors → single-node timeline (still resolve `related` for symmetry).
  if (latestIds.length === 0) {
    return { chain: [await decorate(latestRecord, null)], error };
  }

  const ancestors = [];
  // The node we descended FROM. Its branch hint decides which way out of the
  // node we are about to fetch — the hint is written by the child because only
  // the child knows which of its parent's chains it belongs to.
  let childRecord = latestRecord;
  let currentId = latestIds[0]; // the tail's own spine parent
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

    const nextId = pickSpineParentId(
      normalizePrecursorss(fetched.precursors),
      getChainBranchId(childRecord)
    );

    ancestors.unshift(await decorate(fetched, nextId)); // prepend (oldest first)
    childRecord = fetched;
    currentId = nextId;
    depth += 1;
  }

  return { chain: [...ancestors, await decorate(latestRecord, latestIds[0])], error };
}

/**
 * Which of a merge event's chains have NOT been continued yet.
 *
 * A rainfall is the current node of every trend that ran into it. One of those
 * trends turning into a Progressive moves THAT chain past the event; the rest
 * are still sitting on it, and the event has to keep standing for them.
 *
 * `successors` are the active records naming this one as a precursor. Each
 * continues the branch it recorded, or — for records written before branches
 * existed — the event's first chain, which is what the timeline walked then.
 *
 * @param {object} record
 * @param {object[]} [successors]
 * @returns {Array<number|string>} the open branch ids, oldest listing order kept
 */
export function resolveOpenBranchIds(record, successors = []) {
  const ids = normalizePrecursorss(record?.precursors);
  if (ids.length === 0) return [];
  const continued = new Set(
    successors.map((s) => String(getChainBranchId(s) ?? ids[0]))
  );
  return ids.filter((id) => !continued.has(String(id)));
}

/**
 * The records that stand on the board: one per live chain.
 *
 * A plain record is superseded the moment anything points back at it. A merge
 * event is not — several chains arrive at it, and it goes on being the current
 * node of every chain that has not moved past it. Continuing ONE trend out of a
 * rainfall must not take the rainfall away from the others, which is what a
 * bare "referenced by anything" rule does.
 *
 * @param {object[]} records  the ACTIVE records under consideration
 * @returns {{ heads: object[], openBranchesById: Map<string, Array<number|string>> }}
 *   `openBranchesById` is keyed by record id and only carries merge events.
 */
export function resolveChainHeads(records = []) {
  const list = (records ?? []).filter(Boolean);

  const successorsById = new Map();
  list.forEach((r) => {
    normalizePrecursorss(r.precursors).forEach((pid) => {
      const key = String(pid);
      const bucket = successorsById.get(key);
      if (bucket) bucket.push(r);
      else successorsById.set(key, [r]);
    });
  });

  const openBranchesById = new Map();
  const heads = list.filter((record) => {
    const successors = successorsById.get(String(record.id)) || [];

    // Not a merge point: anything pointing back at it has replaced it.
    if (!isMergeEventRecord(record) || normalizePrecursorss(record.precursors).length === 0) {
      return successors.length === 0;
    }

    const open = resolveOpenBranchIds(record, successors);
    openBranchesById.set(String(record.id), open);
    return open.length > 0;
  });

  return { heads, openBranchesById };
}

/**
 * Take records off the board.
 *
 * @param {object} client  Supabase-like client
 * @param {Array<number|string>} ids
 * @returns {Promise<{ ok: boolean, error?: any }>}
 */
export async function archiveDefRecords(client, ids = []) {
  const unique = [...new Set(ids.filter((id) => id !== null && id !== undefined).map(String))];
  if (unique.length === 0) return { ok: true };

  const res = await filterByIds(client.from('def_records').update({ isactive: 'No' }), unique);
  if (res && res.error) return { ok: false, error: res.error };
  return { ok: true };
}

/**
 * Build the insert that carries ONE chain forward past the merge event it was
 * sitting on.
 *
 * Archiving a rainfall is a statement about the rainfall, not about the trends
 * that were running when it fell. So the trend is re-stated with the same values
 * as a fresh active record pointing at the event — the chain reads trend →
 * rainfall → trend — and goes on being tracked until someone archives THAT
 * record, which is a statement about the trend.
 *
 * `chain_branch_id` records which of the event's trends this copy continues, so
 * two copies out of one rainfall do not both walk back to the first one.
 *
 * @param {object} precursorRecord  the trend being carried forward (a full row)
 * @param {object} eventRecord      the Rainfall/Blast it ran into
 * @param {{ createdAt?: string }} [options]
 * @returns {object} columns for the new def_record
 */
export function buildChainContinuationPayload(precursorRecord, eventRecord, options = {}) {
  const properties = { ...(precursorRecord?.properties || {}) };
  properties[CHAIN_BRANCH_KEY] = precursorRecord.id;

  return {
    def_type: precursorRecord.def_type ?? null,
    // The copy is stated NOW — it is what the board carries from this moment on.
    // `start` still points at when the trend itself began, so nothing about the
    // trend's own history moves.
    created_at: options.createdAt || new Date().toISOString(),
    wallfolder_id: precursorRecord.wallfolder_id ?? eventRecord?.wallfolder_id ?? null,
    location: precursorRecord.location ?? null,
    isactive: 'Yes',
    tarp_level: precursorRecord.tarp_level ?? null,
    start: precursorRecord.start ?? null,
    notes: precursorRecord.notes ?? null,
    detected_by: precursorRecord.detected_by ?? null,
    crosschecked_by: precursorRecord.crosschecked_by ?? null,
    notification_time: precursorRecord.notification_time ?? null,
    site_engineer: precursorRecord.site_engineer ?? null,
    alarm: precursorRecord.alarm ?? null,
    properties,
    precursors: [eventRecord.id],
  };
}

/**
 * Archive a merge event (Rainfall/Blast), carrying every chain still sitting on
 * it forward, as one compensating transaction.
 *
 * `precursorRecords` are the OPEN branches that are still live — the chains the
 * event is currently the head of. A branch whose own record was archived is a
 * chain the engineer has already closed and is not passed here; a branch that
 * has been continued past the event has a head of its own and is not passed
 * either.
 *
 * The copies go in FIRST and the event is archived only once they are safely
 * stored, so a failure leaves the event standing rather than stranding its
 * trends. The originals are archived alongside it: their copy is what stands
 * now, and leaving both active would print the same trend twice.
 *
 * @param {object} client       Supabase-like client
 * @param {object} params
 * @param {object} params.event                the record being archived
 * @param {object[]} [params.precursorRecords] full rows for the live open branches
 * @param {string} [params.createdAt]
 * @returns {Promise<{ ok: boolean, stage?: 'insert'|'archive', error?: any, inserted?: object[], compensated?: boolean }>}
 */
export async function performEventArchiveFlow(client, params = {}) {
  const { event, precursorRecords = [], createdAt } = params;
  const carried = precursorRecords.filter(Boolean);

  // Step 1: state each chain's continuation.
  let inserted = [];
  if (carried.length > 0) {
    const insertRes = await client
      .from('def_records')
      .insert(carried.map((r) => buildChainContinuationPayload(r, event, { createdAt })))
      .select('id');

    if (insertRes && insertRes.error) {
      return { ok: false, stage: 'insert', error: insertRes.error, inserted: [] };
    }
    inserted = (insertRes && insertRes.data) || [];
  }

  // Step 2: the event, and the trends its copies now stand for, become history.
  const archived = await archiveDefRecords(client, [event.id, ...carried.map((r) => r.id)]);

  if (!archived.ok) {
    // Compensate: the copies only make sense once the event is gone.
    if (inserted.length > 0) {
      await filterByIds(client.from('def_records').delete(), inserted.map((r) => r.id));
    }
    return { ok: false, stage: 'archive', error: archived.error, inserted: [], compensated: true };
  }

  return { ok: true, inserted };
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
 * The `precursors` column is `INT[]`. The original id is always the first
 * (primary spine) element; any additional precursors ids the caller placed on
 * `insertPayload.precursors` (e.g. related Blast/Rainfall events picked in the
 * form) are appended after it, de-duplicated.
 *
 * `options.chainBranchId` names which of the ORIGINAL record's precursors the new
 * record continues; it is written into the new record's properties and only
 * matters when the original is a merge event with more than one chain.
 *
 * `options.archiveOriginal: false` supersedes the original WITHOUT taking it off
 * the board — the case where the original is a merge event other chains are
 * still sitting on, and the case where the new record is itself a merge event
 * and the original is one of the chains running into it. Both stop being heads
 * on their own once `resolveChainHeads` sees the new record.
 *
 * @param {object} client       Supabase-like client (has .from(table) chain API)
 * @param {string|number} originalId   id of the record being superseded (primary precursors)
 * @param {object} insertPayload       columns for the new record (its `precursors` is merged, not overwritten)
 * @param {{ chainBranchId?: number|string|null, archiveOriginal?: boolean }} [options]
 * @returns {Promise<{ ok: boolean, stage?: 'archive'|'insert', error?: any, compensated?: boolean, inserted?: any }>}
 */
export async function performDeformationUpdateFlow(client, originalId, insertPayload, options = {}) {
  const { chainBranchId = null, archiveOriginal = true } = options;

  // Step 1: archive the original record.
  if (archiveOriginal) {
    const archiveRes = await client
      .from('def_records')
      .update({ isactive: 'No' })
      .eq('id', originalId);

    if (archiveRes && archiveRes.error) {
      return { ok: false, stage: 'archive', error: archiveRes.error, inserted: null };
    }
  }

  // Merge the original (primary) with any extra precursorss the caller supplied,
  // keeping the original first and dropping duplicates.
  const { precursors: extraPrecursors, properties, ...rest } = insertPayload || {};
  const precursors = [
    originalId,
    ...normalizePrecursorss(extraPrecursors).filter((id) => id !== originalId),
  ];

  const payload = { ...rest, precursors };
  if (properties !== undefined || chainBranchId !== null) {
    payload.properties =
      chainBranchId !== null
        ? { ...(properties || {}), [CHAIN_BRANCH_KEY]: chainBranchId }
        : properties;
  }

  // Step 2: insert the new record with the precursors linkage.
  const insertRes = await client
    .from('def_records')
    .insert([payload])
    .select('id')
    .single();

  if (insertRes && insertRes.error) {
    // Compensate: restore the original record.
    if (archiveOriginal) {
      await client.from('def_records').update({ isactive: 'Yes' }).eq('id', originalId);
    }
    return {
      ok: false,
      stage: 'insert',
      error: insertRes.error,
      compensated: archiveOriginal,
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
