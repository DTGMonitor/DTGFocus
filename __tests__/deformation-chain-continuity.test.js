/**
 * Chain continuity across a Rainfall/Blast event.
 *
 * Several chains arrive at one rainfall: it becomes the CURRENT record of every
 * trend that ran into it, and stays that way until each of them is either
 * continued past it or archived with it. One trend turning into a Progressive
 * moves that chain on; the others are still sitting on the rain.
 *
 * Two things follow, and these tests pin both:
 *
 *   1. head detection has to be branch-aware — continuing one chain out of an
 *      event must not retire the event for the chains still on it;
 *   2. a record continuing one of those chains has to record WHICH, so its
 *      timeline walks back out of the event along its own trend instead of
 *      collapsing onto whichever trend happened to be listed first.
 */

import {
  resolveTimelineChain,
  resolveChainHeads,
  resolveOpenBranchIds,
  performDeformationUpdateFlow,
  performEventArchiveFlow,
  buildChainContinuationPayload,
  archiveDefRecords,
  isMergeEventRecord,
  isMergeEventType,
  pickSpineParentId,
  getChainBranchId,
  CHAIN_BRANCH_KEY,
} from '@/utils/tabHelpers';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const trend = (id, overrides = {}) => ({
  id,
  def_type: 'Regressive',
  location: `Area ${id}`,
  created_at: '2026-08-01T00:00:00.000Z',
  isactive: 'Yes',
  properties: { Vmax1: id },
  precursors: null,
  ...overrides,
});

const rainfall = (id, precursors, overrides = {}) => ({
  id,
  def_type: 'Rainfall Event',
  location: 'Whole wall',
  created_at: '2026-08-02T00:00:00.000Z',
  isactive: 'Yes',
  properties: {},
  precursors,
  ...overrides,
});

/** A record continuing `branchId` out of `eventId`. */
const continuation = (id, eventId, branchId, overrides = {}) =>
  trend(id, {
    def_type: 'Progressive',
    precursors: [eventId],
    properties: { [CHAIN_BRANCH_KEY]: branchId },
    ...overrides,
  });

const fetcherFor = (records) => {
  const byId = new Map(records.map((r) => [String(r.id), r]));
  return async (id) => byId.get(String(id)) ?? null;
};

/**
 * Supabase-shaped mock recording every write. `insert(...).select()` resolves to
 * the inserted rows with ids; the same builder also answers `.single()`, which
 * is what the update flow uses.
 */
const makeClient = ({ insertError = null, updateError = null } = {}) => {
  const calls = [];
  return {
    calls,
    from() {
      return {
        insert(rows) {
          calls.push({ op: 'insert', rows });
          const data = (Array.isArray(rows) ? rows : [rows]).map((_, i) => ({ id: 200 + i }));
          return {
            select: () =>
              Object.assign(
                Promise.resolve(
                  insertError ? { data: null, error: insertError } : { data, error: null }
                ),
                {
                  single: async () =>
                    insertError ? { data: null, error: insertError } : { data: data[0], error: null },
                }
              ),
          };
        },
        delete() {
          return {
            eq: async (_col, id) => {
              calls.push({ op: 'delete', ids: [String(id)] });
              return { error: null };
            },
            in: async (_col, ids) => {
              calls.push({ op: 'delete', ids: ids.map(String) });
              return { error: null };
            },
          };
        },
        update(patch) {
          return {
            eq: async (_col, id) => {
              calls.push({ op: 'update', patch, ids: [String(id)] });
              return { error: updateError };
            },
            in: async (_col, ids) => {
              calls.push({ op: 'update', patch, ids: ids.map(String) });
              return { error: updateError };
            },
          };
        },
      };
    },
  };
};

// ─── Branch identification ────────────────────────────────────────────────────

describe('chain branch identification', () => {
  it('treats only rainfall and blast as merge events', () => {
    expect(isMergeEventType('Rainfall Event')).toBe(true);
    expect(isMergeEventRecord({ def_type: 'Blast Event' })).toBe(true);
    expect(isMergeEventRecord({ def_type: 'Regressive' })).toBe(false);
    expect(isMergeEventRecord(null)).toBe(false);
  });

  it('falls back to the first precursor when nothing names a branch', () => {
    expect(pickSpineParentId([5, 6, 7], null)).toBe(5);
    // A hint that does not name one of them is not a way to leave the chain.
    expect(pickSpineParentId([5, 6, 7], 99)).toBe(5);
    expect(pickSpineParentId([], 5)).toBeNull();
  });

  it('follows the named branch, comparing ids as strings', () => {
    expect(pickSpineParentId([5, 6, 7], 6)).toBe(6);
    expect(pickSpineParentId([5, 6, 7], '6')).toBe(6);
  });

  it('reads a branch off properties, and reports its absence as null', () => {
    expect(getChainBranchId({ properties: { [CHAIN_BRANCH_KEY]: 6 } })).toBe(6);
    expect(getChainBranchId({ properties: {} })).toBeNull();
    expect(getChainBranchId(null)).toBeNull();
  });
});

