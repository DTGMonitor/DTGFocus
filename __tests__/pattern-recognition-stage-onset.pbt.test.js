/**
 * Property-based test for StageEditor onset-of-failure derivation.
 *
 * Feature: pattern-recognition-integration, Property 5: onset_of_failure is start of first PF window or — if none
 *
 * Validates: Requirements 6.5
 */

import fc from 'fast-check';
import { deriveOnsetOfFailure } from '@/components/admin/Radar/PatternRecognition/StageEditor';

const NUM_RUNS = 200; // ≥ 100 iterations per the spec

const PHASES = [
  'No Significant Movement',
  'Linear',
  'Progressive Failure',
  'Regressive',
  'Unclassified',
];

/** A window arbitrary with a random phase and an ISO start string. */
const windowArb = fc.record({
  phase: fc.constantFrom(...PHASES),
  start: fc
    .integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2030, 0, 1) })
    .map((ms) => new Date(ms).toISOString()),
  end: fc.constant('2030-12-31T00:00:00.000Z'),
  duration: fc.constant('1h'),
});

describe('StageEditor.deriveOnsetOfFailure', () => {
  // Feature: pattern-recognition-integration, Property 5: onset_of_failure is start of first PF window or — if none
  it('Property 5: returns the start of the first Progressive Failure window, or null (rendered as "—") when none', () => {
    fc.assert(
      fc.property(fc.array(windowArb, { maxLength: 12 }), (windows) => {
        const onset = deriveOnsetOfFailure(windows);

        const firstPf = windows.find((w) => w.phase === 'Progressive Failure');

        if (firstPf) {
          // Must equal the start of the FIRST PF window (order preserved).
          expect(onset).toBe(firstPf.start);
        } else {
          // No PF window → null, which the editor renders as "—".
          expect(onset).toBeNull();
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('returns null for non-array / empty inputs', () => {
    expect(deriveOnsetOfFailure(undefined)).toBeNull();
    expect(deriveOnsetOfFailure(null)).toBeNull();
    expect(deriveOnsetOfFailure([])).toBeNull();
  });
});
