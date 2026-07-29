/**
 * Property-based tests for the Comprehensive Radar Report.
 *
 * Each property test runs a minimum of 100 iterations via fast-check.
 * Tag format: // Feature: comprehensive-radar-report, Property N: <text>
 */
import fc from 'fast-check';

import { trimChain, isTrimmedHeadTrueRoot, DAY_MS } from '@/utils/reportTimeline';
import {
  computeAvailability,
  toGaugeShape,
  windowForFrequency,
  MECHANICAL_REASONS,
  USE_OF_REASONS,
} from '@/utils/reportAvailability';
import { aggregateAlarmCauses, countValidTotal, deriveAlarmTone, ALARM_HIERARCHY } from '@/utils/reportAlarms';
import {
  folderGroupKey,
  isArchivedFolder,
  folderDisplayLabel,
  nodeInWindow,
  chainInWindow,
  shouldIncludeChain,
  groupTimelinesByFolder,
  folderChangedInWindow,
} from '@/utils/reportWallFolders';
import { buildKeyFindings } from '@/components/admin/Radar/report/blocks/KeyFindings';
import { severityColor, uptimeSeverityLabel, SEV, ALARM_SEV } from '@/components/admin/Radar/report/severity';
import { pivotParameterTree, buildRadarRecord } from '@/utils/buildRadarRecord';
import { buildRadarData } from '@/components/Radars/Live/radarChart';
import { CAUSE_OPTIONS } from '@/config/formConfig';

const RUNS = { numRuns: 100 };
const NOW = new Date('2026-07-17T12:00:00Z').getTime();
const HOUR_MS = 60 * 60 * 1000;

// ── Arbitraries ───────────────────────────────────────────────────────────────

/** A chain of nodes ordered root → current, with plausible timestamps. */
const chainArb = (minLength = 1, maxLength = 8) =>
  fc
    .array(fc.integer({ min: 0, max: 240 }), { minLength, maxLength })
    .map((agesHours) => {
      // Sort descending so the root is oldest and the tail is newest.
      const sorted = [...agesHours].sort((a, b) => b - a);
      return sorted.map((h, i) => ({
        id: i + 1,
        def_type: 'Linear',
        created_at: new Date(NOW - h * HOUR_MS).toISOString(),
      }));
    });

const ALL_REASONS = [...MECHANICAL_REASONS, ...USE_OF_REASONS];

/** Downtime records, some open-ended, spanning a window around NOW. */
const downtimeRecordsArb = fc.array(
  fc.record({
    reason: fc.constantFrom(...ALL_REASONS),
    fromOffsetH: fc.integer({ min: -48, max: 24 }),
    durationH: fc.integer({ min: 0, max: 30 }),
    open: fc.boolean(),
  }),
  { maxLength: 8 }
).map((rows) =>
  rows.map((r) => ({
    reason: r.reason,
    from: new Date(NOW - r.fromOffsetH * HOUR_MS).toISOString(),
    to: r.open ? null : new Date(NOW - r.fromOffsetH * HOUR_MS + r.durationH * HOUR_MS).toISOString(),
  }))
);

const alarmRecordsArb = fc.array(
  fc.record({
    cause: fc.oneof(
      fc.constantFrom(...CAUSE_OPTIONS.False, ...CAUSE_OPTIONS.Valid),
      fc.constant(''),
      fc.constant('Some Unlisted Cause'),
    ),
    reason: fc.constantFrom('Valid', 'False'),
  }),
  { maxLength: 30 }
);

// ── trimChain ─────────────────────────────────────────────────────────────────

describe('trimChain', () => {
  // Feature: comprehensive-radar-report, Property 1: Trimmed chain is a contiguous suffix
  // Validates: Requirements 3.3, 3.6, 3.7, 3.8
  it('Property 1: returns a non-empty contiguous suffix that always contains the tail', () => {
    fc.assert(
      fc.property(chainArb(1, 8), (chain) => {
        const trimmed = trimChain(chain, NOW);

        expect(trimmed.length).toBeGreaterThan(0);
        expect(trimmed.length).toBeLessThanOrEqual(chain.length);

        // Contiguous suffix: identical to the last N entries, by reference.
        const suffix = chain.slice(chain.length - trimmed.length);
        expect(trimmed).toEqual(suffix);
        trimmed.forEach((node, i) => expect(node).toBe(suffix[i]));

        // Always contains the current node.
        expect(trimmed[trimmed.length - 1]).toBe(chain[chain.length - 1]);
      }),
      RUNS
    );
  });

  // Feature: comprehensive-radar-report, Property 2: Trim includes every recent node
  // Validates: Requirements 3.3, 3.4, 3.5
  it('Property 2: every node within the window survives the trim', () => {
    fc.assert(
      fc.property(chainArb(1, 8), (chain) => {
        const trimmed = trimChain(chain, NOW);
        const cutoff = NOW - DAY_MS;

        // Only nodes in the recent *suffix* are guaranteed — a stale timestamp
        // earlier in the chain must not drag unrelated ancestors in.
        const recentSuffix = [];
        for (let i = chain.length - 1; i >= 0; i--) {
          if (new Date(chain[i].created_at).getTime() >= cutoff) recentSuffix.unshift(chain[i]);
          else break;
        }
        for (const node of recentSuffix) expect(trimmed).toContain(node);
      }),
      RUNS
    );
  });

  // Feature: comprehensive-radar-report, Property 3: Root badge is truthful
  // Validates: Requirements 3.9
  it('Property 3: isTrimmedHeadTrueRoot is true exactly when the trimmed head is the chain head', () => {
    fc.assert(
      fc.property(chainArb(1, 8), (chain) => {
        const trimmed = trimChain(chain, NOW);
        expect(isTrimmedHeadTrueRoot(chain, trimmed)).toBe(trimmed[0] === chain[0]);
      }),
      RUNS
    );
  });

  // The two worked examples from the brief.
  describe('worked examples', () => {
    const at = (hoursAgo) => new Date(NOW - hoursAgo * HOUR_MS).toISOString();

    it('A→B→C→D with C and D inside 24h renders B→C→D', () => {
      const chain = [
        { id: 'A', created_at: at(100) },
        { id: 'B', created_at: at(80) },
        { id: 'C', created_at: at(10) },
        { id: 'D', created_at: at(2) },
      ];
      expect(trimChain(chain, NOW).map((n) => n.id)).toEqual(['B', 'C', 'D']);
    });

    it('A→B→C→D with only D inside 24h renders C→D', () => {
      const chain = [
        { id: 'A', created_at: at(100) },
        { id: 'B', created_at: at(80) },
        { id: 'C', created_at: at(48) },
        { id: 'D', created_at: at(2) },
      ];
      expect(trimChain(chain, NOW).map((n) => n.id)).toEqual(['C', 'D']);
    });

    it('a single-node chain renders that node alone', () => {
      const chain = [{ id: 'D', created_at: at(2) }];
      expect(trimChain(chain, NOW).map((n) => n.id)).toEqual(['D']);
      expect(isTrimmedHeadTrueRoot(chain, trimChain(chain, NOW))).toBe(true);
    });

    it('no recent nodes falls back to the last two', () => {
      const chain = [
        { id: 'A', created_at: at(300) },
        { id: 'B', created_at: at(200) },
        { id: 'C', created_at: at(100) },
      ];
      expect(trimChain(chain, NOW).map((n) => n.id)).toEqual(['B', 'C']);
    });

    it('an all-recent chain keeps every node (no context node exists)', () => {
      const chain = [
        { id: 'A', created_at: at(6) },
        { id: 'B', created_at: at(4) },
        { id: 'C', created_at: at(1) },
      ];
      const trimmed = trimChain(chain, NOW);
      expect(trimmed.map((n) => n.id)).toEqual(['A', 'B', 'C']);
      expect(isTrimmedHeadTrueRoot(chain, trimmed)).toBe(true);
    });

    it('an empty chain returns empty', () => {
      expect(trimChain([], NOW)).toEqual([]);
    });
  });
});

