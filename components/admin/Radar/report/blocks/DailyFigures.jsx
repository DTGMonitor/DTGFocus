'use client';

/**
 * Daily Radar Report — the deformation figures.
 *
 * Two shapes, one implementation underneath. The Scan Area figure is the whole
 * radar view on page 1; an Area Analysis figure is a zoomed view followed by the
 * curves taken from it. Both wrap the shared `AnnotatedImage`, so the analyst
 * draws labelled boundaries on them exactly as in the Post-Blast and
 * Comprehensive reports — and both carry a rotatable compass, which the other
 * two reports do not (see NorthArrow for why the bearing cannot be derived).
 *
 * Each figure and each graph is its own paginatable block. The alternative —
 * one block per analysis area, image and graphs together — cannot be placed at
 * all once an area carries three graphs, because the group is taller than an A4
 * page and the paginator never splits a block.
 */

import { MUTED, LINE, IMAGE_MAX_H } from '../constants';
import { SectionBar } from '../pageFrame';
import { AnnotatedImage } from '../AnnotatedImage';

/** Caption strip under a figure. */
function Caption({ children }) {
  return (
    <div style={{ fontSize: 8, fontStyle: 'italic', color: MUTED, marginTop: 3, textAlign: 'left' }}>
      {children}
    </div>
  );
}

/**
 * The page-1 scan-area figure.
 *
 * @param {object} annotation  A useImageAnnotation() bundle, owned by the caller
 *   so the uploaded image and drawn zones survive into the export render.
 * @param {boolean} interactive  false for the measurement and export renders.
 * @param {object} imageRef    Ref for the annotated <img>, for click → % maths.
 * @param {number} maxHeight   Capped below IMAGE_MAX_H by the caller when the
 *   figure has to share page 1 with the summary and the movement table.
 */
export function DailyScanArea({
  strings,
  annotation,
  interactive = false,
  // See DeformationImage: whether the empty box is DRAWN is a question about
  // geometry, and geometry may not depend on `interactive` — the hidden
  // measurement pass is non-interactive and has to measure what the analyst is
  // looking at. The caller passes the same value to both passes (`hasScanImage`).
  placeholder = interactive,
  imageRef,
  onImageLoad,
  maxHeight = IMAGE_MAX_H,
}) {
  if (!annotation?.image && !placeholder) return null;

  return (
    <div>
      <SectionBar title={strings.scanAreaHeading} />
      <div style={{ border: `1px solid ${LINE}`, borderTop: 'none', padding: 5 }}>
        <AnnotatedImage
          image={annotation?.image}
          boundaries={annotation?.boundaries}
          draft={annotation?.draft}
          interactive={interactive}
          imageRef={imageRef}
          onDrop={annotation?.handleDrop}
          onPaste={annotation?.handlePaste}
          onImageClick={(e) => annotation?.addPoint(e, imageRef?.current)}
          onImageLoad={onImageLoad}
          onLabelMove={annotation?.moveLabel}
          maxHeight={maxHeight}
          northRotation={annotation?.north ?? 0}
          northLetter={strings.northLetter}
          emptyHint="Drag, drop or paste (Ctrl+V) the scan area image here, or use “Upload image”."
        />
        {annotation?.image ? <Caption>{strings.scanAreaFigure}</Caption> : null}
      </div>
    </div>
  );
}

/**
 * One Area Analysis image.
 *
 * `withHeader` puts the section bar on the first figure only, so several
 * analysis areas read as one section rather than as a heading repeated per
 * image. `areaName` is the analyst's label for the area — it also names every
 * graph caption beneath it.
 *
 * @param {object} api  A figure adapter from useDailyFigures().figureApis.
 */
export function DailyAnalysisImage({
  strings,
  api,
  areaName,
  interactive = false,
  // As DailyScanArea. The caller passes its `includeFigure(i)` decision, which
  // is already computed outside buildBlocks precisely so the two passes agree.
  placeholder = interactive,
  imageRef,
  onImageLoad,
  withHeader = false,
  maxHeight = IMAGE_MAX_H,
}) {
  if (!api?.image && !placeholder) return null;

  return (
    <div>
      {withHeader ? <SectionBar title={strings.analysisHeading} /> : null}
      <div style={{ border: `1px solid ${LINE}`, borderTop: withHeader ? 'none' : undefined, padding: 5 }}>
        {areaName ? (
          <div
            style={{
              fontSize: 9,
              fontWeight: 800,
              color: '#1f2937',
              textTransform: 'uppercase',
              letterSpacing: '0.03em',
              marginBottom: 4,
            }}
          >
            {areaName}
          </div>
        ) : null}
        <AnnotatedImage
          image={api?.image}
          boundaries={api?.boundaries}
          draft={api?.draft}
          interactive={interactive}
          imageRef={imageRef}
          onDrop={api?.handleDrop}
          onPaste={api?.handlePaste}
          onImageClick={(e) => api?.addPoint(e, imageRef?.current)}
          onImageLoad={onImageLoad}
          onLabelMove={api?.moveLabel}
          maxHeight={maxHeight}
          northRotation={api?.north ?? 0}
          northLetter={strings.northLetter}
          emptyHint="Drag, drop or paste (Ctrl+V) the analysis image here, or use “Upload image”."
        />
      </div>
    </div>
  );
}

/**
 * One deformation graph, captioned by the area it belongs to.
 *
 * `joinPrev` lets a graph sit flush under the image or graph above it when the
 * paginator kept them together — the page frame closes the gap to match, so the
 * run reads as one framed section instead of a stack of separately boxed
 * images. The caller resolves it from the packed pages; it must not be assumed.
 */
export function DailyAnalysisGraph({ strings, graph, areaName, onImageLoad, joinPrev = false, maxHeight = 280 }) {
  if (!graph?.image) return null;

  return (
    <div>
      <div
        style={{
          borderLeft: `1px solid ${LINE}`,
          borderRight: `1px solid ${LINE}`,
          borderBottom: `1px solid ${LINE}`,
          borderTop: joinPrev ? 'none' : `1px solid ${LINE}`,
          padding: 5,
        }}
      >
        <div
          style={{
            background: '#e8eef0',
            color: '#1f2937',
            fontSize: 8,
            fontWeight: 700,
            textAlign: 'center',
            padding: '3px 4px',
            marginBottom: 4,
          }}
        >
          {strings.analysisGraphCaption(areaName)}
        </div>
        <div style={{ textAlign: 'center' }}>
          <img
            src={graph.image}
            alt={strings.analysisGraphCaption(areaName)}
            onLoad={onImageLoad}
            crossOrigin="anonymous"
            style={{
              maxWidth: '100%',
              maxHeight,
              objectFit: 'contain',
              display: 'inline-block',
              border: `1px solid ${LINE}`,
            }}
          />
        </div>
        {graph.caption ? <Caption>{graph.caption}</Caption> : null}
      </div>
    </div>
  );
}

export default DailyScanArea;
