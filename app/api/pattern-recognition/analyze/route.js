import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

export const dynamic = 'force-dynamic';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const SUBPROCESS_TIMEOUT_MS = 60 * 1000; // 60 seconds

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

/**
 * Parse and validate form fields from the multipart/form-data request.
 * Returns { params, error } where error is a string if validation fails.
 */
function extractParams(formData) {
  // Check required params
  for (const name of REQUIRED_PARAMS) {
    const value = formData.get(name);
    if (value === null || value === undefined || value === '') {
      return { params: null, error: `Missing required parameter: ${name}` };
    }
  }

  const parseBool = (val) => val === 'true';
  const parseFloat_ = (val) => parseFloat(val);
  const parseInt_ = (val) => parseInt(val, 10);

  const params = {
    smoothingWindow: parseInt_(formData.get('smoothingWindow')),
    longSmoothWindow: parseInt_(formData.get('longSmoothWindow')),
    vLowFrac: parseFloat_(formData.get('vLowFrac')),
    aMultiplier: parseFloat_(formData.get('aMultiplier')),
    minSegmentPts: parseInt_(formData.get('minSegmentPts')),
    ivR2Threshold: parseFloat_(formData.get('ivR2Threshold')),
    r2WarningThreshold: parseFloat_(formData.get('r2WarningThreshold')),
    fukuzonoTailFraction: parseFloat_(formData.get('fukuzonoTailFraction')),
    enableForecasting: parseBool(formData.get('enableForecasting')),
    enableFukuzono: parseBool(formData.get('enableFukuzono')),
    enableSloGradient: parseBool(formData.get('enableSloGradient')),
    sloRollingWindow: parseFloat_(formData.get('sloRollingWindow') ?? '5'),
    sloCriticalThreshold: parseFloat_(formData.get('sloCriticalThreshold') ?? '50.0'),
    sloTailFraction: parseFloat_(formData.get('sloTailFraction') ?? '0.30'),
    sloR2WarningThreshold: parseFloat_(formData.get('sloR2WarningThreshold') ?? '0.70'),
  };

  return { params, error: null };
}

/**
 * Write uploaded File objects to the OS temp directory.
 * Returns an array of { tempPath, originalName } objects.
 */
async function writeTempFiles(files) {
  const tempFiles = [];
  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const suffix = Math.random().toString(36).slice(2, 8);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const tempPath = path.join(tmpdir(), `pr_${Date.now()}_${suffix}_${safeName}`);
    await writeFile(tempPath, buffer);
    tempFiles.push({ tempPath, originalName: file.name });
  }
  return tempFiles;
}

/**
 * Build the stdin payload for the Python runner.
 * Matches each uploaded file to its vcpConfig entry by fileName.
 */
function buildStdinPayload(tempFiles, vcpConfigs, params) {
  const filesPayload = tempFiles.map(({ tempPath, originalName }) => {
    // Find matching vcpConfig by fileName
    const config = vcpConfigs.find((c) => c.fileName === originalName);
    return {
      path: tempPath,
      vcpNamePrefix: config?.vcpNamePrefix ?? originalName.replace(/\.[^.]+$/, ''),
      smoothingWindows: config?.smoothingWindows ?? [params.smoothingWindow],
    };
  });

  return {
    mode: 'analyze',
    files: filesPayload,
    params,
  };
}

/**
 * Spawn the Python runner and return the parsed JSON result.
 * Rejects on non-zero exit code or timeout.
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

    python.on('error', (err) => {
      // python not found — try python3
      const python3 = spawn('python3', [scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const out3 = [];
      const err3 = [];

      python3.stdout.on('data', (chunk) => out3.push(chunk));
      python3.stderr.on('data', (chunk) => err3.push(chunk));

      python3.on('error', (err3spawn) => {
        reject(new Error(`Failed to spawn Python: ${err3spawn.message}`));
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
  let tempFiles = [];

  try {
    const formData = await request.formData();
    const files = formData.getAll('files[]');

    // Validate: at least one file
    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No files uploaded.' }, { status: 400 });
    }

    // Enforce 50 MB per-file limit before any processing
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `File "${file.name}" exceeds the 50 MB size limit.` },
          { status: 400 }
        );
      }
    }

    // Validate required params
    const { params, error: paramError } = extractParams(formData);
    if (paramError) {
      return NextResponse.json({ error: paramError }, { status: 400 });
    }

    // Parse vcpConfigs JSON string
    let vcpConfigs = [];
    try {
      vcpConfigs = JSON.parse(formData.get('vcpConfigs'));
    } catch {
      return NextResponse.json(
        { error: 'Missing required parameter: vcpConfigs' },
        { status: 400 }
      );
    }

    // Write uploaded files to temp directory
    tempFiles = await writeTempFiles(files);

    // Build stdin payload for Python runner
    const stdinPayload = buildStdinPayload(tempFiles, vcpConfigs, params);

    // Run Python subprocess with 60-second timeout
    const result = await runWithTimeout(stdinPayload);

    // Clean up temp files (best-effort)
    await Promise.allSettled(tempFiles.map(({ tempPath }) => unlink(tempPath)));
    tempFiles = [];

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    // Clean up temp files on error
    if (tempFiles.length > 0) {
      await Promise.allSettled(tempFiles.map(({ tempPath }) => unlink(tempPath)));
    }

    console.error('Pattern recognition API error:', err);

    // Python exit code 1 or timeout → 500 with generic message
    return NextResponse.json(
      { error: 'Analysis failed. Please try again.' },
      { status: 500 }
    );
  }
}