// ─── Open branches ────────────────────────────────────────────────────────────

describe('resolveOpenBranchIds', () => {
  const rain = rainfall(4, [1, 2, 3]);

  it('reports every chain as open while nothing has continued', () => {
    expect(resolveOpenBranchIds(rain, [])).toEqual([1, 2, 3]);
  });

  it('closes only the chain a successor names', () => {
    expect(resolveOpenBranchIds(rain, [continuation(5, 4, 2)])).toEqual([1, 3]);
  });

  it('reads a successor with no branch as continuing the first chain', () => {
    // How the timeline walked before branches existed, so that is what such a
    // record means.
    const legacy = trend(5, { precursors: [4], properties: {} });
    expect(resolveOpenBranchIds(rain, [legacy])).toEqual([2, 3]);
  });

  it('has no branches to open when the event started its own chain', () => {
    expect(resolveOpenBranchIds(rainfall(4, null), [])).toEqual([]);
  });
});

// ─── Head detection ───────────────────────────────────────────────────────────

describe('resolveChainHeads', () => {
  it('stands the event up as the current record of every chain that ran into it', () => {
    // A, B, C -> rain. The trends are rolled up into the event; the event is
    // what the board shows.
    const records = [trend(1), trend(2), trend(3), rainfall(4, [1, 2, 3])];
    const { heads, openBranchesById } = resolveChainHeads(records);

    expect(heads.map((r) => r.id)).toEqual([4]);
    expect(openBranchesById.get('4')).toEqual([1, 2, 3]);
  });

  it('keeps the event for B and C when A has become a Progressive', () => {
    const records = [
      trend(1),
      trend(2),
      trend(3),
      rainfall(4, [1, 2, 3]),
      continuation(5, 4, 1),
    ];
    const { heads, openBranchesById } = resolveChainHeads(records);

    // Chain A's current record is the Progressive; B and C are still on the rain.
    expect(heads.map((r) => r.id).sort()).toEqual([4, 5]);
    expect(openBranchesById.get('4')).toEqual([2, 3]);
  });

  it('retires the event once every chain has moved past it', () => {
    const records = [
      trend(1),
      trend(2),
      rainfall(4, [1, 2]),
      continuation(5, 4, 1),
      continuation(6, 4, 2),
    ];
    const { heads } = resolveChainHeads(records);

    expect(heads.map((r) => r.id).sort()).toEqual([5, 6]);
  });

  it('leaves a chain the event never touched standing on its own', () => {
    // A blast is local: chain C was not selected as a precursor, so it carries on
    // as its own chain rather than joining the blast.
    const records = [
      trend(1),
      trend(2),
      trend(3),
      { ...rainfall(4, [1, 2]), def_type: 'Blast Event' },
    ];
    const { heads } = resolveChainHeads(records);

    expect(heads.map((r) => r.id).sort()).toEqual([3, 4]);
  });

  it('supersedes a plain record the moment anything points back at it', () => {
    const records = [trend(1), trend(2, { precursors: [1] })];
    expect(resolveChainHeads(records).heads.map((r) => r.id)).toEqual([2]);
  });

  it('retires an event that started its own chain like any other record', () => {
    // A rainfall raised with no precursors IS the root of a new chain, so the
    // record continuing it replaces it outright.
    const records = [rainfall(4, null), trend(5, { precursors: [4] })];
    expect(resolveChainHeads(records).heads.map((r) => r.id)).toEqual([5]);
  });
});

// ─── Timeline resolution through a merge event ────────────────────────────────

