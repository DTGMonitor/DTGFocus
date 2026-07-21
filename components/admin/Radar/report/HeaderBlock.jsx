'use client';

/**
 * Shared report header — logo + title + inline metadata grid (pipe dividers).
 *
 * Generalised from PostBlastReportModal's header block. Rendered as block index
 * 0, so it appears on page 1 only; the footer is the per-page element.
 *
 * `metaItems` drives the pipe-separated row, so adding or removing a field is a
 * caller-side change (Post-Blast adds `Blast ID`; the Comprehensive report does
 * not).
 */

import { NAVY, MUTED, INK, LINE, FALLBACK_LOGO } from './constants';

/**
 * @param {string} title      Rendered uppercase, followed by `titleSuffix`.
 * @param {string} titleSuffix  Appended to the title (default " REPORT"); pass
 *                              "" for titles that already read as a full name.
 * @param {string} company
 * @param {string} siteName
 * @param {{label: string, value: string}[]} metaItems
 * @param {string} logoSrc    URL or data URL. Data URL for export paths.
 * @param {Function} onImageLoad  Pass the pagination hook's `bumpMeasure`, so
 *                                the page re-packs once the logo's real height
 *                                lands. Easy to forget; the header silently
 *                                mis-measures without it.
 */
export function HeaderBlock({
  title,
  titleSuffix = ' REPORT',
  company,
  siteName,
  metaItems = [],
  logoSrc = FALLBACK_LOGO,
  onImageLoad,
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <img
          src={logoSrc}
          alt="Company"
          style={{ height: 46, maxWidth: 140, objectFit: 'contain' }}
          crossOrigin="anonymous"
          onLoad={onImageLoad}
        />
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: NAVY, letterSpacing: '0.01em' }}>
            {String(title || '').toUpperCase()}{titleSuffix}
          </h1>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: MUTED, fontWeight: 600 }}>
            {company || '—'} – {siteName || '—'}
          </p>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 0, marginTop: 12, fontSize: 12 }}>
        {metaItems.map((it, i) => (
          <div key={it.label} style={{ display: 'flex', alignItems: 'center' }}>
            {i > 0 && <span style={{ color: LINE, margin: '0 12px' }}>|</span>}
            <span style={{ color: MUTED, marginRight: 5 }}>{it.label}:</span>
            <span style={{ color: INK, fontWeight: 700 }}>{it.value}</span>
          </div>
        ))}
      </div>
      <div style={{ height: 2, background: '#000', marginTop: 12 }} />
    </div>
  );
}

export default HeaderBlock;