// ── computeAvailability ───────────────────────────────────────────────────────

describe('computeAvailability', () => {
  const start = new Date(NOW - 24 * HOUR_MS);
  const end = new Date(NOW);

  // Feature: comprehensive-radar-report, Property 4: Uptime is a bounded complement of downtime
  // Validates: Requirements 2.5, 2.8
  it('Property 4: uptimePercentage stays within [0,100]; isOff forces 0', () => {
    fc.assert(
      fc.property(downtimeRecordsArb, (records) => {
        const a = computeAvailability(records, start, end);
        expect(a.uptimePercentage).toBeGreaterThanOrEqual(0);
        expect(a.uptimePercentage).toBeLessThanOrEqual(100);
        expect(Number.isNaN(a.uptimePercentage)).toBe(false);

        const off = computeAvailability(records, start, end, { isOff: true });
        expect(off.uptimePercentage).toBe(0);
        expect(off.mechanicalAvailability).toBe(0);
        expect(off.useOfAvailability).toBe(0);
      }),
      RUNS
    );
  });

  // Feature: comprehensive-radar-report, Property 5: Downtime clipping is window-bounded
  // Validates: Requirements 6.7, 2.7
  //
  // Per-RECORD clipping is the invariant. Per-REASON totals are NOT bounded by
  // the window: overlapping records are not merged (inherited behaviour), so two
  // overlapping 12.5h records legitimately sum to 25h in a 24h window. Every
  // percentage is still clamped, which is what keeps the output sane.
  it('Property 5: every record is clipped to the window; percentages stay bounded', () => {
    fc.assert(
      fc.property(downtimeRecordsArb, (records) => {
        const a = computeAvailability(records, start, end);
        expect(a.windowHours).toBeCloseTo(24, 6);

        for (const b of [...Object.values(a.mechanical), ...Object.values(a.useOf)]) {
          expect(b.hours).toBeGreaterThanOrEqual(0);
          expect(Number.isFinite(b.hours)).toBe(true);
          expect(b.percentage).toBeGreaterThanOrEqual(0);
          expect(b.percentage).toBeLessThanOrEqual(100);
        }

        // No single record can contribute more than the window spans.
        for (const rec of records) {
          const solo = computeAvailability([rec], start, end);
          expect(solo.downtimeHours).toBeLessThanOrEqual(a.windowHours + 1e-9);
        }
      }),
      RUNS
    );
  });

  // Feature: comprehensive-radar-report, Property 6: Availability denominators stay consistent
  // Validates: Requirements 6.5, 6.6
  it('Property 6: mechanical uses the window, use-of uses available hours, never NaN/Infinity', () => {
    fc.assert(
      fc.property(downtimeRecordsArb, (records) => {
        const a = computeAvailability(records, start, end);

        for (const b of Object.values(a.mechanical)) {
          const expected = Math.min(100, (b.hours / a.windowHours) * 100);
          expect(b.percentage).toBeCloseTo(expected, 6);
        }

        const denom = a.availableHours > 0 ? a.availableHours : a.windowHours;
        for (const b of Object.values(a.useOf)) {
          const expected = Math.min(100, (b.hours / denom) * 100);
          expect(b.percentage).toBeCloseTo(expected, 6);
          expect(Number.isFinite(b.percentage)).toBe(true);
        }
      }),
      RUNS
    );
  });

  describe('edge cases', () => {
    it('clips an open-ended record to the window end, not to now', () => {
      const a = computeAvailability(
        [{ reason: 'Maintenance', from: new Date(NOW - 10 * HOUR_MS).toISOString(), to: null }],
        start,
        end
      );
      expect(a.mechanical.Maintenance.hours).toBeCloseTo(10, 6);
    });

    it('clips a record that straddles the window start', () => {
      const a = computeAvailability(
        [{
          reason: 'Relocation',
          from: new Date(NOW - 40 * HOUR_MS).toISOString(),
          to: new Date(NOW - 20 * HOUR_MS).toISOString(),
        }],
        start,
        end
      );
      // Overlap is windowStart (−24h) → −20h = 4h.
      expect(a.mechanical.Relocation.hours).toBeCloseTo(4, 6);
    });

    it('ignores a record entirely outside the window', () => {
      const a = computeAvailability(
        [{
          reason: 'Maintenance',
          from: new Date(NOW - 100 * HOUR_MS).toISOString(),
          to: new Date(NOW - 50 * HOUR_MS).toISOString(),
        }],
        start,
        end
      );
      expect(a.mechanical.Maintenance.hours).toBe(0);
      expect(a.uptimePercentage).toBe(100);
    });

    it('falls back to the window denominator when fully mechanically down', () => {
      const a = computeAvailability(
        [
          { reason: 'Maintenance', from: start.toISOString(), to: end.toISOString() },
          { reason: 'Connection', from: start.toISOString(), to: end.toISOString() },
        ],
        start,
        end
      );
      expect(a.availableHours).toBeCloseTo(0, 6);
      expect(Number.isFinite(a.useOf.Connection.percentage)).toBe(true);
      expect(a.useOf.Connection.percentage).toBeCloseTo(100, 6);
      expect(a.uptimePercentage).toBe(0);
    });

    it('an empty window yields zeroes rather than NaN', () => {
      const a = computeAvailability([], end, end);
      expect(a.uptimePercentage).toBe(0);
      expect(a.windowHours).toBe(0);
    });

    it('no downtime is 100% uptime', () => {
      const a = computeAvailability([], start, end);
      expect(a.uptimePercentage).toBe(100);
      expect(a.mechanicalAvailability).toBe(100);
      expect(a.useOfAvailability).toBe(100);
    });

    it('ignores unrecognised reasons', () => {
      const a = computeAvailability(
        [{ reason: 'Not A Real Reason', from: start.toISOString(), to: end.toISOString() }],
        start,
        end
      );
      expect(a.downtimeHours).toBe(0);
      expect(a.uptimePercentage).toBe(100);
    });

    it('produces the shape GaugeLive expects', () => {
      const a = computeAvailability([], start, end);
      const g = toGaugeShape(a);
      expect(Object.keys(g)).toEqual(['Mechanical Availability', 'Use of Availability']);
      expect(Object.keys(g['Mechanical Availability'])).toEqual(MECHANICAL_REASONS);
      expect(Object.keys(g['Use of Availability'])).toEqual(USE_OF_REASONS);
    });
  });

  // Feature: comprehensive-radar-report, wall-folder change: downtime is unioned
  // across folders with overlaps merged (Requirement: downtime joined & calculated
  // across wall folders).
  describe('mergeOverlaps (across wall folders)', () => {
    const iso = (hoursAgo) => new Date(NOW - hoursAgo * HOUR_MS).toISOString();

    it('counts an outage logged under two folders once, not twice', () => {
      // Same 10h Maintenance recorded under the old and the new wall folder.
      const dup = [
        { reason: 'Maintenance', from: iso(10), to: iso(0) },
        { reason: 'Maintenance', from: iso(10), to: iso(0) },
      ];
      const naive = computeAvailability(dup, start, end);
      const merged = computeAvailability(dup, start, end, { mergeOverlaps: true });

      expect(naive.mechanical.Maintenance.hours).toBeCloseTo(20, 6); // double-counted
      expect(merged.mechanical.Maintenance.hours).toBeCloseTo(10, 6); // counted once
      expect(merged.downtimeHours).toBeCloseTo(10, 6);
      expect(merged.uptimePercentage).toBeCloseTo(((24 - 10) / 24) * 100, 6);
    });

    it('merges partially overlapping same-reason intervals across a changeover', () => {
      // Old folder: 12h→4h ago. New folder: 6h→0h ago. Union = 12h→0h = 12h.
      const rows = [
        { reason: 'Relocation', from: iso(12), to: iso(4) },
        { reason: 'Relocation', from: iso(6), to: iso(0) },
      ];
      const merged = computeAvailability(rows, start, end, { mergeOverlaps: true });
      expect(merged.mechanical.Relocation.hours).toBeCloseTo(12, 6);
    });

    it('does not merge two distinct non-overlapping outages', () => {
      const rows = [
        { reason: 'Maintenance', from: iso(20), to: iso(16) }, // 4h
        { reason: 'Maintenance', from: iso(8), to: iso(4) }, // 4h
      ];
      const merged = computeAvailability(rows, start, end, { mergeOverlaps: true });
      const naive = computeAvailability(rows, start, end);
      expect(merged.mechanical.Maintenance.hours).toBeCloseTo(8, 6);
      expect(naive.mechanical.Maintenance.hours).toBeCloseTo(8, 6);
    });

    it('overall downtime unions across different reasons (cross-reason overlap counts once)', () => {
      // A Maintenance and a Connection outage overlapping the same 6h: distinct
      // reasons keep their own hours, but the overall downtime is the union.
      const rows = [
        { reason: 'Maintenance', from: iso(10), to: iso(4) }, // 6h
        { reason: 'Connection', from: iso(8), to: iso(2) }, // 6h, overlaps 8→4
      ];
      const merged = computeAvailability(rows, start, end, { mergeOverlaps: true });
      // Union of [10→4] and [8→2] is [10→2] = 8h down.
      expect(merged.downtimeHours).toBeCloseTo(8, 6);
      expect(merged.uptimePercentage).toBeCloseTo(((24 - 8) / 24) * 100, 6);
    });

    // Feature: comprehensive-radar-report, Property 10: merging never inflates downtime.
    it('Property 10: merged downtime is always <= the naive sum and stays bounded', () => {
      fc.assert(
        fc.property(downtimeRecordsArb, (records) => {
          const naive = computeAvailability(records, start, end);
          const merged = computeAvailability(records, start, end, { mergeOverlaps: true });
          expect(merged.downtimeHours).toBeLessThanOrEqual(naive.downtimeHours + 1e-9);
          expect(merged.downtimeHours).toBeLessThanOrEqual(merged.windowHours + 1e-9);
          expect(merged.uptimePercentage).toBeGreaterThanOrEqual(0);
          expect(merged.uptimePercentage).toBeLessThanOrEqual(100);
        }),
        RUNS
      );
    });

    it('with no overlaps, merged and naive agree (flag is a no-op)', () => {
      fc.assert(
        fc.property(
          fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 1, maxLength: 5 }),
          (gaps) => {
            // Build strictly non-overlapping 1h Maintenance blocks marching back in time.
            let cursor = 0;
            const rows = gaps.map((g) => {
              cursor += g + 1; // at least 1h gap so nothing touches
              const from = iso(cursor);
              const to = iso(cursor - 1);
              return { reason: 'Maintenance', from, to };
            });
            const naive = computeAvailability(rows, start, end);
            const merged = computeAvailability(rows, start, end, { mergeOverlaps: true });
            expect(merged.mechanical.Maintenance.hours).toBeCloseTo(naive.mechanical.Maintenance.hours, 6);
          }
        ),
        RUNS
      );
    });
  });

  describe('windowForFrequency', () => {
    // Perth never observes DST, so the window span is exactly N*24h.
    const TZ = 'Australia/Perth';
    const reportDay = '2026-07-17';
    // A `now` well AFTER reportDay → a closed (historical) period, whose window
    // ends at the fixed 05:00 boundary, so the span is exactly N*24h.
    const nowAfter = new Date('2026-08-01T00:00:00Z');

    it.each([
      ['daily', 24],
      ['weekly', 24 * 7],
      ['monthly', 24 * 30],
    ])('%s spans %i hours for a past report day', (freq, hours) => {
      const { windowStart, windowEnd } = windowForFrequency(freq, reportDay, TZ, nowAfter);
      expect((windowEnd - windowStart) / HOUR_MS).toBeCloseTo(hours, 6);
    });

    it('an unknown frequency falls back to daily', () => {
      const { windowStart, windowEnd } = windowForFrequency('fortnightly', reportDay, TZ, nowAfter);
      expect((windowEnd - windowStart) / HOUR_MS).toBeCloseTo(24, 6);
    });

    it('a CLOSED report day runs 05:00 → 05:00 site-local and includes the prior day', () => {
      // 05:00 Jakarta (UTC+7, no DST) on 2026-07-27 == 22:00Z on 2026-07-26, so the
      // window start (a day earlier) is 22:00Z on 2026-07-25. `now` is the next day
      // → reportDay is history → the window ends at the fixed 05:00 boundary.
      const after = new Date('2026-07-28T08:00:00Z');
      const { windowStart, windowEnd } = windowForFrequency('daily', '2026-07-27', 'Asia/Jakarta', after);
      expect(windowStart.toISOString()).toBe('2026-07-25T22:00:00.000Z');
      expect(windowEnd.toISOString()).toBe('2026-07-26T22:00:00.000Z');

      // The reported record (2026-07-26 02:04Z → 16:04Z, Maintenance) must land in
      // the 2026-07-27 daily report — the original bug was that it did not.
      // Exact Postgres/Supabase wire format from the reported record (space + '+00').
      const rec = { from: '2026-07-26 02:04:51+00', to: '2026-07-26 16:04:56+00', reason: 'Maintenance' };
      const a = computeAvailability([rec], windowStart, windowEnd);
      expect(a.mechanical.Maintenance.hours).toBeCloseTo(14, 1);
    });

    it('an OPEN report day ends at now and starts exactly N*24h earlier', () => {
      // Report day is TODAY; now is 15:00 Jakarta (08:00Z) on 2026-07-27.
      const now = new Date('2026-07-27T08:00:00Z');
      const { windowStart, windowEnd } = windowForFrequency('daily', '2026-07-27', 'Asia/Jakarta', now);
      // End tracks `now`, NOT the 05:00 boundary (which was 2026-07-26T22:00Z)...
      expect(windowEnd.toISOString()).toBe('2026-07-27T08:00:00.000Z');
      // ...and the start is the SAME hour:minute one day back — the latest 24h,
      // not 05:00 yesterday (which would have made this a 34h "daily" window.)
      expect(windowStart.toISOString()).toBe('2026-07-26T08:00:00.000Z');
      expect((windowEnd - windowStart) / HOUR_MS).toBeCloseTo(24, 6);

      // A still-open incident (to == null) that started at 06:00Z today is counted
      // from its start up to `now` — 2h — and never beyond it.
      const open = { from: '2026-07-27 06:00:00+00', to: null, reason: 'Relocation' };
      const a = computeAvailability([open], windowStart, windowEnd);
      expect(a.mechanical.Relocation.hours).toBeCloseTo(2, 2);
      // 2h of a 24h window — the denominator is the window, so 8.33% down / 91.67% up.
      expect(a.uptimePercentage).toBeCloseTo((22 / 24) * 100, 6);
    });

    it.each([
      ['daily', 24],
      ['weekly', 24 * 7],
      ['monthly', 24 * 30],
    ])('%s spans exactly %i hours for an open (current) report day', (freq, hours) => {
      // The reported bug: an open period was anchored at its START, so the window
      // stretched from 05:00 to `now` and a "daily" report covered 33h.
      const now = new Date('2026-07-29T06:30:00Z'); // 14:30 Perth
      const { windowStart, windowEnd } = windowForFrequency(freq, '2026-07-29', TZ, now);
      expect((windowEnd - windowStart) / HOUR_MS).toBeCloseTo(hours, 6);
      expect(windowEnd.toISOString()).toBe('2026-07-29T06:30:00.000Z');
    });

    it('does NOT extend a past report day to now (historical reports stay bounded)', () => {
      // reportDay 2026-07-20 is history relative to now (2026-07-27).
      const now = new Date('2026-07-27T08:00:00Z');
      const { windowStart, windowEnd } = windowForFrequency('daily', '2026-07-20', 'Asia/Jakarta', now);
      // Fixed 05:00 boundary: 05:00 Jakarta 2026-07-20 == 2026-07-19T22:00Z.
      expect(windowEnd.toISOString()).toBe('2026-07-19T22:00:00.000Z');
      // An open record inside the window still stops at the fixed end, not now.
      const open = { from: '2026-07-19 10:00:00+00', to: null, reason: 'Maintenance' };
      const a = computeAvailability([open], windowStart, windowEnd);
      expect(a.mechanical.Maintenance.hours).toBeCloseTo(12, 2); // 10:00Z → 22:00Z
    });
  });
});

