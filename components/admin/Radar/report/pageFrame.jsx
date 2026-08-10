'use client';

/**
 * Shared A4 page frame — sheet, footer, section bar.
 *
 * Extracted verbatim from PostBlastReportModal so the Post-Blast and
 * Comprehensive radar reports share one implementation.
 *
 * Three html2canvas/print workarounds are load-bearing here. Removing any of
 * them silently corrupts the exported PDF:
 *
 *   1. Block spacing uses `marginBottom`, never flex `gap` — html2canvas 1.x
 *      ignores flex gap, so the preview and the PDF would disagree.
 *   2. `lineHeight` is explicit — the default `normal` places text low in a tall
 *      line box, which shows up as a baseline shift in the raster.
 *   3. The `.pbr-page` class name is relied on by the export paths to find and
 *      capture each page, and by the print stylesheet to force page breaks.
 */

import { PAGE_W, PAGE_H, PAD_X, PAD_TOP, BLOCK_GAP, INK, MUTED, LINE, DARK } from './constants';

/**
 * Dark uppercase band that introduces a section.
 *
 * `right` is an optional node parked at the far end of the bar — a severity key,
 * a window label. It lives here rather than in the section body because the bar
 * is dead space that every section already pays for, so a legend placed in it
 * costs no page height. Callers passing only `title` render exactly as before.
 */
export function SectionBar({ title, right }) {
  return (
    <div
      style={{
        background: DARK,
        color: '#fff',
        padding: '6px 12px',
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}
    >
      <span>{title}</span>
      {right ?? null}
    </div>
  );
}

/**
 * Grey, background-free DTG Focus mark for the footer.
 *
 * Geometry and wordmark weights mirror components/Reusable/FocusLogo — keep the
 * two in step if the brand mark changes. This cannot import FocusLogo directly:
 * that component paints itself with `var(--dtg-focus-gradient-*)` through a
 * `background-clip: text` gradient, and html2canvas 1.x resolves neither, so the
 * export would drop the mark entirely. Hence the duplicated paths and the flat
 * inline `MUTED` fill in place of the gradient.
 */
export function FooterLogo() {
  const c = MUTED;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <svg width="25" height="24" viewBox="0 0 152 145" fill="none" xmlns="http://www.w3.org/2000/svg">
        <line x1="77" y1="65" x2="77" y2="75" stroke={c} strokeWidth="6" strokeLinecap="round" />
        <line x1="49.5" y1="80" x2="62" y2="85" stroke={c} strokeWidth="6" strokeLinecap="round" />
        <line x1="104.5" y1="80" x2="91" y2="85" stroke={c} strokeWidth="6" strokeLinecap="round" />
        <path d="M 77 10 L 99 22 L 99 52 L 77 65 L 55 52 L 55 22 Z" stroke={c} strokeWidth="6" strokeLinejoin="round" />
        <path d="M 27.5 50 L 49.5 62 L 49.5 92 L 27.5 105 L 5.5 92 L 5.5 62 Z" stroke={c} strokeWidth="6" strokeLinejoin="round" />
        <path d="M 126.5 50 L 148.5 62 L 148.5 92 L 126.5 105 L 104.5 92 L 104.5 62 Z" stroke={c} strokeWidth="6" strokeLinejoin="round" />
        <path d="M 77 75 L 91 84 L 91 103 L 77 112 L 63 103 L 63 84 Z" fill={c} stroke={c} strokeWidth="6" strokeLinejoin="round" />
      </svg>
      {/* The TM rides at the cap height of "Focus", not on the baseline — at the
          baseline it reads as a third word. `lineHeight` is explicit because the
          page frame's 1.25 would otherwise drop it low in a tall line box. */}
      <span style={{ display: 'flex', alignItems: 'flex-start', gap: 3, color: c, lineHeight: 1 }}>
        <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: '-0.02em' }}>DTG</span>
        <span style={{ display: 'flex', alignItems: 'flex-start' }}>
          <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: '-0.02em' }}>Focus</span>
          <span style={{ fontWeight: 700, fontSize: 4.6, marginLeft: 1, marginTop: 1.3, opacity: 0.8 }}>TM</span>
        </span>
      </span>
    </div>
  );
}

/**
 * A single A4 page sheet. `flexShrink: 0` keeps it at full height inside the
 * preview's flex column (otherwise flexbox squishes it and the footer rides up).
 *
 * A block may declare `joinPrev` to sit flush against the one above it (the
 * deformation timeline continuing the deformation figure's frame). That drops
 * BLOCK_GAP so the two borders actually meet; the block itself drops its top
 * border. Only the block's own author knows whether it is truly adjacent — see
 * ComprehensiveRadarTemplate, which resolves it from the packed pages.
 *
 * `renderFooter` replaces the standard DTG Focus / page-number strip. A report
 * whose footer carries more than that (the daily report signs each page and
 * repeats the disclaimer) supplies its own — and MUST also tell its paginator
 * how much taller it is, via useReportPagination's `usableHeight`, or the
 * blocks will be packed into space the footer covers.
 */
export function PageSheet({ blocks, idxs, pageNum, total, renderFooter }) {
  return (
    <div
      className="pbr-page"
      style={{
        position: 'relative',
        flexShrink: 0,
        width: PAGE_W,
        height: PAGE_H,
        background: '#fff',
        color: INK,
        boxShadow: '0 0 0 1px rgba(0,0,0,0.12), 0 8px 30px rgba(0,0,0,0.35)',
        fontFamily: 'Arial, Helvetica, sans-serif',
        lineHeight: 1.25,
        padding: `${PAD_TOP}px ${PAD_X}px`,
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      <div>
        {idxs.map((bi, j) => {
          const nextJoins = j < idxs.length - 1 && blocks[idxs[j + 1]]?.props?.joinPrev;
          return (
            <div key={bi} style={{ marginBottom: j < idxs.length - 1 && !nextJoins ? BLOCK_GAP : 0 }}>
              {blocks[bi]}
            </div>
          );
        })}
      </div>

      {/* Footer (per page) */}
      <div
        style={{
          position: 'absolute',
          left: PAD_X,
          right: PAD_X,
          bottom: 14,
        }}
      >
        {renderFooter ? (
          renderFooter({ pageNum, total })
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderTop: `1px solid ${LINE}`,
              paddingTop: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <FooterLogo />
              <span style={{ fontSize: 10, color: MUTED }}>
                Advanced Geotechnical Data Analytics. Powered by DTG Focus
              </span>
            </div>
            <span style={{ fontSize: 10, color: MUTED }}>
              Page {pageNum} of {total}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/** The stacked A4 page sheets for the on-screen preview. */
export function ReportPages({ blocks, pages, renderFooter }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
      {pages.map((idxs, pageIdx) => (
        <PageSheet
          key={pageIdx}
          blocks={blocks}
          idxs={idxs}
          pageNum={pageIdx + 1}
          total={pages.length}
          renderFooter={renderFooter}
        />
      ))}
    </div>
  );
}
