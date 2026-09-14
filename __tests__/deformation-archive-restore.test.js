/**
 * The archived deformation board.
 *
 * Two questions decide whether this view is honest:
 *
 *   1. WHICH archived rows are listed. Most are not history in their own right —
 *      the Update flow archives a record the instant it writes the one replacing
 *      it — and listing those would show the same trend several times over and
 *      offer to restore a chain that already has a current record.
 *   2. What restoring one of them means for the chain behind it, which is what
 *      the confirm dialog has to tell the engineer before they do it.
 */

import {
  resolveArchivedChainTips,
  resolveRestoreImpact,
  restoreDefRecords,
} from '@/utils/tabHelpers';

const record = (id, overrides = {}) => ({
  id,
  created_at: `2026-01-${String(id).padStart(2, '0')}T00:00:00.000Z`,
  def_type: 'Regressive',
  location: `Area ${id}`,
  precursors: null,
  isactive: 'No',
  properties: {},
  ...overrides,
});

describe('resolveArchivedChainTips', () => {
  test('a lone archived record is a closed chain', () => {
    const archived = [record(1)];
    expect(resolveArchivedChainTips(archived, archived).map((r) => r.id)).toEqual([1]);
  });

  test('a node superseded by a LIVE record is not listed — its timeline already prints it', () => {
    const archived = [record(1)];
    const active = [record(2, { isactive: 'Yes', precursors: [1] })];

    expect(resolveArchivedChainTips(archived, [...active, ...archived])).toEqual([]);
  });

  test('a chain archived in one go lists only its tip, not every node behind it', () => {
    // 1 → 2 → 3, all archived. Only 3 is the chain; 1 and 2 are its history.
    const archived = [
      record(1),
      record(2, { precursors: [1] }),
      record(3, { precursors: [2] }),
    ];

    expect(resolveArchivedChainTips(archived, archived).map((r) => r.id)).toEqual([3]);
  });

  test('reading only the ACTIVE records would wrongly call a predecessor a chain', () => {
    const archived = [record(1), record(2, { precursors: [1] })];

    // The bug this guards: passing just the active set (here, none) leaves
    // record 1 looking like a tip because nothing in that set points at it.
    expect(resolveArchivedChainTips(archived, []).map((r) => r.id)).toEqual([2, 1]);
    expect(resolveArchivedChainTips(archived, archived).map((r) => r.id)).toEqual([2]);
  });

  test('an event whose chains were carried forward is not listed twice', () => {
    // performEventArchiveFlow archives the rainfall and writes a copy of each
    // trend pointing back at it. The rainfall is therefore referenced and is
    // history inside those copies, not a chain of its own.
    const archived = [record(9, { def_type: 'Rainfall Event', precursors: [1] }), record(1)];
    const active = [record(10, { isactive: 'Yes', precursors: [9] })];

    expect(resolveArchivedChainTips(archived, [...active, ...archived])).toEqual([]);
  });

  test('newest first, so the most recently closed chain leads the board', () => {
    const archived = [
      record(1, { created_at: '2026-01-01T00:00:00.000Z' }),
      record(3, { created_at: '2026-03-01T00:00:00.000Z' }),
      record(2, { created_at: '2026-02-01T00:00:00.000Z' }),
    ];

    expect(resolveArchivedChainTips(archived, archived).map((r) => r.id)).toEqual([3, 2, 1]);
  });

  test('tolerates the empty and the malformed without throwing', () => {
    expect(resolveArchivedChainTips()).toEqual([]);
    expect(resolveArchivedChainTips([null, undefined], [null])).toEqual([]);
  });
});

describe('resolveRestoreImpact', () => {
  test('no predecessor on the board — restoring reopens the chain', () => {
    expect(resolveRestoreImpact(record(2, { precursors: [1] }), [])).toEqual({
      kind: 'reopens',
      spineId: 1,
    });
  });

  test('predecessor still active — the chain steps forward rather than gaining one', () => {
    const active = [record(1, { isactive: 'Yes' })];

    expect(resolveRestoreImpact(record(2, { precursors: [1] }), active)).toEqual({
      kind: 'steps-forward',
      spineId: 1,
    });
  });

  test('only the SPINE precursor counts — a ticked rainfall is not the chain', () => {
    // precursors[0] is the record superseded; the rest are related events the
    // engineer ticked. An active rainfall must not make this read as a chain
    // that is already on the board.
    const active = [record(7, { isactive: 'Yes', def_type: 'Rainfall Event' })];

    expect(resolveRestoreImpact(record(2, { precursors: [1, 7] }), active)).toEqual({
      kind: 'reopens',
      spineId: 1,
    });
  });

  test('a lone record has no spine at all', () => {
    expect(resolveRestoreImpact(record(1), [])).toEqual({ kind: 'reopens', spineId: null });
  });
});

describe('restoreDefRecords', () => {
  /** Records the writes a supabase-like client would have made. */
  const client = (error = null) => {
    const calls = [];
    return {
      calls,
      from(table) {
        return {
          update(payload) {
            const call = { table, payload, filter: null };
            calls.push(call);
            return {
              eq(col, value) {
                call.filter = { op: 'eq', col, value };
                return Promise.resolve({ error });
              },
              in(col, value) {
                call.filter = { op: 'in', col, value };
                return Promise.resolve({ error });
              },
            };
          },
        };
      },
    };
  };

  test('flips isactive back to Yes, by eq for a single id', async () => {
    const c = client();
    await expect(restoreDefRecords(c, [4])).resolves.toEqual({ ok: true });

    expect(c.calls).toEqual([
      { table: 'def_records', payload: { isactive: 'Yes' }, filter: { op: 'eq', col: 'id', value: '4' } },
    ]);
  });

  test('deduplicates and uses in() for several', async () => {
    const c = client();
    await restoreDefRecords(c, [4, '4', 5]);

    expect(c.calls[0].filter).toEqual({ op: 'in', col: 'id', value: ['4', '5'] });
  });

  test('an empty list writes nothing', async () => {
    const c = client();
    await expect(restoreDefRecords(c, [null, undefined])).resolves.toEqual({ ok: true });
    expect(c.calls).toEqual([]);
  });

  test('a failed write is reported rather than swallowed', async () => {
    const boom = { message: 'nope' };
    await expect(restoreDefRecords(client(boom), [1])).resolves.toEqual({ ok: false, error: boom });
  });
});
