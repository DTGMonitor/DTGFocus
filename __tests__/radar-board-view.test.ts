/**
 * How the SSR checklist board orders, narrows and groups its rows.
 *
 * The board is a station's worth of radars, and a station mixes sites. These
 * tests pin the three things an operator relies on when they reach for a
 * heading:
 *
 *   sorting   a column with a severity sorts by that severity, not by its text
 *   filtering nothing ticked means everything, and a blank cell is still a
 *             value that can be filtered to
 *   grouping  the sections follow the sort only when the sort is on the column
 *             the board is grouped by
 */

import {
  BLANK_GROUP_LABEL,
  BLANK_LABEL,
  BOARD_COLUMNS,
  activeFilterCount,
  applyFilters,
  cellText,
  compareRows,
  filterOptions,
  groupRows,
  matchesSearch,
  riskRank,
  sortRows
} from '@/utils/radarBoardView';
import type { BoardRow, ColumnKey } from '@/utils/radarBoardView';

const row = (over: Partial<BoardRow> = {}): BoardRow => ({
  radar_number: 'SSR-1',
  site_name: 'Telfer',
  area: 'North Wall',
  risk: 'TARP 1',
  riskInfo: { label: 'TARP 1', colour: 'green' },
  status: 'Live',
  quality: 'Optimal',
  ...over
});

const asc = (key: ColumnKey) => ({ key, direction: 'asc' as const });
const desc = (key: ColumnKey) => ({ key, direction: 'desc' as const });

describe('the columns on offer', () => {
  it('does not offer the hourly checklist', () => {
    // Twelve booleans whose meaning depends on the shift on screen: nothing to
    // compare, and ordering by it would move rows as they were ticked.
    expect(BOARD_COLUMNS.map((c) => c.key)).toEqual([
      'radar_number',
      'site_name',
      'area',
      'risk',
      'status',
      'quality'
    ]);
  });

  it('reads a blank cell as a value rather than an empty string', () => {
    expect(cellText(row({ area: null }), 'area')).toBe(BLANK_LABEL);
  });
});

describe('sorting', () => {
  it('orders the SSR column numerically, not lexically', () => {
    const rows = [row({ radar_number: 'SSR-10' }), row({ radar_number: 'SSR-9' })];
    expect(sortRows(rows, asc('radar_number')).map((r) => r.radar_number)).toEqual([
      'SSR-9',
      'SSR-10'
    ]);
  });

  it('orders status by severity, so the two link faults do not split alphabetically', () => {
    const rows = [
      row({ radar_number: 'SSR-1', status: 'Live' }),
      row({ radar_number: 'SSR-2', status: 'Lost Connection' }),
      row({ radar_number: 'SSR-3', status: 'Link Down' })
    ];
    expect(sortRows(rows, desc('status')).map((r) => r.status)).toEqual([
      'Link Down',
      'Lost Connection',
      'Live'
    ]);
  });

  it('orders quality worst-first on a descending sort', () => {
    const rows = ['Optimal', 'Critical', 'Acceptable', 'Sub-Optimal'].map((quality, i) =>
      row({ radar_number: `SSR-${i}`, quality })
    );
    expect(sortRows(rows, desc('quality')).map((r) => r.quality)).toEqual([
      'Critical',
      'Sub-Optimal',
      'Acceptable',
      'Optimal'
    ]);
  });

  it('ranks a rapid movement above a TARP 4, the way the bands do', () => {
    const rapid = row({ riskInfo: { label: 'Rapid Movement', colour: 'darkred' } });
    const tarp4 = row({ riskInfo: { label: 'TARP 4', colour: 'red' } });
    expect(riskRank(rapid)).toBeGreaterThan(riskRank(tarp4));
  });

  it('falls back to the raw TARP level when no deformation record resolved', () => {
    // A row whose def_records have not loaded still has to sort somewhere
    // sensible rather than collapsing in with the unknowns.
    const pending = row({ riskInfo: undefined, risk: 'TARP 3' });
    const green = row({ riskInfo: undefined, risk: 'TARP 1' });
    expect(riskRank(pending)).toBeGreaterThan(riskRank(green));
  });

  it('breaks ties on the SSR number, so equal rows keep one stable order', () => {
    const rows = [
      row({ radar_number: 'SSR-4', site_name: 'Leonora' }),
      row({ radar_number: 'SSR-2', site_name: 'Leonora' })
    ];
    expect(sortRows(rows, asc('site_name')).map((r) => r.radar_number)).toEqual([
      'SSR-2',
      'SSR-4'
    ]);
    // Same order whichever way the site column points: the tiebreak is not
    // reversed by the sort direction.
    expect(sortRows(rows, desc('site_name')).map((r) => r.radar_number)).toEqual([
      'SSR-2',
      'SSR-4'
    ]);
  });

  it('leaves the rows alone when nothing is sorting', () => {
    const rows = [row({ radar_number: 'SSR-9' }), row({ radar_number: 'SSR-1' })];
    expect(sortRows(rows, null).map((r) => r.radar_number)).toEqual(['SSR-9', 'SSR-1']);
  });

  it('does not mutate the array it was given', () => {
    const rows = [row({ radar_number: 'SSR-9' }), row({ radar_number: 'SSR-1' })];
    sortRows(rows, asc('radar_number'));
    expect(rows.map((r) => r.radar_number)).toEqual(['SSR-9', 'SSR-1']);
  });
});

