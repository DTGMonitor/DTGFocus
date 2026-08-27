'use client';

/**
 * The Area Analysis section's figure set: N deformation images, each with its
 * own zones, its own compass bearing, and its own list of graphs beneath it.
 *
 * `useImageAnnotation` cannot do this. It is one image per hook call, and the
 * count here is chosen by the analyst at render time — the printed report puts
 * two graphs under the first image and three under the second — so calling it
 * per figure would break the rules of hooks the moment a figure is added or
 * removed. This holds the whole set in ONE state array instead and hands out a
 * per-figure adapter shaped exactly like `useImageAnnotation`'s return, so
 * `AnnotatedImage` and the toolbar consume either without knowing which.
 *
 * Two invariants are inherited from `useImageAnnotation` and matter just as much
 * here:
 *
 *   1. Images are DATA URLs (FileReader.readAsDataURL), never object URLs —
 *      html2canvas cannot fetch during rasterization, so a blob: <img> would
 *      snapshot blank into the PDF.
 *   2. Polygon points are PERCENTAGES of the image box, so preview and export
 *      agree without rescaling.
 *
 * As with the single-image hook, the state belongs to the CALLER: the export
 * path mounts a second copy of the template in a detached container, where
 * component-local state would start empty and every uploaded figure would
 * silently vanish from the PDF.
 */

import { useCallback, useMemo, useState } from 'react';
import { DEFAULT_BOUNDARY_COLOR, NO_OFFSET, PLACEMENT_INSIDE } from './useImageAnnotation';

/** Monotonic ids, so React keys survive a removal from the middle of the list. */
let nextId = 1;
const uid = (prefix) => `${prefix}-${nextId++}`;

/** An empty analysis figure: no image yet, no zones, no graphs, north up. */
export const emptyFigure = (name = '') => ({
  id: uid('fig'),
  name,
  image: null,
  boundaries: [],
  draft: null,
  color: DEFAULT_BOUNDARY_COLOR,
  north: 0,
  graphs: [],
});

