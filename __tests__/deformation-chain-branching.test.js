/**
 * Branching out of a merge event.
 *
 * A rainfall falls across a wall that already has two trends on it. What comes
 * out the other side is not one chain and not two — it is however many the
 * engineer says, and each of them is a separate history:
 *
 *     Regressive ─┐                ┌─ Regressive   (continues the Regressive)
 *                 ├─ Rainfall ─────┼─ Progressive  (continues the Linear)
 *     Linear ─────┘                └─ Linear       (a chain of its own)
 *
 * The first two continue a trend that ran INTO the event. The third continues
 * nothing: it is something the rain caused, whose history begins at the rain.
 *
 * These tests pin the three things that has to be true everywhere:
 *   1. a new chain closes no branch — every trend on the event is still waiting;
 *   2. the walk out of the event follows the chain being drawn, so the three
 *      chains above resolve to three different histories rather than one;
 *   3. every surface iterates CHAINS, not current records, so two chains
 *      standing on one rainfall are two rows and two timelines — never one.
 */

import {
  resolveChainTips,
  resolveChainHeads,
  resolveOpenBranchIds,
  resolveTimelineChain,
  pickSpineParentId,
  chainSubjectRecord,
  chainLocationLabel,
  performDeformationUpdateFlow,
  resolveChainImpact,
  performRecordDeleteFlow,
  isNewChainBranch,
  CHAIN_BRANCH_KEY,
  CHAIN_BRANCH_NEW,
} from '@/utils/tabHelpers';
import { buildStatusRows } from '@/utils/dailyStatusRows';

// ─── The wall in the diagram ──────────────────────────────────────────────────

const REGRESSIVE = {
  id: 1,
  def_type: 'Regressive',
  location: 'Area A',
  created_at: '2026-08-01T00:00:00.000Z',
  isactive: 'Yes',
  precursors: null,
  properties: {},
};

const LINEAR = {
  id: 2,
  def_type: 'Linear',
  location: 'Area B',
  created_at: '2026-08-01T01:00:00.000Z',
  isactive: 'Yes',
  precursors: null,
  properties: {},
};

const RAIN = {
  id: 3,
  def_type: 'Rainfall Event',
  location: 'Whole wall',
  created_at: '2026-08-02T00:00:00.000Z',
  isactive: 'Yes',
  precursors: [1, 2],
  properties: {},
};

/** A record out of the rain: `branch` is a trend id, or CHAIN_BRANCH_NEW. */
const outOfRain = (id, def_type, location, branch) => ({
  id,
  def_type,
  location,
  created_at: '2026-08-03T00:00:00.000Z',
  isactive: 'Yes',
  precursors: [RAIN.id],
  properties: { [CHAIN_BRANCH_KEY]: branch },
});

const CONTINUED_REGRESSIVE = outOfRain(4, 'Regressive', 'Area A', 1);
const CONTINUED_PROGRESSIVE = outOfRain(5, 'Progressive', 'Area B', 2);
const NEW_LINEAR = outOfRain(6, 'Linear', 'Area C', CHAIN_BRANCH_NEW);

const fetcherFor = (records) => {
  const byId = new Map(records.map((r) => [String(r.id), r]));
  return async (id) => byId.get(String(id)) ?? null;
};

const ids = (chain) => chain.map((n) => n.id);

// ─── 1. A new chain closes no branch ──────────────────────────────────────────

