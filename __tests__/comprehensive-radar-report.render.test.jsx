/**
 * Render tests for the Comprehensive Radar Report template.
 *
 * jsdom performs no layout, so getBoundingClientRect() is all zeroes and every
 * block "fits" one page. That makes real pagination untestable here — these
 * tests cover composition, the header/footer contract, and the values that reach
 * the page. Page-count fidelity is verified in the browser (tasks.md task 9).
 */

import { StrictMode } from 'react';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';

import { ComprehensiveRadarTemplate } from '@/components/admin/Reports/ComprehensiveRadarTemplate';
import { DeformationTimeline } from '@/components/admin/Radar/report/blocks/DeformationTimeline';
import { useImageAnnotation } from '@/components/admin/Radar/report/useImageAnnotation';
import { computeAvailability } from '@/utils/reportAvailability';
import { aggregateAlarmCauses, countValidTotal } from '@/utils/reportAlarms';
import { buildRadarRecord } from '@/utils/buildRadarRecord';
import { trimChain, isTrimmedHeadTrueRoot } from '@/utils/reportTimeline';

// The template signs appendix images through Supabase storage; stub it out.
jest.mock('@/lib/supabaseClient', () => ({
  supabase: {
    storage: {
      from: () => ({
        createSignedUrl: jest.fn().mockResolvedValue({ data: null, error: null }),
      }),
    },
  },
}));

// recharts needs a non-zero parent box; we pass fixed width/height, but its
// internals still probe the DOM. Keep the real component — a blank chart here
// would be a false negative, since jsdom can't lay out SVG anyway.
const NOW = new Date('2026-07-17T12:00:00Z').getTime();
const HOUR_MS = 3600 * 1000;
const at = (hoursAgo) => new Date(NOW - hoursAgo * HOUR_MS).toISOString();

const paramRow = (id, name, level, parent_id, value, notes = '') => ({
  value,
  notes,
  appendix: null,
  caption: null,
  image: null,
  parameters: { id, name, level, parent_id },
});

const dqpRows = [
  paramRow(1, 'Overall', 0, null, 'Sub-Optimal'),
  paramRow(10, 'Scan Area', 1, null, 'Sub-Optimal'),
  paramRow(11, 'Vector Loss', 2, 10, 'Sub-Optimal', 'Vector loss in some areas of concern is around 50%.'),
  paramRow(12, 'Coherence', 2, 10, 'Optimal'),
  paramRow(20, 'Masks', 1, null, 'Optimal'),
  paramRow(21, 'Sky Mask', 2, 20, 'Optimal'),
];

const chain = [
  { id: 'A', def_type: 'Blast Event', tarp_level: 'TARP 2', location: 'WEST DOME', created_at: at(100), detected_by: 'u1' },
  { id: 'B', def_type: 'Linear', tarp_level: 'TARP 3', location: 'WEST DOME', created_at: at(80), detected_by: 'u1' },
  { id: 'C', def_type: 'Regressive', tarp_level: 'TARP 2', location: 'WEST DOME', created_at: at(10), detected_by: 'u2' },
  { id: 'D', def_type: 'Progressive', tarp_level: 'TARP 4', location: 'Area 2', created_at: at(2), detected_by: 'u2' },
];

function buildData(overrides = {}) {
  const trimmed = trimChain(chain, NOW);
  const alarms = [
    { reason: 'False', cause: 'Machinery Activity' },
    { reason: 'False', cause: 'Machinery Activity' },
    { reason: 'False', cause: 'Vegetation' },
  ];
  return {
    window: { windowStart: new Date(NOW - 24 * HOUR_MS), windowEnd: new Date(NOW) },
    risk: 'TARP 4',
    quality: { label: 'Sub-Optimal', score: 0.85 },
    availability: computeAvailability(
      [{ reason: 'Maintenance', from: at(5), to: at(4) }],
      new Date(NOW - 24 * HOUR_MS),
      new Date(NOW)
    ),
    alarms: { causes: aggregateAlarmCauses(alarms), ...countValidTotal(alarms), regions: [{ id: 1 }] },
    radarRecord: buildRadarRecord({ radar_number: 'SSR461FX', brand: 'GroundProbe' }, dqpRows),
    dqpRows,
    timelines: [{ chain, trimmed, headIsTrueRoot: isTrimmedHeadTrueRoot(chain, trimmed) }],
    timelineError: null,
    deformationImage: null,
    crosscheckers: [{ id: 'u1', full_name: 'Adib Izzuddin' }, { id: 'u2', full_name: 'Lintang Sadewa' }],
    ...overrides,
  };
}

