/**
 * The one place that knows how a dqp_values row stores its figures.
 *
 * A row carries N images as two index-aligned arrays — `image_ids[i]` pairs with
 * `image_captions[i]` (see .kiro/specs/dqp-multi-image/migrations/001). PostgREST
 * cannot embed a join through an array column the way `image:client_images(...)`
 * did for the old single FK, so resolving ids to storage paths is a second query.
 * That query is the same everywhere, so it lives here rather than in each caller.
 *
 * Pure functions plus one Supabase call; no React.
 */

/**
 * Columns every dqp_values read needs for figures.
 *
 * `image` and `caption` are the pre-migration single-figure columns. They are
 * still selected because a client running older code writes them and nothing
 * else — `normaliseDqpImages` falls back to them so a figure written mid-rollout
 * is not invisible. Remove both once those columns are dropped.
 */
export const DQP_IMAGE_COLUMNS = 'image, caption, image_ids, image_captions';

/**
 * The (id, caption) pairs a row declares, newest storage format first.
 *
 * Tolerates the legacy `image` in either shape: a bare id, or the object left by
 * an `image:client_images(...)` embed.
 *
 * @returns {{id: number, caption: string}[]}
 */
export function normaliseDqpImages(row) {
  const ids = Array.isArray(row?.image_ids) ? row.image_ids.filter((id) => id != null) : [];

  if (ids.length) {
    const captions = Array.isArray(row?.image_captions) ? row.image_captions : [];
    // The CHECK constraint keeps these aligned, but a caller can hand us a
    // hand-built row; index past the end reads as "no caption", never as a
    // caption borrowed from a neighbour.
    return ids.map((id, i) => ({ id: Number(id), caption: captions[i] ?? '' }));
  }

  const legacy = row?.image;
  const legacyId = legacy && typeof legacy === 'object' ? legacy.id : legacy;
  if (legacyId == null) return [];
  return [{ id: Number(legacyId), caption: row?.caption ?? '' }];
}

/**
 * Resolve every row's image ids to storage paths in ONE round trip.
 *
 * Adds `images: [{ id, caption, image_url }]` to each row, in the order the row
 * declared. Ids that no longer resolve (image deleted out from under the row)
 * are dropped rather than kept as holes — a figure that cannot render must not
 * claim a figure number in the report.
 *
 * A failed lookup degrades to "no figures" and never throws: a missing image
 * must not take down the DQP table or stop a report from generating.
 *
 * @param {object} client  Supabase client.
 * @param {object[]} rows  dqp_values rows selected with DQP_IMAGE_COLUMNS.
 */
export async function attachDqpImages(client, rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return list;

  const pairsByRow = list.map(normaliseDqpImages);
  const ids = [...new Set(pairsByRow.flat().map((p) => p.id))];
  if (!ids.length) return list.map((row) => ({ ...row, images: [] }));

  let pathById = new Map();
  try {
    const { data, error } = await client
      .from('client_images')
      .select('id, image_url')
      .in('id', ids);
    if (error) throw error;
    pathById = new Map((data ?? []).map((d) => [Number(d.id), d.image_url]));
  } catch (err) {
    console.error('Error resolving DQP images:', err);
  }

  return list.map((row, i) => ({
    ...row,
    images: pairsByRow[i]
      .map((p) => ({ id: p.id, caption: p.caption, image_url: pathById.get(p.id) ?? null }))
      .filter((img) => img.image_url),
  }));
}

/**
 * The payload half of the same contract — what the uploader writes back.
 *
 * Kept here so the write shape cannot drift from the read shape, and so the
 * arrays are guaranteed equal-length before they hit the CHECK constraint.
 *
 * @param {{id: number, caption?: string}[]} images
 */
export function buildDqpImagePayload(images) {
  const list = Array.isArray(images) ? images.filter((img) => img?.id != null) : [];
  return {
    image_ids: list.map((img) => Number(img.id)),
    image_captions: list.map((img) => img.caption ?? ''),
    // The legacy columns are kept consistent rather than left stale, so a client
    // still on the old read path shows the first figure instead of a stale one.
    image: list.length ? Number(list[0].id) : null,
    caption: list.length ? list[0].caption ?? '' : null,
  };
}