describe('resolveTimelineChain across a Rainfall Event', () => {
  const t1 = trend(1);
  const t2 = trend(2);
  const rain = rainfall(4, [1, 2]);

  it('walks a continuation back to its OWN chain, not to whichever was listed first', async () => {
    const fromA = continuation(5, 4, 1);
    const fromB = continuation(6, 4, 2);
    const fetchFn = fetcherFor([t1, t2, rain, fromA, fromB]);

    const a = await resolveTimelineChain(fromA, fetchFn);
    const b = await resolveTimelineChain(fromB, fetchFn);

    expect(a.error).toBeNull();
    expect(a.chain.map((r) => r.id)).toEqual([1, 4, 5]);
    expect(b.error).toBeNull();
    expect(b.chain.map((r) => r.id)).toEqual([2, 4, 6]);
  });

  it('lists the chains it did not walk as the event node’s related precursors', async () => {
    const fromB = continuation(6, 4, 2);
    const { chain } = await resolveTimelineChain(fromB, fetcherFor([t1, t2, rain, fromB]));

    expect(chain.find((r) => r.id === 4).related.map((r) => r.id)).toEqual([1]);
  });

  it('still walks precursors[0] for records written before branches existed', async () => {
    const legacy = trend(7, { precursors: [4], properties: {} });
    const { chain } = await resolveTimelineChain(legacy, fetcherFor([t1, t2, rain, legacy]));

    expect(chain.map((r) => r.id)).toEqual([1, 4, 7]);
  });
});

// ─── Writes ───────────────────────────────────────────────────────────────────

describe('performDeformationUpdateFlow', () => {
  const newRecord = { def_type: 'Progressive', location: 'Area 2', properties: { Vmax1: 9 } };

  it('records which chain the replacement continues', async () => {
    const client = makeClient();
    const res = await performDeformationUpdateFlow(client, 4, newRecord, { chainBranchId: 2 });

    expect(res.ok).toBe(true);
    const insert = client.calls.find((c) => c.op === 'insert');
    expect(insert.rows[0].precursors).toEqual([4]);
    expect(insert.rows[0].properties).toEqual({ Vmax1: 9, [CHAIN_BRANCH_KEY]: 2 });
    expect(res.inserted).toEqual({ id: 200 });
  });

  it('leaves properties untouched when there is no branch to name', async () => {
    const client = makeClient();
    await performDeformationUpdateFlow(client, 4, newRecord);

    expect(client.calls.find((c) => c.op === 'insert').rows[0].properties).toEqual({ Vmax1: 9 });
  });

  it('archives the record it supersedes, by default', async () => {
    const client = makeClient();
    await performDeformationUpdateFlow(client, 4, newRecord);

    expect(client.calls[0]).toEqual({ op: 'update', patch: { isactive: 'No' }, ids: ['4'] });
  });

  it('leaves the event standing when other chains are still on it', async () => {
    // Continuing chain A must not take the rain away from B and C. The event
    // stops being a head on its own once every branch has moved past it.
    const client = makeClient();
    const res = await performDeformationUpdateFlow(client, 4, newRecord, {
      chainBranchId: 1,
      archiveOriginal: false,
    });

    expect(res.ok).toBe(true);
    expect(client.calls.some((c) => c.op === 'update')).toBe(false);
    expect(client.calls.find((c) => c.op === 'insert').rows[0].precursors).toEqual([4]);
  });

  it('restores the archived original when the replacement cannot be written', async () => {
    const client = makeClient({ insertError: { message: 'nope' } });
    const res = await performDeformationUpdateFlow(client, 4, newRecord);

    expect(res.ok).toBe(false);
    expect(res.stage).toBe('insert');
    expect(res.compensated).toBe(true);
    expect(client.calls.some((c) => c.op === 'update' && c.patch.isactive === 'Yes')).toBe(true);
  });

  it('has nothing to compensate when it archived nothing', async () => {
    const client = makeClient({ insertError: { message: 'nope' } });
    const res = await performDeformationUpdateFlow(client, 4, newRecord, {
      archiveOriginal: false,
    });

    expect(res.ok).toBe(false);
    expect(res.compensated).toBe(false);
    expect(client.calls.some((c) => c.op === 'update')).toBe(false);
  });
});