// ── aggregateAlarmCauses / countValidTotal ────────────────────────────────────

describe('aggregateAlarmCauses', () => {
  // Feature: comprehensive-radar-report, Property 7: Alarm percentages are a partition
  // Validates: Requirements 7.5, 7.9
  it('Property 7: percentages sum to 100 and counts sum to the record total', () => {
    fc.assert(
      fc.property(alarmRecordsArb, (records) => {
        const slices = aggregateAlarmCauses(records);

        if (records.length === 0) {
          expect(slices).toEqual([]);
          return;
        }

        const totalCount = slices.reduce((t, s) => t + s.count, 0);
        const totalPct = slices.reduce((t, s) => t + s.percentage, 0);

        expect(totalCount).toBe(records.length);
        expect(totalPct).toBeCloseTo(100, 6);

        // Counts and percentages agree — the mockup showed counts labelled "%".
        for (const s of slices) {
          expect(s.percentage).toBeCloseTo((s.count / records.length) * 100, 6);
        }
      }),
      RUNS
    );
  });

  it('sorts descending by count', () => {
    const slices = aggregateAlarmCauses([
      { cause: 'Vegetation' },
      { cause: 'Machinery Activity' },
      { cause: 'Machinery Activity' },
    ]);
    expect(slices.map((s) => s.cause)).toEqual(['Machinery Activity', 'Vegetation']);
    expect(slices[0].count).toBe(2);
  });

  it('keeps causes outside the taxonomy rather than dropping them', () => {
    const slices = aggregateAlarmCauses([{ cause: 'Meteor Strike' }, { cause: 'Vegetation' }]);
    expect(slices.map((s) => s.cause).sort()).toEqual(['Meteor Strike', 'Vegetation']);
    expect(slices.reduce((t, s) => t + s.count, 0)).toBe(2);
  });

  it('buckets missing causes under Uncategorised', () => {
    const slices = aggregateAlarmCauses([{ cause: '' }, { cause: null }, {}]);
    expect(slices).toEqual([{ cause: 'Uncategorised', count: 3, percentage: 100 }]);
  });

  it('returns empty for no records', () => {
    expect(aggregateAlarmCauses([])).toEqual([]);
    expect(aggregateAlarmCauses(null)).toEqual([]);
  });
});

