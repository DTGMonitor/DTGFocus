'use client';

/**
 * Image upload + polygon zone drawing for reports.
 *
 * Extracted from PostBlastReportModal's pit viewport so the Post-Blast and
 * Comprehensive reports share one implementation.
 *
 * Two details that matter and are easy to lose:
 *
 * 1. Images are held as DATA URLs (FileReader.readAsDataURL), never object URLs.
 *    html2canvas cannot fetch during rasterization, so a blob:/http: <img> would
 *    snapshot blank into the PDF.
 * 2. Polygon points are stored as PERCENTAGES of the image box, not pixels. The
 *    overlay SVG uses viewBox="0 0 100 100" with preserveAspectRatio="none", so
 *    annotations land in the same place at preview size and at export size.
 *
 * The state lives in a hook rather than the template because the export path
 * mounts a SECOND instance of the template in a detached container. Component
 * state would start empty there and the uploaded image would silently vanish
 * from the PDF — the caller must own this and pass it into both renders.
 */

import { useCallback, useEffect, useState } from 'react';

export const DEFAULT_BOUNDARY_COLOR = '#FF1744';

/**
 * Marks an interactive annotation drop zone in the DOM.
 *
 * The document-level paste listener reads it to tell "the user pasted into a
 * figure" from "the user pasted with nothing focused" — see handleDocumentPaste.
 * AnnotatedImage stamps it on its viewport.
 */
export const DROPZONE_ATTR = 'data-annotation-dropzone';

/** Where a zone's label sits relative to its polygon. */
export const PLACEMENT_INSIDE = 'inside';
export const PLACEMENT_OUTSIDE = 'outside';

/** Centroid of a polygon, for label placement. */
export function centroid(points) {
  if (!points?.length) return { x: 0, y: 0 };
  const sx = points.reduce((a, p) => a + p.x, 0);
  const sy = points.reduce((a, p) => a + p.y, 0);
  return { x: sx / points.length, y: sy / points.length };
}

/**
 * Keep a percent-space coordinate inside the image box. A label that reaches
 * past the edge is clipped by the viewport's `overflow: hidden` and reads as
 * missing, so every anchor this module returns goes through here.
 */
export const clampPct = (v) => Math.max(3, Math.min(97, v));

/** A label that has never been dragged. Frozen so it can be shared safely. */
export const NO_OFFSET = Object.freeze({ dx: 0, dy: 0 });

/** Axis-aligned bounds of a polygon, in the same percent space as the points. */
export function bbox(points) {
  if (!points?.length) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/**
 * Leader-line geometry for a label placed OUTSIDE its polygon.
 *
 * The label is pushed along the ray from the image centre through the polygon's
 * centroid, so a zone near the left edge labels to the left and one near the top
 * labels upward — the leader never crosses the middle of the figure to reach it.
 * `from` sits on the polygon's bounding box (where the line should start, not the
 * centroid, so the line does not draw over the zone it points at) and `to` is the
 * label anchor `margin` further out.
 *
 * Both are clamped to the image box: a label that reaches past the edge is
 * clipped by the viewport's `overflow: hidden` and reads as missing.
 *
 * Note the percent space is not square (the image rarely is), so the ray is
 * skewed relative to true screen angles. That only tilts the leader slightly and
 * keeps the maths resolution-independent, which is what makes preview and export
 * agree.
 */
export function outsideLabelAnchor(points, margin = 7) {
  const c = centroid(points);
  const b = bbox(points);

  let dx = c.x - 50;
  let dy = c.y - 50;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) {
    // Dead centre — no meaningful direction. Up is the least surprising default.
    dx = 0;
    dy = -1;
  } else {
    dx /= len;
    dy /= len;
  }

  const halfW = (b.maxX - b.minX) / 2;
  const halfH = (b.maxY - b.minY) / 2;
  const tX = Math.abs(dx) > 1e-6 ? halfW / Math.abs(dx) : Infinity;
  const tY = Math.abs(dy) > 1e-6 ? halfH / Math.abs(dy) : Infinity;
  const edge = Math.min(tX, tY);

  return {
    from: { x: clampPct(c.x + dx * edge), y: clampPct(c.y + dy * edge) },
    to: { x: clampPct(c.x + dx * (edge + margin)), y: clampPct(c.y + dy * (edge + margin)) },
  };
}

/**
 * Where a leader line should MEET the polygon when its label sits at `target`.
 *
 * The same ray maths as `outsideLabelAnchor`, run backwards: given a label
 * position — which the analyst may have dragged anywhere — find the point on the
 * zone's bounding box facing it. Returns null when the label still sits over the
 * zone, because a leader drawn there would just be a stub under the label.
 */
