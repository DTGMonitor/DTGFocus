/**
 * @jest-environment node
 *
 * Integration tests for the bundled pattern-recognition runner (the same code
 * the Vercel Python functions in api/pattern-recognition/*.py call). Drives the
 * real pipeline through the CLI shim (scripts/run_pattern_recognition.py),
 * exercising the production handle_analyze / handle_classify_manual paths.
 *
 *   analyze end-to-end (base64 file in → result shape, plotly_dark, units)
 *   classify-manual (supplied phases preserved, onset = first PF start)
 *
 * Skips automatically when the Python pipeline is not importable or the .xlsx
 * fixture is missing.
 */

const fs = require('fs');
const path = require('path');
const { pythonAvailable, runPython, PROJECT_ROOT } = require('./helpers/pythonRunner');

const FIXTURE = path.resolve(PROJECT_ROOT, '..', 'pattern-recognition', 'sample_data.xlsx');
const RUNNER = 'scripts/run_pattern_recognition.py';

const canRun = pythonAvailable() && fs.existsSync(FIXTURE);
const maybeDescribe = canRun ? describe : describe.skip;

if (!canRun) {
  // eslint-disable-next-line no-console
  console.warn(
    `[pattern-recognition] Skipping integration tests: pythonAvailable=${pythonAvailable()}, fixtureExists=${fs.existsSync(
      FIXTURE
    )} (${FIXTURE})`
  );
}

const PARAMS = {
  smoothingWindow: 60,
  longSmoothWindow: 24,
  vLowFrac: 0.03,
  aMultiplier: 2.5,
  minSegmentPts: 12,
  ivR2Threshold: 0.75,
  r2WarningThreshold: 0.8,
  fukuzonoTailFraction: 0.2,
  enableForecasting: true,
  enableFukuzono: true,
  enableSloGradient: false,
};

/** Run the CLI shim with a JSON job on stdin, return the parsed result. */
function runJob(job) {
  const res = runPython([RUNNER], JSON.stringify(job));
  if (res.status !== 0) {
    throw new Error(`runner failed (status ${res.status}): ${res.stderr || res.error}`);
  }
  return JSON.parse(res.stdout);
}

maybeDescribe('Pattern Recognition pipeline integration (bundled runner)', () => {
  it('analyze: base64 file → documented shape with a plotly_dark combined chart in mm/h', () => {
    const contentBase64 = fs.readFileSync(FIXTURE).toString('base64');
    const out = runJob({
      mode: 'analyze',
      files: [{ name: 'sample_data.xlsx', contentBase64, vcpNamePrefix: 'VCP-01', smoothingWindows: [60] }],
      params: PARAMS,
    });

    expect(Array.isArray(out.vcps)).toBe(true);
    expect(out.vcps.length).toBeGreaterThanOrEqual(1);
    expect(out).toHaveProperty('multiVcpComparisonChartJson');

    const vcp = out.vcps[0];
    for (const key of [
      'vcpName',
      'smoothingWindow',
      'velocityUnit',
      'windows',
      'onsetOfFailure',
      'fukuzono',
      'slo',
      'stageSummaryRows',
      'combinedChartJson',
      'displacementSeries',
      'velocitySmoothSeries',
      'errors',
    ]) {
      expect(vcp).toHaveProperty(key);
    }
    expect(vcp.velocityUnit).toBe('mm/h'); // 60-min window < 1440
    // plotly_dark signature dark background in the expanded template.
    expect(vcp.combinedChartJson.layout.template.layout.paper_bgcolor).toBe('rgb(17,17,17)');
    // velocity axis uses the chosen display unit.
    expect(vcp.combinedChartJson.layout.yaxis2.title.text).toBe('Velocity (mm/h)');
  }, 60000);

  it('classify-manual: returns the supplied phases and onset = first Progressive Failure start; recomputes forecast', () => {
    // First analyze to obtain the preprocessed series.
    const contentBase64 = fs.readFileSync(FIXTURE).toString('base64');
    const analyzed = runJob({
      mode: 'analyze',
      files: [{ name: 'sample_data.xlsx', contentBase64, vcpNamePrefix: 'VCP-01', smoothingWindows: [60] }],
      params: PARAMS,
    });
    const vcp = analyzed.vcps[0];

    // Build explicit windows spanning the data range with a PF stage.
    const xs = vcp.velocitySmoothSeries.x;
    const start = xs[0];
    const end = xs[xs.length - 1];
    const mid1 = xs[Math.floor(xs.length / 3)];
    const mid2 = xs[Math.floor((2 * xs.length) / 3)];
    const windows = [
      { phase: 'Linear', start, end: mid1 },
      { phase: 'Progressive Failure', start: mid1, end: mid2 },
      { phase: 'Regressive', start: mid2, end },
    ];

    const out = runJob({
      mode: 'classify-manual',
      vcpName: vcp.vcpName,
      smoothingWindow: 60,
      displacement: vcp.displacementSeries,
      velocity_smooth: vcp.velocitySmoothSeries,
      windows,
      params: PARAMS,
    });

    expect(out.windows.map((w) => w.phase)).toEqual([
      'Linear',
      'Progressive Failure',
      'Regressive',
    ]);
    // onset == start of the first PF window (compare to the minute).
    expect(out.onsetOfFailure.slice(0, 16)).toBe(mid1.slice(0, 16));
    // Forecast was recomputed (key present; value present when a fit succeeds).
    expect(out).toHaveProperty('fukuzono');
    expect(out.combinedChartJson).toBeTruthy();
    expect(Array.isArray(out.stageSummaryRows)).toBe(true);
  }, 60000);
});
