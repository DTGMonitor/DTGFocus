// radarBoardView.ts
//
// How the SSR checklist board is ORDERED, NARROWED and GROUPED.
//
// The board is a station's worth of radars — several sites' worth once a station
// mixes them — and an operator working one site had to read past every other
// site's rows to find theirs. This module holds the pure part of that: the
// columns the board can be sorted and filtered by, and the grouping that puts a
// site's radars under one heading.
//
// The hourly checklist is deliberately NOT a column here. It is twelve boolean
// slots whose meaning depends on the shift on screen, so it has no single value
// to compare or match on, and ordering by it would reorder rows every time
// somebody ticked a box.
//
// Two orderings are kept apart, because a column can want either:
//
//   rank  a severity the site cares about — a Link Down sorts next to a Link
//         Down, not next to a Lost Connection because 'Li' < 'Lo'. Worst is
//         highest, so descending puts what needs attention on top.
//   text  what the cell reads as. Filters always match this, and columns with
//         no severity of their own (SSR, site, area) sort by it.

import { COLOUR_RANK, tarpPriority } from '@/config/riskDisplay';
import type { RiskColour } from '@/config/riskDisplay';

export type SortDirection = 'asc' | 'desc';

export type ColumnKey = 'radar_number' | 'site_name' | 'area' | 'risk' | 'status' | 'quality';

export interface BoardRow {
  radar_number?: string | null;
  site_name?: string | null;
  area?: string | null;
  /** The raw view value ('TARP 3'), used only where a site's own wording is missing. */
  risk?: string | null;
  riskInfo?: { label?: string | null; colour?: RiskColour | null } | null;
  status?: string | null;
  quality?: string | null;
}

export interface BoardColumn {
  key: ColumnKey;
  label: string;
  /** What the cell reads as: what a filter matches, and what an unranked sort compares. */
  text: (row: BoardRow) => string;
  /** Severity, worst highest. Absent on columns whose only order is their text. */
  rank?: (row: BoardRow) => number;
}

/** How a value reads when the column is empty on that row. */
export const BLANK_LABEL = '—';

/** Group heading for rows the grouping column is empty on. */
export const BLANK_GROUP_LABEL = 'Unassigned';

const clean = (value: unknown): string => String(value ?? '').trim();

/**
 * Quality, worst first. The same order the board's "overall quality" tile
 * reduces by — a station is only as good as its worst radar.
 */
const QUALITY_RANK: Record<string, number> = {
  Critical: 3,
  'Sub-Optimal': 2,
  Acceptable: 1,
  Optimal: 0
};

/**
 * Status, worst first.
 *
 * A scheduled outage ranks above Live but below every unplanned one: it is a
 * radar that is not watching, which the shift needs to see, but nobody has to
 * act on it.
 */
const STATUS_RANK: Record<string, number> = {
  'Link Down': 4,
  'Lost Connection': 3,
  Intermittent: 2,
  'Scheduled Offline': 1,
  Live: 0
};

/** TARP levels the view can carry, as the band each one is reported in. */
const LEVEL_BAND: Record<number, RiskColour> = { 4: 'red', 3: 'orange', 2: 'yellow', 1: 'green' };

/**
 * Band rank of a row's risk.
 *
 * Prefers the resolved band, which already takes the more severe of the
 * deformation type and the TARP level (see config/riskDisplay.ts). Falls back to
 * the view's raw level for a row whose deformation records have not resolved, so
 * the column still sorts sensibly rather than collapsing to one value.
 */
export const riskRank = (row: BoardRow): number => {
  const colour = row.riskInfo?.colour;
  if (colour && colour in COLOUR_RANK) return COLOUR_RANK[colour as RiskColour];

  const band = LEVEL_BAND[tarpPriority(row.risk)];
  return band ? COLOUR_RANK[band] : -1;
};

const rankIn = (table: Record<string, number>, value: string): number =>
  value in table ? table[value] : -1;

/** Every column the board can be sorted, filtered or grouped by, in display order. */
export const BOARD_COLUMNS: BoardColumn[] = [
  {
    key: 'radar_number',
    label: 'SSR',
    text: (row) => clean(row.radar_number)
  },
  {
    key: 'site_name',
    label: 'Site Name',
    text: (row) => clean(row.site_name)
  },
  {
    key: 'area',
    label: 'Area',
    text: (row) => clean(row.area)
  },
  {
    key: 'risk',
    // The site's own wording, which is what the badge prints; the raw level only
    // where no deformation record resolved it.
    label: 'Risk',
    text: (row) => clean(row.riskInfo?.label ?? row.risk),
    rank: riskRank
  },
  {
    key: 'status',
    label: 'Status',
    text: (row) => clean(row.status),
    rank: (row) => rankIn(STATUS_RANK, clean(row.status))
  },
  {
    key: 'quality',
    label: 'Quality',
    text: (row) => clean(row.quality),
    rank: (row) => rankIn(QUALITY_RANK, clean(row.quality))
  }
];

export const columnFor = (key: ColumnKey): BoardColumn =>
  BOARD_COLUMNS.find((c) => c.key === key) as BoardColumn;

/** The value a cell reads as, or BLANK_LABEL where the row has nothing there. */
export const cellText = (row: BoardRow, key: ColumnKey): string =>
  columnFor(key).text(row) || BLANK_LABEL;

