/**
 * Property-based tests for the Sensor Detail Tabs Redesign.
 *
 * Each test runs a minimum of 100 iterations via fast-check.
 * Tag format: // Feature: sensor-detail-tabs-redesign, Property N: <text>
 */
import fc from 'fast-check';
import { useEffect, useRef, useState } from 'react';
import { act, render } from '@testing-library/react';

import {
  resolveDetectedBy,
  formatTimestamp,
  sortDowntimeRecords,
  sortAlarmRecords,
  getCauseOptions,
  resolveTimelineChain,
  performDeformationUpdateFlow,
  normalizePrecursorss,
} from '@/utils/tabHelpers';
import { fromUTC } from '@/utils/timezoneUtils';
import { CAUSE_OPTIONS } from '@/config/formConfig';

const RUNS = { numRuns: 100 };
const TIMEZONES = ['Asia/Jakarta', 'Australia/Perth', 'UTC', 'America/New_York', 'Europe/London'];

// Robust ISO-timestamp generator (avoids fast-check's invalid-date sentinel).
const MS_2000 = Date.UTC(2000, 0, 1);
const MS_2035 = Date.UTC(2035, 0, 1);
const isoArb = fc.integer({ min: MS_2000, max: MS_2035 }).map((t) => new Date(t).toISOString());

// ─── Property 1: Tab reset on sensor change ────────────────────────────────────
// Feature: sensor-detail-tabs-redesign, Property 1: Tab reset on sensor change
//
// Validates the reset rule used by SensorDetail's sensor.id-change effect:
// switching to a sensor with a different id always resets activeTab to
// 'deformation', regardless of which tab was active before.
function useTabResetHarness(sensorId) {
  const [activeTab, setActiveTab] = useState('deformation');
  const prevId = useRef(sensorId);
  useEffect(() => {
    if (sensorId !== prevId.current) {
      prevId.current = sensorId;
      setActiveTab('deformation');
    }
  }, [sensorId]);
  // expose a setter for the test to mutate the tab before the change
  useTabResetHarness.lastSetTab = setActiveTab;
  useTabResetHarness.lastTab = activeTab;
  return activeTab;
}

function Harness({ sensorId }) {
  const tab = useTabResetHarness(sensorId);
  return <span data-testid="tab">{tab}</span>;
}

test('Property 1: activeTab resets to deformation on sensor id change', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 1000 }),
      fc.integer({ min: 1001, max: 2000 }),
      fc.constantFrom('deformation', 'alarm', 'dqp', 'downtime'),
      (idA, idB, priorTab) => {
        const { getByTestId, rerender, unmount } = render(<Harness sensorId={idA} />);

        // Simulate the user having navigated to an arbitrary tab.
        act(() => {
          useTabResetHarness.lastSetTab(priorTab);
        });
        expect(getByTestId('tab').textContent).toBe(priorTab);

        // Switch to a different sensor.
        act(() => {
          rerender(<Harness sensorId={idB} />);
        });

        expect(getByTestId('tab').textContent).toBe('deformation');
        unmount();
      }
    ),
    RUNS
  );
});

// ─── Property 2: UUID-to-name resolution is consistent across tabs ─────────────
// Feature: sensor-detail-tabs-redesign, Property 2: UUID-to-name resolution
test('Property 2: resolveDetectedBy returns full_name when present, raw UUID otherwise', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({ id: fc.uuid(), full_name: fc.string({ minLength: 1, maxLength: 20 }) }),
        { maxLength: 10 }
      ),
      fc.uuid(),
      (crosscheckers, uuid) => {
        const result = resolveDetectedBy(uuid, crosscheckers);
        const match = crosscheckers.find((c) => String(c.id) === String(uuid));
        if (match) {
          expect(result).toBe(match.full_name);
        } else {
          expect(result).toBe(uuid);
        }
      }
    ),
    RUNS
  );
});

// ─── Property 3: Timestamp display uses fromUTC ────────────────────────────────
// Feature: sensor-detail-tabs-redesign, Property 3: Timestamp display uses fromUTC
test('Property 3: formatTimestamp is derived from fromUTC, never the raw UTC string', () => {
  fc.assert(
    fc.property(
      isoArb,
      fc.constantFrom(...TIMEZONES),
      (iso, tz) => {
        const expected = new Date(fromUTC(iso, tz)).toLocaleString('en-AU', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          // fromUTC returns a tz-naive ISO carrying site wall-clock components;
          // read them back in UTC so the assertion is runtime-independent.
          timeZone: 'UTC',
        });
        expect(formatTimestamp(iso, tz)).toBe(expected);
      }
    ),
    RUNS
  );
});

