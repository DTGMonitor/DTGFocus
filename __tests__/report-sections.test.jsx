/**
 * Data Quality + System Performance rendering contracts.
 *
 * These cover the decisions that are easy to regress by "tidying" later — the
 * completeness of the group table, the zero-collapse, and the severity key —
 * rather than the pixels, which jsdom cannot see anyway.
 */

import { render, screen } from '@testing-library/react';

import { DataQuality } from '@/components/admin/Radar/report/blocks/DataQuality';
import { SystemPerformance } from '@/components/admin/Radar/report/blocks/SystemPerformance';
import { buildStatusGroups } from '@/utils/reportDqp';
import { computeAvailability } from '@/utils/reportAvailability';
import { SEVERITY_LEGEND, wash, severityTextColor, SEV } from '@/components/admin/Radar/report/severity';

const paramRow = (id, name, level, parent_id, value, notes = '') => ({
  value,
  notes,
  appendix: null,
  caption: null,
  image: null,
  parameters: { id, name, level, parent_id },
});

// Scan Area fails; Masks and Alarms are clean. The chart plots all three.
const dqpRows = [
  paramRow(1, 'Overall', 0, null, 'Sub-Optimal'),
  paramRow(10, 'Scan Area', 1, null, 'Sub-Optimal'),
  paramRow(11, 'Vector Loss', 2, 10, 'Sub-Optimal', 'Vector loss around 50%.'),
  paramRow(12, 'Coherence', 2, 10, 'Optimal'),
  paramRow(20, 'Masks', 1, null, 'Optimal'),
  paramRow(21, 'Sky Mask', 2, 20, 'Optimal'),
  paramRow(22, 'Ground Mask', 2, 20, 'Optimal'),
  paramRow(30, 'Alarms', 1, null, 'Optimal'),
  paramRow(31, 'Alarm Config', 2, 30, 'Optimal'),
];

const radarRecord = {
  radar: 'IBIS-FM',
  brand: 'GroundProbe',
  parameters: {
    'System Health': { value: 'Optimal' },
    'Scan Area': { value: 'Sub-Optimal' },
    Photograph: { value: 'Optimal' },
    Masks: { value: 'Optimal' },
    Alarms: { value: 'Optimal' },
    'Atmospheric Correction': { value: 'Optimal' },
    'Visual Data': { value: 'Optimal' },
    Overall: { value: 'Sub-Optimal' },
  },
};

const WINDOW_START = '2026-07-16T12:00:00Z';
const WINDOW_END = '2026-07-17T12:00:00Z';
const availability = (records) => computeAvailability(records, WINDOW_START, WINDOW_END);

describe('buildStatusGroups', () => {
  test('returns every group, not only the failing ones', () => {
    const groups = buildStatusGroups(dqpRows);
    expect(groups.map((g) => g.name)).toEqual(expect.arrayContaining(['Scan Area', 'Masks', 'Alarms']));
    expect(groups).toHaveLength(3);
  });

  test('flags optimality per group and sorts failures first', () => {
    const groups = buildStatusGroups(dqpRows);
    expect(groups[0]).toMatchObject({ name: 'Scan Area', isOptimal: false });
    expect(groups.slice(1).every((g) => g.isOptimal)).toBe(true);
  });

  test('a group is non-optimal if ANY child is, however many are clean', () => {
    // Scan Area has one failing child and one optimal one.
    const scanArea = buildStatusGroups(dqpRows).find((g) => g.name === 'Scan Area');
    expect(scanArea.items).toHaveLength(2);
    expect(scanArea.isOptimal).toBe(false);
  });

  test('ties break on id, so row order still tracks the chart axis order', () => {
    const groups = buildStatusGroups(dqpRows).filter((g) => g.isOptimal);
    expect(groups.map((g) => g.id)).toEqual([...groups.map((g) => g.id)].sort((a, b) => a - b));
  });

  test('tolerates rows with no groups at all', () => {
    expect(buildStatusGroups([])).toEqual([]);
    expect(buildStatusGroups(null)).toEqual([]);
  });
});

