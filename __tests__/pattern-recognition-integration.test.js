/**
 * @jest-environment node
 *
 * Integration tests for the Pattern Recognition API routes. These drive the
 * real route handlers, which spawn the real Python pipeline.
 *
 *   Task 15.1 — analyze API end-to-end (Requirements 4.1, 4.2, 5.5)
 *   Task 15.2 — classify-manual endpoint (Requirements 6.3, 6.5)
 *
 * Skips automatically when the Python pipeline is not importable or the .xlsx
 * fixture is missing.
 */

const fs = require('fs');
const path = require('path');
const { pythonAvailable, PROJECT_ROOT } = require('./helpers/pythonRunner');

const FIXTURE = path.resolve(PROJECT_ROOT, '..', 'pattern-recognition', 'sample_data.xlsx');

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

/** Build a minimal File stand-in backed by a real buffer. */
function fileFromBuffer(name, buf) {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return { name, size: buf.length, arrayBuffer: async () => ab };
}

/** Minimal FormData stand-in matching the route's get()/getAll() usage. */
function makeFormData(fields, files) {
  return {
    getAll: (k) => (k === 'files[]' ? files : []),
    get: (k) => (k in fields ? fields[k] : null),
  };
}

maybeDescribe('Pattern Recognition API integration', () => {
  // Task 15.1 — analyze API end-to-end
  it('analyze: returns the documented response shape with a plotly_dark combined chart', async () => {
    const { POST } = require('@/app/api/pattern-recognition/analyze/route');

    const buf = fs.readFileSync(FIXTURE);
    const file = fileFromBuffer('sample_data.xlsx', buf);

    const fields = {
      vcpConfigs: JSON.stringify([
        { fileName: 'sample_data.xlsx', vcpNamePrefix: 'VCP-01', smoothingWindows: [7] },
      ]),
      smoothingWindow: '7',
      longSmoothWindow: '24',
      vLowFrac: '0.03',
      aMultiplier: '2.5',
      minSegmentPts: '12',
      ivR2Threshold: '0.75',
      r2WarningThreshold: '0.8',
      fukuzonoTailFraction: '0.2',
      enableForecasting: 'true',
      enableFukuzono: 'true',
      enableSloGradient: 'false',
    };

    const req = { formData: async () => makeFormData(fields, [file]) };
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();

    // Top-level shape (Requirement 4.2).
    expect(Array.isArray(body.vcps)).toBe(true);
    expect(body.vcps.length).toBeGreaterThanOrEqual(1);
    expect(body).toHaveProperty('multiVcpComparisonChartJson');

    // Per-VCP shape.
    const vcp = body.vcps[0];
    for (const key of [
      'vcpName',
      'smoothingWindow',
      'windows',
      'onsetOfFailure',
      'fukuzono',
      'slo',
      'stageSummaryRows',
      'combinedChartJson',
      'errors',
    ]) {
      expect(vcp).toHaveProperty(key);
    }
    expect(Array.isArray(vcp.windows)).toBe(true);
    expect(Array.isArray(vcp.stageSummaryRows)).toBe(true);

    // The combined chart uses the plotly_dark template (Requirement 5.5).
    // Plotly expands the named template into a full object on serialisation, so
    // we assert the template's signature dark background colour.
    expect(vcp.combinedChartJson).toBeTruthy();
    expect(vcp.combinedChartJson.layout.template.layout.paper_bgcolor).toBe(
      'rgb(17,17,17)'
    );
  }, 60000);

  // Task 15.2 — classify-manual endpoint
  it('classify-manual: returns the supplied phases and onset = start of the first Progressive Failure window', async () => {
    const { POST } = require('@/app/api/pattern-recognition/classify-manual/route');

    // Build a velocity series spanning 2026-01-01 → 2026-01-10 (hourly) so the
    // supplied window boundaries fall strictly inside the data range and are
    // therefore preserved unchanged by classify_from_manual_windows.
    const startMs = Date.UTC(2026, 0, 1, 0, 0, 0);
    const points = 24 * 9 + 1; // 9 days inclusive
    const x = [];
    const y = [];
    for (let i = 0; i < points; i++) {
      const d = new Date(startMs + i * 3600_000);
      // ISO without trailing 'Z' to keep the runner's timestamps tz-naive.
      x.push(d.toISOString().replace('Z', ''));
      y.push(Math.sin(i / 10));
    }

    const windows = [
      { phase: 'Linear', start: '2026-01-01T00:00:00', end: '2026-01-03T00:00:00' },
      { phase: 'Progressive Failure', start: '2026-01-03T00:00:00', end: '2026-01-06T00:00:00' },
      { phase: 'Regressive', start: '2026-01-06T00:00:00', end: '2026-01-09T00:00:00' },
    ];

    const body = {
      vcpName: 'VCP-01',
      smoothingWindow: 7,
      fileIndex: 0,
      displacement: { x, y },
      velocity_smooth: { x, y },
      windows,
    };

    const req = { json: async () => body };
    const res = await POST(req);

    expect(res.status).toBe(200);
    const out = await res.json();

    // Returned windows match the supplied phases in order.
    expect(out.windows.map((w) => w.phase)).toEqual([
      'Linear',
      'Progressive Failure',
      'Regressive',
    ]);

    // onsetOfFailure equals the start of the first Progressive Failure window.
    expect(out.onsetOfFailure).toMatch(/^2026-01-03T00:00:00/);

    // Result carries the rebuilt chart and stage summary.
    expect(out.combinedChartJson).toBeTruthy();
    expect(Array.isArray(out.stageSummaryRows)).toBe(true);
  }, 60000);
});
