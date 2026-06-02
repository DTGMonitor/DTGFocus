/**
 * utils/devPythonRunner.js  (server-only)
 *
 * Local-development helper: runs the bundled pattern-recognition pipeline by
 * spawning the local Python CLI shim (scripts/run_pattern_recognition.py) and
 * piping a JSON job to it. This is used ONLY by the dev-only /api/pr-local
 * routes so the app can be exercised with `npm run dev` (production uses the
 * Vercel Python functions in api/pattern-recognition/*.py instead).
 */

import { spawn } from 'child_process';
import path from 'path';

const SCRIPT = path.join(process.cwd(), 'scripts', 'run_pattern_recognition.py');

function spawnOnce(bin, job, timeoutMs) {
  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn(bin, [SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      reject(Object.assign(new Error('spawn-failed'), { code: 'SPAWN' }));
      return;
    }

    const out = [];
    const err = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill();
      reject(new Error('Processing timed out.'));
    }, timeoutMs);

    proc.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(Object.assign(new Error('spawn-failed'), { code: 'SPAWN' }));
    });
    proc.stdout.on('data', (d) => out.push(d));
    proc.stderr.on('data', (d) => err.push(d));
    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(Buffer.concat(err).toString('utf8') || `Python exited ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(out).toString('utf8')));
      } catch {
        reject(new Error('Failed to parse Python output.'));
      }
    });

    proc.stdin.write(JSON.stringify(job));
    proc.stdin.end();
  });
}

/** Run a runner job ({mode, ...}); tries `python`, falls back to `python3`. */
export async function runRunnerJob(job, timeoutMs = 120000) {
  try {
    return await spawnOnce('python', job, timeoutMs);
  } catch (err) {
    if (err && err.code === 'SPAWN') {
      return spawnOnce('python3', job, timeoutMs);
    }
    throw err;
  }
}
