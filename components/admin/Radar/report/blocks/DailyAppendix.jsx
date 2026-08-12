'use client';

/**
 * Daily Radar Report — the appendix.
 *
 * Same source and same shape as the Comprehensive report's appendix
 * (GlossaryAppendix's AppendixItem): one entry per `dqp_values` row the analyst
 * wrote a note against, built by `buildAppendixItems`, so a downgrade explained
 * in the daily report's quality line has the same evidence attached to it in
 * both documents rather than two hand-maintained sets.
 *
 * It is a separate component from that one for the reason stated at the top of
 * DailyRadarTemplate: this report is written in the SITE's language, so every
 * word on the page — heading, entry label, figure prefix — comes from
 * `dailyStrings(locale)`. AppendixItem prints "Appendix A" and "Figure 2" in
 * English unconditionally.
 *
 * One block per entry, as in the Comprehensive report: the paginator places them
 * and never splits a block, so an entry's figures stay with the prose that
 * introduces them. The per-image height cap is what keeps a many-figure entry
 * placeable at all — it tightens as the count grows.
 */

import { INK, MUTED, LINE, DARK, IMAGE_MAX_H } from '../constants';
import { SectionBar } from '../pageFrame';

/**
 * One appendix entry — heading, the analyst's prose, and every figure the DQP
 * row carries.
 *
 * Figure numbers run across the whole appendix rather than restarting per entry,
 * so an entry's images are numbered from `item.figure` (see buildAppendixItems).
 *
 * @param {object} item  A buildAppendixItems() entry, images already inlined as
 *   data URLs (useAppendixImages) — html2canvas cannot fetch mid-capture.
 * @param {boolean} withHeader  Section bar on the first entry only, so several
 *   entries read as one section rather than as a heading repeated per entry.
 */
export function DailyAppendixItem({ strings, item, onImageLoad, withHeader = false }) {
  // Not filtered to the images that resolved: figure numbers are assigned from
  // the row's DECLARED order, so dropping one has to leave its number unused
  // rather than shift every figure after it.
  const images = item?.images ?? [];
  // Two figures fit a page at full height; beyond that each has to give ground.
  const maxH = images.length > 1 ? Math.floor(IMAGE_MAX_H / Math.min(images.length, 3)) : IMAGE_MAX_H;

  return (
    <div>
      {withHeader ? <SectionBar title={strings.appendixHeading} /> : null}
      <div
        style={{
          border: `1px solid ${LINE}`,
          borderTop: withHeader ? 'none' : undefined,
          padding: '6px 10px',
        }}
      >
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
          {strings.appendixLabel(item.letter)}
          {item.name ? ` — ${item.name}` : ''}
        </div>

        {item.appendix ? (
          <p style={{ fontSize: 9, color: INK, textAlign: 'justify', whiteSpace: 'pre-wrap', margin: '0 0 5px' }}>
            {item.appendix}
          </p>
        ) : null}

        {images.map((img, i) =>
          img.imageUrl ? (
            <div key={img.id ?? i} style={{ textAlign: 'center', marginTop: i === 0 ? 0 : 6 }}>
              <img
                src={img.imageUrl}
                alt={`${strings.appendixLabel(item.letter)} ${item.figure + i}`}
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
                <strong>{strings.appendixFigure(item.figure + i)} </strong>
                {img.caption || item.name}
              </div>
            </div>
          ) : null
        )}
      </div>
    </div>
  );
}

export default DailyAppendixItem;
