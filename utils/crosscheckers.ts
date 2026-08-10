// utils/crosscheckers.ts
//
// Who can appear as a detector or a crosschecker: every `user_sites` row with
// role = 'admin', minus the admins who never take a monitoring shift.
//
// This roster used to be four names typed into four components and handed to
// the `get_safe_crosscheckers` RPC, which only ever returns the names it is
// given. An engineer added to user_sites afterwards therefore existed
// everywhere except in those arrays, and every record they logged rendered as
// a raw UUID — `resolveDetectedBy` falls back to the UUID when the lookup
// misses. The roster now comes from the table, so adding a member to
// user_sites is the whole job.

/** The role that puts someone on shift. Client rows are not crosscheckers. */
export const CROSSCHECKER_ROLE = 'admin';

/**
 * Admins who hold the role for access rather than for monitoring — they never
 * detect or crosscheck a record, so listing them only lengthens the dropdowns.
 */
export const EXCLUDED_CROSSCHECKERS = ['Peter Saunders', 'Mark Burdett'];

/** The shape every consumer expects — same pair `get_safe_crosscheckers` returned. */
export interface Crosschecker {
  id: string;
  full_name: string;
}

/** A `user_sites` row, as far as this module cares about it. */
export interface UserSiteRow {
  user_id?: string | null;
  displayname?: string | null;
}

const EXCLUDED = new Set(EXCLUDED_CROSSCHECKERS.map((n) => n.toLowerCase()));

/**
 * user_sites rows → the crosschecker roster.
 *
 * `id` is `user_id`, not the row id: `detected_by` and `crosschecked_by` store
 * the auth uid, which is what the old RPC returned as `id` too.
 *
 * Rows without a display name are dropped — they would resolve to a blank
 * option, which is worse than the UUID it replaced. A person holding more than
 * one user_sites row appears once.
 */
export function toCrosscheckers(rows: UserSiteRow[] | null | undefined): Crosschecker[] {
  const byId = new Map<string, Crosschecker>();

  for (const row of rows ?? []) {
    const id = row?.user_id;
    const name = row?.displayname?.trim();
    if (!id || !name) continue;
    if (EXCLUDED.has(name.toLowerCase())) continue;
    if (!byId.has(id)) byId.set(id, { id, full_name: name });
  }

  return [...byId.values()].sort((a, b) => a.full_name.localeCompare(b.full_name));
}

/**
 * Fetch the roster from the browser. Throws on a failed request so callers can
 * log it the way they already log an RPC failure.
 */
export async function fetchCrosscheckers(): Promise<Crosschecker[]> {
  const res = await fetch('/api/crosscheckers');
  if (!res.ok) {
    throw new Error(`GET /api/crosscheckers responded ${res.status}`);
  }
  const body = await res.json();
  return body?.crosscheckers ?? [];
}
