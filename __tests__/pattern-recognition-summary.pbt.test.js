/**
 * Property-based + scenario tests for pattern_recognition_summary storage.
 *
 * Feature: pattern-recognition-integration, Property 6: merging summary preserves all existing properties keys
 *
 * Also covers Task 15.3 (summary stored / absent) at the unit of the shared
 * merge helper that AddDeformationForm.handleSubmit delegates to — the single
 * source of truth for the storage decision (Requirements 9.1–9.5).
 */

import fc from 'fast-check';
import { mergeSummaryIntoProperties } from '@/utils/patternRecognitionMapper';

const NUM_RUNS = 200; // ≥ 100 iterations per the spec

const SUMMARY = {
  vcps: [{ name: 'VCP-7', windows: [], onset_of_failure: null }],
  fukuzono: [],
  slo: [],
  stage_summary: [],
};

describe('mergeSummaryIntoProperties', () => {
  // Feature: pattern-recognition-integration, Property 6: merging summary preserves all existing properties keys
  it('Property 6: merging the summary preserves every existing key and value', () => {
    // Arbitrary properties objects that do NOT already use the reserved key.
    const propsArb = fc
      .dictionary(
        fc.string(),
        fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null))
      )
      .map((d) => {
        const clone = { ...d };
        delete clone.pattern_recognition_summary;
        return clone;
      });

    fc.assert(
      fc.property(propsArb, (props) => {
        const original = JSON.parse(JSON.stringify(props));
        const result = mergeSummaryIntoProperties(props, SUMMARY, false);

        // Every original key/value is unchanged.
        for (const key of Object.keys(original)) {
          expect(result[key]).toEqual(original[key]);
        }
        // The summary key was added.
        expect(result.pattern_recognition_summary).toEqual(SUMMARY);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  // Task 15.3 — summary stored / absent depending on edits + presence.
  describe('Task 15.3: storage decision', () => {
    it('stores the summary when present and there were no manual edits', () => {
      const props = { Type: 'Progressive', Vmax: '12' };
      mergeSummaryIntoProperties(props, SUMMARY, false);
      expect(props.pattern_recognition_summary).toEqual(SUMMARY);
    });

    it('omits the key entirely when filled directly (summary is null)', () => {
      const props = { Type: 'Linear' };
      mergeSummaryIntoProperties(props, null, false);
      expect('pattern_recognition_summary' in props).toBe(false);
    });

    it('omits the key when the form was manually edited after auto-fill', () => {
      const props = { Type: 'Progressive' };
      mergeSummaryIntoProperties(props, SUMMARY, true);
      expect('pattern_recognition_summary' in props).toBe(false);
    });

    it('never sets the key to null (absent, not null) when omitted', () => {
      const props = {};
      mergeSummaryIntoProperties(props, undefined, false);
      expect(props.pattern_recognition_summary).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(props, 'pattern_recognition_summary')).toBe(false);
    });
  });
});