// ── pivotParameterTree / buildRadarRecord ─────────────────────────────────────

describe('pivotParameterTree', () => {
  const row = (id, name, level, parent_id, value, extra = {}) => ({
    value,
    notes: extra.notes ?? '',
    appendix: extra.appendix ?? null,
    image: extra.image ?? null,
    parameters: { id, name, level, parent_id },
  });

  it('builds level-0/1 entries keyed by name, with level-2 rows as children', () => {
    const { parameters } = pivotParameterTree([
      row(1, 'Overall', 0, null, 'Sub-Optimal'),
      row(10, 'Masks', 1, null, 'Optimal'),
      row(11, 'Sky Mask', 2, 10, 'Optimal'),
    ]);

    expect(parameters.Overall.value).toBe('Sub-Optimal');
    // Single-word parent: key matches, so children land on the real entry.
    expect(parameters.Masks.value).toBe('Optimal');
    expect(parameters.Masks.children.map((c) => c.name)).toEqual(['Sky Mask']);
  });

  it('preserves the inherited multi-word key collision (duplicate placeholder parent)', () => {
    // Regression guard for the extraction: "System Health" (level 1) is keyed
    // spaced, but its level-2 child looks the parent up as "SystemHealth". The
    // keys never match, so BOTH entries exist — the real one holding the value,
    // the placeholder holding the children. buildRadarData reads the former;
    // RadarDetail.getIssues walks the latter. Fixing this is a separate ticket;
    // this test exists to prove the move changed nothing.
    const { parameters } = pivotParameterTree([
      row(20, 'System Health', 1, null, 'Critical'),
      row(21, 'Amplitude', 2, 20, 'Critical'),
    ]);

    expect(parameters['System Health'].value).toBe('Critical');
    expect(parameters['System Health'].children).toEqual([]);

    expect(parameters.SystemHealth).toBeDefined();
    expect(parameters.SystemHealth.value).toBe('');
    expect(parameters.SystemHealth.children.map((c) => c.name)).toEqual(['Amplitude']);
  });

  it('creates a placeholder when the parent row is absent entirely', () => {
    const { parameters } = pivotParameterTree([row(31, 'Orphan', 2, 99, 'Optimal')]);
    expect(parameters.Parent_99).toBeDefined();
    expect(parameters.Parent_99.name).toBe('Unknown (99)');
    expect(parameters.Parent_99.children.map((c) => c.name)).toEqual(['Orphan']);
  });

  it('prefers the first non-empty value when rows repeat', () => {
    const { parameters } = pivotParameterTree([
      row(10, 'Masks', 1, null, ''),
      row(10, 'Masks', 1, null, 'Optimal'),
    ]);
    expect(parameters.Masks.value).toBe('Optimal');
  });

  it('tracks children with no value', () => {
    const { emptyChildren } = pivotParameterTree([
      row(10, 'Masks', 1, null, 'Optimal'),
      row(11, 'Sky Mask', 2, 10, ''),
    ]);
    expect(emptyChildren).toEqual([{ id: 11, name: 'Sky Mask', parent_id: 10 }]);
  });

  it('tolerates empty and malformed input', () => {
    expect(pivotParameterTree([]).parameters).toEqual({});
    expect(pivotParameterTree(null).parameters).toEqual({});
    expect(pivotParameterTree([{ value: 'x' }]).parameters).toEqual({});
  });
});