// ─── Property 4: Downtime records ordered by from descending (nulls last) ──────
// Feature: sensor-detail-tabs-redesign, Property 4: Downtime records ordered by from descending
test('Property 4: sortDowntimeRecords orders by from desc, nulls last', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          id: fc.uuid(),
          from: fc.option(isoArb, { nil: null }),
        }),
        { maxLength: 20 }
      ),
      (records) => {
        const sorted = sortDowntimeRecords(records);
        const nonNull = sorted.filter((r) => r.from !== null && r.from !== undefined);
        const firstNullIdx = sorted.findIndex((r) => r.from === null || r.from === undefined);

        // (a) non-null `from` values are non-increasing
        for (let i = 0; i < nonNull.length - 1; i++) {
          expect(new Date(nonNull[i].from).getTime()).toBeGreaterThanOrEqual(
            new Date(nonNull[i + 1].from).getTime()
          );
        }
        // (b) once a null appears, everything after is null
        if (firstNullIdx !== -1) {
          for (let i = firstNullIdx; i < sorted.length; i++) {
            expect(sorted[i].from == null).toBe(true);
          }
        }
        // (c) no records lost
        expect(sorted.length).toBe(records.length);
      }
    ),
    RUNS
  );
});

// ─── Property 5: Alarm records ordered by created_at descending ────────────────
// Feature: sensor-detail-tabs-redesign, Property 5: Alarm records ordered by created_at descending
test('Property 5: sortAlarmRecords orders by created_at descending', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          id: fc.uuid(),
          created_at: isoArb,
        }),
        { maxLength: 20 }
      ),
      (records) => {
        const sorted = sortAlarmRecords(records);
        for (let i = 0; i < sorted.length - 1; i++) {
          expect(new Date(sorted[i].created_at).getTime()).toBeGreaterThanOrEqual(
            new Date(sorted[i + 1].created_at).getTime()
          );
        }
        expect(sorted.length).toBe(records.length);
      }
    ),
    RUNS
  );
});

// ─── Property 6: Cause options match CAUSE_OPTIONS for the selected reason ──────
// Feature: sensor-detail-tabs-redesign, Property 6: Cause options match CAUSE_OPTIONS
test('Property 6: getCauseOptions returns exactly CAUSE_OPTIONS[reason]', () => {
  fc.assert(
    fc.property(fc.constantFrom(...Object.keys(CAUSE_OPTIONS)), (reason) => {
      expect(getCauseOptions(reason)).toEqual(CAUSE_OPTIONS[reason]);
    }),
    RUNS
  );
});

// ─── Mock Supabase client for update-flow properties ───────────────────────────
function makeClient({ archiveError = null, insertError = null } = {}) {
  const calls = { updates: [], inserts: [] };
  const client = {
    from() {
      return {
        update(payload) {
          return {
            eq(col, val) {
              calls.updates.push({ payload, col, val });
              // archive step sets isactive:'No', compensation sets 'Yes'
              const err = payload.isactive === 'No' ? archiveError : null;
              return Promise.resolve({ error: err });
            },
          };
        },
        insert(rows) {
          calls.inserts.push({ rows });
          return {
            select() {
              return {
                single() {
                  return Promise.resolve(
                    insertError
                      ? { data: null, error: insertError }
                      : { data: { id: 'new-record-id' }, error: null }
                  );
                },
              };
            },
          };
        },
      };
    },
  };
  return { client, calls };
}

// ─── Property 7: Update flow preserves precursors linkage ───────────────────────
// Feature: sensor-detail-tabs-redesign, Property 7: Update flow preserves precursors linkage
test('Property 7: successful update flow archives original and links precursors', async () => {
  await fc.assert(
    fc.asyncProperty(fc.uuid(), async (originalId) => {
      const { client, calls } = makeClient();
      const result = await performDeformationUpdateFlow(client, originalId, { def_type: 'Linear' });

      expect(result.ok).toBe(true);
      // (a) original archived
      const archive = calls.updates.find((u) => u.payload.isactive === 'No');
      expect(archive).toBeTruthy();
      expect(archive.val).toBe(originalId);
      // (b) new record links precursors as an INT[] with the archived original first
      expect(calls.inserts).toHaveLength(1);
      expect(calls.inserts[0].rows[0].precursors).toEqual([originalId]);
    }),
    RUNS
  );
});

