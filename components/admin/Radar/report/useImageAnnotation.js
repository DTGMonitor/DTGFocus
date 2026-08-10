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

  const clamp = (v) => Math.max(3, Math.min(97, v));
  return {
    from: { x: clamp(c.x + dx * edge), y: clamp(c.y + dy * edge) },
    to: { x: clamp(c.x + dx * (edge + margin)), y: clamp(c.y + dy * (edge + margin)) },
  };
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
  const [boundaries, setBoundaries] = useState([]); // [{ points, color, label, placement }]
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

  useEffect(() => {
    if (!pasteEnabled || typeof document === 'undefined') return undefined;
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [pasteEnabled, handlePaste]);

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

  return {
    image, setImage,
    boundaries, draft, color, setColor,
    north, setNorth,
    readImageFile, handleDrop, handlePaste, addPoint,
    startDraft, undoPoint, finishDraft, clearBoundaries, updateLabel, updatePlacement,
  };
}

export default useImageAnnotation;