describe('a chain of its own, rooted at the event', () => {
  it('is a hint the helpers can recognise', () => {
    expect(isNewChainBranch(CHAIN_BRANCH_NEW)).toBe(true);
    expect(isNewChainBranch(1)).toBe(false);
    expect(isNewChainBranch(null)).toBe(false);
  });

  it('leaves every trend on the event still waiting', () => {
    expect(resolveOpenBranchIds(RAIN, [NEW_LINEAR])).toEqual([1, 2]);
  });

  it('does not take the event off the board', () => {
    const { heads, openBranchesById } = resolveChainHeads([REGRESSIVE, LINEAR, RAIN, NEW_LINEAR]);
    expect(heads.map((r) => r.id).sort()).toEqual([3, 6]);
    expect(openBranchesById.get('3')).toEqual([1, 2]);
  });

  it('stops the walk at the event rather than adopting the first trend', () => {
    expect(pickSpineParentId([1, 2], CHAIN_BRANCH_NEW)).toBeNull();
  });

  it('is written by the update flow as the branch hint', async () => {
    const calls = [];
    const client = {
      from: () => ({
        insert(rows) {
          calls.push({ op: 'insert', rows });
          return {
            select: () => ({ single: async () => ({ data: { id: 6 }, error: null }) }),
          };
        },
        update(patch) {
          return {
            eq: async (_c, id) => {
              calls.push({ op: 'update', patch, ids: [String(id)] });
              return { error: null };
            },
          };
        },
      }),
    };

    const res = await performDeformationUpdateFlow(
      client,
      RAIN.id,
      { def_type: 'Linear', location: 'Area C', properties: { AverageVelocity: 3 } },
      { chainBranchId: CHAIN_BRANCH_NEW, archiveOriginal: false }
    );

    expect(res.ok).toBe(true);
    // The event stays on the board — the trends standing on it are still live.
    expect(calls.every((c) => c.op !== 'update')).toBe(true);
    expect(calls[0].rows[0].precursors).toEqual([3]);
    expect(calls[0].rows[0].properties).toEqual({
      AverageVelocity: 3,
      [CHAIN_BRANCH_KEY]: CHAIN_BRANCH_NEW,
    });
  });
});

// ─── 2. One tip per chain, not per record ─────────────────────────────────────

describe('resolveChainTips', () => {
  it('gives a plain record exactly one chain', () => {
    const tips = resolveChainTips([REGRESSIVE, LINEAR]);
    expect(tips.map((t) => [t.record.id, t.branchId])).toEqual([
      [1, null],
      [2, null],
    ]);
  });

  it('splits an event several trends ran into, one chain each', () => {
    const tips = resolveChainTips([REGRESSIVE, LINEAR, RAIN]);
    expect(tips.map((t) => [t.record.id, t.branchId])).toEqual([
      [3, 1],
      [3, 2],
    ]);
    // Each chain knows the trend it is about, so the board can name it.
    expect(tips.map((t) => t.branchRecord.def_type)).toEqual(['Regressive', 'Linear']);
    expect(new Set(tips.map((t) => t.key)).size).toBe(2);
  });

  it('drops a chain that has been continued past the event', () => {
    const tips = resolveChainTips([REGRESSIVE, LINEAR, RAIN, CONTINUED_REGRESSIVE]);
    expect(tips.map((t) => [t.record.id, t.branchId])).toEqual([
      [3, 2],
      [4, null],
    ]);
  });

  it('reads the whole diagram as three chains, the event spent', () => {
    const tips = resolveChainTips([
      REGRESSIVE,
      LINEAR,
      RAIN,
      CONTINUED_REGRESSIVE,
      CONTINUED_PROGRESSIVE,
      NEW_LINEAR,
    ]);
    expect(tips.map((t) => t.record.id).sort()).toEqual([4, 5, 6]);
    expect(tips.every((t) => t.branchId === null)).toBe(true);
  });

  it('falls back to the event when the branch record has been archived', () => {
    // The trend was archived out from under the rain; the branch is still one
    // of the event's and still has to be listed.
    const tips = resolveChainTips([RAIN]);
    expect(tips.map((t) => [t.record.id, t.branchId, t.branchRecord])).toEqual([
      [3, 1, null],
      [3, 2, null],
    ]);
  });
});

// ─── 3. Each chain resolves to its OWN history ────────────────────────────────

