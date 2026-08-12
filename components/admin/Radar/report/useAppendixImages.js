'use client';

/**
 * The appendix figures a DQP row carries, inlined as data URLs.
 *
 * Shared by every report whose appendix is built from `dqp_values` — the
 * Comprehensive report and the Daily (Tabulation) report. Both read the same
 * rows through `buildAppendixItems`, so both need the same resolution step, and
 * a second copy of it would be a second place for the export race documented
 * below to be reintroduced.
 */

import { useEffect, useState } from 'react';

import { urlToDataUrl } from '@/components/admin/Radar/report/pdfExport';
import { supabase } from '@/lib/supabaseClient';

/**
 * Sign every appendix figure and inline it as a data URL.
 *
 * html2canvas cannot fetch during rasterization, so a remote <img> snapshots
 * blank; and the signed URL expires in an hour, which would break a long-lived
 * preview. Inlining solves both.
 *
 * An item can carry several figures, so this resolves the whole grid at once —
 * every image of every item concurrently, not item by item, since a row with
 * four figures would otherwise serialise four sign+fetch round trips.
 *
 * Exported because the export path MUST await this before it mounts the template
 * — see `useAppendixImages`.
 */
export async function resolveAppendixImages(items) {
  const resolveOne = async (img) => {
    if (!img?.image_url) return img;
    try {
      const { data } = await supabase.storage.from('Radar').createSignedUrl(img.image_url, 3600);
      if (!data?.signedUrl) return img;
      return { ...img, imageUrl: await urlToDataUrl(data.signedUrl) };
    } catch {
      return img; // A missing figure must not stop the report.
    }
  };

  return Promise.all(
    items.map(async (item) => ({
      ...item,
      images: await Promise.all((item.images ?? []).map(resolveOne)),
    }))
  );
}

/**
 * Appendix figures, resolved.
 *
 * `preResolved` is how the export path avoids a race it cannot win. Resolving in
 * an effect means the first render has `imageUrl: null` on every item, so each
 * appendix block measures at heading+prose with no figure — hundreds of px short.
 * The preview never notices, because it re-packs when the images land. The export
 * captures on a fixed timer (`waitForImages`), and signing a Supabase URL plus
 * fetching the bytes does not finish inside it — so the export rasterizes the
 * short measurement and silently loses whole pages.
 *
 * The logo and the deformation image are already pre-inlined by the caller for
 * the same reason. Appendix figures were the one async resource still resolving
 * inside the render.
 */
export function useAppendixImages(items, preResolved) {
  const [resolved, setResolved] = useState(preResolved ?? items);

  useEffect(() => {
    if (preResolved) return; // Already inlined before mount; nothing to race.
    let cancelled = false;
    (async () => {
      const out = await resolveAppendixImages(items);
      if (!cancelled) setResolved(out);
    })();
    return () => { cancelled = true; };
  }, [items, preResolved]);

  return preResolved ?? resolved;
}

export default useAppendixImages;
