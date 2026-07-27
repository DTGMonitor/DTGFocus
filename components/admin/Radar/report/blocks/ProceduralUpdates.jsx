'use client';

/**
 * Procedural (TARP) updates within the report window.
 *
 * The TARP is a controlled safety document; this section is a dated list of the
 * revisions that took effect inside the window, each with its summary of changes.
 * It renders ONLY when something actually changed this period — a report on an
 * unchanged plan omits the section entirely rather than carrying a "no changes"
 * line (the template gates it, and this returns null defensively).
 *
 * The rows come pre-filtered and newest-first from filterTarpUpdatesInWindow;
 * this block only formats them. A revision's fields mirror the TARP tab's
 * Document Control table (see TarpTab) so the printed history and the live one
 * cannot disagree.
 */

import { INK, MUTED, LINE, ZEBRA, DARK } from '../constants';
import { SectionBar } from '../pageFrame';

/** 'YYYY-MM-DD' → 'DD/MM/YYYY', reformatted by parts so no timezone can shift it. */
const fmtDay = (value) => {
  if (!value) return '—';
  const m = String(value).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(value);
};

/** "Name (Role)", either half optional, "—" when both are absent. */
const namedRole = (name, role) => {
  const n = (name || '').trim();
  const r = (role || '').trim();
  if (n && r) return `${n} (${r})`;
  return n || r || '—';
};

const th = {
  fontSize: 8,
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: '#fff',
  background: DARK,
  padding: '4px 6px',
  textAlign: 'left',
  verticalAlign: 'top',
};

const td = {
  fontSize: 9,
  color: INK,
  padding: '4px 6px',
  verticalAlign: 'top',
  borderBottom: `1px solid ${LINE}`,
};

/**
 * @param {object} tarp  data.tarp — { heading, version, hasDocument, updates }.
 * @param {boolean} withHeader  Render the section bar (kept for parity with the
 *   other blocks; the template always passes true).
 */
export function ProceduralUpdates({ tarp, withHeader = true }) {
  const updates = tarp?.updates ?? [];
  const count = updates.length;
  // Nothing changed this period → no section at all. The template already gates
  // this; the guard keeps the block honest if it is ever rendered directly.
  if (count === 0) return null;

  return (
    <div>
      {withHeader ? (
        <SectionBar
          title="Procedural Updates (TARP)"
          right={
            <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.06em' }}>
              {`${count} update${count > 1 ? 's' : ''}`}
            </span>
          }
        />
      ) : null}

      <div style={{ border: `1px solid ${LINE}`, borderTop: withHeader ? 'none' : `1px solid ${LINE}` }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th style={{ ...th, width: '9%' }}>Ver.</th>
              <th style={{ ...th, width: '13%' }}>Date</th>
              <th style={{ ...th, width: '22%' }}>Sections Modified</th>
              <th style={{ ...th, width: '34%' }}>Summary of Changes</th>
              <th style={{ ...th, width: '22%' }}>Approved / Modified by</th>
            </tr>
          </thead>
          <tbody>
            {updates.map((r, i) => (
              <tr key={r.id ?? r.seq ?? i} style={{ background: i % 2 ? ZEBRA : '#fff' }}>
                <td style={{ ...td, fontWeight: 700 }}>{r.versionNo ?? '—'}</td>
                <td style={td}>{fmtDay(r.modifiedDate || r.approvalDate)}</td>
                <td style={{ ...td, wordBreak: 'break-word' }}>{r.sectionsModified || '—'}</td>
                <td style={{ ...td, color: MUTED, wordBreak: 'break-word' }}>{r.remark || '—'}</td>
                <td style={{ ...td, wordBreak: 'break-word' }}>
                  <div>Site: {namedRole(r.approvedBySite, r.siteRole)}</div>
                  <div style={{ color: MUTED }}>DTG: {namedRole(r.approvedByDtg, r.dtgRole)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default ProceduralUpdates;