describe('DataQuality', () => {
  const renderBlock = (props = {}) =>
    render(
      <DataQuality radarRecord={radarRecord} groups={buildStatusGroups(dqpRows)} {...props} />
    );

  /**
   * Does `name` appear in the TABLE, as opposed to only as a chart axis label?
   *
   * Group names deliberately appear twice — the radar plots an axis per group
   * and the table lists a row per group — so a bare getByText would match the
   * SVG tick and pass even if the table row were missing, which is precisely the
   * bug these tests exist to catch. SVG elements have an ownerSVGElement; the
   * table's divs do not.
   */
  const inTable = (name) => screen.getAllByText(name).some((el) => el.ownerSVGElement == null);

  test('prints the severity key so the colours are decodable', () => {
    renderBlock();
    SEVERITY_LEGEND.forEach((tier) => {
      expect(screen.getByText(tier.label)).toBeInTheDocument();
    });
  });

  test('lists passing groups as well as failing ones', () => {
    renderBlock();
    expect(inTable('Scan Area')).toBe(true);
    expect(inTable('Masks')).toBe(true);
    expect(inTable('Alarms')).toBe(true);
  });

  test('collapses a passing group to one line instead of listing its chips', () => {
    renderBlock();
    expect(screen.getByText('All 2 sub-parameters optimal.')).toBeInTheDocument();
    // Masks' children are summarised, not enumerated.
    expect(screen.queryByText('Sky Mask')).not.toBeInTheDocument();
  });

  test('singular wording when a passing group has exactly one sub-parameter', () => {
    renderBlock();
    expect(screen.getByText('Sub-parameter optimal.')).toBeInTheDocument();
  });

  test('a failing group keeps its note and every chip, including the clean ones', () => {
    renderBlock();
    expect(screen.getByText(/Vector loss around 50%/)).toBeInTheDocument();
    // Coherence is Optimal but still printed: it is what makes the group's
    // Sub-Optimal verdict legible.
    expect(screen.getByText('Coherence')).toBeInTheDocument();
    expect(screen.getByText('Vector Loss')).toBeInTheDocument();
  });

  test('appends the appendix letter to the note that has a figure', () => {
    renderBlock({ appendixByParamId: new Map([[11, 'A']]) });
    expect(screen.getByText('(Appendix A)')).toBeInTheDocument();
  });

  test('says so when a non-optimal parameter has no analyst note', () => {
    const rows = [
      paramRow(10, 'Scan Area', 1, null, 'Sub-Optimal'),
      paramRow(11, 'Vector Loss', 2, 10, 'Sub-Optimal'), // no note
    ];
    render(<DataQuality radarRecord={radarRecord} groups={buildStatusGroups(rows)} />);
    expect(screen.getByText('No analyst note recorded.')).toBeInTheDocument();
  });

  test('counts optimal parameters in the caption', () => {
    renderBlock();
    expect(screen.getByText(/2 of 3 parameters optimal/)).toBeInTheDocument();
  });

  test('renders the severity bands behind the chart, outermost first', () => {
    const { container } = renderBlock();
    const bands = [...container.querySelectorAll('polygon')].filter((p) =>
      p.getAttribute('fill')?.startsWith('#')
    );
    expect(bands.length).toBeGreaterThanOrEqual(4);
    // Painting order matters: a washed band is opaque and covers the one beneath.
    expect(bands[0].getAttribute('fill')).toBe(wash(SEV.optimal, 0.13));
  });

  test('survives a record with no parameters rather than rendering a blank chart', () => {
    render(<DataQuality radarRecord={{ parameters: {} }} groups={[]} />);
    expect(screen.getByText('Assessment unavailable.')).toBeInTheDocument();
    expect(screen.getByText(/No data-quality parameters were assessed/)).toBeInTheDocument();
  });
});

