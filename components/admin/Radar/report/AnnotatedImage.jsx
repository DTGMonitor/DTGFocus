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
import { centroid } from './useImageAnnotation';

/**
 * @param {string|null} image        Data URL.
 * @param {object[]} boundaries      [{ points, color, label }]
 * @param {object|null} draft        In-progress polygon.
 * @param {boolean} interactive      false for the measurement/export render.
 * @param {object} imageRef          Ref on the <img>, for click → percent maths.
 * @param {Function} onImageLoad     Pass bumpMeasure so pagination re-runs.
 * @param {number} maxHeight
 */
export function AnnotatedImage({
  image,
  boundaries = [],
  draft = null,
  interactive = false,
  imageRef,
  onDrop,
  onImageClick,
  onImageLoad,
  maxHeight = IMAGE_MAX_H,
  emptyHint = 'Drag & drop an image here, or use “Upload image”.',
}) {
  return (
    <div
      onDragOver={interactive ? (e) => e.preventDefault() : undefined}
      onDrop={interactive ? onDrop : undefined}
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
            const c = centroid(b.points);
            return (
              <span
                key={i}
                style={{
                  position: 'absolute',
                  left: `${c.x}%`,
                  top: `${c.y}%`,
                  transform: 'translate(-50%, -50%)',
                  background: b.color,
                  color: '#fff',
                  fontSize: 9,
                  fontWeight: 700,
                  padding: '1px 5px',
                  borderRadius: 3,
                  whiteSpace: 'nowrap',
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
  const { image, boundaries, draft, color, setColor, readImageFile, startDraft, undoPoint, finishDraft, clearBoundaries, updateLabel } = annotation;

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
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#cbd5e1' }}>Zone labels:</span>
          {boundaries.map((b, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 9, height: 9, background: b.color, borderRadius: 2, display: 'inline-block' }} />
              <input
                value={b.label}
                onChange={(e) => updateLabel(i, e.target.value)}
                aria-label={`Zone ${i + 1} label`}
                style={{
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: 'rgba(255,255,255,0.08)',
                  color: '#fff',
                  borderRadius: 3,
                  padding: '2px 5px',
                  fontSize: 11,
                  width: 90,
                }}
              />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default AnnotatedImage;