export function edgeToward(points, target) {
  if (!points?.length) return null;
  const c = centroid(points);
  const b = bbox(points);

  let dx = target.x - c.x;
  let dy = target.y - c.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  dx /= len;
  dy /= len;

  const halfW = (b.maxX - b.minX) / 2;
  const halfH = (b.maxY - b.minY) / 2;
  const tX = Math.abs(dx) > 1e-6 ? halfW / Math.abs(dx) : Infinity;
  const tY = Math.abs(dy) > 1e-6 ? halfH / Math.abs(dy) : Infinity;
  const edge = Math.min(tX, tY);

  // Still inside (or barely clear of) the zone — nothing to lead to.
  if (!Number.isFinite(edge) || len <= edge + 1) return null;
  return { x: clampPct(c.x + dx * edge), y: clampPct(c.y + dy * edge) };
}

/**
 * Where one zone's label sits, and the leader line it needs to get there.
 *
 * Three inputs stack, in this order:
 *
 *   1. `placement` — centroid for an inside label, pushed clear of the polygon
 *      for an outside one.
 *   2. `offset` — how far the analyst has DRAGGED it from there, in percent
 *      points of the image box. This is what lets two zones that would print
 *      their labels on top of each other be pulled apart by hand.
 *   3. the leader — drawn whenever the label ends up clear of the zone,
 *      whichever of the two put it there. Without one an offset label is just a
 *      caption floating on the image with nothing saying which zone it belongs to.
 *
 * Lives here rather than in AnnotatedImage because the drag maths and the render
 * have to agree on the anchor exactly, and because the export render resolves it
 * through the same path as the preview.
 */
export function resolveLabelAnchor(b) {
  const base = b.placement === PLACEMENT_OUTSIDE ? outsideLabelAnchor(b.points).to : centroid(b.points);
  const off = b.offset ?? NO_OFFSET;
  const at =
    off.dx || off.dy
      ? { x: clampPct(base.x + off.dx), y: clampPct(base.y + off.dy) }
      : base;
  const from = edgeToward(b.points, at);
  return { at, leader: from ? { from, to: at } : null };
}

/** First image on a DataTransfer / ClipboardData, or null. */
function firstImageFile(dataTransfer) {
  const items = dataTransfer?.items;
  if (items?.length) {
    for (const item of items) {
      if (item.kind === 'file' && item.type?.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) return file;
      }
    }
  }
  const files = dataTransfer?.files;
  if (files?.length) {
    for (const file of files) {
      if (file.type?.startsWith('image/')) return file;
    }
  }
  return null;
}

/**
 * @param {string|null} initialImage  Data URL to seed with (e.g. the deformation
 *   heatmap already pulled from storage). The user can replace it.
 * @param {object} options
 * @param {boolean} options.pasteEnabled  Listen for Ctrl+V on the document.
 *   Callers that keep this hook mounted while their modal is CLOSED must pass
 *   their open flag — a listener left armed would swallow the user's clipboard
 *   image from anywhere in the app and drop it into an invisible report.
 */