/** Case- and accent-insensitive, numeric-aware: SSR-9 sorts before SSR-10. */
const compareText = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export interface SortState {
  key: ColumnKey;
  direction: SortDirection;
}

/**
 * Order two rows by one column.
 *
 * Ranked columns compare by severity and fall back to their text, so values a
 * site uses that this module has never heard of still land together instead of
 * scattering through the unranked block.
 *
 * The SSR number breaks every remaining tie. Without it, rows equal on the sort
 * column would keep whatever order the last render left them in, and a board
 * grouped by site would appear to shuffle its rows on every refetch.
 */
export const compareRows = (a: BoardRow, b: BoardRow, sort: SortState): number => {
  const column = columnFor(sort.key);
  const sign = sort.direction === 'desc' ? -1 : 1;

  if (column.rank) {
    const diff = column.rank(a) - column.rank(b);
    if (diff !== 0) return sign * diff;
  }

  const byText = compareText(column.text(a), column.text(b));
  if (byText !== 0) return sign * byText;

  return compareText(clean(a.radar_number), clean(b.radar_number));
};

export const sortRows = <T extends BoardRow>(rows: T[], sort: SortState | null): T[] =>
  sort ? [...rows].sort((a, b) => compareRows(a, b, sort)) : rows;

/**
 * Selected values per column. A column absent from the map, or holding an empty
 * list, is not filtering — "nothing ticked" means "everything", the way a filter
 * menu reads when it is first opened.
 */
export type ColumnFilters = Partial<Record<ColumnKey, string[]>>;

/** The values actually present in a column, in the order its filter menu lists them. */
export const filterOptions = (rows: BoardRow[], key: ColumnKey): string[] => {
  const column = columnFor(key);
  // One representative row per value, so a ranked column can order its menu by
  // the same severity the rows sort by.
  const seen = new Map<string, BoardRow>();
  rows.forEach((row) => {
    const value = column.text(row) || BLANK_LABEL;
    if (!seen.has(value)) seen.set(value, row);
  });

  return Array.from(seen.keys()).sort((a, b) => {
    if (column.rank) {
      // Worst first: the values an operator filters to sit at the top.
      const diff = column.rank(seen.get(b) as BoardRow) - column.rank(seen.get(a) as BoardRow);
      if (diff !== 0) return diff;
    }
    return compareText(a, b);
  });
};

const matchesColumn = (row: BoardRow, key: ColumnKey, selected: string[] | undefined): boolean => {
  if (!selected || selected.length === 0) return true;
  return selected.includes(columnFor(key).text(row) || BLANK_LABEL);
};

/** Does the row read as `term` anywhere across the sortable columns? */
export const matchesSearch = (row: BoardRow, term: string): boolean => {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return BOARD_COLUMNS.some((c) => c.text(row).toLowerCase().includes(needle));
};

export const matchesFilters = (row: BoardRow, filters: ColumnFilters, search = ''): boolean =>
  matchesSearch(row, search) &&
  BOARD_COLUMNS.every((c) => matchesColumn(row, c.key, filters[c.key]));

export const applyFilters = <T extends BoardRow>(
  rows: T[],
  filters: ColumnFilters,
  search = ''
): T[] => rows.filter((r) => matchesFilters(r, filters, search));

/** How many things are narrowing the board — what the "clear" control counts. */
export const activeFilterCount = (filters: ColumnFilters, search = ''): number =>
  BOARD_COLUMNS.filter((c) => (filters[c.key]?.length ?? 0) > 0).length + (search.trim() ? 1 : 0);

export interface RowGroup<T> {
  /** The grouping column's value. BLANK_GROUP_LABEL where the row has none. */
  key: string;
  rows: T[];
}

/**
 * Split rows into their groups, each group internally ordered by `sort`.
 *
 * Groups themselves follow the sort when it is ON the grouping column — sorting
 * by site with the board grouped by site reverses the headings, which is what
 * clicking that header is asking for. Any other sort leaves the headings in
 * their own order (worst-first where the column is ranked, else alphabetical) so
 * that re-sorting the rows does not also reshuffle the sections around them.
 *
 * `groupBy` of null returns one unnamed group holding everything, so a caller
 * can render grouped and ungrouped boards through the same path.
 */
export const groupRows = <T extends BoardRow>(
  rows: T[],
  groupBy: ColumnKey | null,
  sort: SortState | null
): RowGroup<T>[] => {
  const ordered = sortRows(rows, sort);
  if (!groupBy) return [{ key: '', rows: ordered }];

  const column = columnFor(groupBy);
  const groups = new Map<string, T[]>();
  ordered.forEach((row) => {
    const key = column.text(row) || BLANK_GROUP_LABEL;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  });

  const headingSort: SortState =
    sort && sort.key === groupBy ? sort : { key: groupBy, direction: column.rank ? 'desc' : 'asc' };

  return Array.from(groups.entries())
    .map(([key, groupedRows]) => ({ key, rows: groupedRows }))
    // Compare groups through their first row, so a heading order that depends on
    // severity reads the same fact the rows did.
    .sort((a, b) => compareRows(a.rows[0], b.rows[0], headingSort));
};
