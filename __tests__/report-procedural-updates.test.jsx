/**
 * Procedural (TARP) updates section of the Comprehensive Radar Report.
 *
 * Covers the window filter (which revisions count as "within the chosen dates")
 * and the block's two states — a dated table, and the explicit "unchanged" line
 * that is the whole point of printing the section when nothing changed.
 */

import { render, screen } from '@testing-library/react';

// The hook module pulls in supabaseClient at import time; stub it so importing
// the pure filter helper does not spin up a real client.
jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));

import { filterTarpUpdatesInWindow } from '@/components/admin/Reports/useComprehensiveReportData';
import { ProceduralUpdates } from '@/components/admin/Radar/report/blocks/ProceduralUpdates';
import { buildKeyFindings } from '@/components/admin/Radar/report/blocks/KeyFindings';

const rev = (over = {}) => ({
  id: over.id ?? 1,
  seq: over.seq ?? 1,
  versionNo: over.versionNo ?? 1,
  approvalDate: over.approvalDate ?? null,
  approvedBySite: over.approvedBySite ?? null,
  siteRole: over.siteRole ?? null,
  approvedByDtg: over.approvedByDtg ?? null,
  dtgRole: over.dtgRole ?? null,
  modifiedDate: over.modifiedDate ?? null,
  sectionsModified: over.sectionsModified ?? null,
  remark: over.remark ?? null,
});

// A one-week window ending 2026-07-17, in UTC for a predictable day boundary.
const WINDOW_START = new Date('2026-07-10T05:00:00Z');
const WINDOW_END = new Date('2026-07-17T12:00:00Z');

describe('filterTarpUpdatesInWindow', () => {
  test('keeps revisions dated within the window, inclusive of both ends', () => {
    const revisions = [
      rev({ id: 1, seq: 1, modifiedDate: '2026-07-09' }), // day before → out
      rev({ id: 2, seq: 2, modifiedDate: '2026-07-10' }), // start day → in
      rev({ id: 3, seq: 3, modifiedDate: '2026-07-14' }), // middle → in
      rev({ id: 4, seq: 4, modifiedDate: '2026-07-17' }), // end day → in
      rev({ id: 5, seq: 5, modifiedDate: '2026-07-18' }), // day after → out
    ];
    const kept = filterTarpUpdatesInWindow(revisions, WINDOW_START, WINDOW_END, 'UTC');
    expect(kept.map((r) => r.id)).toEqual([4, 3, 2]); // newest first
  });

  test('falls back to the approval date when no modified date is recorded', () => {
    const revisions = [rev({ id: 7, approvalDate: '2026-07-12', modifiedDate: null })];
    expect(filterTarpUpdatesInWindow(revisions, WINDOW_START, WINDOW_END, 'UTC')).toHaveLength(1);
  });

  test('is empty for no revisions or an undated one', () => {
    expect(filterTarpUpdatesInWindow([], WINDOW_START, WINDOW_END, 'UTC')).toEqual([]);
    expect(filterTarpUpdatesInWindow([rev({ modifiedDate: null, approvalDate: null })], WINDOW_START, WINDOW_END, 'UTC')).toEqual([]);
  });
});

describe('ProceduralUpdates block', () => {
  test('lists a dated update with its version, sections and approvers', () => {
    render(
      <ProceduralUpdates
        tarp={{
          hasDocument: true,
          version: 5,
          updates: [
            rev({
              versionNo: 5,
              modifiedDate: '2026-07-14',
              sectionsModified: 'Trigger 3',
              remark: 'Raised the velocity threshold.',
              approvedBySite: 'Jane Roe',
              siteRole: 'SSE',
              approvedByDtg: 'John Doe',
              dtgRole: 'Geotechnical Engineer',
            }),
          ],
        }}
      />
    );
    expect(screen.getByText('14/07/2026')).toBeInTheDocument();
    expect(screen.getByText('Trigger 3')).toBeInTheDocument();
    expect(screen.getByText('Raised the velocity threshold.')).toBeInTheDocument();
    expect(screen.getByText('Site: Jane Roe (SSE)')).toBeInTheDocument();
    expect(screen.getByText('DTG: John Doe (Geotechnical Engineer)')).toBeInTheDocument();
    expect(screen.getByText('1 update')).toBeInTheDocument();
  });

  test('renders nothing when nothing changed this period', () => {
    const { container } = render(
      <ProceduralUpdates tarp={{ hasDocument: true, version: 5, updates: [] }} />
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Procedural Updates (TARP)')).not.toBeInTheDocument();
  });

  test('renders nothing when the site has no TARP document at all', () => {
    const { container } = render(
      <ProceduralUpdates tarp={{ hasDocument: false, version: null, updates: [] }} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('Key Findings — procedural update summary point', () => {
  test('adds a bullet with the latest summary of changes when the plan changed', () => {
    const findings = buildKeyFindings({
      risk: 'TARP 1',
      tarp: {
        updates: [
          rev({ versionNo: 6, modifiedDate: '2026-07-15', remark: 'Added a night-shift response.' }),
          rev({ versionNo: 5, modifiedDate: '2026-07-11', remark: 'Older change.' }),
        ],
      },
    });
    const point = findings.find((f) => /Trigger Action Response Plan updated/.test(f.text));
    expect(point).toBeTruthy();
    expect(point.text).toBe('Trigger Action Response Plan updated 2 times this period.');
    expect(point.detail).toBe('Latest (v6, 15/07/2026): Added a night-shift response.');
  });

  test('contributes no bullet when the plan did not change', () => {
    const findings = buildKeyFindings({ risk: 'TARP 1', tarp: { updates: [] } });
    expect(findings.some((f) => /Trigger Action Response Plan updated/.test(f.text))).toBe(false);
  });
});