export function useImageAnnotation(initialImage = null, { pasteEnabled = true } = {}) {
  const [image, setImage] = useState(initialImage);
  const [boundaries, setBoundaries] = useState([]); // [{ points, color, label, placement, offset }]
  const [draft, setDraft] = useState(null);
  const [color, setColor] = useState(DEFAULT_BOUNDARY_COLOR);
  // Compass bearing for the figure, in degrees clockwise from up. Only the
  // daily report draws it (AnnotatedImage renders none unless asked), but it
  // lives here because it is a property of the FIGURE and must survive into the
  // export render alongside the image and the zones.
  const [north, setNorth] = useState(0);

  const readImageFile = useCallback((file) => {
    if (!file || !file.type?.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => setImage(e.target.result);
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      readImageFile(firstImageFile(e.dataTransfer));
    },
    [readImageFile]
  );

  /**
   * Paste a screenshot straight in — the common case is a snip of the radar view,
   * which otherwise has to be saved to disk first just to be dragged back.
   *
   * A paste carrying no image is left alone rather than swallowed, so pasting
   * text into the zone-label fields still works while this is armed.
   */
  const handlePaste = useCallback(
    (e) => {
      const file = firstImageFile(e.clipboardData);
      if (!file) return;
      e.preventDefault();
      readImageFile(file);
    },
    [readImageFile]
  );

  /**
   * The same paste, arriving on the DOCUMENT rather than on this figure's own
   * drop zone — the convenience path for the common case of one figure on screen
   * and nothing focused.
   *
   * It must stand down when the paste already belongs to a drop zone. A report
   * can carry several figures (the daily report has a scan area and N analysis
   * areas), and a paste into one of them bubbles up to here as well: this hook
   * would read the same clipboard image and replace ITS figure too, so pasting
   * into the second placeholder silently overwrote the first. The zone's own
   * `onPaste` runs first and marks the event — both by consuming it
   * (`defaultPrevented`) and by being an ancestor of the paste target — and
   * either mark is enough to leave it alone.
   */
  const handleDocumentPaste = useCallback(
    (e) => {
      if (e.defaultPrevented) return;
      const target = e.target;
      if (target && typeof target.closest === 'function' && target.closest(`[${DROPZONE_ATTR}]`)) return;
      handlePaste(e);
    },
    [handlePaste]
  );

  useEffect(() => {
    if (!pasteEnabled || typeof document === 'undefined') return undefined;
    document.addEventListener('paste', handleDocumentPaste);
    return () => document.removeEventListener('paste', handleDocumentPaste);
  }, [pasteEnabled, handleDocumentPaste]);

  /** Click → append a point, in percent of the image box. */
  const addPoint = useCallback(
    (e, imageEl) => {
      if (!draft || !imageEl) return;
      const rect = imageEl.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      setDraft((d) => ({ ...d, points: [...d.points, { x, y }] }));
    },
    [draft]
  );

  const startDraft = useCallback(() => setDraft({ points: [], color }), [color]);
  const undoPoint = useCallback(
    () => setDraft((d) => (d ? { ...d, points: d.points.slice(0, -1) } : d)),
    []
  );
  // Commits from `draft` directly rather than from inside a setDraft updater.
  // Nesting setBoundaries in that updater committed the zone TWICE: React
  // double-invokes state updaters in StrictMode to surface impure ones, so the
  // nested setBoundaries ran twice and one drawn polygon became Zone A + Zone B.
  // Updaters must be pure — side effects belong outside them.
  const finishDraft = useCallback(() => {
    // Two points is the minimum that describes an area worth labelling.
    if (draft && draft.points.length >= 2) {
      const { points, color: draftColor } = draft;
      setBoundaries((b) => [
        ...b,
        {
          points,
          color: draftColor,
          label: `Zone ${String.fromCharCode(65 + b.length)}`,
          placement: PLACEMENT_INSIDE,
          offset: NO_OFFSET,
        },
      ]);
    }
    setDraft(null);
  }, [draft]);
  const clearBoundaries = useCallback(() => {
    setBoundaries([]);
    setDraft(null);
  }, []);
  const updateLabel = useCallback(
    (idx, label) => setBoundaries((b) => b.map((bd, i) => (i === idx ? { ...bd, label } : bd))),
    []
  );
  const updatePlacement = useCallback(
    (idx, placement) => setBoundaries((b) => b.map((bd, i) => (i === idx ? { ...bd, placement } : bd))),
    []
  );
  /**
   * Recolour ONE zone after it is drawn.
   *
   * `setColor` picks the colour the NEXT zone is drawn in; this changes one that
   * already exists. Both are needed — an analyst who draws three zones before
   * noticing two of them are the same red should not have to redraw them.
   */
  const updateColor = useCallback(
    (idx, zoneColor) => setBoundaries((b) => b.map((bd, i) => (i === idx ? { ...bd, color: zoneColor } : bd))),
    []
  );
  /** Drag a label off its computed anchor, in percent points of the image box. */
  const moveLabel = useCallback(
    (idx, offset) => setBoundaries((b) => b.map((bd, i) => (i === idx ? { ...bd, offset } : bd))),
    []
  );
  const resetLabelPosition = useCallback(
    (idx) => setBoundaries((b) => b.map((bd, i) => (i === idx ? { ...bd, offset: NO_OFFSET } : bd))),
    []
  );
  /**
   * Delete ONE zone. The remaining zones keep their own labels rather than being
   * renamed to close the gap: "Zone C" may already be written into the report
   * prose, and silently promoting it to Zone B would falsify that.
   */
  const removeBoundary = useCallback(
    (idx) => setBoundaries((b) => b.filter((_, i) => i !== idx)),
    []
  );

  return {
    image, setImage,
    boundaries, draft, color, setColor,
    north, setNorth,
    readImageFile, handleDrop, handlePaste, addPoint,
    startDraft, undoPoint, finishDraft, clearBoundaries, updateLabel, updatePlacement,
    updateColor, moveLabel, resetLabelPosition, removeBoundary,
  };
}

export default useImageAnnotation;
