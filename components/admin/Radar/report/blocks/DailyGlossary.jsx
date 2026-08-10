'use client';

/**
 * Daily Radar Report — the glossary page and the per-page footer.
 *
 * The glossary is printed as one block PER LETTER GROUP rather than as a single
 * section: the full set is comfortably taller than an A4 page, and the
 * paginator never splits a block, so one block would overflow its sheet and lose
 * everything past the fold. Grouping also matches the printed report, which
 * runs a lettered header strip above each group.
 */

import { INK, MUTED, LINE, DARK } from '../constants';
import { SectionBar, FooterLogo } from '../pageFrame';
import { PATTERN_SHAPE_PATH } from '@/config/dailyGlossary';

const th = {
  background: '#7a8f93',
  color: '#fff',
  fontSize: 8,
  fontWeight: 700,
  textAlign: 'left',
  padding: '3px 6px',
  border: `1px solid ${LINE}`,
};

const td = {
  fontSize: 8,
  color: INK,
  padding: '4px 6px',
  border: `1px solid ${LINE}`,
  verticalAlign: 'top',
  textAlign: 'justify',
  whiteSpace: 'pre-line',
};

/**
 * The little cumulative-deformation sketch beside a movement pattern.
 *
 * Inline SVG with literal colours, for the same reason every other mark in
 * these reports is: html2canvas cannot fetch an asset mid-capture and does not
 * resolve CSS custom properties.
 */
function PatternSketch({ shape }) {
  const d = PATTERN_SHAPE_PATH[shape];
  if (!d) return null;
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" style={{ flexShrink: 0 }} xmlns="http://www.w3.org/2000/svg">
      {/* The axis pair, so the curve reads as a graph and not as an arrow. */}
      <path d="M4 2 L4 20 L22 20" fill="none" stroke="#9ca3af" strokeWidth="1.2" />
      <path d={d} fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** The introductory paragraph. Its own block, so it never orphans a group. */
export function DailyGlossaryIntro({ strings }) {
  return (
    <div>
      <SectionBar title={strings.glossaryHeading} />
      <div style={{ border: `1px solid ${LINE}`, borderTop: 'none', padding: '6px 10px' }}>
        <p style={{ margin: 0, fontSize: 8, color: MUTED, textAlign: 'justify' }}>
          {strings.glossaryIntro}
        </p>
      </div>
    </div>
  );
}

/** One lettered group of terms. */
export function DailyGlossaryGroup({ strings, group }) {
  return (
    <div>
      <div
        style={{
          background: DARK,
          color: '#fff',
          fontSize: 9,
          fontWeight: 800,
          textAlign: 'center',
          padding: '2px 4px',
          letterSpacing: '0.08em',
        }}
      >
        {group.letter}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <th style={{ ...th, width: '22%' }}>{strings.glossaryTerm}</th>
            <th style={{ ...th, width: '40%' }}>{strings.glossaryDefinition}</th>
            <th style={{ ...th, width: '38%' }}>{strings.glossaryContext}</th>
          </tr>
        </thead>
        <tbody>
          {group.entries.map((entry) => (
            <tr key={entry.term}>
              <td style={{ ...td, fontWeight: 700 }}>{entry.term}</td>
              <td style={td}>{entry.definition}</td>
              <td style={td}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                  <span style={{ flex: 1, minWidth: 0 }}>{entry.context}</span>
                  <PatternSketch shape={entry.shape} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

/**
 * The daily report's per-page footer: who prepared it, the DTG Focus mark, and
 * the standing disclaimer.
 *
 * Replaces the shared frame's strip (see PageSheet's `renderFooter`), so it is
 * TALLER than FOOTER_RESERVE — the template must pass a matching `usableHeight`
 * to `useReportPagination` or the paginator will pack blocks into space this
 * covers.
 *
 * `FooterLogo` is reused rather than redrawn: it is already the flat-fill,
 * gradient-free DTG Focus mark that survives html2canvas, TM included.
 */
export function DailyFooter({ strings, preparedBy, pageNum, total }) {
  return (
    <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 5 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 8, color: MUTED, fontWeight: 700 }}>{strings.preparedBy}</div>
          <div style={{ fontSize: 10, color: INK, fontWeight: 800 }}>{preparedBy || '—'}</div>
          <div style={{ fontSize: 8, color: MUTED, fontStyle: 'italic' }}>{strings.preparedByRole}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 8, color: MUTED }}>
            {pageNum} / {total}
          </span>
          <FooterLogo />
        </div>
      </div>
      <p style={{ margin: '4px 0 0', fontSize: 6.5, color: MUTED, textAlign: 'justify', fontStyle: 'italic' }}>
        {strings.disclaimer}
      </p>
    </div>
  );
}

export default DailyGlossaryGroup;
