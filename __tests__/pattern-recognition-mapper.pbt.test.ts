/**
 * Property-based tests for the Pattern Recognition auto-fill mapper.
 *
 * Feature: pattern-recognition-integration
 *   - Property 3: longest VCP selection is correct for any input set
 *   - Property 4: auto-fill mapper produces correct field values for any VCP results
 *
 * Validates: Requirements 8.1, 8.4, 8.5, 8.6, 8.7, 8.8, 8.10, 8.13
 */

import fc from 'fast-check';
import {
  buildAutoFillInitialValues,
  selectFormVcp,
  PHASE_TO_TYPE_MAP,
  type VCPResult,
  type StageSummaryRow,
  type WindowResult,
} from '@/utils/patternRecognitionMapper';
import { isoToDatetimeLocal } from '@/utils/tabHelpers';

const NUM_RUNS = 200; // ≥ 100 iterations per the spec
const TIMEZONE = 'Australia/Perth';

const PHASES = [
  'No Significant Movement',
  'Linear',
  'Progressive Failure',
  'Regressive',
  'Unclassified',
];

const BASE_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0); // 2026-01-01T00:00:00Z

/** Reproduce the mapper's round() (multiply-round-divide). */
function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/** A blank stage-summary row with only the fields we care about populated. */
function pfRow(velMax: number, velMin: number | null): StageSummaryRow {
  return {
    VCP: 'x',
    Stage: 'Progressive Failure',
    Start: '',
    End: '',
    Duration: '',
    'Deformation min (mm)': null,
    'Deformation max (mm)': null,
    'Deformation Δ (mm)': null,
    'Velocity min (mm/day)': velMin,
    'Velocity max (mm/day)': velMax,
    'Velocity Δ (mm/day)': null,
    'Inv. Velocity min (day/mm)': null,
    'Inv. Velocity max (day/mm)': null,
    'Inv. Velocity Δ (day/mm)': null,
  };
}

/**
 * Arbitrary for a single VCP result.
 * `pfHours` controls total PF window duration; `pfRows` controls the PF stage
 * statistics (and therefore whether a PF stage "exists").
 */
const vcpArb = (): fc.Arbitrary<VCPResult> =>
  fc
    .record({
      pfHours: fc.integer({ min: 0, max: 480 }),
      finalPhase: fc.constantFrom(...PHASES),
      smoothingWindow: fc.integer({ min: 2, max: 1440 }),
      // 0 PF rows → no PF stage. Otherwise unique Velocity-max values to avoid
      // ambiguity in "highest Velocity max" tie-breaking.
      pfVelMaxes: fc.uniqueArray(
        fc.float({ min: Math.fround(0.01), max: 1000, noNaN: true }),
        { minLength: 0, maxLength: 3 }
      ),
      vmin: fc.option(fc.float({ min: 0, max: 50, noNaN: true }), { nil: null }),
      hasOnset: fc.boolean(),
    })
    .map((g): VCPResult => {
      const windows: WindowResult[] = [];
      const start = new Date(BASE_EPOCH_MS).toISOString();
      if (g.pfHours > 0) {
        windows.push({
          phase: 'Progressive Failure',
          start,
          end: new Date(BASE_EPOCH_MS + g.pfHours * 3600_000).toISOString(),
          duration: `${g.pfHours}h`,
        });
      }
      // Ensure the final window carries the chosen finalPhase.
      windows.push({
        phase: g.finalPhase,
        start: new Date(BASE_EPOCH_MS + 480 * 3600_000).toISOString(),
        end: new Date(BASE_EPOCH_MS + 481 * 3600_000).toISOString(),
        duration: '1h',
      });

      const stageSummaryRows = g.pfVelMaxes.map((vm) => pfRow(vm, g.vmin));

      return {
        vcpName: `VCP-${g.smoothingWindow}`,
        smoothingWindow: g.smoothingWindow,
        windows,
        onsetOfFailure: g.hasOnset
          ? new Date(BASE_EPOCH_MS).toISOString()
          : null,
        fukuzono: null,
        slo: null,
        stageSummaryRows,
        combinedChartJson: {},
        errors: [],
      };
    });