describe('buildChainContinuationPayload', () => {
  const source = trend(2, {
    start: '2026-07-31T00:00:00.000Z',
    notes: 'notes 2',
    wallfolder_id: 77,
    tarp_level: 'TARP 2',
  });
  const rain = rainfall(4, [1, 2]);
  const payload = buildChainContinuationPayload(source, rain, {
    createdAt: '2026-08-03T00:00:00.000Z',
  });

  it('re-states the trend with the same values', () => {
    expect(payload.def_type).toBe(source.def_type);
    expect(payload.location).toBe(source.location);
    expect(payload.tarp_level).toBe(source.tarp_level);
    expect(payload.notes).toBe(source.notes);
    expect(payload.wallfolder_id).toBe(source.wallfolder_id);
    expect(payload.properties.Vmax1).toBe(source.properties.Vmax1);
  });

  it('stands on the board, dated now, but keeps the trend’s own start', () => {
    expect(payload.isactive).toBe('Yes');
    expect(payload.created_at).toBe('2026-08-03T00:00:00.000Z');
    expect(payload.start).toBe(source.start);
  });

  it('points at the event and names the chain it continues', () => {
    expect(payload.precursors).toEqual([4]);
    expect(payload.properties[CHAIN_BRANCH_KEY]).toBe(2);
  });

  it('does not mutate the record it copies', () => {
    expect(source.properties[CHAIN_BRANCH_KEY]).toBeUndefined();
  });
});

describe('performEventArchiveFlow', () => {
  // The 778 case: chain 700 had already become a Progressive, chains 707 and 605
  // were still sitting on the rain when it was archived.
  const rain = rainfall(716, [707, 700, 605]);
  const stillOnTheRain = [trend(707), trend(605)];

  it('carries each open chain forward instead of closing it', async () => {
    const client = makeClient();
    const res = await performEventArchiveFlow(client, {
      event: rain,
      precursorRecords: stillOnTheRain,
    });

    expect(res.ok).toBe(true);
    expect(res.inserted).toHaveLength(2);

    const insert = client.calls.find((c) => c.op === 'insert');
    expect(insert.rows.map((r) => r.properties[CHAIN_BRANCH_KEY])).toEqual([707, 605]);
    expect(insert.rows.every((r) => r.precursors[0] === 716 && r.isactive === 'Yes')).toBe(true);
  });

  it('archives the event and the trends its copies now stand for', async () => {
    const client = makeClient();
    await performEventArchiveFlow(client, { event: rain, precursorRecords: stillOnTheRain });

    // Chain 700 is NOT in the list: its head is the Progressive, not the rain.
    expect(client.calls.find((c) => c.op === 'update')).toEqual({
      op: 'update',
      patch: { isactive: 'No' },
      ids: ['716', '707', '605'],
    });
  });

  it('archives nothing when the chains cannot be carried forward', async () => {
    // Archiving first would strand them: the event off the board with nothing
    // standing in its place.
    const client = makeClient({ insertError: { message: 'nope' } });
    const res = await performEventArchiveFlow(client, {
      event: rain,
      precursorRecords: stillOnTheRain,
    });

    expect(res.ok).toBe(false);
    expect(res.stage).toBe('insert');
    expect(client.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('removes the copies again when the event cannot be archived', async () => {
    const client = makeClient({ updateError: { message: 'nope' } });
    const res = await performEventArchiveFlow(client, {
      event: rain,
      precursorRecords: stillOnTheRain,
    });

    expect(res.ok).toBe(false);
    expect(res.stage).toBe('archive');
    expect(res.compensated).toBe(true);
    expect(client.calls.find((c) => c.op === 'delete').ids).toEqual(['200', '201']);
  });

  it('archives a bare event with no chains on it', async () => {
    const client = makeClient();
    const res = await performEventArchiveFlow(client, { event: rainfall(4, null) });

    expect(res.ok).toBe(true);
    expect(client.calls).toEqual([{ op: 'update', patch: { isactive: 'No' }, ids: ['4'] }]);
  });
});

describe('archiveDefRecords', () => {
  it('takes several records off the board in one write', async () => {
    const client = makeClient();
    const res = await archiveDefRecords(client, [4, 2, 3]);

    expect(res.ok).toBe(true);
    expect(client.calls).toEqual([
      { op: 'update', patch: { isactive: 'No' }, ids: ['4', '2', '3'] },
    ]);
  });

  it('archives a lone record through eq, not in', async () => {
    const client = makeClient();
    await archiveDefRecords(client, [4]);
    expect(client.calls).toEqual([{ op: 'update', patch: { isactive: 'No' }, ids: ['4'] }]);
  });

  it('writes nothing when there is nothing to archive', async () => {
    const client = makeClient();
    expect(await archiveDefRecords(client, [])).toEqual({ ok: true });
    expect(client.calls).toEqual([]);
  });

  it('reports a failed archive rather than claiming success', async () => {
    const client = makeClient({ updateError: { message: 'nope' } });
    const res = await archiveDefRecords(client, [4, 2]);
    expect(res.ok).toBe(false);
    expect(res.error).toEqual({ message: 'nope' });
  });
});
