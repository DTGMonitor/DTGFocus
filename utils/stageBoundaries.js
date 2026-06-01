/**
 * utils/stageBoundaries.js
 *
 * Pure helpers for the manual stage-boundary editor (issue 5). Translates
 * between the stage windows produced by the pipeline and the inter-stage
 * boundary lines drawn on the combined chart, and infers the user's gesture
 * (drag / add / delete) from a changed boundary set.
 *
 * Ported from the Streamlit reference (`app.py` _boundaries_to_spec /
 * _apply_boundary_change / _find_inserted / _find_removed) so the Next.js
 * editor behaves identically.
 */

export const PHASE_OPTIONS = [
  'No Significant Movement',
  'Linear',
  'Progressive Failure',
  'Regressive',
  'Unclassified',
];

const SEC = 1000;

/**
 * Parse a timestamp to epoch-ms, treating tz-naive inputs as UTC. Handles ISO
 * strings (with or without `Z`), Plotly's dragged date strings ("YYYY-MM-DD
 * HH:MM:SS" — space-separated, no tz), and raw numbers. Canonical UTC parsing
 * keeps all arithmetic consistent regardless of the browser's local zone.
 */
const ms = (t) => {
  if (typeof t === 'number') return t;
  let s = String(t).trim().replace(' ', 'T');
  if (!/[zZ]$/.test(s) && !/[+-]\d{2}:?\d{2}$/.test(s)) s += 'Z';
  return new Date(s).getTime();
};

/**
 * Render epoch-ms back to a tz-naive ISO string (no trailing `Z`), matching the
 * format the Python pipeline emits and that classify-manual reconstructs as
 * tz-naive — so boundary edits round-trip without a timezone shift.
 */
const iso = (m) => new Date(m).toISOString().slice(0, -1);

/**
 * Internal boundaries = the end of every window except the last one (the K-1
 * split points between K stages). Returns an array of ISO strings.
 */
export function windowsToBoundaries(windows) {
  if (!Array.isArray(windows) || windows.length < 2) return [];
  return windows.slice(0, -1).map((w) => w.end);
}

/**
 * Rebuild stage windows from ordered phases + internal boundary timestamps.
 * Edges are clamped non-decreasing and into [tStart, tEnd]; zero-length stages
 * are dropped.
 */
export function boundariesToWindows(phases, internalIso, tStartIso, tEndIso) {
  const tStart = ms(tStartIso);
  const tEnd = ms(tEndIso);
  const edges = [tStart, ...internalIso.map(ms), tEnd].map((e) =>
    Math.min(Math.max(e, tStart), tEnd)
  );
  for (let i = 1; i < edges.length; i++) {
    if (edges[i] < edges[i - 1]) edges[i] = edges[i - 1];
  }
  const out = [];
  for (let i = 0; i < phases.length; i++) {
    const s = edges[i];
    const e = edges[i + 1];
    if (e <= s) continue;
    out.push({ phase: phases[i], start: iso(s), end: iso(e) });
  }
  return out;
}

/** Clamp, sort, drop edge-touching, and de-duplicate near-equal boundaries. */
function cleanBoundaries(returnedMs, tStart, tEnd) {
  const eps = 30 * SEC;
  const cleaned = [];
  for (const b0 of [...returnedMs].sort((a, b) => a - b)) {
    const b = Math.min(Math.max(b0, tStart), tEnd);
    if (b <= tStart + eps || b >= tEnd - eps) continue;
    if (cleaned.length && Math.abs(b - cleaned[cleaned.length - 1]) <= 60 * SEC) continue;
    cleaned.push(b);
  }
  return cleaned;
}

function boundariesChanged(a, b, tolSec = 60) {
  if (a.length !== b.length) return true;
  return a.some((x, i) => Math.abs(x - b[i]) > tolSec * SEC);
}

function findInserted(newInternal, oldInternal, tolSec = 90) {
  return (
    newInternal.find((b) =>
      oldInternal.every((o) => Math.abs(b - o) > tolSec * SEC)
    ) ?? null
  );
}

function findRemovedIndex(newInternal, oldInternal, tolSec = 90) {
  for (let i = 0; i < oldInternal.length; i++) {
    if (newInternal.every((b) => Math.abs(oldInternal[i] - b) > tolSec * SEC)) {
      return i;
    }
  }
  return null;
}

/**
 * Infer the gesture from a changed boundary set and return the resulting stage
 * windows, or `null` when there is no meaningful change (so callers can skip a
 * needless re-classify).
 *
 * @param {Array<{phase,start,end}>} oldWindows  current stage windows
 * @param {Array<string|number>}     returned    new boundary set (ISO or ms)
 */