describe('resolveTimelineChain along a named branch', () => {
  const fetchFn = fetcherFor([
    REGRESSIVE,
    LINEAR,
    RAIN,
    CONTINUED_REGRESSIVE,
    CONTINUED_PROGRESSIVE,
    NEW_LINEAR,
  ]);

  it('walks each chain standing on the event back to its own trend', async () => {
    const tips = resolveChainTips([REGRESSIVE, LINEAR, RAIN]);
    const chains = [];
    for (const tip of tips) {
      const { chain } = await resolveTimelineChain(tip.record, fetchFn, 50, {
        branchId: tip.branchId,
      });
      chains.push(ids(chain));
    }
    expect(chains).toEqual([
      [1, 3],
      [2, 3],
    ]);
  });

  it('collapses both chains onto the first trend when the branch is not named', async () => {
    // The bug this whole mechanism exists to prevent: without a branch, the
    // event's second chain is indistinguishable from its first.
    const { chain } = await resolveTimelineChain(RAIN, fetchFn);
    expect(ids(chain)).toEqual([1, 3]);
  });

  it('keeps the three chains out of the event apart', async () => {
    const walk = async (record) => ids((await resolveTimelineChain(record, fetchFn)).chain);
    expect(await walk(CONTINUED_REGRESSIVE)).toEqual([1, 3, 4]);
    expect(await walk(CONTINUED_PROGRESSIVE)).toEqual([2, 3, 5]);
    // The new chain starts AT the rain. It inherits neither trend.
    expect(await walk(NEW_LINEAR)).toEqual([3, 6]);
  });

  it('lists the trends it did not walk as related, not as history', async () => {
    const { chain } = await resolveTimelineChain(CONTINUED_PROGRESSIVE, fetchFn);
    const rainNode = chain.find((n) => n.id === 3);
    expect(rainNode.related.map((r) => r.id)).toEqual([1]);
  });
});

// ─── 4. Naming a chain ────────────────────────────────────────────────────────

describe('chainSubjectRecord', () => {
  it('names a chain after its movement, not the event it is sitting on', () => {
    const chain = [REGRESSIVE, RAIN];
    expect(chainSubjectRecord(chain).id).toBe(1);
    expect(chainLocationLabel(chain)).toBe('Area A');
  });

  it('falls back to the tail for a chain that is only ever an event', () => {
    expect(chainSubjectRecord([RAIN]).id).toBe(3);
    expect(chainLocationLabel([RAIN])).toBe('Whole wall');
  });

  it('gives two chains on one rainfall two different names', () => {
    expect(chainLocationLabel([REGRESSIVE, RAIN])).toBe('Area A');
    expect(chainLocationLabel([LINEAR, RAIN])).toBe('Area B');
  });
});

// ─── 5. The daily movement table keeps the chains it cannot print ─────────────

describe('the movement table under a shared rainfall', () => {
  it('prints the trend standing on the event, never the event', () => {
    const rows = buildStatusRows([REGRESSIVE, LINEAR, RAIN], { riskMode: 'band' });
    expect(rows.map((r) => [r.area, r.pattern]).sort()).toEqual([
      ['Area A', 'Regressive'],
      ['Area B', 'Linear'],
    ]);
  });

  it('prints a chain once, not once per event it has crossed', () => {
    const secondRain = { ...RAIN, id: 7, precursors: [1] };
    const rows = buildStatusRows([REGRESSIVE, LINEAR, RAIN, secondRain], { riskMode: 'band' });
    expect(rows.filter((r) => r.pattern === 'Regressive')).toHaveLength(1);
  });

  it('prints each chain out of the event separately once they have moved on', () => {
    const rows = buildStatusRows(
      [REGRESSIVE, LINEAR, RAIN, CONTINUED_REGRESSIVE, CONTINUED_PROGRESSIVE, NEW_LINEAR],
      { riskMode: 'band' }
    );
    expect(rows.map((r) => [r.area, r.pattern]).sort()).toEqual([
      ['Area A', 'Regressive'],
      ['Area B', 'Progressive'],
      ['Area C', 'Linear'],
    ]);
  });
});

// ─── 6. What a destructive action costs ───────────────────────────────────────

