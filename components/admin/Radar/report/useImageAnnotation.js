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

import { useCallback, useState } from 'react';

export const DEFAULT_BOUNDARY_COLOR = '#FF1744';

/** Centroid of a polygon, for label placement. */
export function centroid(points) {
  if (!points?.length) return { x: 0, y: 0 };
  const sx = points.reduce((a, p) => a + p.x, 0);
  const sy = points.reduce((a, p) => a + p.y, 0);
  return { x: sx / points.length, y: sy / points.length };
}

/**
 * @param {string|null} initialImage  Data URL to seed with (e.g. the deformation
 *   heatmap already pulled from storage). The user can replace it.
 */
export function useImageAnnotation(initialImage = null) {
  const [image, setImage] = useState(initialImage);
  const [boundaries, setBoundaries] = useState([]); // [{ points, color, label }]
  const [draft, setDraft] = useState(null);
  const [color, setColor] = useState(DEFAULT_BOUNDARY_COLOR);

  const readImageFile = useCallback((file) => {
    if (!file || !file.type?.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => setImage(e.target.result);
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      readImageFile(e.dataTransfer?.files?.[0]);
    },
    [readImageFile]
  );

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
        { points, color: draftColor, label: `Zone ${String.fromCharCode(65 + b.length)}` },
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

  return {
    image, setImage,
    boundaries, draft, color, setColor,
    readImageFile, handleDrop, addPoint,
    startDraft, undoPoint, finishDraft, clearBoundaries, updateLabel,
  };
}

export default useImageAnnotation;