describe('filtering', () => {
  const board = [
    row({ radar_number: 'SSR-1', site_name: 'Telfer', status: 'Live' }),
    row({ radar_number: 'SSR-2', site_name: 'Leonora', status: 'Link Down' }),
    row({ radar_number: 'SSR-3', site_name: 'Leonora', status: 'Live' })
  ];

  it('treats nothing ticked as everything', () => {
    expect(applyFilters(board, {})).toHaveLength(3);
    expect(applyFilters(board, { site_name: [] })).toHaveLength(3);
  });

  it('keeps the rows matching any ticked value', () => {
    const kept = applyFilters(board, { site_name: ['Leonora'] });
    expect(kept.map((r) => r.radar_number)).toEqual(['SSR-2', 'SSR-3']);
  });

  it('intersects across columns', () => {
    const kept = applyFilters(board, { site_name: ['Leonora'], status: ['Live'] });
    expect(kept.map((r) => r.radar_number)).toEqual(['SSR-3']);
  });

  it('can filter to the rows a column is blank on', () => {
    const rows = [...board, row({ radar_number: 'SSR-4', area: '' })];
    expect(applyFilters(rows, { area: [BLANK_LABEL] }).map((r) => r.radar_number)).toEqual([
      'SSR-4'
    ]);
  });

  it('searches across every sortable column at once', () => {
    expect(matchesSearch(row({ area: 'South Wall' }), 'south')).toBe(true);
    expect(matchesSearch(row({ status: 'Link Down' }), 'link')).toBe(true);
    expect(matchesSearch(row(), 'nothing here')).toBe(false);
    // A blank search narrows nothing.
    expect(matchesSearch(row(), '   ')).toBe(true);
  });

  it('counts the search as one of the active filters', () => {
    expect(activeFilterCount({}, '')).toBe(0);
    expect(activeFilterCount({ site_name: ['Telfer'], status: [] }, '')).toBe(1);
    expect(activeFilterCount({ site_name: ['Telfer'] }, 'ssr')).toBe(2);
  });

  it('offers the values present, worst first on a ranked column', () => {
    const rows = [
      row({ status: 'Live' }),
      row({ status: 'Link Down' }),
      row({ status: 'Live' }),
      row({ status: 'Intermittent' })
    ];
    expect(filterOptions(rows, 'status')).toEqual(['Link Down', 'Intermittent', 'Live']);
  });

  it('offers unranked values alphabetically', () => {
    const rows = [row({ site_name: 'Telfer' }), row({ site_name: 'Hidden Valley' })];
    expect(filterOptions(rows, 'site_name')).toEqual(['Hidden Valley', 'Telfer']);
  });
});

describe('grouping', () => {
  const board = [
    row({ radar_number: 'SSR-3', site_name: 'Telfer', quality: 'Critical' }),
    row({ radar_number: 'SSR-1', site_name: 'Leonora', quality: 'Optimal' }),
    row({ radar_number: 'SSR-2', site_name: 'Telfer', quality: 'Acceptable' })
  ];

  it('puts a site\'s radars under one heading', () => {
    const groups = groupRows(board, 'site_name', null);
    expect(groups.map((g) => g.key)).toEqual(['Leonora', 'Telfer']);
    expect(groups[1].rows.map((r) => r.radar_number)).toEqual(['SSR-3', 'SSR-2']);
  });

  it('sorts inside each group, leaving the headings where they were', () => {
    const groups = groupRows(board, 'site_name', desc('quality'));
    expect(groups.map((g) => g.key)).toEqual(['Leonora', 'Telfer']);
    expect(groups[1].rows.map((r) => r.quality)).toEqual(['Critical', 'Acceptable']);
  });

  it('reverses the headings when the sort is on the grouping column itself', () => {
    const groups = groupRows(board, 'site_name', desc('site_name'));
    expect(groups.map((g) => g.key)).toEqual(['Telfer', 'Leonora']);
  });

  it('orders headings worst-first where the grouping column is ranked', () => {
    const groups = groupRows(board, 'quality', null);
    expect(groups.map((g) => g.key)).toEqual(['Critical', 'Acceptable', 'Optimal']);
  });

  it('names the group a row has no value for', () => {
    const groups = groupRows([row({ site_name: null })], 'site_name', null);
    expect(groups[0].key).toBe(BLANK_GROUP_LABEL);
  });

  it('returns one unnamed group when grouping is off, still sorted', () => {
    const groups = groupRows(board, null, asc('radar_number'));
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('');
    expect(groups[0].rows.map((r) => r.radar_number)).toEqual(['SSR-1', 'SSR-2', 'SSR-3']);
  });

  it('keeps every row: grouping splits the board, it does not narrow it', () => {
    const total = groupRows(board, 'site_name', null).reduce((n, g) => n + g.rows.length, 0);
    expect(total).toBe(board.length);
  });
});

describe('compareRows', () => {
  it('is symmetric, so a sort cannot depend on the order it started in', () => {
    const a = row({ radar_number: 'SSR-1', status: 'Live' });
    const b = row({ radar_number: 'SSR-2', status: 'Link Down' });
    expect(Math.sign(compareRows(a, b, asc('status')))).toBe(
      -Math.sign(compareRows(b, a, asc('status')))
    );
  });
});
