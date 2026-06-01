/**
 * Unit tests for the manual stage-boundary editor logic (issue 5).
 *
 * Mirrors the Streamlit gesture inference: drag (reposition), add (split,
 * halves keep phase), delete (merge, keep left phase), rename.
 */

import {
  windowsToBoundaries,
  boundariesToWindows,
  applyBoundaryChange,
  repositionBoundaries,
  deleteBoundaryAt,
  addBoundaryAt,
  renameStage,
  stageAtMs,
} from '@/utils/stageBoundaries';

const W = (phase, start, end) => ({ phase, start, end });

// Three contiguous daily stages spanning 2026-01-01 → 2026-01-04.
const baseWindows = [
  W('Linear', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
  W('Progressive Failure', '2026-01-02T00:00:00.000Z', '2026-01-03T00:00:00.000Z'),
  W('Regressive', '2026-01-03T00:00:00.000Z', '2026-01-04T00:00:00.000Z'),
];

describe('stageBoundaries', () => {
  it('windowsToBoundaries returns the K-1 internal split points', () => {
    expect(windowsToBoundaries(baseWindows)).toEqual([
      '2026-01-02T00:00:00.000Z',
      '2026-01-03T00:00:00.000Z',
    ]);
    expect(windowsToBoundaries([baseWindows[0]])).toEqual([]);
  });

  it('boundariesToWindows rebuilds contiguous windows and drops zero-length stages', () => {
    const out = boundariesToWindows(
      ['Linear', 'Progressive Failure', 'Regressive'],
      ['2026-01-02T00:00:00.000Z', '2026-01-03T00:00:00.000Z'],
      '2026-01-01T00:00:00.000Z',
      '2026-01-04T00:00:00.000Z'
    );
    expect(out.map((w) => w.phase)).toEqual(['Linear', 'Progressive Failure', 'Regressive']);
    // Output is tz-naive ISO (no trailing Z), matching the pipeline format.
    expect(out[0].start).toBe('2026-01-01T00:00:00.000');
    expect(out[2].end).toBe('2026-01-04T00:00:00.000');
  });

  it('drag: same count → repositions boundary, phases unchanged', () => {
    // Move the first internal boundary later by 6h.
    const moved = applyBoundaryChange(baseWindows, [
      '2026-01-02T06:00:00.000Z',
      '2026-01-03T00:00:00.000Z',
    ]);
    expect(moved.map((w) => w.phase)).toEqual(['Linear', 'Progressive Failure', 'Regressive']);
    expect(moved[0].end).toBe('2026-01-02T06:00:00.000');
    expect(moved[1].start).toBe('2026-01-02T06:00:00.000');
  });

  it('drag: identical boundaries → null (no needless re-classify)', () => {
    expect(
      applyBoundaryChange(baseWindows, [
        '2026-01-02T00:00:00.000Z',
        '2026-01-03T00:00:00.000Z',
      ])
    ).toBeNull();
  });

  it('add: +1 boundary splits the containing stage, both halves keep its phase', () => {
    // Add a boundary inside the Progressive Failure stage (day 2→3).
    const out = applyBoundaryChange(baseWindows, [
      '2026-01-02T00:00:00.000Z',
      '2026-01-02T12:00:00.000Z',
      '2026-01-03T00:00:00.000Z',
    ]);
    expect(out.map((w) => w.phase)).toEqual([
      'Linear',
      'Progressive Failure',
      'Progressive Failure',
      'Regressive',
    ]);
    expect(out[1].end).toBe('2026-01-02T12:00:00.000');
    expect(out[2].start).toBe('2026-01-02T12:00:00.000');
  });

  it('delete: -1 boundary merges two stages, keeping the left phase', () => {
    // Remove the second internal boundary (between PF and Regressive).
    const out = applyBoundaryChange(baseWindows, ['2026-01-02T00:00:00.000Z']);
    expect(out.map((w) => w.phase)).toEqual(['Linear', 'Progressive Failure']);
    expect(out[1].start).toBe('2026-01-02T00:00:00.000');
    expect(out[1].end).toBe('2026-01-04T00:00:00.000');
  });

  it('rename: changes a single stage phase, or null when unchanged/invalid', () => {
    const out = renameStage(baseWindows, 0, 'No Significant Movement');
    expect(out[0].phase).toBe('No Significant Movement');
    expect(out[1]).toEqual(baseWindows[1]);
    expect(renameStage(baseWindows, 0, 'Linear')).toBeNull(); // unchanged
    expect(renameStage(baseWindows, 5, 'Linear')).toBeNull(); // out of range
    expect(renameStage(baseWindows, 0, 'Bogus')).toBeNull(); // invalid phase
  });

  // ── Deterministic index-based operations (interactive editor) ──

  it('repositionBoundaries moves boundaries to new positions, keeping phases', () => {
    const out = repositionBoundaries(baseWindows, [
      '2026-01-02T06:00:00.000Z',
      '2026-01-03T00:00:00.000Z',
    ]);
    expect(out.map((w) => w.phase)).toEqual(['Linear', 'Progressive Failure', 'Regressive']);
    expect(out[0].end).toBe('2026-01-02T06:00:00.000');
    expect(out[1].start).toBe('2026-01-02T06:00:00.000');
    // No-op (sub-second change) → null
    expect(
      repositionBoundaries(baseWindows, ['2026-01-02T00:00:00.000Z', '2026-01-03T00:00:00.000Z'])
    ).toBeNull();
    // Wrong count → null
    expect(repositionBoundaries(baseWindows, ['2026-01-02T00:00:00.000Z'])).toBeNull();
  });

  it('deleteBoundaryAt(index) merges the indexed stage with the next, keeping the left phase', () => {
    // Delete boundary 1 (between PF and Regressive) → merge PF + Regressive.
    const out = deleteBoundaryAt(baseWindows, 1);
    expect(out.map((w) => w.phase)).toEqual(['Linear', 'Progressive Failure']);
    expect(out[1].start).toBe('2026-01-02T00:00:00.000Z');
    expect(out[1].end).toBe('2026-01-04T00:00:00.000Z');

    // Delete boundary 0 → merge Linear + PF (keep Linear).
    const out0 = deleteBoundaryAt(baseWindows, 0);
    expect(out0.map((w) => w.phase)).toEqual(['Linear', 'Regressive']);

    // Out of range → null.
    expect(deleteBoundaryAt(baseWindows, 2)).toBeNull();
    expect(deleteBoundaryAt(baseWindows, -1)).toBeNull();
  });

  it('addBoundaryAt(timeMs) splits the containing stage, both halves keep its phase', () => {
    const t = new Date('2026-01-02T12:00:00Z').getTime(); // inside PF stage
    const out = addBoundaryAt(baseWindows, t);
    expect(out.map((w) => w.phase)).toEqual([
      'Linear',
      'Progressive Failure',
      'Progressive Failure',
      'Regressive',
    ]);
    expect(out[1].end).toBe('2026-01-02T12:00:00.000');
    expect(out[2].start).toBe('2026-01-02T12:00:00.000');
    // Accepts ISO strings too.
    expect(addBoundaryAt(baseWindows, '2026-01-01T12:00:00Z')[0].phase).toBe('Linear');
  });

  it('stageAtMs locates the containing stage', () => {
    expect(stageAtMs(baseWindows, new Date('2026-01-02T12:00:00Z').getTime())).toBe(1);
    expect(stageAtMs(baseWindows, new Date('2026-01-01T01:00:00Z').getTime())).toBe(0);
  });
});
