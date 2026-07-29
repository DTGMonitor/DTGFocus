'use client';

/**
 * Glossary, Appendix and Disclaimer blocks.
 *
 * Reused from the Data Quality template with no logic changes — only restyled to
 * the A4 block metrics.
 *
 * Unlike RadarTemplate, the appendix is NOT chunked at two items per page: each
 * item is its own block and the paginator places it. Images are capped so a
 * single item always fits one page.
 */

import { INK, MUTED, LINE, DARK, IMAGE_MAX_H } from '../constants';
import { SectionBar } from '../pageFrame';
import { getGlossaryForRadar } from '@/config/glossaryConfig';

/**
 * Glossary terms for this radar model. `getGlossaryForRadar` parses the model
 * out of the radar number and returns only the applicable terms (falling back to
 * all of them for an unrecognised model).
 */
export function Glossary({ radarNumber }) {
  const entries = getGlossaryForRadar(radarNumber);
  if (!entries?.length) return null;

  return (
    <div>
      <SectionBar title="Glossary" />
      <div style={{ border: `1px solid ${LINE}`, borderTop: 'none', padding: '6px 10px' }}>
        {entries.map((item) => (
          <div key={item.term} style={{ marginBottom: 5 }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: INK, textTransform: 'uppercase' }}>
              {item.term}
            </div>
            <div style={{ fontSize: 8.5, color: MUTED, textAlign: 'justify' }}>{item.definition}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * One appendix entry — heading, prose, and every figure the DQP row carries.
 *
 * Figure numbers continue across the appendix rather than restarting per item,
 * so an item's images are numbered from `item.figure` (see buildAppendixItems).
 * All of an item's figures share one block: they belong to a single finding and
 * splitting them across pages would strand a caption from its evidence. The
 * per-image `IMAGE_MAX_H` cap is what keeps that block placeable — a row with
 * many large figures is the one case the paginator can overflow, which is why
 * the cap tightens as the count grows.
 */
export function AppendixItem({ item, onImageLoad, withHeader = false }) {
  const images = item.images ?? [];
  // Two figures fit a page at full height; beyond that each has to give ground.
  const maxH = images.length > 1 ? Math.floor(IMAGE_MAX_H / Math.min(images.length, 3)) : IMAGE_MAX_H;

  return (
    <div>
      {withHeader ? <SectionBar title="Appendix" /> : null}
      <div style={{ border: `1px solid ${LINE}`, borderTop: withHeader ? 'none' : undefined, padding: '6px 10px' }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: INK,
            textTransform: 'uppercase',
            borderBottom: `2px solid ${DARK}`,
            paddingBottom: 3,
            marginBottom: 4,
          }}
        >
          Appendix {item.letter}
        </div>

        {item.appendix ? (
          <p style={{ fontSize: 9, color: INK, textAlign: 'justify', whiteSpace: 'pre-wrap', margin: '0 0 5px' }}>
            {item.appendix}
          </p>
        ) : null}

        {images.map((img, i) =>
          img.imageUrl ? (
            <div
              key={img.id ?? i}
              style={{ textAlign: 'center', marginTop: i === 0 ? 0 : 6 }}
            >
              <img
                src={img.imageUrl}
                alt={`Appendix ${item.letter} figure ${item.figure + i}`}
                onLoad={onImageLoad}
                crossOrigin="anonymous"
                style={{
                  maxWidth: '100%',
                  maxHeight: maxH,
                  objectFit: 'contain',
                  border: `1px solid ${LINE}`,
                  display: 'inline-block',
                }}
              />
              <div style={{ fontSize: 8, fontStyle: 'italic', color: MUTED, marginTop: 3, textAlign: 'left' }}>
                <strong>Figure {item.figure + i}. </strong>
                {img.caption || item.name}
              </div>
            </div>
          ) : null
        )}
      </div>
    </div>
  );
}

/** The standing disclaimer — final page only. */
export function Disclaimer() {
  return (
    <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 5 }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: INK, marginBottom: 2 }}>Disclaimer</div>
      <p style={{ fontSize: 8, color: MUTED, textAlign: 'justify', margin: 0 }}>
        While DTG takes all practical steps to ensure that the services are provided with reasonable care,
        skill, and professionalism, no guarantees are given regarding the outcome, accuracy, or suitability
        of the services for any specific purpose. For the avoidance of doubt, DTG&rsquo;s role is limited to
        providing geotechnical monitoring services; DTG does not act as a consultant and does not provide
        direct advice or decision-making services for the Client. The Client acknowledges and accepts full
        responsibility for the use and interpretation of the data and services provided.
      </p>
    </div>
  );
}

export default Glossary;
