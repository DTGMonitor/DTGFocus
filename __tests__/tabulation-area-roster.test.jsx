/**
 * The roster movement table — one row per monitoring point, calm points
 * included.
 *
 * These cover the decisions a later tidy-up would quietly break: which radars
 * print which table, that a quiet point still gets a row, that an unregistered
 * area is never hidden, and that a long table is laid out as blocks the
 * paginator can actually break between.
 *
 * The chain table's own contracts live in daily-radar-report.test.jsx and are
 * deliberately untouched: this style is additive, and the standard report must
 * behave exactly as it did before.
 */

import { render, screen, within } from '@testing-library/react';

import {
  buildStatusRows,
  applyAreaRoster,
  splitStatusRows,
  splitStatusRowsIntoBlocks,
  areaKey,
  hasActiveRisk,
  SINGLE_COLUMN_MAX_ROWS,
  MOVEMENT_ROWS_PER_BLOCK,
} from '@/utils/dailyStatusRows';
import {
  movementTableStyleForRadar,
  resolveMovementTableStyle,
  usesAreaRoster,
} from '@/config/movementTableStyle';
import { resolveCreatedFolderId, copyAreaRoster } from '@/utils/monitoringAreas';
import { resolveRiskPresentation } from '@/config/riskDisplay';
import { dailyStrings } from '@/config/dailyReportLocale';
import { DailyMovementTable } from '@/components/admin/Radar/report/blocks/DailySummary';

const rec = (over = {}) => ({
  id: over.id ?? 'r1',
  created_at: over.created_at ?? '2026-08-07T02:00:00Z',
  location: 'Top dk 1',
  def_type: 'Linear',
  tarp_level: 'TARP 3',
  isactive: 'Yes',
  properties: {},
  ...over,
});

/** The client's board, in the order they read it. */
const ROSTER = [
  'Top dk 1',
  'Top dk 2',
  'Kaki_disp_parkiran',
  'Kaki disp 1',
  'Kaki disp 2',
  'Poli Dk',
  'Poli Disp',
  '102',
  'Midle disp 102',
];

const rosterRows = (records, opts = {}) =>
  applyAreaRoster(buildStatusRows(records, opts), ROSTER, opts);

// ---------------------------------------------------------------------------
// Which table a radar prints
// ---------------------------------------------------------------------------

