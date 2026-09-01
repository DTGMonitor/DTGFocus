'use client';

/**
 * Measure-then-pack pagination for block-composed reports.
 *
 * Extracted from PostBlastReportModal. The caller renders `measureLayer` once
 * (hidden, off-screen, at CONTENT_W), and this hook reads each block's real
 * height and greedily packs block indices into pages.
 *
 * Blocks are never split mid-element — a block taller than USABLE_H gets a page
 * to itself and overflows. Builders pre-chunk oversized content instead (e.g.
 * one appendix item per block) and cap figures at IMAGE_MAX_H.
 *
 * Callers MUST pass `bumpMeasure` to every <img onLoad>: images have zero height
 * until decoded, so without it the first pack runs against wrong numbers and
 * never corrects.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BLOCK_GAP, CONTENT_W, USABLE_H, INK } from './constants';

// SSR-safe layout effect.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Takes only `deps`, not the blocks themselves: callers build their blocks with
 * `bumpMeasure` wired into every <img onLoad>, so `bumpMeasure` has to exist
 * before the blocks do. Measurement reads the DOM, not the array, so the hook
 * never needs it.
 *
 * @param {any[]} deps  Re-measure when these change (include the block count).
 * @param {object} options
 * @param {number} options.usableHeight  Content height one page can hold.
 *   Defaults to USABLE_H, which reserves FOOTER_RESERVE for the standard
 *   footer. A report printing a TALLER footer (the daily report's signature
 *   block and disclaimer) must pass its own, or the paginator packs blocks into
 *   space the footer then covers.
 * @returns {{ pages: number[][]|null, measureRef, measureLayer: object, bumpMeasure: Function }}
 *          `pages[i]` is the list of block indices on page i, or null before the
 *          first measurement — callers fall back to one page holding everything.
 *          `measureLayer` is a style object for the hidden measuring container.
 */
export function useReportPagination(deps = [], { usableHeight = USABLE_H } = {}) {
  const measureRef = useRef(null);
  const [pages, setPages] = useState(null);
  const [measureTick, setMeasureTick] = useState(0);

  const bumpMeasure = useCallback(() => setMeasureTick((t) => t + 1), []);

  useIsoLayoutEffect(() => {
    if (!measureRef.current) return;
    const children = Array.from(measureRef.current.children);
    if (children.length === 0) return;

    const heights = children.map((c) => c.getBoundingClientRect().height);
    const result = [];
    let cur = [];
    let h = 0;

    heights.forEach((ht, i) => {
      const need = ht + (cur.length ? BLOCK_GAP : 0);
      if (cur.length && h + need > usableHeight) {
        result.push(cur);
        cur = [];
        h = 0;
      }
      cur.push(i);
      h += ht + (cur.length > 1 ? BLOCK_GAP : 0);
    });
    if (cur.length) result.push(cur);

    // A block taller than a page cannot be placed — the sheet clips it, so the
    // overflow is not merely ugly, it is CONTENT SILENTLY MISSING from both the
    // preview and the PDF. Nothing here can split it (only the builder knows
    // where a split is legible), so say which block it is, loudly, in dev.
    if (process.env.NODE_ENV !== 'production') {
      heights.forEach((ht, i) => {
        if (ht > usableHeight) {
          console.warn(
            `[report] block ${i} measures ${Math.round(ht)}px against a ${Math.round(usableHeight)}px page. ` +
              'It will be clipped — pre-chunk it into several blocks (see chunkImprovements / buildTimelineChunks).'
          );
        }
      });
    }

    setPages(result.length ? result : [heights.map((_, i) => i)]);
  }, [measureTick, usableHeight, ...deps]);

  const measureLayer = {
    position: 'absolute',
    left: -100000,
    top: 0,
    width: CONTENT_W,
    boxSizing: 'border-box',
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: INK,
    lineHeight: 1.25,
    visibility: 'hidden',
    pointerEvents: 'none',
  };

  return { pages, measureRef, measureLayer, bumpMeasure };
}

/**
 * Resolve the hook's `pages` against a block list, falling back to a single page
 * holding everything before the first measurement lands.
 */
export function resolvePages(pages, blocks) {
  return pages ?? [blocks.map((_, i) => i)];
}

/**
 * Are two blocks (by key) directly adjacent on the same packed page?
 *
 * Blocks can only be welded into one frame when they really do touch. The
 * paginator is free to push the second onto the next page, where a joined block
 * would render with its top border missing and nothing above it to explain why
 * — so this is asked of the packed pages, never assumed.
 *
 * Used by every report that has a block continuing another's frame: the
 * comprehensive report's timeline under its deformation figure, the daily
 * report's graphs under their analysis image.
 */
export function blocksAreAdjacent(pages, blocks, keyA, keyB) {
  const a = blocks.findIndex((b) => b.key === keyA);
  const b = blocks.findIndex((x) => x.key === keyB);
  if (a === -1 || b === -1) return false;
  return pages.some((idxs) => {
    const pa = idxs.indexOf(a);
    return pa !== -1 && idxs[pa + 1] === b;
  });
}

export default useReportPagination;