describe('SystemPerformance', () => {
  test('prints uptime as the headline, once', () => {
    render(<SystemPerformance availability={availability([])} alarmCauses={[]} />);
    expect(screen.getByText('100.0%')).toBeInTheDocument();
    expect(screen.getByText('UPTIME')).toBeInTheDocument();
    // The old footer line is gone — uptime is not stated twice.
    expect(screen.queryByText(/Uptime 100\.00% over/)).not.toBeInTheDocument();
  });

  test('collapses a clean ring to one line instead of a row of zeros', () => {
    render(<SystemPerformance availability={availability([])} alarmCauses={[]} />);
    expect(
      screen.getByText('No downtime recorded — Maintenance, Relocation, Radar System Issue.')
    ).toBeInTheDocument();
    expect(screen.getByText('No downtime recorded — Connection, PMP Issue.')).toBeInTheDocument();
    expect(screen.queryByText('0.00 h / 0%')).not.toBeInTheDocument();
  });

  test('gives a reason a row once it costs time, and names the clean ones separately', () => {
    const a = availability([
      { from: '2026-07-17T09:00:00Z', to: '2026-07-17T11:00:00Z', reason: 'Maintenance' },
    ]);
    render(<SystemPerformance availability={a} alarmCauses={[]} />);

    expect(screen.getByText('Maintenance')).toBeInTheDocument();
    expect(screen.getByText('2.00 h / 8%')).toBeInTheDocument();
    expect(screen.getByText('Relocation, Radar System Issue — none.')).toBeInTheDocument();
  });

  test('colours uptime by the shared severity helper, so it agrees with the summary tile', () => {
    // 3h of an 24h window down → 87.5%, which uptimeSeverityLabel calls acceptable.
    const a = availability([
      { from: '2026-07-17T09:00:00Z', to: '2026-07-17T12:00:00Z', reason: 'Maintenance' },
    ]);
    const { container } = render(<SystemPerformance availability={a} alarmCauses={[]} />);
    const headline = [...container.querySelectorAll('text')].find((t) => t.textContent === '87.5%');
    expect(headline).toBeTruthy();
    expect(headline.getAttribute('fill')).toBe(SEV.acceptable);
  });

  test('states the window in the section bar', () => {
    render(<SystemPerformance availability={availability([])} alarmCauses={[]} />);
    expect(screen.getByText('Last 24 h')).toBeInTheDocument();
  });

  test('reports zero alarms as a result rather than an empty box', () => {
    render(<SystemPerformance availability={availability([])} alarmCauses={[]} />);
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('ALARMS RAISED')).toBeInTheDocument();
  });

  test('draws the pie and drops the redundant total when alarms exist', () => {
    const causes = [
      { cause: 'Machinery Activity', count: 6, percentage: 60 },
      { cause: 'Vegetation', count: 4, percentage: 40 },
    ];
    const { container } = render(
      <SystemPerformance availability={availability([])} alarmCauses={causes} />
    );
    expect(container.querySelectorAll('path').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('10 alarms')).toBeInTheDocument();
    expect(screen.getByText('6 (60.0%)')).toBeInTheDocument();
    expect(screen.queryByText(/Total: 10 alarms/)).not.toBeInTheDocument();
  });

  test('degrades to a message when there is no availability data', () => {
    render(<SystemPerformance availability={null} alarmCauses={[]} />);
    expect(screen.getByText('Availability data unavailable.')).toBeInTheDocument();
  });
});

describe('severity helpers', () => {
  test('wash returns a solid hex, so nested bands cannot composite', () => {
    expect(wash('#008000', 0.13)).toMatch(/^#[0-9a-f]{6}$/);
    expect(wash('#008000', 0)).toBe('#ffffff');
    expect(wash('#008000', 1)).toBe('#008000');
  });

  test('severityTextColor darkens only the fills that are illegible as text', () => {
    expect(severityTextColor(SEV.acceptable)).not.toBe(SEV.acceptable);
    expect(severityTextColor(SEV.subOptimal)).not.toBe(SEV.subOptimal);
    // Already dark enough to read on white.
    expect(severityTextColor(SEV.critical)).toBe(SEV.critical);
    expect(severityTextColor(SEV.optimal)).toBe(SEV.optimal);
  });
});