describe('buildRadarRecord → buildRadarData', () => {
  const paramRow = (id, name, value) => ({
    value,
    notes: '',
    appendix: null,
    image: null,
    parameters: { id, name, level: 1, parent_id: null },
  });

  // Level-1 parameter ids as the parameters table defines them.
  const SYSTEM_HEALTH = 2;
  const SCAN_AREA = 3;
  const PHOTOGRAPH = 4;
  const MASKS = 5;
  const ALARMS = 6;
  const ATMOSPHERIC = 7;
  const VISUAL_DATA = 8;

  const allSeven = [
    paramRow(SYSTEM_HEALTH, 'System Health', 'Optimal'),
    paramRow(SCAN_AREA, 'Scan Area', 'Acceptable'),
    paramRow(PHOTOGRAPH, 'Photograph', 'Optimal'),
    paramRow(MASKS, 'Masks', 'Optimal'),
    paramRow(ALARMS, 'Alarms', 'Critical'),
    paramRow(ATMOSPHERIC, 'Atmospheric Correction', 'Optimal'),
    paramRow(VISUAL_DATA, 'Visual Data', 'Sub-Optimal'),
  ];

  const without = (...ids) => allSeven.filter((r) => !ids.includes(r.parameters.id));

  // Validates: Requirements 4.2, 4.3, 4.4 — the axis count is variable, driven
  // entirely by which parameters the sensor actually has dqp_values rows for.
  it('yields 7 axes when the radar carries the full parameter set', () => {
    const record = buildRadarRecord({ radar_number: 'SSR461FX', brand: 'GroundProbe' }, allSeven);
    expect(buildRadarData(record)).toHaveLength(7);
  });

  it('omits an axis when the parameter has no row — SSR...XT (params 2-7)', () => {
    const record = buildRadarRecord(
      { radar_number: 'SSR461XT', brand: 'GroundProbe' },
      without(VISUAL_DATA)
    );
    const axes = buildRadarData(record).map((d) => d.subject);
    expect(axes).not.toContain('VisualData');
    expect(axes).toHaveLength(6);
  });

  it('omits several axes at once — MSR (params 2, 3, 6, 7, 8)', () => {
    const record = buildRadarRecord(
      { radar_number: 'MSR004', brand: 'GroundProbe' },
      without(PHOTOGRAPH, MASKS)
    );
    const axes = buildRadarData(record).map((d) => d.subject);
    expect(axes).toEqual([
      'SystemHealth',
      'ScanArea',
      'Alarms',
      'AtmosphericCorrection',
      'VisualData',
    ]);
  });

  it('ignores the radar name and brand — only the rows decide', () => {
    // Same rows, wildly different sensor identity: same axes.
    const gp = buildRadarRecord({ radar_number: 'SSR461FX', brand: 'GroundProbe' }, allSeven);
    const chc = buildRadarRecord({ radar_number: 'FooXT', brand: 'CHCNAV' }, allSeven);
    expect(buildRadarData(chc)).toEqual(buildRadarData(gp));
  });

  it('orders axes by parameter id regardless of row order', () => {
    const shuffled = [...allSeven].reverse();
    const record = buildRadarRecord({ radar_number: 'SSR461FX', brand: 'GroundProbe' }, shuffled);
    expect(buildRadarData(record).map((d) => d.subject)).toEqual([
      'SystemHealth',
      'ScanArea',
      'Photograph',
      'Masks',
      'Alarms',
      'AtmosphericCorrection',
      'VisualData',
    ]);
  });

  it('does not raise a placeholder parent into an axis', () => {
    // A level-2 row whose level-1 parent has no row of its own creates a
    // placeholder entry in the tree. It holds children, not a score, so it
    // must not become an axis.
    const orphanChild = {
      value: 'Optimal',
      notes: '',
      appendix: null,
      image: null,
      parameters: { id: 99, name: 'Orphan Leaf', level: 2, parent_id: VISUAL_DATA },
    };
    const record = buildRadarRecord(
      { radar_number: 'SSR461XT', brand: 'GroundProbe' },
      [...without(VISUAL_DATA), orphanChild]
    );
    expect(buildRadarData(record).map((d) => d.subject)).not.toContain('VisualData');
  });

  it('keeps a scored axis whose multi-word name also spawns a placeholder', () => {
    // "System Health" (real, scored) vs "SystemHealth" (placeholder holding the
    // children). Exactly one axis, carrying the real value.
    const record = buildRadarRecord({ radar_number: 'SSR461FX', brand: 'GroundProbe' }, [
      paramRow(SYSTEM_HEALTH, 'System Health', 'Critical'),
      {
        value: 'Critical',
        notes: '',
        appendix: null,
        image: null,
        parameters: { id: 21, name: 'Amplitude', level: 2, parent_id: SYSTEM_HEALTH },
      },
    ]);
    const data = buildRadarData(record);
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ subject: 'SystemHealth', score: 1, status: 'Critical' });
  });

  it('maps statuses onto the 0–5 score scale', () => {
    const record = buildRadarRecord({ radar_number: 'SSR461FX', brand: 'GroundProbe' }, allSeven);
    const byAxis = Object.fromEntries(buildRadarData(record).map((d) => [d.subject, d.score]));
    expect(byAxis.SystemHealth).toBe(5); // Optimal
    expect(byAxis.ScanArea).toBe(3);     // Acceptable
    expect(byAxis.Alarms).toBe(1);       // Critical
    expect(byAxis.VisualData).toBe(2);   // Sub-Optimal
  });

  it('scores an unassessed parameter as 0 but keeps its axis', () => {
    const record = buildRadarRecord({ radar_number: 'SSR461FX', brand: 'GroundProbe' }, [
      paramRow(SYSTEM_HEALTH, 'System Health', ''),
    ]);
    expect(buildRadarData(record)).toEqual([
      { subject: 'SystemHealth', score: 0, fullMark: 5, status: '' },
    ]);
  });

  it('tolerates a record with no parameters', () => {
    expect(buildRadarData({})).toEqual([]);
    expect(buildRadarData(null)).toEqual([]);
  });
});