export function applyBoundaryChange(oldWindows, returned) {
  if (!Array.isArray(oldWindows) || oldWindows.length === 0) return null;

  const tStart = ms(oldWindows[0].start);
  const tEnd = ms(oldWindows[oldWindows.length - 1].end);
  const oldPhases = oldWindows.map((w) => w.phase);
  const oldInternal = windowsToBoundaries(oldWindows).map(ms);

  const newInternal = cleanBoundaries(returned.map(ms), tStart, tEnd);
  const nOld = oldInternal.length;
  const nNew = newInternal.length;

  let newPhases;
  if (nNew === nOld) {
    if (!boundariesChanged(newInternal, oldInternal)) return null;
    newPhases = [...oldPhases];
  } else if (nNew === nOld + 1) {
    const ins = findInserted(newInternal, oldInternal);
    if (ins === null) return null;
    const edges = [tStart, ...oldInternal, tEnd];
    let k = oldPhases.length - 1;
    for (let i = 0; i < oldPhases.length; i++) {
      if (edges[i] <= ins && ins <= edges[i + 1]) {
        k = i;
        break;
      }
    }
    // Split stage k → two halves keep its phase.
    newPhases = [
      ...oldPhases.slice(0, k + 1),
      oldPhases[k],
      ...oldPhases.slice(k + 1),
    ];
  } else if (nNew === nOld - 1) {
    const r = findRemovedIndex(newInternal, oldInternal);
    if (r === null) return null;
    // Merge stages r and r+1 → keep the left phase.
    newPhases = [...oldPhases.slice(0, r + 1), ...oldPhases.slice(r + 2)];
  } else {
    return null;
  }

  return boundariesToWindows(newPhases, newInternal.map(iso), oldWindows[0].start, oldWindows[oldWindows.length - 1].end);
}

// ---------------------------------------------------------------------------
// Deterministic, index-based operations (used by the interactive editor so a
// gesture maps to an exact change — no fuzzy position matching).
// ---------------------------------------------------------------------------

/**
 * Reposition all internal boundaries to a new set of positions (drag). The
 * count is unchanged; positions are sorted and assigned in order, phases kept.
 * Returns new windows, or null if the count doesn't match / no real change.
 */
export function repositionBoundaries(windows, newBoundaries) {
  if (!Array.isArray(windows) || windows.length < 2) return null;
  const phases = windows.map((w) => w.phase);
  if (!Array.isArray(newBoundaries) || newBoundaries.length !== phases.length - 1) {
    return null;
  }
  const sorted = [...newBoundaries].map(ms).sort((a, b) => a - b);
  const oldInternal = windowsToBoundaries(windows).map(ms);
  // Ignore sub-second no-op drags.
  if (sorted.every((v, i) => Math.abs(v - oldInternal[i]) <= SEC)) return null;
  return boundariesToWindows(
    phases,
    sorted.map(iso),
    windows[0].start,
    windows[windows.length - 1].end
  );
}

/**
 * Delete the internal boundary at `index` (0-based), merging stage `index` with
 * stage `index + 1` and keeping the left stage's phase. Returns new windows.
 */
export function deleteBoundaryAt(windows, index) {
  if (!Array.isArray(windows) || index < 0 || index >= windows.length - 1) {
    return null;
  }
  const merged = { ...windows[index], end: windows[index + 1].end };
  return [...windows.slice(0, index), merged, ...windows.slice(index + 2)];
}

/**
 * Add a boundary at `timeMs`, splitting the containing stage into two halves
 * that keep its phase. Returns new windows, or null when out of range.
 */
export function addBoundaryAt(windows, timeMs) {
  if (!Array.isArray(windows) || windows.length === 0) return null;
  const t = typeof timeMs === 'number' ? timeMs : ms(timeMs);
  const k = stageAtMs(windows, t);
  if (k < 0) return null;
  const w = windows[k];
  const start = ms(w.start);
  const end = ms(w.end);
  // Reject splits that land on (or outside) the stage edges.
  if (t <= start + SEC || t >= end - SEC) return null;
  const splitIso = iso(t);
  const left = { ...w, end: splitIso };
  const right = { ...w, start: splitIso };
  return [...windows.slice(0, k), left, right, ...windows.slice(k + 1)];
}

/** Relabel a single stage (rename gesture); returns new windows or null. */
export function renameStage(windows, stageIndex, phase) {
  if (
    !Array.isArray(windows) ||
    stageIndex < 0 ||
    stageIndex >= windows.length ||
    !PHASE_OPTIONS.includes(phase)
  ) {
    return null;
  }
  if (windows[stageIndex].phase === phase) return null;
  return windows.map((w, i) => (i === stageIndex ? { ...w, phase } : w));
}

/**
 * Display label for a phase. Until an actual failure time is confirmed, the
 * accelerating phase is shown as "Progressive" rather than "Progressive
 * Failure" (issue 3). The internal phase key is never changed — only display.
 */
export function displayPhase(phase, pfConfirmed) {
  if (pfConfirmed || typeof phase !== 'string') return phase;
  return phase.replace('Progressive Failure', 'Progressive');
}

/** Index of the stage window containing time `tMs`, or -1. */
export function stageAtMs(windows, tMs) {
  if (!Array.isArray(windows)) return -1;
  for (let i = 0; i < windows.length; i++) {
    if (tMs >= ms(windows[i].start) && tMs <= ms(windows[i].end)) return i;
  }
  return windows.length ? windows.length - 1 : -1;
}
