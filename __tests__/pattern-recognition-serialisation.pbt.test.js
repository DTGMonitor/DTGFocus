/**
 * @jest-environment node
 *
 * Property-based test for the Python serialisation round-trip.
 *
 * Feature: pattern-recognition-integration, Property 1: serialisation round-trip preserves all values
 *
 * Validates: Requirements 11.1, 11.2, 11.4
 *
 * fast-check generates arbitrary pipeline-output values (pd.Timestamp inputs and
 * numeric series); the ACTUAL Python serialise_timestamp()/serialise_series()
 * functions from scripts/run_pattern_recognition.py process them in one batched
 * subprocess. We then assert every timestamp came back as a valid ISO 8601 string
 * and every numeric is preserved to within 1e-9.
 *
 * Skips automatically when the Python pipeline is not importable.
 */

import fc from 'fast-check';
const { pythonAvailable, runPython } = require('./helpers/pythonRunner');

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const MIN_MS = Date.UTC(2000, 0, 1);
const MAX_MS = Date.UTC(2030, 0, 1);

// Probe that imports the REAL serialisers and applies them to each case.
const PROBE = `
import os, sys, json
sys.path.insert(0, os.path.join(os.getcwd(), 'scripts'))
import pandas as pd
from run_pattern_recognition import serialise_timestamp, serialise_series
data = json.loads(sys.stdin.read())
out = []
for c in data['cases']:
    tss = [serialise_timestamp(pd.Timestamp(ms, unit='ms')) for ms in c['timestamps']]
    idx = pd.DatetimeIndex([pd.Timestamp(ms, unit='ms') for ms in c['series_x']])
    ser = pd.Series(c['series_y'], index=idx)
    out.append({'timestamps': tss, 'series': serialise_series(ser)})
sys.stdout.write(json.dumps(out))
`;

const msArb = fc.integer({ min: MIN_MS, max: MAX_MS });
const numArb = fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true });

const caseArb = fc
  .record({
    timestamps: fc.array(msArb, { maxLength: 5 }),
    n: fc.integer({ min: 0, max: 6 }),
  })
  .chain((g) =>
    fc.record({
      timestamps: fc.constant(g.timestamps),
      series_x: fc.array(msArb, { minLength: g.n, maxLength: g.n }),
      series_y: fc.array(numArb, { minLength: g.n, maxLength: g.n }),
    })
  );

const maybeDescribe = pythonAvailable() ? describe : describe.skip;

maybeDescribe('Python serialisation round-trip', () => {
  // Feature: pattern-recognition-integration, Property 1: serialisation round-trip preserves all values
  it('Property 1: timestamps → valid ISO 8601, numerics preserved to within 1e-9 (200 cases)', () => {
    const cases = fc.sample(caseArb, { numRuns: 200, seed: 42 });

    const res = runPython(['-c', PROBE], JSON.stringify({ cases }));
    if (res.status !== 0) {
      throw new Error(`Python probe failed: ${res.stderr || res.error}`);
    }
    const out = JSON.parse(res.stdout);
    expect(out).toHaveLength(cases.length);

    out.forEach((result, i) => {
      const input = cases[i];

      // (a) Every standalone timestamp is a valid ISO 8601 string.
      result.timestamps.forEach((ts) => {
        expect(typeof ts).toBe('string');
        expect(ts).toMatch(ISO_8601);
        expect(Number.isNaN(Date.parse(ts))).toBe(false);
      });

      // (b) Series x-values are valid ISO 8601 strings, one per input point.
      expect(result.series.x).toHaveLength(input.series_x.length);
      result.series.x.forEach((ts) => {
        expect(ts).toMatch(ISO_8601);
        expect(Number.isNaN(Date.parse(ts))).toBe(false);
      });

      // (c) Series y-values are preserved to within 1e-9.
      expect(result.series.y).toHaveLength(input.series_y.length);
      result.series.y.forEach((y, j) => {
        expect(typeof y).toBe('number');
        expect(Math.abs(y - input.series_y[j])).toBeLessThanOrEqual(1e-9);
      });
    });
  }, 60000);
});

if (!pythonAvailable()) {
  // Surface why the suite was skipped instead of silently passing.
  // eslint-disable-next-line no-console
  console.warn(
    '[pattern-recognition] Skipping Property 1 (serialisation round-trip): Python pipeline not importable in this environment.'
  );
}