describe('countValidTotal', () => {
  it('counts Valid against the full total', () => {
    expect(
      countValidTotal([{ reason: 'Valid' }, { reason: 'False' }, { reason: 'False' }])
    ).toEqual({ valid: 1, total: 3 });
  });

  it('the mockup 0/55 case: no valid alarms among many', () => {
    const records = Array.from({ length: 55 }, () => ({ reason: 'False' }));
    expect(countValidTotal(records)).toEqual({ valid: 0, total: 55 });
  });

  it('handles empty input', () => {
    expect(countValidTotal([])).toEqual({ valid: 0, total: 0 });
    expect(countValidTotal(null)).toEqual({ valid: 0, total: 0 });
  });

  // Property 8's tile/chart agreement rests on both reading one record set.
  it('agrees with aggregateAlarmCauses on the total', () => {
    fc.assert(
      fc.property(alarmRecordsArb, (records) => {
        const { total } = countValidTotal(records);
        const sliceTotal = aggregateAlarmCauses(records).reduce((t, s) => t + s.count, 0);
        expect(sliceTotal).toBe(total);
      }),
      RUNS
    );
  });
});

// ── deriveAlarmTone ───────────────────────────────────────────────────────────

describe('deriveAlarmTone', () => {
  const regions = [
    { id: 'r-red', alarmtype: 'Red' },
    { id: 'r-orange', alarmtype: 'orange' },
    { id: 'r-yellow', alarmtype: 'yellow' },
    { id: 'r-blue', alarmtype: 'blue' },
    { id: 'r-purple', alarmtype: 'purple' },
  ];
  const at = (region, reason) => ({ alarm_region: region, reason });

  it('no alarms at all is neutral, not a clean bill of health', () => {
    expect(deriveAlarmTone([], regions)).toBe('none');
    expect(deriveAlarmTone(null, regions)).toBe('none');
  });

  it('every alarm false is green', () => {
    expect(deriveAlarmTone([at('r-red', 'False'), at('r-red', 'False')], regions)).toBe('false');
  });

  it('a single valid alarm outranks any number of false ones', () => {
    const records = [...Array(20)].map(() => at('r-red', 'False')).concat(at('r-blue', 'Valid'));
    expect(deriveAlarmTone(records, regions)).toBe('blue');
  });

  it('takes the highest rank among valid alarms only', () => {
    // A red FALSE alarm must not colour the tile red.
    expect(deriveAlarmTone([at('r-red', 'False'), at('r-yellow', 'Valid')], regions)).toBe('yellow');
    expect(deriveAlarmTone([at('r-purple', 'Valid'), at('r-orange', 'Valid')], regions)).toBe('orange');
    expect(deriveAlarmTone([at('r-blue', 'Valid'), at('r-purple', 'Valid')], regions)).toBe('blue');
  });

  it('unassessed alarms are not green, and unrankable ones are not guessed', () => {
    expect(deriveAlarmTone([at('r-red', null)], regions)).toBe('unknown');
    expect(deriveAlarmTone([at('r-red', 'False'), at('r-red', null)], regions)).toBe('unknown');
    expect(deriveAlarmTone([at('r-unknown', 'Valid')], regions)).toBe('unknown');
  });

  // Feature: comprehensive-radar-report, Property 9: The alarm tone never
  // under-reports the worst valid alarm.
  it('Property 9: the tone is the worst-ranked valid alarm present', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            type: fc.constantFrom(...ALARM_HIERARCHY),
            reason: fc.constantFrom('Valid', 'False'),
          }),
          { maxLength: 20 }
        ),
        (rows) => {
          const records = rows.map((r) => at(`r-${r.type}`, r.reason));
          const tone = deriveAlarmTone(records, regions);
          const validRanks = rows
            .filter((r) => r.reason === 'Valid')
            .map((r) => ALARM_HIERARCHY.indexOf(r.type));

          if (records.length === 0) return expect(tone).toBe('none');
          if (validRanks.length === 0) return expect(tone).toBe('false');
          expect(tone).toBe(ALARM_HIERARCHY[Math.min(...validRanks)]);
        }
      ),
      RUNS
    );
  });
});