describe('patternRecognitionMapper', () => {
  // Feature: pattern-recognition-integration, Property 3: form-VCP selection is correct for any input set
  it('Property 3: selects the single VCP, or the shortest-window VCP when several', () => {
    fc.assert(
      fc.property(fc.array(vcpArb(), { minLength: 1, maxLength: 6 }), (vcps) => {
        const selected = selectFormVcp(vcps);
        if (vcps.length === 1) {
          expect(selected).toBe(vcps[0]);
          return;
        }
        const minWindow = Math.min(...vcps.map((v) => v.smoothingWindow));
        expect(selected.smoothingWindow).toBe(minWindow);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  // Feature: pattern-recognition-integration, Property 4: auto-fill mapper produces correct field values for any VCP results
  it('Property 4: maps Type, Start, VCP, Vmax, Vmin, InverseVelocity1 (native unit), Location, alarmRegions correctly', () => {
    const precursorArb = fc.record({
      Location: fc.option(fc.string(), { nil: undefined }),
      alarmRegions: fc.option(fc.array(fc.integer()), { nil: undefined }),
    });

    fc.assert(
      fc.property(
        fc.array(vcpArb(), { minLength: 1, maxLength: 6 }),
        precursorArb,
        (vcps, precursor) => {
          const result = buildAutoFillInitialValues(vcps, precursor, TIMEZONE);
          const selected = selectFormVcp(vcps);

          // Native form unit: mm/h (×1/24) when window < 1440, else mm/day.
          const vFac = selected.smoothingWindow < 1440 ? 1 / 24 : 1;

          // --- Derive expectations independently from the spec rules ---
          const pfRows = selected.stageSummaryRows.filter((r) =>
            r.Stage.startsWith('Progressive Failure')
          );
          const hasPFStage = pfRows.length > 0;

          const finalWindow =
            selected.windows.length > 0
              ? selected.windows[selected.windows.length - 1]
              : null;
          const finalPhase = finalWindow?.phase ?? 'Unclassified';
          const mappedType = PHASE_TO_TYPE_MAP[finalPhase] ?? 'Linear';

          // Type (Req 8.4): mapped phase when a PF stage exists, else "Linear".
          expect(result.Type).toBe(hasPFStage ? mappedType : 'Linear');

          // Start (Req 8.5): onset → datetime-local, else "".
          expect(result.Start).toBe(
            selected.onsetOfFailure
              ? isoToDatetimeLocal(selected.onsetOfFailure, TIMEZONE)
              : ''
          );

          // VCP (Req 8.6): the smoothing window as a string.
          expect(result.VCP).toBe(String(selected.smoothingWindow));

          if (hasPFStage) {
            // PF row with the highest Velocity max wins (Req 8.7).
            const best = pfRows.reduce((b, r) =>
              (r['Velocity max (mm/day)'] ?? -Infinity) >
              (b['Velocity max (mm/day)'] ?? -Infinity)
                ? r
                : b
            );
            const pfVmax = best['Velocity max (mm/day)']!;
            const pfVmin = best['Velocity min (mm/day)'];
            const vmaxDisp = pfVmax * vFac;

            // Velocity in the VCP's native unit (issue 4).
            expect(result.Vmax).toBe(String(round(vmaxDisp, 4)));
            expect(result.Vmin).toBe(
              pfVmin !== null ? String(round(pfVmin * vFac, 4)) : ''
            );

            // InverseVelocity1 = round(1 / Vmax, 4) in the matching inverse unit.
            expect(result.InverseVelocity1).toBe(
              vmaxDisp !== 0 ? String(round(1 / vmaxDisp, 4)) : ''
            );
          } else {
            // No PF stage → velocity fields empty (Req 8.12).
            expect(result.Vmax).toBe('');
            expect(result.Vmin).toBe('');
            expect(result.InverseVelocity1).toBe('');
          }

          // Location & alarmRegions always come from the precursor (Req 8.13).
          expect(result.Location).toBe(precursor.Location ?? '');
          expect(result.alarmRegions).toEqual(precursor.alarmRegions ?? []);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
