/**
 * Test helper: locate a usable Python interpreter that can import the pattern
 * recognition runner, and run it synchronously.
 *
 * Used by the Python-backed property/integration tests. When no suitable
 * interpreter is available (e.g. CI without the pipeline deps installed), the
 * dependent suites skip themselves rather than fail.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const CANDIDATES = ['python', 'python3'];

function runWith(bin, args, input) {
  return spawnSync(bin, args, {
    input,
    encoding: 'utf8',
    cwd: PROJECT_ROOT,
    maxBuffer: 128 * 1024 * 1024,
  });
}

let _bin; // undefined = unresolved, string = bin, null = unavailable

function resolvePython() {
  if (_bin !== undefined) return _bin;
  const probe =
    'import os,sys; sys.path.insert(0, os.path.join(os.getcwd(),"scripts")); import run_pattern_recognition; print("ok")';
  for (const bin of CANDIDATES) {
    try {
      const r = runWith(bin, ['-c', probe]);
      if (r.status === 0 && r.stdout && r.stdout.includes('ok')) {
        _bin = bin;
        return _bin;
      }
    } catch {
      /* try next candidate */
    }
  }
  _bin = null;
  return _bin;
}

function pythonAvailable() {
  return resolvePython() !== null;
}

/** Run the resolved python with args, piping `input` to stdin. */
function runPython(args, input) {
  const bin = resolvePython();
  if (!bin) throw new Error('No usable Python interpreter for the pipeline.');
  return runWith(bin, args, input);
}

module.exports = { pythonAvailable, runPython, PROJECT_ROOT };