// ── reportWallFolders (wall folder change handling) ───────────────────────────

describe('reportWallFolders', () => {
  const WSTART = new Date(NOW - 24 * HOUR_MS);
  const WEND = new Date(NOW);
  const at = (hoursAgo) => new Date(NOW - hoursAgo * HOUR_MS).toISOString();

  describe('folderGroupKey', () => {
    it('prefers location_group, then area, then name, then id', () => {
      expect(folderGroupKey({ location_group: 'LG', area: 'A', name: 'N', id: 1 })).toBe('LG');
      expect(folderGroupKey({ area: 'A', name: 'N', id: 1 })).toBe('A');
      expect(folderGroupKey({ name: 'N', id: 1 })).toBe('N');
      expect(folderGroupKey({ id: 7 })).toBe('folder-7');
      expect(folderGroupKey(null)).toBe('—');
    });
  });

  describe('isArchivedFolder', () => {
    it('is true only for type Archive (case-insensitive)', () => {
      expect(isArchivedFolder({ type: 'Archive' })).toBe(true);
      expect(isArchivedFolder({ type: 'archive' })).toBe(true);
      expect(isArchivedFolder({ type: 'Live' })).toBe(false);
      expect(isArchivedFolder({ type: 'Link Down' })).toBe(false);
      expect(isArchivedFolder(null)).toBe(false);
    });
  });

  describe('folderDisplayLabel', () => {
    it('appends the area only when it adds information', () => {
      expect(folderDisplayLabel({ name: 'North', area: 'North Wall' })).toBe('North (North Wall)');
      expect(folderDisplayLabel({ name: 'North', area: 'North' })).toBe('North');
      expect(folderDisplayLabel({ name: 'North' })).toBe('North');
      expect(folderDisplayLabel({ area: 'South' })).toBe('South');
      expect(folderDisplayLabel({})).toBe('Unnamed wall folder');
    });
  });

  describe('nodeInWindow / chainInWindow', () => {
    it('is inclusive of the window bounds and excludes outside', () => {
      expect(nodeInWindow({ created_at: at(1) }, WSTART, WEND)).toBe(true);
      expect(nodeInWindow({ created_at: at(0) }, WSTART, WEND)).toBe(true); // == end
      expect(nodeInWindow({ created_at: at(24) }, WSTART, WEND)).toBe(true); // == start
      expect(nodeInWindow({ created_at: at(25) }, WSTART, WEND)).toBe(false);
      expect(nodeInWindow({ created_at: 'not-a-date' }, WSTART, WEND)).toBe(false);
    });

    it('chainInWindow is true when ANY node lands inside', () => {
      expect(chainInWindow([{ created_at: at(100) }, { created_at: at(2) }], WSTART, WEND)).toBe(true);
      expect(chainInWindow([{ created_at: at(100) }, { created_at: at(50) }], WSTART, WEND)).toBe(false);
      expect(chainInWindow([], WSTART, WEND)).toBe(false);
    });
  });

  describe('shouldIncludeChain', () => {
    it('always keeps the current folder, regardless of window', () => {
      const stale = [{ created_at: at(500) }];
      expect(shouldIncludeChain({ isCurrent: true, chain: stale, windowStart: WSTART, windowEnd: WEND })).toBe(true);
    });

    it('keeps an archived folder only when it has in-window activity', () => {
      const inWin = [{ created_at: at(100) }, { created_at: at(3) }];
      const stale = [{ created_at: at(100) }, { created_at: at(40) }];
      expect(shouldIncludeChain({ isCurrent: false, chain: inWin, windowStart: WSTART, windowEnd: WEND })).toBe(true);
      expect(shouldIncludeChain({ isCurrent: false, chain: stale, windowStart: WSTART, windowEnd: WEND })).toBe(false);
    });
  });

  describe('groupTimelinesByFolder', () => {
    const tl = (folder, isCurrent, loc = 'X') => ({
      folder,
      isCurrent,
      trimmed: [{ id: 1, location: loc }],
    });
    const current = { id: 2, name: 'NEW', area: 'North', type: 'Live', location_group: 'North', commenced_at: at(10) };
    const archivedSameLoc = { id: 1, name: 'OLD', area: 'North', type: 'Archive', location_group: 'North', commenced_at: at(200) };
    const archivedOtherLoc = { id: 3, name: 'FAR', area: 'South', type: 'Archive', location_group: 'South', commenced_at: at(300) };

    it('orders the current folder first, its location cluster next, others last', () => {
      const groups = groupTimelinesByFolder(
        [tl(archivedOtherLoc, false), tl(archivedSameLoc, false), tl(current, true)],
        2
      );
      expect(groups.map((g) => g.folderId)).toEqual([2, 1, 3]);
      expect(groups[0].isCurrent).toBe(true);
      expect(groups[1].isArchived).toBe(true);
      expect(groups[2].groupKey).toBe('South');
    });

    it('collects every timeline of a folder under one group', () => {
      const groups = groupTimelinesByFolder(
        [tl(current, true), tl(current, true)],
        2
      );
      expect(groups).toHaveLength(1);
      expect(groups[0].timelines).toHaveLength(2);
    });
  });

  describe('folderChangedInWindow', () => {
    it('is true when a folder commenced or was decommissioned inside the window', () => {
      expect(folderChangedInWindow([{ commenced_at: at(5) }], WSTART, WEND)).toBe(true);
      expect(folderChangedInWindow([{ decommissioned_at: at(5) }], WSTART, WEND)).toBe(true);
      expect(folderChangedInWindow([{ commenced_at: at(500) }], WSTART, WEND)).toBe(false);
      expect(folderChangedInWindow([], WSTART, WEND)).toBe(false);
    });
  });
});