// ─── Property 8: Compensating transaction restores isactive on insert failure ──
// Feature: sensor-detail-tabs-redesign, Property 8: Compensating transaction on insert failure
test('Property 8: insert failure triggers compensating restore of isactive=Yes', async () => {
  await fc.assert(
    fc.asyncProperty(fc.uuid(), async (originalId) => {
      const { client, calls } = makeClient({ insertError: { message: 'insert failed' } });
      const result = await performDeformationUpdateFlow(client, originalId, { def_type: 'Linear' });

      expect(result.ok).toBe(false);
      expect(result.stage).toBe('insert');
      // compensation restores isactive='Yes' for the original id
      const restore = calls.updates.find((u) => u.payload.isactive === 'Yes' && u.val === originalId);
      expect(restore).toBeTruthy();
    }),
    RUNS
  );
});

// ─── Property 9: Timeline chain is ordered from root to current ────────────────
// Feature: sensor-detail-tabs-redesign, Property 9: Timeline chain ordered root to current
test('Property 9: resolveTimelineChain returns root-to-current ordered chain', async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 10 }), async (depth) => {
      // Build a linked chain r0(root, precursors=null) -> r1 -> ... -> r{depth}
      const records = [];
      for (let i = 0; i <= depth; i++) {
        records.push({
          id: `id-${i}`,
          precursors: i === 0 ? null : `id-${i - 1}`,
          created_at: new Date(2020, 0, 1 + i).toISOString(),
        });
      }
      const byId = Object.fromEntries(records.map((r) => [r.id, r]));
      const fetchFn = (id) => Promise.resolve(byId[id]);
      const latest = records[depth];

      const { chain, error } = await resolveTimelineChain(latest, fetchFn, 50);

      expect(error).toBeNull();
      expect(chain).toHaveLength(depth + 1);
      expect(chain[0].precursors).toBeNull();
      expect(chain[chain.length - 1].id).toBe(latest.id);
      for (let i = 0; i < chain.length - 1; i++) {
        expect(chain[i + 1].precursors).toBe(chain[i].id);
      }
    }),
    RUNS
  );
});

// ─── Property 10: normalizePrecursorss coerces every shape to a clean array ──────
// Feature: precursors-int-array, Property 10: normalizePrecursorss normalization
test('Property 10: normalizePrecursorss returns a null/undefined-free array for any input', () => {
  fc.assert(
    fc.property(
      fc.oneof(
        fc.constant(null),
        fc.constant(undefined),
        fc.integer(),
        fc.array(fc.oneof(fc.integer(), fc.constant(null), fc.constant(undefined))),
      ),
      (input) => {
        const out = normalizePrecursorss(input);
        expect(Array.isArray(out)).toBe(true);
        expect(out.every((v) => v !== null && v !== undefined)).toBe(true);
        if (input === null || input === undefined) expect(out).toHaveLength(0);
        if (typeof input === 'number') expect(out).toEqual([input]);
      },
    ),
    RUNS
  );
});

// ─── Property 11: array precursorss — linear spine + non-primary `related` ───────
// Feature: precursors-int-array, Property 11: first precursors forms spine, rest are `related`
test('Property 11: resolveTimelineChain walks precursors[0] and lists the rest as related', async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 4 }), async (depth, extras) => {
      // Spine s0(root) -> s1 -> ... -> s{depth}; the tail also links `extras`
      // standalone event records via the non-primary slots of precursors[].
      const records = [];
      for (let i = 0; i <= depth; i++) {
        records.push({ id: `s-${i}`, def_type: 'Progressive', precursors: i === 0 ? [] : [`s-${i - 1}`] });
      }
      const eventIds = [];
      for (let e = 0; e < extras; e++) {
        const id = `evt-${e}`;
        eventIds.push(id);
        records.push({ id, def_type: 'Blast Event', precursors: [] });
      }
      // Append event ids after the primary spine parent on the tail record.
      records[depth].precursors = [`s-${depth - 1}`, ...eventIds];

      const byId = Object.fromEntries(records.map((r) => [r.id, r]));
      const fetchFn = (id) => Promise.resolve(byId[id]);

      const { chain, error } = await resolveTimelineChain(records[depth], fetchFn, 50);

      expect(error).toBeNull();
      // Spine length is unaffected by the extra event links.
      expect(chain).toHaveLength(depth + 1);
      expect(chain[0].id).toBe('s-0');
      const tail = chain[chain.length - 1];
      expect(tail.id).toBe(`s-${depth}`);
      // Non-primary precursorss surface as `related`, primary spine parent does not.
      expect(tail.related.map((r) => r.id)).toEqual(eventIds);
      // Interior spine nodes have no extras.
      expect(chain[0].related).toEqual([]);
    }),
    RUNS
  );
});
