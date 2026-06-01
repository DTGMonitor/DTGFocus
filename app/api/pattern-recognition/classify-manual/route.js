import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

export const dynamic = 'force-dynamic';

const SUBPROCESS_TIMEOUT_MS = 60 * 1000; // 60 seconds

const PHASE_LABELS = [
  'No Significant Movement',
  'Linear',
  'Progressive Failure',
  'Regressive',
  'Unclassified',
];

/**
 * Validate the incoming request body.
 * Returns { error } if validation fails, or { error: null } on success.
 */
function validateBody(body) {
  const { vcpName, smoothingWindow, windows, displacement, velocity_smooth } = body;

  // Validate vcpName and smoothingWindow presence
  if (!vcpName || vcpName === '') {
    return { error: 'Missing required field: vcpName' };
  }
  if (smoothingWindow === undefined || smoothingWindow === null || smoothingWindow === '') {
    return { error: 'Missing required field: smoothingWindow' };
  }

  // Validate displacement
  if (
    !displacement ||
    !Array.isArray(displacement.x) ||
    !Array.isArray(displacement.y)
  ) {
    return { error: 'Missing or invalid field: displacement must have x and y arrays' };
  }

  // Validate velocity_smooth
  if (
    !velocity_smooth ||
    !Array.isArray(velocity_smooth.x) ||
    !Array.isArray(velocity_smooth.y)
  ) {
    return { error: 'Missing or invalid field: velocity_smooth must have x and y arrays' };
  }

  // Validate windows is a non-empty array
  if (!Array.isArray(windows) || windows.length === 0) {
    return { error: 'Missing or invalid field: windows must be a non-empty array' };
  }

  // Validate each window entry has a valid phase
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    if (!w || typeof w !== 'object') {
      return { error: `Invalid window at index ${i}: must be an object` };
    }
    if (!PHASE_LABELS.includes(w.phase)) {
      return {
        error: `Invalid phase "${w.phase}" at index ${i}. Must be one of: ${PHASE_LABELS.join(', ')}`,
      };
    }
  }

  return { error: null };
}

/**
 * Spawn the Python runner in classify-manual mode and return the parsed JSON result.
 * Tries 'python' first, falls back to 'python3' on spawn error.
 */
function runPythonSubprocess(stdinPayload) {
  const scriptPath = path.join(process.cwd(), 'scripts', 'run_pattern_recognition.py');

  return new Promise((resolve, reject) => {
    const python = spawn('python', [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdoutChunks = [];
    const stderrChunks = [];

    python.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    python.stderr.on('data', (chunk) => stderrChunks.push(chunk));

    python.on('error', () => {
      // 'python' not found — fall back to 'python3'
      const python3 = spawn('python3', [scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const out3 = [];
      const err3 = [];

      python3.stdout.on('data', (chunk) => out3.push(chunk));
      python3.stderr.on('data', (chunk) => err3.push(chunk));

      python3.on('error', (spawnErr) => {
        reject(new Error(`Failed to spawn Python: ${spawnErr.message}`));
      });

      python3.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Python exited with code ${code}`));
          return;
        }
        const stdout = Buffer.concat(out3).toString('utf8');
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error('Failed to parse Python output as JSON'));
        }
      });

      python3.stdin.write(JSON.stringify(stdinPayload));
      python3.stdin.end();
    });

    python.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Python exited with code ${code}`));
        return;
      }
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error('Failed to parse Python output as JSON'));
      }
    });

    python.stdin.write(JSON.stringify(stdinPayload));
    python.stdin.end();
  });
}

/**
 * Wrap the subprocess call with a 60-second timeout via Promise.race.
 */
function runWithTimeout(stdinPayload) {
  const subprocessPromise = runPythonSubprocess(stdinPayload);

  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error('Processing timed out after 60 seconds')),
      SUBPROCESS_TIMEOUT_MS
    );
  });

  // Clear the timer once the race settles so it never dangles past completion.
  return Promise.race([subprocessPromise, timeoutPromise]).finally(() =>
    clearTimeout(timeoutId)
  );
}

export async function POST(request) {
  let body;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body.' },
      { status: 400 }
    );
  }

  // Validate request body
  const { error: validationError } = validateBody(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const { vcpName, smoothingWindow, windows, displacement, velocity_smooth, params } = body;

  // Build stdin payload for the Python runner (classify-manual mode)
  const stdinPayload = {
    mode: 'classify-manual',
    vcpName,
    smoothingWindow,
    displacement,
    velocity_smooth,
    windows,
    // Forecasting params so PF-boundary edits recompute the prediction.
    params: params ?? {},
  };

  try {
    const result = await runWithTimeout(stdinPayload);

    // Return the classification result with all timestamps as ISO 8601 strings
    // (serialisation is handled by the Python runner per Requirements 11.1, 11.3)
    return NextResponse.json(
      {
        windows: result.windows,
        onsetOfFailure: result.onsetOfFailure,
        fukuzono: result.fukuzono ?? null,
        slo: result.slo ?? null,
        combinedChartJson: result.combinedChartJson,
        stageSummaryRows: result.stageSummaryRows,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('Pattern recognition classify-manual API error:', err);

    return NextResponse.json(
      { error: 'Classification failed. Please try again.' },
      { status: 500 }
    );
  }
}