// ── KPI tile / findings dot agreement ─────────────────────────────────────────

describe('Executive Summary tile and Key Findings dot agree', () => {
  const dotFor = (d, i) => {
    const f = buildKeyFindings(d)[i];
    return f.color ?? severityColor(f.tone ?? 'optimal').color;
  };

  it('data quality uses the classification the record already carries', () => {
    // 80% would pass a >=75 pass/fail but the label says otherwise: the dot must
    // follow the label, exactly as the tile does.
    const d = { risk: 'TARP 1', quality: { label: 'Sub-Optimal', score: 0.8 } };
    expect(dotFor(d, 1)).toBe(severityColor('Sub-Optimal').color);
  });

  it('uptime shares the tile’s three-tier scale', () => {
    const dot = (uptime) => dotFor({ risk: 'TARP 1', availability: { uptimePercentage: uptime } }, 1);
    // 88% is the case the old two-tier dot got wrong: amber tile, red dot.
    expect(dot(88)).toBe(severityColor(uptimeSeverityLabel(88)).color);
    expect(dot(88)).toBe(SEV.acceptable);
    expect(dot(99)).toBe(SEV.optimal);
    expect(dot(50)).toBe(SEV.critical);
  });

  it('alarm dot follows the tone, including the no-alarm grey', () => {
    const dot = (alarms) => dotFor({ risk: 'TARP 1', alarms }, 1);
    expect(dot({ total: 0, valid: 0, tone: 'none' })).toBe(SEV.neutral);
    expect(dot({ total: 4, valid: 0, tone: 'false' })).toBe(SEV.optimal);
    expect(dot({ total: 4, valid: 1, tone: 'red' })).toBe(SEV.critical);
    expect(dot({ total: 4, valid: 1, tone: 'purple' })).toBe(ALARM_SEV.purple);
    expect(dot({ total: 4, valid: 1, tone: 'blue' })).toBe(ALARM_SEV.blue);
  });
});

// ── Key Findings: wall-folder-change note ─────────────────────────────────────

describe('buildKeyFindings — wall folder change note', () => {
  const base = { risk: 'TARP 1' };

  it('adds a neutral note when more than one folder contributed', () => {
    const findings = buildKeyFindings({
      ...base,
      wallFolders: {
        multiFolder: true,
        contributing: [
          { id: 2, name: 'NEW', area: 'North', type: 'Live' },
          { id: 1, name: 'OLD', area: 'North', type: 'Archive' },
        ],
      },
    });
    const note = findings.find((f) => /combines 2 wall folders/i.test(f.text));
    expect(note).toBeTruthy();
    expect(note.color).toBe(SEV.neutral);
    expect(note.detail).toContain('NEW');
    expect(note.detail).toMatch(/OLD.*—\s*archived/);
  });

  it('adds no note for a single-folder report', () => {
    const one = buildKeyFindings({
      ...base,
      wallFolders: { multiFolder: false, contributing: [{ id: 2, name: 'NEW', type: 'Live' }] },
    });
    expect(one.some((f) => /wall folders/i.test(f.text))).toBe(false);

    const none = buildKeyFindings(base);
    expect(none.some((f) => /wall folders/i.test(f.text))).toBe(false);
  });
});