describe('resolveChainImpact', () => {
  it('reads a record with no history as standing alone', () => {
    expect(resolveChainImpact(REGRESSIVE, [REGRESSIVE, LINEAR]).kind).toBe('lone-record');
  });

  it('sees an archived predecessor behind a plain head', () => {
    // The Update flow archived the trend this record replaced, so the board no
    // longer holds it and nothing in the app can bring it back.
    const superseding = {
      id: 9,
      def_type: 'Progressive',
      location: 'Area A',
      isactive: 'Yes',
      precursors: [REGRESSIVE.id],
      properties: {},
    };
    const impact = resolveChainImpact(superseding, [superseding]);
    expect(impact.kind).toBe('predecessor-archived');
    expect(impact.liveBehind).toEqual([]);
  });

  it('sees a predecessor that is still on the board', () => {
    const superseding = {
      id: 9,
      def_type: 'Progressive',
      location: 'Area A',
      isactive: 'Yes',
      precursors: [REGRESSIVE.id],
      properties: {},
    };
    const impact = resolveChainImpact(superseding, [superseding, REGRESSIVE]);
    expect(impact.kind).toBe('predecessor-active');
    expect(impact.liveBehind).toEqual([1]);
  });

  it('counts the chains an event would hand back', () => {
    const open = resolveChainHeads([REGRESSIVE, LINEAR, RAIN]).openBranchesById.get('3');
    const impact = resolveChainImpact(RAIN, [REGRESSIVE, LINEAR, RAIN], open);
    expect(impact).toMatchObject({ kind: 'carries-chains', count: 2 });
  });

  it('does not treat a plain record as carrying chains, whatever it is handed', () => {
    const trendOnRain = { ...LINEAR, id: 10, precursors: [3] };
    // Only a merge event holds several chains open; a trend supersedes one thing.
    expect(resolveChainImpact(trendOnRain, [trendOnRain], [1, 2]).kind).toBe('predecessor-archived');
  });
});

// ─── 7. Deleting a head must not take its chain with it ───────────────────────

/**
 * Supabase-shaped mock for the delete flow. `rows` is the table; every write is
 * recorded so the ORDER of restore and delete can be asserted — it is the whole
 * safety property.
 */
const makeDeleteClient = ({ rows = [], readError = null, updateError = null, deleteError = null } = {}) => {
  const calls = [];
  const table = new Map(rows.map((r) => [String(r.id), { ...r }]));
  return {
    calls,
    table,
    from() {
      return {
        select() {
          return {
            eq(_col, id) {
              return {
                maybeSingle: async () => {
                  calls.push({ op: 'read', id: String(id) });
                  if (readError) return { data: null, error: readError };
                  return { data: table.get(String(id)) ?? null, error: null };
                },
              };
            },
          };
        },
        update(patch) {
          return {
            eq: async (_col, id) => {
              calls.push({ op: 'update', patch, id: String(id) });
              if (updateError) return { error: updateError };
              const row = table.get(String(id));
              if (row) Object.assign(row, patch);
              return { error: null };
            },
          };
        },
        delete() {
          return {
            eq: async (_col, id) => {
              calls.push({ op: 'delete', id: String(id) });
              if (deleteError) return { error: deleteError };
              table.delete(String(id));
              return { error: null };
            },
          };
        },
      };
    },
  };
};

/** The shape the Update flow leaves behind: an active head over an archived trend. */
const archivedTrend = { ...REGRESSIVE, isactive: 'No' };
const head = {
  id: 9,
  def_type: 'Progressive',
  location: 'Area A',
  isactive: 'Yes',
  precursors: [REGRESSIVE.id],
  properties: {},
};