describe('movement table style', () => {
  test('a PS radar prints the roster, everything else prints active movements', () => {
    expect(movementTableStyleForRadar('PS2000')).toBe('roster');
    expect(movementTableStyleForRadar('ps2000')).toBe('roster');
    expect(movementTableStyleForRadar('SSR994FX')).toBe('chain');
    expect(movementTableStyleForRadar('MSR254')).toBe('chain');
    expect(movementTableStyleForRadar('SSR530Omni')).toBe('chain');
    // Nothing typed yet is not a reason to change the standard table.
    expect(movementTableStyleForRadar('')).toBe('chain');
    expect(movementTableStyleForRadar(null)).toBe('chain');
  });

  test('a stored per-radar choice beats the family default, both ways', () => {
    expect(
      resolveMovementTableStyle({ radar_number: 'PS2000', movement_table_style: 'chain' })
    ).toBe('chain');
    expect(
      resolveMovementTableStyle({ radar_number: 'SSR994FX', movement_table_style: 'roster' })
    ).toBe('roster');
    // A column the view does not expose, or a value nothing recognises, falls
    // back to the radar number rather than to an arbitrary table.
    expect(resolveMovementTableStyle({ radar_number: 'PS2000' })).toBe('roster');
    expect(
      resolveMovementTableStyle({ radar_number: 'PS2000', movement_table_style: 'nonsense' })
    ).toBe('roster');
    expect(usesAreaRoster({ radar_number: 'SSR994FX' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Merging the roster in
// ---------------------------------------------------------------------------

describe('applyAreaRoster', () => {
  test('a wall with nothing moving still lists every point', () => {
    const rows = rosterRows([]);

    expect(rows).toHaveLength(ROSTER.length);
    expect(rows.map((r) => r.area)).toEqual(ROSTER);
    for (const row of rows) {
      expect(row.tarp).toBe('TARP 1');
      expect(row.pattern).toBe('No Significant');
      expect(row.remark).toBe('No significant movement observed.');
      expect(row.colour).toBe('green');
      expect(row.patternColour).toBe('green');
      expect(row.rosterOnly).toBe(true);
    }
  });

  test('an active chain replaces its point rather than duplicating it', () => {
    const rows = rosterRows([rec({ location: 'Poli Dk', def_type: 'Linear', tarp_level: 'TARP 3' })]);

    expect(rows).toHaveLength(ROSTER.length);
    const poli = rows.filter((r) => r.area === 'Poli Dk');
    expect(poli).toHaveLength(1);
    expect(poli[0].tarp).toBe('TARP 3');
    expect(poli[0].pattern).toBe('Linear');
    expect(poli[0].rosterOnly).toBeUndefined();
  });

  test('two chains on one point stay two rows, and the point gets no baseline', () => {
    // The chain table's contract, preserved: collapsing them to the worst would
    // hide something the site has been asked to act on.
    const rows = rosterRows([
      rec({ id: 'a', location: 'Poli Dk', def_type: 'Linear', tarp_level: 'TARP 4' }),
      rec({ id: 'b', location: 'Poli Dk', def_type: 'Progressive', tarp_level: 'TARP 3' }),
    ]);

    const poli = rows.filter((r) => r.area === 'Poli Dk');
    expect(poli).toHaveLength(2);
    expect(poli.some((r) => r.rosterOnly)).toBe(false);
    expect(rows).toHaveLength(ROSTER.length + 1);
  });

  test('the point is matched on spelling, not on characters', () => {
    // 'Kaki disp 1' on the roster, 'kaki  Disp   1' typed into the record.
    const rows = rosterRows([rec({ location: 'kaki  Disp   1', def_type: 'Regressive', tarp_level: 'TARP 2' })]);

    expect(rows).toHaveLength(ROSTER.length);
    const matched = rows.filter((r) => areaKey(r.area) === areaKey('Kaki disp 1'));
    expect(matched).toHaveLength(1);
    expect(matched[0].pattern).toBe('Regressive');
  });

  test('live movement on an unregistered area is never hidden', () => {
    const rows = rosterRows([
      rec({ location: 'New Batter 7', def_type: 'Progressive', tarp_level: 'TARP 4' }),
    ]);

    expect(rows).toHaveLength(ROSTER.length + 1);
    // Worst first — an area the roster has fallen behind on still leads.
    expect(rows[0].area).toBe('New Batter 7');
    expect(rows[0].tarp).toBe('TARP 4');
  });

  test('severity leads, then the client’s own order', () => {
    const rows = rosterRows([
      rec({ id: 'a', location: 'Poli Disp', def_type: 'Linear', tarp_level: 'TARP 3' }),
      rec({ id: 'b', location: '102', def_type: 'Progressive', tarp_level: 'TARP 4' }),
    ]);

    expect(rows.map((r) => r.area)).toEqual([
      // Red before orange...
      '102',
      'Poli Disp',
      // ...then the roster's own sequence, with the two moving points removed.
      'Top dk 1',
      'Top dk 2',
      'Kaki_disp_parkiran',
      'Kaki disp 1',
      'Kaki disp 2',
      'Poli Dk',
      'Midle disp 102',
    ]);
  });

  test('a duplicated roster entry prints once', () => {
    const rows = applyAreaRoster([], ['Poli Dk', 'poli dk', 'Top dk 1'], {});
    expect(rows.map((r) => r.area)).toEqual(['Poli Dk', 'Top dk 1']);
  });

  test('an empty roster leaves the chain table exactly as it was', () => {
    const active = buildStatusRows([rec()]);
    expect(applyAreaRoster(active, [], {})).toEqual(active);
    expect(applyAreaRoster(active, null, {})).toEqual(active);
  });

  test('the baseline row follows the site’s language and its TARP wording', () => {
    const id = applyAreaRoster([], ['Poli Dk'], { locale: 'id' });
    expect(id[0].remark).toBe('Tidak teramati pergerakan signifikan.');
    // The radar software's own vocabulary is not translated — see the
    // conventions at the top of config/dailyReportLocale.ts.
    expect(id[0].pattern).toBe('No Significant');

    // A site whose chart carries no TARP numbers gets a blank column, not a
    // level it does not use.
    const notification = applyAreaRoster([], ['Poli Dk'], { noLevelLabel: '' });
    expect(notification[0].tarp).toBe('');
    expect(notification[0].tarpColour).toBeNull();
  });

  test('a page of TARP 1 rows is still a day with nothing to analyse', () => {
    // The roster is presentation. It must not talk the report into printing an
    // Area Analysis section for a wall where nothing is happening.
    const presentation = resolveRiskPresentation([], { site_name: 'Sorowako' });
    expect(rosterRows([])).toHaveLength(ROSTER.length);
    expect(hasActiveRisk(presentation)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Laying a long table out
// ---------------------------------------------------------------------------

describe('splitStatusRowsIntoBlocks', () => {
  const rows = (n) =>
    Array.from({ length: n }, (_, i) => ({ area: `P${i + 1}`, tarp: 'TARP 1', colour: 'green' }));

  test('a short table is one single-column block, as it has always been', () => {
    const blocks = splitStatusRowsIntoBlocks(rows(SINGLE_COLUMN_MAX_ROWS));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].twoUp).toBe(false);
    expect(blocks[0].right).toEqual([]);
    expect(blocks[0]).toEqual(splitStatusRows(rows(SINGLE_COLUMN_MAX_ROWS)));
  });

  test('a long table is broken into blocks the paginator can split between', () => {
    const blocks = splitStatusRowsIntoBlocks(rows(40), { maxRows: 24 });
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => b.left.length + b.right.length)).toEqual([24, 16]);
    // Every block two-up, decided once from the total. A last block of four
    // rows must not render full-width under 24 half-width ones.
    expect(blocks.every((b) => b.twoUp)).toBe(true);
  });

  test('no row is dropped and the reading order is left column first', () => {
    const all = rows(30);
    const blocks = splitStatusRowsIntoBlocks(all, { maxRows: MOVEMENT_ROWS_PER_BLOCK });
    const read = blocks.flatMap((b) => [...b.left, ...b.right]);
    expect(read).toEqual(all);
  });

  test('an empty table is one empty block, so the message still renders', () => {
    expect(splitStatusRowsIntoBlocks([])).toEqual([{ left: [], right: [], twoUp: false }]);
  });
});

// ---------------------------------------------------------------------------
// Surviving a wall folder rotation
// ---------------------------------------------------------------------------

describe('carrying the roster to a new wall folder', () => {
  /** Enough of a PostgREST builder for these two functions: thenable, filtered. */
  const stubClient = (tables) => {
    const inserted = [];
    const from = (table) => {
      const filters = {};
      const builder = {
        select: () => builder,
        eq: (column, value) => {
          filters[column] = value;
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        insert: (rows) => {
          inserted.push(...rows);
          tables[table] = [...(tables[table] ?? []), ...rows];
          return Promise.resolve({ data: null, error: null });
        },
        then: (resolve) =>
          resolve({
            data: (tables[table] ?? []).filter((row) =>
              Object.entries(filters).every(([k, v]) => String(row[k]) === String(v))
            ),
            error: null,
          }),
      };
      return builder;
    };
    return { from, inserted };
  };

  const roster = [
    { id: 1, wallfolder_id: 10, name: 'Top dk 1', sort_order: 1, isactive: 'Yes' },
    { id: 2, wallfolder_id: 10, name: 'Poli Dk', sort_order: 2, isactive: 'Yes' },
    { id: 3, wallfolder_id: 10, name: 'Retired Batter', sort_order: 3, isactive: 'No' },
  ];

  test('the board follows the wall, minus the points that were retired', async () => {
    const client = stubClient({ monitoring_areas: [...roster] });

    await expect(copyAreaRoster(client, 10, 11)).resolves.toBe(2);
    expect(client.inserted).toEqual([
      { wallfolder_id: 11, name: 'Top dk 1', sort_order: 1 },
      { wallfolder_id: 11, name: 'Poli Dk', sort_order: 2 },
    ]);
  });

  test('a folder that already has a board is left alone', async () => {
    const client = stubClient({
      monitoring_areas: [...roster, { id: 9, wallfolder_id: 11, name: 'Already here', sort_order: 1 }],
    });

    await expect(copyAreaRoster(client, 10, 11)).resolves.toBe(0);
    expect(client.inserted).toEqual([]);
  });

  test('nothing to copy, and copying onto itself, are both no-ops', async () => {
    const client = stubClient({ monitoring_areas: [] });
    await expect(copyAreaRoster(client, 10, 11)).resolves.toBe(0);
    await expect(copyAreaRoster(client, 10, 10)).resolves.toBe(0);
    await expect(copyAreaRoster(client, null, 11)).resolves.toBe(0);
    expect(client.inserted).toEqual([]);
  });

  test('the new folder is found even when the RPC returns nothing useful', async () => {
    const client = stubClient({
      radar_wall_folders: [{ id: 11, radar_id: 5, name: 'PS2000_260810_Stage_9' }],
    });

    // What the RPC returns today.
    await expect(resolveCreatedFolderId(client, 11, 5, 'PS2000_260810_Stage_9')).resolves.toBe(11);
    // And what it might return tomorrow.
    await expect(resolveCreatedFolderId(client, null, 5, 'PS2000_260810_Stage_9')).resolves.toBe(11);
    await expect(resolveCreatedFolderId(client, [{ id: 11 }], 5, 'x')).resolves.toBe(11);
    await expect(resolveCreatedFolderId(client, null, 5, 'no such folder')).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// What reaches the page
// ---------------------------------------------------------------------------

describe('the printed roster table', () => {
  test('prints every point, moving or not', () => {
    const strings = dailyStrings('id');
    const rows = rosterRows([rec({ location: 'Poli Dk', def_type: 'Linear', tarp_level: 'TARP 3' })], {
      locale: 'id',
    });
    const blocks = splitStatusRowsIntoBlocks(rows);

    render(
      <table>
        <tbody>
          <tr>
            <td>
              {blocks.map((split, i) => (
                <DailyMovementTable key={i} strings={strings} split={split} withHeader={i === 0} />
              ))}
            </td>
          </tr>
        </tbody>
      </table>
    );

    for (const area of ROSTER) {
      expect(screen.getAllByText(area).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText('No Significant')).toHaveLength(ROSTER.length - 1);
    expect(screen.getAllByText('Tidak teramati pergerakan signifikan.')).toHaveLength(
      ROSTER.length - 1
    );
    expect(screen.getByText('Linear')).toBeInTheDocument();
  });

  test('a continued block repeats the column headers', () => {
    const strings = dailyStrings('en');
    const blocks = splitStatusRowsIntoBlocks(
      Array.from({ length: 30 }, (_, i) => ({
        area: `P${i + 1}`,
        tarp: 'TARP 1',
        pattern: 'No Significant',
        remark: '',
        colour: 'green',
      })),
      { maxRows: 24 }
    );

    const { container } = render(
      <div>
        {blocks.map((split, i) => (
          <DailyMovementTable key={i} strings={strings} split={split} withHeader={i === 0} />
        ))}
      </div>
    );

    // Two tables, each with its own header row: a table continued onto page 2
    // has to be readable there.
    const tables = container.querySelectorAll('table');
    expect(tables).toHaveLength(2);
    for (const table of tables) {
      expect(within(table).getAllByText(strings.colArea).length).toBeGreaterThan(0);
    }
  });
});
