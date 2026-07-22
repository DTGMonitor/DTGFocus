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
import { centroid, outsideLabelAnchor, PLACEMENT_OUTSIDE } from './useImageAnnotation';

/**
 * Where one zone's label sits, and the leader line it needs to get there.
 *
 * Inside labels sit on the centroid and need no leader. Outside labels are
 * pushed clear of the polygon and are tied back to it by a line — without one an
 * offset label is just a caption floating on the image with nothing saying which
 * zone it belongs to.
 */
function labelAnchor(b) {
  if (b.placement !== PLACEMENT_OUTSIDE) return { at: centroid(b.points), leader: null };
  const { from, to } = outsideLabelAnchor(b.points);
  return { at: to, leader: { from, to } };
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
}) {
  return (
    <div
      onDragOver={interactive ? (e) => e.preventDefault() : undefined}
      onDrop={interactive ? onDrop : undefined}
      onPaste={interactive ? onPaste : undefined}
      // Focusable so a click on the drop zone puts Ctrl+V here explicitly. Not
      // the only path — the hook's document listener covers the untouched case.
      tabIndex={interactive ? 0 : undefined}
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
              const { leader } = labelAnchor(b);
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
            const { at } = labelAnchor(b);
            return (
              <span
                key={i}
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
                  pointerEvents: 'none',
                }}
              >
                {b.label}
              </span>
            );
          })}
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
 */
export function AnnotationToolbar({ annotation, label = 'Deformation image' }) {
  const {
    image, boundaries, draft, color, setColor, readImageFile,
    startDraft, undoPoint, finishDraft, clearBoundaries, updateLabel, updatePlacement,
  } = annotation;

  return (
    <div style={{ background: '#111418', color: '#fff', padding: '8px 12px', borderRadius: 6, marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 12 }}>{label}</strong>

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
        <button type="button" onClick={clearBoundaries} disabled={!boundaries.length} style={btn}>Clear</button>

        {draft ? (
          <span style={{ fontSize: 11, color: '#cbd5e1' }}>Click the image to add points.</span>
        ) : null}
      </div>

      {boundaries.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 11, color: '#cbd5e1', paddingTop: 4 }}>Zone labels:</span>
          {boundaries.map((b, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
              <span
                style={{ width: 9, height: 9, background: b.color, borderRadius: 2, display: 'inline-block', marginTop: 5 }}
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
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default AnnotatedImage;
