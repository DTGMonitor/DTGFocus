// utils/wallFolderChangeover.ts
//
// Rotating a radar onto a new wall folder, without stranding its downtime.
//
// A changeover is a rename of reality: the radar is re-aimed, the old folder is
// archived, and a fresh one takes over. Everything recorded under the old folder
// stays there — that is the point of the folder — and the app then only ever
// shows the CURRENT one.
//
// Which is exactly the trap. `downtime_records.to IS NULL` means "still down",
// and the availability RPCs read an open record as running to the end of the
// window (the folder's own end is 'infinity' while it is live). Rotate away from
// a folder with an outage still open and nobody can reach that record again from
// the UI, but the meter never stops: every report run over that radar keeps
// subtracting an outage that ended the moment the wall was re-aimed.
//
// It is the same omission utils/radarDecommission.ts exists to make
// unforgettable, one step earlier in the radar's life — a decommission at least
// has a confirmation panel listing what it is about to close, whereas a folder
// rotation is a two-field form behind the wrench menu. So the close is not
// offered here, it is simply done, and the creation is abandoned if it fails:
// a folder that was never created can be created again in ten seconds, while an
// orphaned open record is invisible until somebody recomputes availability by
// hand.
//
// The changeover is NOT the outage ending in any physical sense. The radar may
// well still be down, and the analyst will say so against the new folder through
// the normal status flow. What ends at the changeover is this FOLDER's share of
// it — which is the same split the availability RPCs already expect, and the
// reason they de-duplicate an outage logged either side of a rotation.

import type { SupabaseClient } from '@supabase/supabase-js';

import { fromUTC, toUTC } from './timezoneUtils';
import { planDowntimeClosures } from './downtimeWindow';
import type { OpenDowntime } from './downtimeWindow';

/**
 * "Now", as the instant to stamp onto `to`.
 *
 * Round-tripped through the SITE clock and truncated to the minute rather than
 * taken straight off `new Date()`, for two reasons. Every other `to` in the
 * table came from a `datetime-local` field and therefore lands on a whole
 * minute; a lone value carrying seconds and milliseconds reads as a different
 * kind of record in the downtime tab. And the round trip is what proves the
 * value was resolved against the site's clock — the one the outage is read on —
 * rather than the analyst's browser, which is rarely in the same country.
 *
 * Truncation rounds DOWN, so this can land a few seconds before a record opened
 * in the same minute. `planDowntimeClosures` clamps that to the record's own
 * start rather than writing a backwards window.
 */
export const changeoverInstant = (
  siteTimeZone?: string | null,
  now: Date = new Date()
): string => {
  const siteLocal = (fromUTC(now.toISOString(), siteTimeZone || 'UTC') || '').slice(0, 16);
  return toUTC(siteLocal, siteTimeZone || 'UTC') || now.toISOString();
};

/** How the outcome is worded once the folder exists. Plural-correct; empty when nothing was open. */
export const closureMessage = (closed: number): string => {
  if (closed <= 0) return '';
  return closed === 1
    ? 'The downtime still open on the previous folder was closed off first.'
    : `The ${closed} downtime records still open on the previous folder were closed off first.`;
};

/** Enough of a Supabase client to read and close downtime records. */
export type DowntimeClient = Pick<SupabaseClient, 'from'>;

/**
 * Close every downtime record still open on `wallfolderId`, at `instantUTC`.
 *
 * Returns how many were closed, so the caller can say so. Throws on any read or
 * write failure — the caller is expected to abandon the changeover, because a
 * partially closed folder is the state this module exists to prevent.
 *
 * Idempotent in the way that matters: a second run finds nothing open and
 * closes nothing, so a retry after a failed folder creation is safe.
 */
export const closeOpenDowntime = async (
  supabase: DowntimeClient,
  wallfolderId: number | string,
  instantUTC: string
): Promise<number> => {
  if (wallfolderId === null || wallfolderId === undefined || wallfolderId === '') return 0;

  const { data, error } = await supabase
    .from('downtime_records')
    .select('id, wallfolder, from')
    .eq('wallfolder', wallfolderId)
    .is('to', null);
  if (error) throw error;

  const open = (data || []) as OpenDowntime[];
  if (open.length === 0) return 0;

  // One at a time rather than one `.in()` per distinct `to`: the clamped rows
  // each take their OWN start, so grouping would need the same loop anyway, and
  // a failure part-way leaves the untouched rows still open and still visible.
  for (const closure of planDowntimeClosures(open, instantUTC)) {
    const { error: updateError } = await supabase
      .from('downtime_records')
      .update({ to: closure.to })
      .eq('id', closure.id);
    if (updateError) throw updateError;
  }

  return open.length;
};