const sensor = { radar_number: 'SSR461FX', site_name: 'Telfer Gold Mine Operations', brand: 'GroundProbe' };
const reportInfo = {
  generatedBy: 'Max Lepper',
  company: 'Greatland Gold',
  site: 'Telfer Gold Mine Operations',
};

const renderReport = (data = buildData(), props = {}) =>
  render(<ComprehensiveRadarTemplate data={data} sensor={sensor} reportInfo={reportInfo} {...props} />);

/** Minimal stand-in for a useImageAnnotation() bundle. */
const stubAnnotation = (over = {}) => ({
  image: null,
  boundaries: [],
  draft: null,
  color: '#FF1744',
  setImage: jest.fn(),
  setColor: jest.fn(),
  readImageFile: jest.fn(),
  handleDrop: jest.fn(),
  addPoint: jest.fn(),
  startDraft: jest.fn(),
  undoPoint: jest.fn(),
  finishDraft: jest.fn(),
  clearBoundaries: jest.fn(),
  updateLabel: jest.fn(),
  ...over,
});

describe('ComprehensiveRadarTemplate', () => {
  it('renders the header with title, company – site, and the Edition/Author/Sensor meta', async () => {
    renderReport();
    // Validates: Requirements 1.4, 1.7
    // Every assertion here uses *All*: each block renders twice — once on the
    // page sheet, once in the hidden measurement layer that drives pagination.
    expect((await screen.findAllByText(/DAILY RADAR REPORTING SERVICES/i)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Greatland Gold – Telfer Gold Mine Operations/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Author:').length).toBeGreaterThan(0);
    // reportInfo must actually reach the page — RadarTemplate silently drops it.
    expect(screen.getAllByText('Max Lepper').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Edition:').length).toBeGreaterThan(0);
  });

  it('renders the footer branding and page number on the sheet', async () => {
    renderReport();
    // Validates: Requirements 1.6
    expect(
      (await screen.findAllByText(/Advanced Geotechnical Data Analytics\. Powered by DTG Focus/i)).length
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/Page 1 of/i).length).toBeGreaterThan(0);
  });

  it('renders the four KPI tiles with derived values', async () => {
    renderReport();
    // Validates: Requirements 2.1, 2.2, 2.4, 2.6
    expect((await screen.findAllByText('Risk Level')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('TARP 4').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Data Quality').length).toBeGreaterThan(0);
    // The tile leads with the score and captions it with the quality label.
    expect(screen.getAllByText('85.00%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sub-Optimal').length).toBeGreaterThan(0);
    expect(screen.getAllByText('System Uptime').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Alarm Events').length).toBeGreaterThan(0);
    expect(screen.getAllByText('0/3').length).toBeGreaterThan(0); // valid/total
  });

  it('renders the trimmed timeline (B→C→D), not the full chain', async () => {
    renderReport();
    // Validates: Requirements 3.3, 3.4 — C and D are recent, B is the context node.
    expect((await screen.findAllByText('Regressive')).length).toBeGreaterThan(0); // C
    expect(screen.getAllByText('Progressive').length).toBeGreaterThan(0);         // D
    expect(screen.getAllByText('Linear').length).toBeGreaterThan(0);              // B (context)
    // A is trimmed away.
    expect(screen.queryByText('Blast Event')).not.toBeInTheDocument();
  });

  it('marks the tail Current and does NOT call the trimmed head Root', async () => {
    renderReport();
    // Validates: Requirements 3.8, 3.9 — the head here is B, not the true root A,
    // so a positional badge would wrongly label it Root.
    expect((await screen.findAllByText('Current')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Root')).not.toBeInTheDocument();
  });

  it('marks Root when the trimmed head IS the true root', async () => {
    const shortChain = [
      { id: 'C', def_type: 'Regressive', tarp_level: 'TARP 2', location: 'X', created_at: at(10), detected_by: 'u2' },
      { id: 'D', def_type: 'Progressive', tarp_level: 'TARP 4', location: 'X', created_at: at(2), detected_by: 'u2' },
    ];
    const trimmed = trimChain(shortChain, NOW);
    renderReport(buildData({
      timelines: [{ chain: shortChain, trimmed, headIsTrueRoot: isTrimmedHeadTrueRoot(shortChain, trimmed) }],
    }));
    // Validates: Requirements 3.9
    expect((await screen.findAllByText('Root')).length).toBeGreaterThan(0);
  });

  it('resolves the detecting user to a name', async () => {
    renderReport();
    // Validates: Requirements 3.10
    expect((await screen.findAllByText(/By: Lintang Sadewa/)).length).toBeGreaterThan(0);
  });

  it('details non-optimal groups and collapses the optimal ones', async () => {
    renderReport();
    // Validates: Requirements 5.2, 5.3, 5.4 — Scan Area is Sub-Optimal and keeps
    // its note; Masks is Optimal and is still listed, as one line.
    expect((await screen.findAllByText(/Vector loss in some areas of concern/)).length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Masks', { selector: 'div' }).length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Sub-parameter optimal.').length).toBeGreaterThan(0);
    // Collapsed, not enumerated: the optimal group's child is not printed.
    expect(screen.queryAllByText('Sky Mask')).toHaveLength(0);
  });

  it('renders System Performance, not "Performance Matrix"', async () => {
    renderReport();
    // Validates: Requirements 8.1, 8.2
    expect((await screen.findAllByText('System Performance')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Performance Matrix/i)).not.toBeInTheDocument();
  });

  it('labels alarm slices with count and percentage that agree', async () => {
    renderReport();
    // Validates: Requirements 7.4, 7.5 — the mockup labelled counts with "%".
    expect((await screen.findAllByText('2 (66.7%)')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('1 (33.3%)').length).toBeGreaterThan(0);
  });

  it('renders the glossary and the disclaimer', async () => {
    renderReport();
    // Validates: Requirements 9.1, 9.6
    expect((await screen.findAllByText('Glossary')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Disclaimer').length).toBeGreaterThan(0);
  });

  describe('client logo (header)', () => {
    it('uses the client logo when one is supplied', async () => {
      renderReport(buildData(), { logoSrc: '/logo/CompanyLogo/greatland.png' });
      const logos = await screen.findAllByAltText('Company');
      expect(logos.length).toBeGreaterThan(0);
      expect(logos[0]).toHaveAttribute('src', '/logo/CompanyLogo/greatland.png');
    });

    it('falls back to the DTG mark when the client has no logo', async () => {
      renderReport();
      const logos = await screen.findAllByAltText('Company');
      expect(logos[0]).toHaveAttribute('src', '/logo/DTG/DTGlogo.png');
    });
  });

  describe('deformation figure — upload and zone drawing', () => {
    it('shows the drop zone in preview when no image has been added', async () => {
      renderReport(buildData(), { annotation: stubAnnotation() });
      expect((await screen.findAllByText(/paste \(Ctrl\+V\) the deformation image here/)).length).toBeGreaterThan(0);
    });

    it('renders the uploaded image and its drawn zones', async () => {
      const annotation = stubAnnotation({
        image: 'data:image/png;base64,AAA',
        boundaries: [{ points: [{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 25, y: 40 }], color: '#FF1744', label: 'Zone A' }],
      });
      renderReport(buildData(), { annotation });
      expect((await screen.findAllByAltText('Report figure')).length).toBeGreaterThan(0);
      expect(screen.getAllByText('Zone A').length).toBeGreaterThan(0);
    });

    it('omits the figure block entirely on export when no image was added', () => {
      // Export must not print an empty dashed drop zone.
      renderReport(buildData(), { annotation: stubAnnotation(), exportMode: true });
      expect(screen.queryByText(/paste \(Ctrl\+V\) the deformation image here/)).not.toBeInTheDocument();
    });

    it('keeps the image on export, since the annotation is caller-owned', () => {
      const annotation = stubAnnotation({ image: 'data:image/png;base64,AAA' });
      renderReport(buildData(), { annotation, exportMode: true });
      // Would be blank if the template owned this state — the export mounts a
      // second copy of the tree.
      expect(screen.getAllByAltText('Report figure').length).toBeGreaterThan(0);
    });
  });

  describe('empty / degraded states', () => {
    it('renders with no deformation records', async () => {
      renderReport(buildData({ timelines: [] }));
      // Validates: Requirements 3.12
      expect((await screen.findAllByText(/No active deformation events/)).length).toBeGreaterThan(0);
    });

    it('renders with no alarms rather than dividing by zero', async () => {
      renderReport(buildData({ alarms: { causes: [], valid: 0, total: 0, regions: [] } }));
      // Validates: Requirements 7.8, 7.9 — the empty state reports the result
      // ("0 alarms raised") rather than leaving a void where a chart would be.
      expect((await screen.findAllByText(/No alarm events in the reporting window/)).length).toBeGreaterThan(0);
      expect(screen.getAllByText('ALARMS RAISED').length).toBeGreaterThan(0);
      expect(screen.getAllByText('0/0').length).toBeGreaterThan(0);
    });

    it('surfaces a partial-timeline notice', async () => {
      renderReport(buildData({ timelineError: 'Timeline may be incomplete.' }));
      // Validates: Requirements 3.11
      expect((await screen.findAllByText('Timeline may be incomplete.')).length).toBeGreaterThan(0);
    });

    it('does not throw when the overall (level-0) status is missing', async () => {
      const rows = dqpRows.filter((r) => r.parameters.level !== 0);
      // Validates: Requirements 2.10 — RadarTemplate crashes on this today.
      expect(() =>
        renderReport(buildData({
          dqpRows: rows,
          quality: { label: null, score: null },
          radarRecord: buildRadarRecord({ radar_number: 'SSR461FX', brand: 'GroundProbe' }, rows),
        }))
      ).not.toThrow();
      await waitFor(() => expect(screen.getAllByText('Data Quality').length).toBeGreaterThan(0));
    });

    it('renders when every parameter is optimal', async () => {
      const rows = [paramRow(1, 'Overall', 0, null, 'Optimal'), paramRow(20, 'Masks', 1, null, 'Optimal'), paramRow(21, 'Sky Mask', 2, 20, 'Optimal')];
      renderReport(buildData({ dqpRows: rows }));
      // Validates: Requirements 5.4 — an all-optimal report is no longer an empty
      // state; every group still prints, each collapsed to its one-line verdict.
      expect((await screen.findAllByText('Sub-parameter optimal.')).length).toBeGreaterThan(0);
    });

    it('renders an empty state only when nothing was assessed at all', async () => {
      renderReport(buildData({ dqpRows: [] }));
      // Validates: Requirements 5.7
      expect(
        (await screen.findAllByText(/No data-quality parameters were assessed/)).length
      ).toBeGreaterThan(0);
    });
  });

  describe('appendix — a row with several figures', () => {
    // Pre-resolved, as the export path supplies them: the storage stub above
    // never returns a signed URL, so resolving in-render would produce no <img>.
    const twoFigureItem = {
      letter: 'A',
      figure: 1,
      name: 'Alarm Mask',
      parameterId: 21,
      notes: 'Continuous triggered false alarms due to vegetation.',
      appendix: 'Continuous triggered false alarms due to vegetation.',
      images: [
        { id: 250, caption: 'Vegetation-affected sectors', image_url: '250.png', imageUrl: 'data:image/png;base64,AAA' },
        { id: 251, caption: 'Alarm mask recommendations', image_url: '251.png', imageUrl: 'data:image/png;base64,BBB' },
      ],
    };

    it('prints every figure the row carries, each with its own caption', async () => {
      // The regression this guards: only the LAST uploaded image used to reach
      // the row, so the appendix printed one figure where two were uploaded.
      renderReport(buildData(), { appendixItems: [twoFigureItem] });
      expect((await screen.findAllByText('Vegetation-affected sectors')).length).toBeGreaterThan(0);
      expect(screen.getAllByText('Alarm mask recommendations').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Figure 1.').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Figure 2.').length).toBeGreaterThan(0);
    });

    it('shifts every figure when the deformation image claims Figure 1', async () => {
      // The offset applies to the whole item, not just its first image —
      // otherwise two figures would both be numbered 2.
      renderReport(buildData(), {
        appendixItems: [twoFigureItem],
        annotation: stubAnnotation({ image: 'data:image/png;base64,AAA' }),
      });
      expect((await screen.findAllByText('Figure 2.')).length).toBeGreaterThan(0);
      expect(screen.getAllByText('Figure 3.').length).toBeGreaterThan(0);
    });

    it('falls back to the parameter name for an uncaptioned figure', async () => {
      renderReport(buildData(), {
        appendixItems: [{ ...twoFigureItem, images: [{ ...twoFigureItem.images[0], caption: '' }] }],
      });
      expect((await screen.findAllByText('Alarm Mask')).length).toBeGreaterThan(0);
    });
  });
});

describe('useImageAnnotation — zone drawing', () => {
  const drawTriangle = (result) => {
    act(() => result.current.startDraft());
    // getBoundingClientRect is stubbed to a 100x100 box at the origin, so the
    // client coords below land at the same numbers in percent.
    const el = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) };
    [[10, 10], [40, 10], [25, 40]].forEach(([clientX, clientY]) => {
      act(() => result.current.addPoint({ clientX, clientY }, el));
    });
  };

  // Regression: finishDraft committed the zone from INSIDE a setDraft updater.
  // React double-invokes updaters in StrictMode to surface impure ones, so the
  // nested setBoundaries ran twice and one drawn polygon became Zone A + Zone B.
  it('commits exactly one zone per drawing, under StrictMode double-invocation', () => {
    const { result } = renderHook(() => useImageAnnotation('data:image/png;base64,AAA'), {
      wrapper: StrictMode,
    });

    drawTriangle(result);
    act(() => result.current.finishDraft());

    expect(result.current.boundaries).toHaveLength(1);
    expect(result.current.boundaries[0].label).toBe('Zone A');
    expect(result.current.draft).toBeNull();
  });

  it('labels successive zones A, B, C', () => {
    const { result } = renderHook(() => useImageAnnotation('data:image/png;base64,AAA'), {
      wrapper: StrictMode,
    });

    ['Zone A', 'Zone B', 'Zone C'].forEach(() => {
      drawTriangle(result);
      act(() => result.current.finishDraft());
    });

    expect(result.current.boundaries.map((b) => b.label)).toEqual(['Zone A', 'Zone B', 'Zone C']);
  });

  it('discards a draft too small to describe an area', () => {
    const { result } = renderHook(() => useImageAnnotation('data:image/png;base64,AAA'), {
      wrapper: StrictMode,
    });

    act(() => result.current.startDraft());
    act(() => result.current.finishDraft());

    expect(result.current.boundaries).toHaveLength(0);
    expect(result.current.draft).toBeNull();
  });
});

describe('DeformationTimeline', () => {
  const NOW = new Date('2026-07-17T12:00:00Z').getTime();
  const HOUR = 60 * 60 * 1000;
  const node = (over) => ({
    id: Math.random(),
    def_type: 'Linear',
    tarp_level: 'TARP 2',
    location: 'WEST DOME',
    created_at: new Date(NOW - HOUR).toISOString(),
    detected_by: 'uuid-1',
    ...over,
  });
  const chain = (nodes) => ({ chain: nodes, trimmed: nodes, headIsTrueRoot: true });

  it('captions each chain when the report carries more than one', () => {
    // Without this two chains are just two runs of cards — the reader cannot
    // tell them from one continuous history.
    render(
      <DeformationTimeline
        timelines={[chain([node()]), chain([node({ location: 'EAST DOME' })])]}
        now={NOW}
      />
    );
    expect(screen.getByText('Chain 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('Chain 2 of 2')).toBeInTheDocument();
  });

  it('labels each wall folder and marks the archived one when the report spans more than one', () => {
    const current = { id: 2, name: 'NEW WALL', area: 'North', type: 'Live' };
    const archived = { id: 1, name: 'OLD WALL', area: 'North', type: 'Archive', decommissioned_at: new Date(NOW - 5 * HOUR).toISOString() };
    render(
      <DeformationTimeline
        timelines={[
          { ...chain([node()]), folder: current, isCurrent: true },
          { ...chain([node({ location: 'EAST DOME' })]), folder: archived, isCurrent: false },
        ]}
        now={NOW}
      />
    );
    // Both folders are labelled (grouped rendering), the retired one badged Archived.
    expect(screen.getByText(/NEW WALL/)).toBeInTheDocument();
    expect(screen.getByText(/OLD WALL/)).toBeInTheDocument();
    expect(screen.getByText('Current folder')).toBeInTheDocument();
    expect(screen.getByText(/Archived/)).toBeInTheDocument();
  });

  it('stays in the flat legacy layout for a single folder (no folder labels)', () => {
    const current = { id: 2, name: 'ONLY WALL', area: 'North', type: 'Live' };
    render(
      <DeformationTimeline
        timelines={[{ ...chain([node()]), folder: current, isCurrent: true }]}
        now={NOW}
      />
    );
    expect(screen.queryByText(/ONLY WALL/)).not.toBeInTheDocument();
    expect(screen.queryByText('Current folder')).not.toBeInTheDocument();
  });

  it('does not caption a lone chain', () => {
    render(<DeformationTimeline timelines={[chain([node()])]} now={NOW} />);
    expect(screen.queryByText(/^Chain \d+ of/)).not.toBeInTheDocument();
  });

  it('ignores empty chains rather than counting them', () => {
    render(<DeformationTimeline timelines={[chain([node()]), chain([])]} now={NOW} />);
    expect(screen.queryByText(/^Chain \d+ of/)).not.toBeInTheDocument();
  });

  it('mutes an event that is neither current nor from the last 24h', () => {
    const stale = node({ def_type: 'Regressive', created_at: new Date(NOW - 72 * HOUR).toISOString() });
    const current = node({ def_type: 'Linear' });
    render(<DeformationTimeline timelines={[chain([stale, current])]} now={NOW} />);

    // The stale node's TARP badge drops to the outlined grey treatment; the
    // current node keeps the filled severity colour.
    const badges = screen.getAllByText('TARP 2');
    expect(badges[0]).toHaveStyle({ background: '#fff' });
    expect(badges[1]).not.toHaveStyle({ background: '#fff' });
    expect(screen.getByText('Regressive')).toHaveStyle({ color: '#6b7280' });
    expect(screen.getByText('Linear')).toHaveStyle({ color: '#1f2937' });
  });

  it('does not mute a recent, non-current event', () => {
    const recent = node({ def_type: 'Regressive', created_at: new Date(NOW - 2 * HOUR).toISOString() });
    render(<DeformationTimeline timelines={[chain([recent, node()])]} now={NOW} />);
    expect(screen.getByText('Regressive')).toHaveStyle({ color: '#1f2937' });
  });

  it('mutes nothing when given no clock, rather than calling everything stale', () => {
    const ancient = node({ def_type: 'Regressive', created_at: new Date(NOW - 900 * HOUR).toISOString() });
    render(<DeformationTimeline timelines={[chain([ancient, node()])]} />);
    expect(screen.getByText('Regressive')).toHaveStyle({ color: '#1f2937' });
  });

  it('resolves detected_by to a display name', () => {
    render(
      <DeformationTimeline
        timelines={[chain([node({ detected_by: 'uuid-1' })])]}
        crosscheckers={[{ id: 'uuid-1', full_name: 'Lintang Sadewa' }]}
        now={NOW}
      />
    );
    expect(screen.getByText('By: Lintang Sadewa')).toBeInTheDocument();
    expect(screen.queryByText(/uuid-1/)).not.toBeInTheDocument();
  });

  it('never prints a raw UUID when the crosschecker lookup misses', () => {
    const uuid = '3e8390f8-d8ed-4c72-90f3-17e6fd9d2e43';
    render(<DeformationTimeline timelines={[chain([node({ detected_by: uuid })])]} crosscheckers={[]} now={NOW} />);
    expect(screen.queryByText(new RegExp(uuid))).not.toBeInTheDocument();
    expect(screen.getByText('By: Unknown')).toBeInTheDocument();
  });

  it('drops the top border only when joined to the figure above', () => {
    const box = (joinPrev) => {
      const { container, unmount } = render(
        <DeformationTimeline timelines={[chain([node()])]} joinPrev={joinPrev} now={NOW} />
      );
      const style = container.firstChild.firstChild.getAttribute('style');
      unmount();
      return style;
    };
    // Asserted as presence/absence, not as the literal 'none': jsdom's CSS
    // parser drops `border-top: none` outright, so it never reads back.
    expect(box(true)).not.toMatch(/border-top:\s*\d/);
    expect(box(false)).toMatch(/border-top:\s*1px solid/);
    // The other three edges stay closed either way.
    expect(box(true)).toMatch(/border-bottom:\s*1px solid/);
  });
});