describe('performRecordDeleteFlow', () => {
  it('puts the archived predecessor back on the board', async () => {
    const client = makeDeleteClient({ rows: [archivedTrend, head] });
    const res = await performRecordDeleteFlow(client, head);

    expect(res).toMatchObject({ ok: true, restored: 1 });
    expect(client.table.get('1').isactive).toBe('Yes');
    expect(client.table.has('9')).toBe(false);
  });

  it('restores BEFORE deleting, so a failure never strands the chain', async () => {
    const client = makeDeleteClient({ rows: [archivedTrend, head] });
    await performRecordDeleteFlow(client, head);

    expect(client.calls.map((c) => c.op)).toEqual(['read', 'update', 'delete']);
  });

  it('re-archives the predecessor when the delete fails', async () => {
    const client = makeDeleteClient({
      rows: [archivedTrend, head],
      deleteError: { message: 'nope' },
    });
    const res = await performRecordDeleteFlow(client, head);

    expect(res).toMatchObject({ ok: false, stage: 'delete', compensated: true });
    // Back exactly as it was: the head still stands, its history still behind it.
    expect(client.table.get('1').isactive).toBe('No');
    expect(client.table.has('9')).toBe(true);
  });

  it('deletes nothing when the predecessor cannot be restored', async () => {
    const client = makeDeleteClient({
      rows: [archivedTrend, head],
      updateError: { message: 'nope' },
    });
    const res = await performRecordDeleteFlow(client, head);

    expect(res).toMatchObject({ ok: false, stage: 'restore' });
    expect(client.calls.some((c) => c.op === 'delete')).toBe(false);
    expect(client.table.has('9')).toBe(true);
  });

  it('refuses to delete blind when the predecessor cannot be read', async () => {
    const client = makeDeleteClient({ rows: [archivedTrend, head], readError: { message: 'down' } });
    const res = await performRecordDeleteFlow(client, head);

    expect(res).toMatchObject({ ok: false, stage: 'read' });
    expect(client.calls.some((c) => c.op === 'delete')).toBe(false);
  });

  it('leaves an ALREADY ACTIVE predecessor alone', async () => {
    // A rainfall's trends were never archived — they are only hidden by the
    // event pointing at them. Nothing to restore, and nothing to compensate.
    const client = makeDeleteClient({ rows: [REGRESSIVE, LINEAR, RAIN] });
    const res = await performRecordDeleteFlow(client, RAIN);

    expect(res).toMatchObject({ ok: true, restored: null });
    expect(client.calls.map((c) => c.op)).toEqual(['read', 'delete']);
    expect(client.table.get('1').isactive).toBe('Yes');
  });

  it('deletes a record with no history without touching anything else', async () => {
    const client = makeDeleteClient({ rows: [REGRESSIVE] });
    const res = await performRecordDeleteFlow(client, REGRESSIVE);

    expect(res).toMatchObject({ ok: true, restored: null });
    expect(client.calls).toEqual([{ op: 'delete', id: '1' }]);
  });

  it('restores only the spine, never the related records ticked beside it', async () => {
    // precursors[1] is a blast the engineer linked; it was archived for its own
    // reasons and bringing it back would put it on the board uninvited.
    const archivedBlast = { id: 8, def_type: 'Blast Event', isactive: 'No', precursors: null };
    const withRelated = { ...head, precursors: [REGRESSIVE.id, 8] };
    const client = makeDeleteClient({ rows: [archivedTrend, archivedBlast, withRelated] });

    const res = await performRecordDeleteFlow(client, withRelated);

    expect(res).toMatchObject({ ok: true, restored: 1 });
    expect(client.table.get('8').isactive).toBe('No');
  });

  it('deletes anyway when the predecessor row is itself gone', async () => {
    const client = makeDeleteClient({ rows: [head] });
    const res = await performRecordDeleteFlow(client, head);

    expect(res).toMatchObject({ ok: true, restored: null });
    expect(client.table.has('9')).toBe(false);
  });

  it('leaves the chain readable on the board afterwards', async () => {
    // The end-to-end point: before the delete the board shows the Progressive;
    // after it, the Regressive it replaced — never nothing.
    const client = makeDeleteClient({ rows: [archivedTrend, head] });
    expect(resolveChainTips([head]).map((t) => t.record.id)).toEqual([9]);

    await performRecordDeleteFlow(client, head);

    const board = [...client.table.values()].filter((r) => r.isactive === 'Yes');
    expect(resolveChainTips(board).map((t) => t.record.id)).toEqual([1]);
  });
});
