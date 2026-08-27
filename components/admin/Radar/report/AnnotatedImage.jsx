'use client';

/**
 * Annotated image viewport + its editing toolbar.
 *
 * Extracted from PostBlastReportModal's pit block. The overlay is an SVG with
 * viewBox="0 0 100 100" preserveAspectRatio="none" laid over the image, so the
 * percentage-based points from useImageAnnotation map correctly at any render
 * size — preview and export agree without rescaling anything.
 */

import { MUTED, LINE, ACCENT, IMAGE_MAX_H } from './constants';
import { DROPZONE_ATTR, NO_OFFSET, resolveLabelAnchor } from './useImageAnnotation';
import { NorthArrow } from './NorthArrow';

/**
 * Drag a zone label to a new resting place.
 *
 * Two labels whose zones sit close together print on top of each other, and no
 * automatic placement rule fixes every figure — so the analyst pulls them apart
 * by hand. The delta is measured against the IMAGE box and stored in percent
 * points, the same space the polygons live in, so a label dragged in the preview
 * lands in the same spot in the export.
 *
 * Listeners go on the window, not the label: a fast drag outruns the element and
 * would otherwise drop the pointer mid-move.
 */
function beginLabelDrag({ event, index, boundary, imageEl, onLabelMove }) {
  const rect = imageEl?.getBoundingClientRect();
  if (!rect?.width || !rect?.height) return;

  // Stop the image's click handler from reading this as a polygon point.
  event.preventDefault();
  event.stopPropagation();

  const startX = event.clientX;
  const startY = event.clientY;
  const base = boundary.offset ?? NO_OFFSET;

  // Coalesced to one commit per frame. A pointermove fires far faster than the
  // report re-renders, and every commit re-runs pagination on templates that
  // measure against the zone list — unthrottled, the drag stutters.
  let frame = null;
  let pending = null;
  const flush = () => {
    frame = null;
    if (pending) onLabelMove(index, pending);
  };
  const onMove = (ev) => {
    pending = {
      dx: base.dx + ((ev.clientX - startX) / rect.width) * 100,
      dy: base.dy + ((ev.clientY - startY) / rect.height) * 100,
    };
    if (frame == null) frame = requestAnimationFrame(flush);
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    // Land on the last position even if the pointer came up between frames.
    if (frame != null) cancelAnimationFrame(frame);
    if (pending) onLabelMove(index, pending);
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

/**
 * @param {string|null} image        Data URL.
 * @param {object[]} boundaries      [{ points, color, label, placement }]
 * @param {object|null} draft        In-progress polygon.
 * @param {boolean} interactive      false for the measurement/export render.
 * @param {object} imageRef          Ref on the <img>, for click → percent maths.
 * @param {Function} onImageLoad     Pass bumpMeasure so pagination re-runs.
 * @param {Function} onPaste         Clipboard → image. The hook also listens on
 *   the document, so this only adds the case where the drop zone itself is
 *   focused; both funnel into the same handler and a paste is consumed once.
 * @param {number} maxHeight
 * @param {number|null} northRotation  Degrees clockwise from up. A number — 0
 *   included — overlays a rotatable compass on the figure; null (the default)
 *   renders none, so the Post-Blast and Comprehensive figures are unchanged.
 * @param {string} northLetter       'U' on the Indonesian path, 'N' otherwise.
 * @param {Function|null} onLabelMove  (index, {dx, dy}) — commit a dragged label.
 *   Omitted (or non-interactive) leaves the labels click-through, exactly as they
 *   were before dragging existed, which is what the export render wants.
 */
export function AnnotatedImage({
  image,
  boundaries = [],
  draft = null,
  interactive = false,
  imageRef,
  onDrop,
  onPaste,
  onImageClick,
  onImageLoad,
  maxHeight = IMAGE_MAX_H,
  emptyHint = 'Drag & drop an image here, or use “Upload image”.',
  northRotation = null,
  northLetter = 'N',
  onLabelMove = null,
}) {
  const labelsDraggable = interactive && Boolean(onLabelMove) && !draft;
  return (
    <div
      onDragOver={interactive ? (e) => e.preventDefault() : undefined}
      onDrop={interactive ? onDrop : undefined}
      onPaste={interactive ? onPaste : undefined}
      // Focusable so a click on the drop zone puts Ctrl+V here explicitly. Not
      // the only path — the hook's document listener covers the untouched case.
      tabIndex={interactive ? 0 : undefined}
      // Marks this as a figure that OWNS its pastes, so the single-image hook's
      // document listener does not also swallow one meant for another figure.
      {...(interactive ? { [DROPZONE_ATTR]: '' } : {})}
      style={{
        position: 'relative',
        width: '100%',
        minHeight: image ? undefined : 150,
        border: image ? `1px solid ${LINE}` : `2px dashed ${LINE}`,
        background: '#fafbfc',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {image ? (
        <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', lineHeight: 0 }}>
          <img
            ref={interactive ? imageRef : undefined}
            src={image}
            alt="Report figure"
            onClick={interactive ? onImageClick : undefined}
            onLoad={onImageLoad}
            crossOrigin="anonymous"
            style={{
              display: 'block',
              maxWidth: '100%',
              maxHeight,
              width: 'auto',
              height: 'auto',
              cursor: interactive && draft ? 'crosshair' : 'default',
            }}
          />
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          >
            {boundaries.map((b, i) => (
              <polygon
                key={i}
                points={b.points.map((p) => `${p.x},${p.y}`).join(' ')}
                fill={`${b.color}33`}
                stroke={b.color}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {/* Leader lines, drawn after the polygons so they are never buried
                under a later zone's translucent fill. */}
            {boundaries.map((b, i) => {
              const { leader } = resolveLabelAnchor(b);
              if (!leader) return null;
              return (
                <line
                  key={`leader-${i}`}
                  x1={leader.from.x}
                  y1={leader.from.y}
                  x2={leader.to.x}
                  y2={leader.to.y}
                  stroke={b.color}
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            {interactive && draft && draft.points.length > 0 && (
              <polyline
                points={draft.points.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke={draft.color}
                strokeWidth={2}
                strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
          {boundaries.map((b, i) => {
            const { at } = resolveLabelAnchor(b);
            return (
              <span
                key={i}
                onPointerDown={
                  labelsDraggable
                    ? (e) =>
                        beginLabelDrag({
                          event: e,
                          index: i,
                          boundary: b,
                          imageEl: imageRef?.current,
                          onLabelMove,
                        })
                    : undefined
                }
                title={labelsDraggable ? 'Drag to reposition this label' : undefined}
                style={{
                  position: 'absolute',
                  left: `${at.x}%`,
                  top: `${at.y}%`,
                  transform: 'translate(-50%, -50%)',
                  background: b.color,
                  color: '#fff',
                  fontSize: 9,
                  fontWeight: 700,
                  lineHeight: 1.25,
                  padding: '1px 5px',
                  borderRadius: 3,
                  // pre-line, not nowrap: a label may carry several lines (trend
                  // on one, velocity on the next) and each must keep its break.
                  whiteSpace: 'pre-line',
                  textAlign: 'center',
                  // Click-through except while draggable — during a draft the
                  // clicks belong to the polygon being drawn underneath.
                  pointerEvents: labelsDraggable ? 'auto' : 'none',
                  cursor: labelsDraggable ? 'move' : undefined,
                  userSelect: 'none',
                  touchAction: 'none',
                }}
              >
                {b.label}
              </span>
            );
          })}
          {/* Compass, last so it is never buried under a zone's fill. Inside the
              image box rather than beside it, so it scales and crops with the
              figure it describes. */}
          {northRotation != null ? (
            <div style={{ position: 'absolute', left: 8, top: 8, pointerEvents: 'none' }}>
              <NorthArrow rotation={northRotation} letter={northLetter} />
            </div>
          ) : null}
        </div>
      ) : (
        <div style={{ textAlign: 'center', color: MUTED, fontSize: 11, padding: 18 }}>
          <div style={{ fontSize: 22, marginBottom: 3 }}>⛰</div>
          {emptyHint}
        </div>
      )}
    </div>
  );
}

/** The small ✕ / ⟲ affordances on a zone row. */
const zoneIconBtn = {
  border: '1px solid rgba(255,255,255,0.2)',
  background: 'rgba(255,255,255,0.08)',
  color: '#cbd5e1',
  borderRadius: 3,
  padding: '1px 5px',
  fontSize: 11,
  lineHeight: 1.6,
  cursor: 'pointer',
};

const btn = {
  padding: '5px 10px',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.2)',
  background: 'rgba(255,255,255,0.08)',
  color: '#fff',
  fontSize: 12,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

/**
 * Screen-only editing controls. Never part of the paginated paper — it must not
 * appear in the PDF.
 *
 * @param {boolean} showNorth  Reveal the compass bearing control. Off by
 *   default: only the daily report draws a north arrow, and offering a rotation
 *   the figure never renders would be a dead control in the other two reports.
 * @param {React.ReactNode} extra  Extra controls appended to the top row —
 *   the daily report's per-figure name and remove button.
 */
export function AnnotationToolbar({ annotation, label = 'Deformation image', showNorth = false, extra = null }) {
  const {
    image, boundaries, draft, color, setColor, readImageFile,
    north, setNorth,
    startDraft, undoPoint, finishDraft, clearBoundaries, updateLabel, updatePlacement,
    updateColor, removeBoundary, resetLabelPosition,
  } = annotation;

  return (
    <div style={{ background: '#111418', color: '#fff', padding: '8px 12px', borderRadius: 6, marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 12 }}>{label}</strong>
        {extra}

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => readImageFile(e.target.files?.[0])}
            style={{ display: 'none' }}
          />
          <span style={btn}>{image ? 'Replace image' : 'Upload image'}</span>
        </label>

        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <span style={{ color: '#cbd5e1' }}>Zone colour</span>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            aria-label="Zone colour"
            style={{ width: 30, height: 22, border: 'none', background: 'transparent', cursor: 'pointer' }}
          />
        </span>

        {!draft ? (
          <button type="button" onClick={startDraft} disabled={!image} style={btn}>✏ Draw zone</button>
        ) : (
          <>
            <button type="button" onClick={undoPoint} style={btn}>↶ Undo point</button>
            <button type="button" onClick={finishDraft} style={{ ...btn, background: ACCENT, color: '#111' }}>
              ✓ Finish ({draft.points.length})
            </button>
          </>
        )}
        <button type="button" onClick={clearBoundaries} disabled={!boundaries.length} style={btn} title="Delete every zone on this figure">
          Clear all
        </button>

        {showNorth && setNorth ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <span style={{ color: '#cbd5e1' }}>North</span>
            {/* Slider and number field over the same value: the slider is for
                finding the bearing against the image, the field for typing a
                surveyed one. */}
            <input
              type="range"
              min={0}
              max={359}
              step={1}
              value={north ?? 0}
              onChange={(e) => setNorth(Number(e.target.value))}
              aria-label="North arrow rotation"
              style={{ width: 90 }}
            />
            <input
              type="number"
              min={0}
              max={359}
              value={north ?? 0}
              onChange={(e) => setNorth(Number(e.target.value))}
              aria-label="North arrow rotation, degrees"
              style={{
                width: 52,
                border: '1px solid rgba(255,255,255,0.2)',
                background: 'rgba(255,255,255,0.08)',
                color: '#fff',
                borderRadius: 3,
                padding: '2px 4px',
                fontSize: 11,
              }}
            />
            <span style={{ color: '#cbd5e1' }}>°</span>
          </span>
        ) : null}

        {draft ? (
          <span style={{ fontSize: 11, color: '#cbd5e1' }}>Click the image to add points.</span>
        ) : boundaries.length > 1 ? (
          <span style={{ fontSize: 11, color: '#64748b' }}>Drag a label on the figure to move it.</span>
        ) : null}
      </div>

      {boundaries.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 11, color: '#cbd5e1', paddingTop: 4 }}>Zone labels:</span>
          {boundaries.map((b, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
              {/* The swatch is the control: a zone drawn in the wrong colour is
                  recoloured here rather than deleted and drawn again. */}
              <input
                type="color"
                value={b.color}
                onChange={(e) => updateColor?.(i, e.target.value)}
                disabled={!updateColor}
                aria-label={`Zone ${i + 1} colour`}
                title="Zone colour"
                style={{
                  width: 18,
                  height: 18,
                  padding: 0,
                  marginTop: 2,
                  border: 'none',
                  background: 'transparent',
                  cursor: updateColor ? 'pointer' : 'default',
                }}
              />
              {/* textarea, not input: Enter has to insert a line break so a label
                  can carry the trend on one line and the velocity on the next. */}
              <textarea
                value={b.label}
                onChange={(e) => updateLabel(i, e.target.value)}
                rows={2}
                aria-label={`Zone ${i + 1} label`}
                style={{
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: 'rgba(255,255,255,0.08)',
                  color: '#fff',
                  borderRadius: 3,
                  padding: '2px 5px',
                  fontSize: 11,
                  width: 110,
                  resize: 'vertical',
                  fontFamily: 'inherit',
                }}
              />
              <select
                value={b.placement ?? 'inside'}
                onChange={(e) => updatePlacement(i, e.target.value)}
                aria-label={`Zone ${i + 1} label placement`}
                style={{
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: 'rgba(255,255,255,0.08)',
                  color: '#fff',
                  borderRadius: 3,
                  padding: '2px 4px',
                  fontSize: 11,
                }}
              >
                <option value="inside" style={{ color: '#111' }}>Inside</option>
                <option value="outside" style={{ color: '#111' }}>Outside</option>
              </select>
              {/* Only offered once the label has actually been dragged — a reset
                  that does nothing is a control the analyst has to think about. */}
              {resetLabelPosition && (b.offset?.dx || b.offset?.dy) ? (
                <button
                  type="button"
                  onClick={() => resetLabelPosition(i)}
                  aria-label={`Reset zone ${i + 1} label position`}
                  title="Put this label back on its zone"
                  style={zoneIconBtn}
                >
                  ⟲
                </button>
              ) : null}
              {removeBoundary ? (
                <button
                  type="button"
                  onClick={() => removeBoundary(i)}
                  aria-label={`Delete zone ${i + 1}`}
                  title="Delete this zone"
                  style={{ ...zoneIconBtn, color: '#fca5a5' }}
                >
                  ✕
                </button>
              ) : null}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default AnnotatedImage;