/** Read a File into a data URL, or resolve null for a non-image. */
function readAsDataUrl(file) {
  return new Promise((resolve) => {
    if (!file || !file.type?.startsWith('image/')) return resolve(null);
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
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
 * @param {object[]} initial  Figures to seed with. Defaults to a single empty
 *   one, so the section always offers a drop zone rather than an "Add" button
 *   over nothing.
 */
export function useDailyFigures(initial = null) {
  const [figures, setFigures] = useState(() => initial ?? [emptyFigure()]);

  /** Replace figure `i` through a pure updater. */
  const patch = useCallback((i, updater) => {
    setFigures((list) => list.map((f, idx) => (idx === i ? { ...f, ...updater(f) } : f)));
  }, []);

  const addFigure = useCallback(() => setFigures((list) => [...list, emptyFigure()]), []);

  // Never below one: an empty list leaves the section with no drop zone and no
  // way back to one.
  const removeFigure = useCallback(
    (i) => setFigures((list) => (list.length <= 1 ? list : list.filter((_, idx) => idx !== i))),
    []
  );

  const setName = useCallback((i, name) => patch(i, () => ({ name })), [patch]);
  const setNorth = useCallback(
    (i, north) => patch(i, () => ({ north: Number.isFinite(Number(north)) ? Number(north) : 0 })),
    [patch]
  );

  const setImage = useCallback(
    async (i, file) => {
      const dataUrl = await readAsDataUrl(file);
      if (dataUrl) patch(i, () => ({ image: dataUrl }));
    },
    [patch]
  );

  // --- Graphs ------------------------------------------------------------
  // Several files at once: an analyst exporting three curves from the radar
  // software selects all three, and adding them one dialog at a time is the
  // kind of friction that gets a section left empty.
  const addGraphs = useCallback(
    async (i, fileList) => {
      const files = Array.from(fileList ?? []);
      const urls = (await Promise.all(files.map(readAsDataUrl))).filter(Boolean);
      if (!urls.length) return;
      patch(i, (f) => ({
        graphs: [...f.graphs, ...urls.map((image) => ({ id: uid('graph'), image, caption: '' }))],
      }));
    },
    [patch]
  );

  const removeGraph = useCallback(
    (i, gi) => patch(i, (f) => ({ graphs: f.graphs.filter((_, idx) => idx !== gi) })),
    [patch]
  );

  const setGraphCaption = useCallback(
    (i, gi, caption) =>
      patch(i, (f) => ({ graphs: f.graphs.map((g, idx) => (idx === gi ? { ...g, caption } : g)) })),
    [patch]
  );

  // --- Zone drawing, per figure -----------------------------------------
  const startDraft = useCallback((i) => patch(i, (f) => ({ draft: { points: [], color: f.color } })), [patch]);

  const addPoint = useCallback(
    (i, e, imageEl) => {
      if (!imageEl) return;
      const rect = imageEl.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      patch(i, (f) => (f.draft ? { draft: { ...f.draft, points: [...f.draft.points, { x, y }] } } : {}));
    },
    [patch]
  );

  const undoPoint = useCallback(
    (i) => patch(i, (f) => (f.draft ? { draft: { ...f.draft, points: f.draft.points.slice(0, -1) } } : {})),
    [patch]
  );

  /**
   * Commit the draft. Written as one pure updater over the whole figure —
   * React double-invokes updaters in StrictMode to surface impure ones, so a
   * nested `setBoundaries` inside a `setDraft` updater would commit the zone
   * twice (the bug `useImageAnnotation.finishDraft` documents).
   */
  const finishDraft = useCallback(
    (i) =>
      patch(i, (f) => {
        if (!f.draft || f.draft.points.length < 2) return { draft: null };
        return {
          draft: null,
          boundaries: [
            ...f.boundaries,
            {
              points: f.draft.points,
              color: f.draft.color,
              label: `Zone ${String.fromCharCode(65 + f.boundaries.length)}`,
              placement: PLACEMENT_INSIDE,
              offset: NO_OFFSET,
            },
          ],
        };
      }),
    [patch]
  );

  const clearBoundaries = useCallback((i) => patch(i, () => ({ boundaries: [], draft: null })), [patch]);

  const updateLabel = useCallback(
    (i, bi, label) =>
      patch(i, (f) => ({ boundaries: f.boundaries.map((b, idx) => (idx === bi ? { ...b, label } : b)) })),
    [patch]
  );

  const updatePlacement = useCallback(
    (i, bi, placement) =>
      patch(i, (f) => ({ boundaries: f.boundaries.map((b, idx) => (idx === bi ? { ...b, placement } : b)) })),
    [patch]
  );

  /** Recolour one drawn zone — `setColor` only chooses the colour of the next one. */
  const updateZoneColor = useCallback(
    (i, bi, color) =>
      patch(i, (f) => ({ boundaries: f.boundaries.map((b, idx) => (idx === bi ? { ...b, color } : b)) })),
    [patch]
  );

  /** Drag a label off its computed anchor, in percent points of the image box. */
  const moveLabel = useCallback(
    (i, bi, offset) =>
      patch(i, (f) => ({ boundaries: f.boundaries.map((b, idx) => (idx === bi ? { ...b, offset } : b)) })),
    [patch]
  );

  const resetLabelPosition = useCallback(
    (i, bi) =>
      patch(i, (f) => ({
        boundaries: f.boundaries.map((b, idx) => (idx === bi ? { ...b, offset: NO_OFFSET } : b)),
      })),
    [patch]
  );

  /**
   * Delete ONE zone from a figure. The survivors keep their labels rather than
   * being renamed to close the gap — see useImageAnnotation.removeBoundary.
   */
  const removeBoundary = useCallback(
    (i, bi) => patch(i, (f) => ({ boundaries: f.boundaries.filter((_, idx) => idx !== bi) })),
    [patch]
  );

  const setColor = useCallback((i, color) => patch(i, () => ({ color })), [patch]);

  /**
   * A `useImageAnnotation`-shaped bundle for one figure.
   *
   * Rebuilt only when the figure list changes, so `AnnotatedImage` is not handed
   * a fresh object on every unrelated keystroke elsewhere in the toolbar.
   */
  const figureApis = useMemo(
    () =>
      figures.map((f, i) => ({
        image: f.image,
        boundaries: f.boundaries,
        draft: f.draft,
        color: f.color,
        north: f.north,
        setColor: (c) => setColor(i, c),
        setNorth: (n) => setNorth(i, n),
        readImageFile: (file) => setImage(i, file),
        handleDrop: (e) => {
          e.preventDefault();
          setImage(i, firstImageFile(e.dataTransfer));
        },
        // No document-level paste listener here, unlike the single-image hook:
        // with several drop zones on screen a global listener cannot know which
        // figure the analyst meant. The zone must be focused.
        handlePaste: (e) => {
          const file = firstImageFile(e.clipboardData);
          if (!file) return;
          e.preventDefault();
          setImage(i, file);
        },
        addPoint: (e, el) => addPoint(i, e, el),
        startDraft: () => startDraft(i),
        undoPoint: () => undoPoint(i),
        finishDraft: () => finishDraft(i),
        clearBoundaries: () => clearBoundaries(i),
        updateLabel: (bi, label) => updateLabel(i, bi, label),
        updatePlacement: (bi, placement) => updatePlacement(i, bi, placement),
        updateColor: (bi, c) => updateZoneColor(i, bi, c),
        moveLabel: (bi, offset) => moveLabel(i, bi, offset),
        resetLabelPosition: (bi) => resetLabelPosition(i, bi),
        removeBoundary: (bi) => removeBoundary(i, bi),
      })),
    [figures, setColor, setNorth, setImage, addPoint, startDraft, undoPoint, finishDraft, clearBoundaries, updateLabel, updatePlacement, updateZoneColor, moveLabel, resetLabelPosition, removeBoundary]
  );

  return {
    figures,
    figureApis,
    addFigure,
    removeFigure,
    setName,
    setNorth,
    addGraphs,
    removeGraph,
    setGraphCaption,
  };
}

export default useDailyFigures;
