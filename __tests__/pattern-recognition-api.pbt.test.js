/**
 * @jest-environment node
 *
 * Property-based tests for the /api/pattern-recognition/analyze route.
 *
 * Feature: pattern-recognition-integration
 *   - Property 2: file size > 50 MB always returns HTTP 400
 *   - Property 7: API error responses always have non-empty error field
 *
 * Validates: Requirements 4.6, 11.5, 11.6
 *
 * The Python subprocess and filesystem are mocked so these tests exercise only
 * the route's validation + error-shaping logic (which runs entirely before/around
 * the subprocess) without requiring a Python environment.
 */

import fc from 'fast-check';
import { EventEmitter } from 'events';

// --- Mocks ----------------------------------------------------------------

jest.mock('child_process', () => ({ spawn: jest.fn() }));
jest.mock('fs/promises', () => ({
  writeFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
}));

const { spawn } = require('child_process');
const { POST } = require('@/app/api/pattern-recognition/analyze/route');

const MAX_FILE_SIZE = 50 * 1024 * 1024;

const REQUIRED_PARAMS = [
  'vcpConfigs',
  'smoothingWindow',
  'longSmoothWindow',
  'vLowFrac',
  'aMultiplier',
  'minSegmentPts',
  'ivR2Threshold',
  'r2WarningThreshold',
  'fukuzonoTailFraction',
  'enableForecasting',
];

/** Build a fake spawned Python process that emits stdout then closes. */
function makeProc({ code = 0, stdout = '{}', stderr = '' } = {}) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: () => {}, end: () => {} };
  setImmediate(() => {
    if (stderr) proc.stderr.emit('data', Buffer.from(stderr));
    if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
    proc.emit('close', code);
  });
  return proc;
}

/** A fake File — only `.name`, `.size`, and `.arrayBuffer()` are used. */
function fakeFile(name, size) {
  return { name, size, arrayBuffer: async () => new ArrayBuffer(0) };
}

/** Minimal FormData stand-in matching the route's `.get()` / `.getAll()` usage. */
function makeFormData(fields, files) {
  return {
    getAll: (k) => (k === 'files[]' ? files : []),
    get: (k) => (k in fields ? fields[k] : null),
  };
}

function makeRequest(formData) {
  return { formData: async () => formData };
}

/** Valid parameter field set (all required params present and well-formed). */
function validFields() {
  return {
    vcpConfigs: JSON.stringify([
      { fileName: 'f.xlsx', vcpNamePrefix: 'VCP', smoothingWindows: [7] },
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
  };
}

beforeEach(() => {
  spawn.mockReset();
  spawn.mockImplementation(() => makeProc({ code: 0, stdout: '{}' }));
});

const NUM_RUNS = 150; // ≥ 100 iterations per the spec

describe('POST /api/pattern-recognition/analyze — validation & error shape', () => {
  // Feature: pattern-recognition-integration, Property 2: file size > 50 MB always returns HTTP 400
  it('Property 2: returns HTTP 400 if and only if a file exceeds 50 MB', async () => {
    await fc.assert(
      fc.asyncProperty(
        // sizes straddling the 50 MB boundary
        fc.integer({ min: 0, max: 60 * 1024 * 1024 }),
        async (size) => {
          const files = [fakeFile('f.xlsx', size)];
          const req = makeRequest(makeFormData(validFields(), files));
          const res = await POST(req);

          if (size > MAX_FILE_SIZE) {
            expect(res.status).toBe(400);
            const body = await res.json();
            expect(typeof body.error).toBe('string');
            expect(body.error.length).toBeGreaterThan(0);
          } else {
            // Under/at the limit → not rejected for size (subprocess mocked OK).
            expect(res.status).toBe(200);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // Feature: pattern-recognition-integration, Property 7: API error responses always have non-empty error field
  it('Property 7a: missing required params → HTTP 400 with a non-empty error string', async () => {
    await fc.assert(
      fc.asyncProperty(
        // a non-empty subset of required params to omit
        fc
          .subarray(REQUIRED_PARAMS, { minLength: 1 })
          .filter((a) => a.length >= 1),
        async (toOmit) => {
          const fields = validFields();
          for (const key of toOmit) delete fields[key];

          const files = [fakeFile('f.xlsx', 1024)];
          const req = makeRequest(makeFormData(fields, files));
          const res = await POST(req);

          expect(res.status).toBe(400);
          const body = await res.json();
          expect(typeof body.error).toBe('string');
          expect(body.error.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // Feature: pattern-recognition-integration, Property 7: API error responses always have non-empty error field
  it('Property 7b: a Python failure → HTTP 500 with a clean, non-empty error (no stack traces / module paths)', async () => {
    const FORBIDDEN = [
      /Traceback/i,
      /\.py\b/i,
      /File "/,
      /\bat \//,
      /line \d+/i,
      /[A-Za-z_]+Error:/, // e.g. ValueError:, KeyError:
    ];

    await fc.assert(
      fc.asyncProperty(
        // arbitrary Python exception text that must never leak to the client
        fc.string(),
        async (pyMessage) => {
          spawn.mockImplementation(() =>
            makeProc({
              code: 1,
              stdout: '',
              stderr:
                `Traceback (most recent call last):\n  File "x.py", line 3\nValueError: ` +
                pyMessage,
            })
          );

          const files = [fakeFile('f.xlsx', 1024)];
          const req = makeRequest(makeFormData(validFields(), files));
          const res = await POST(req);

          expect(res.status).toBe(500);
          const body = await res.json();
          expect(typeof body.error).toBe('string');
          expect(body.error.length).toBeGreaterThan(0);
          for (const pattern of FORBIDDEN) {
            expect(body.error).not.toMatch(pattern);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it('returns HTTP 400 "No files uploaded." when files[] is empty', async () => {
    const req = makeRequest(makeFormData(validFields(), []));
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('No files uploaded.');
  });
});
