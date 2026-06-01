'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import VCPSummaryTable from './VCPSummaryTable';
import StageSummaryTable from './StageSummaryTable';
import StageEditor from './StageEditor';
import {
  PHASE_OPTIONS,
  windowsToBoundaries,
  repositionBoundaries,
  deleteBoundaryAt,
  addBoundaryAt,
  renameStage,
  stageAtMs,
  displayPhase,
} from '@/utils/stageBoundaries';

/** Phase band colours — mirrors visualizer.PHASE_COLORS for the rename menu. */
const PHASE_COLORS = {
  'No Significant Movement': '#2196F3',
  Linear: '#4CAF50',
  'Progressive Failure': '#FF5722',
  Regressive: '#9C27B0',
  Unclassified: '#9E9E9E',
};

/**
 * Dynamically import react-plotly.js to avoid SSR issues.
 * react-plotly.js is already available in the project.
 */
const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns true if any VCP in the array has at least one Progressive Failure window.
 * Used to determine whether "Use Results to Fill Form" should be enabled (Req 10.5).
 */
function anyVcpHasProgressiveFailure(vcpResults) {
  if (!Array.isArray(vcpResults)) return false;
  return vcpResults.some(
    (vcp) =>
      Array.isArray(vcp.windows) &&
      vcp.windows.some((w) => w.phase === 'Progressive Failure')
  );
}

/**
 * useIsDarkTheme — track the host app's active theme (toggled via the
 * `html.dark` class) so charts can be re-themed reactively without re-running
 * the analysis. Returns `true` in dark mode.
 */
function useIsDarkTheme() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const root = document.documentElement;
    const read = () => setIsDark(root.classList.contains('dark'));
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

/**
 * applyChartTheme — overlay theme-appropriate colours onto a Plotly figure
 * (built server-side with a transparent background). Adjusts font, axis grid /
 * line colours, and remaps the white displacement trace to a dark colour in
 * light mode so it stays visible (Requirement: issue 1 — match app theme).
 */
function applyChartTheme(chartJson, isDark) {
  const text = isDark ? '#d1d5db' : '#1a1a1a';
  const grid = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.12)';
  const lineColor = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)';

  const data = (chartJson.data ?? []).map((trace) => {
    const c = trace?.line?.color;
    if (typeof c === 'string' && (c.toUpperCase() === '#FFFFFF' || c.toLowerCase() === '#fff')) {
      return { ...trace, line: { ...trace.line, color: isDark ? '#FFFFFF' : '#1a1a1a' } };
    }
    return trace;
  });

  const layout = { ...(chartJson.layout ?? {}) };
  layout.paper_bgcolor = 'rgba(0,0,0,0)';
  layout.plot_bgcolor = 'rgba(0,0,0,0)';
  layout.font = { ...(layout.font ?? {}), color: text };

  // Re-colour every axis grid/zero/line (xaxis, yaxis, yaxis2, …). The coloured
  // velocity (green) / IV (blue) tick fonts are intentionally left untouched.
  for (const key of Object.keys(layout)) {
    if (/^[xy]axis\d*$/.test(key) && layout[key] && typeof layout[key] === 'object') {
      layout[key] = {
        ...layout[key],
        gridcolor: grid,
        zerolinecolor: grid,
        linecolor: lineColor,
      };
    }
  }

  return { data, layout };
}

// ── Sub-components ────────────────────────────────────────────────────────────

/**
 * VCPSelector — tab strip shown when ≥ 2 VCPs are present (Requirement 5.4).
 */
function VCPSelector({ vcpResults, activeIndex, onSelect }) {
  return (
    <div
      role="tablist"
      aria-label="VCP selector"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '4px',
        padding: '4px',
        borderRadius: '8px',
        border: '1px solid var(--dtg-border-medium)',
        background: 'var(--dtg-bg-card)',
      }}
    >
      {vcpResults.map((vcp, index) => {
        const isActive = index === activeIndex;
        return (
          <button
            key={vcp.vcpName ?? index}
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(index)}
            style={{
              padding: '6px 14px',
              borderRadius: '6px',
              border: isActive
                ? '1px solid var(--dtg-border-medium)'
                : '1px solid transparent',
              background: isActive
                ? 'var(--dtg-bg-secondary, rgba(255,255,255,0.08))'
                : 'transparent',
              color: isActive
                ? 'var(--dtg-text-primary)'
                : 'var(--dtg-text-secondary)',
              fontSize: '0.8125rem',
              fontWeight: isActive ? 600 : 400,
              cursor: 'pointer',
              transition: 'background 0.15s, color 0.15s',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.background =
                  'rgba(255,255,255,0.04)';
                e.currentTarget.style.color = 'var(--dtg-text-primary)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--dtg-text-secondary)';
              }
            }}
          >
            {vcp.vcpName ?? `VCP ${index + 1}`}
          </button>
        );
      })}
    </div>
  );
}

/**
 * ChartPanel — wraps a Plot with a label header and (optionally) draggable
 * stage-boundary editing and blasting-event overlays. Chart PNG export is via
 * the built-in Plotly mode-bar camera button.
 */
const BOUNDARY_COLOR = '#FFD54F';
const BLAST_COLOR = '#FF1744';
const ACTUAL_FAILURE_COLOR = '#FF4081';
const NEAR_PX = 35;

/** True if a layout shape is one of our draggable stage-boundary lines. */
function isBoundaryShape(s) {
  return (
    s &&
    s.type === 'line' &&
    String(s.line?.color ?? '').toUpperCase() === BOUNDARY_COLOR &&
    String(s.x0) === String(s.x1)
  );
}

function ChartPanel({
  chartJson,
  label,
  editable = false,
  windows = null,
  onApplyBoundaries,
  isBusy = false,
  blastEvents = null,
  pfConfirmed = false,
  actualFailureTime = '',
}) {
  const graphDivRef = useRef(null);
  const isDark = useIsDarkTheme();
  const [menu, setMenu] = useState(null);
  const [, setTick] = useState(0);
  const forceRerender = useCallback(() => setTick((t) => t + 1), []);

  // Optimistic copy of the stage windows: updated immediately on drag/add/
  // delete/rename so the boundary lines move smoothly (no snap-back to the old
  // position while the classify-manual request is in flight). Re-synced from
  // the prop (authoritative result) using the "adjust state during render"
  // pattern — resets only when the prop reference changes.
  const [localWindows, setLocalWindows] = useState(
    Array.isArray(windows) ? windows : []
  );
  const [prevWindows, setPrevWindows] = useState(windows);
  if (windows !== prevWindows) {
    setPrevWindows(windows);
    setLocalWindows(Array.isArray(windows) ? windows : []);
  }

  // Close the context menu on any outside click / Escape.
  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    const onKey = (e) => {
      if (e.key === 'Escape') setMenu(null);
    };
    document.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  if (!chartJson) return null;

  const { config: chartConfig } = chartJson;
  const themed = applyChartTheme(chartJson, isDark);
  // Relabel the "Progressive Failure" legend/trace as "Progressive" until an
  // actual failure time is confirmed (issue 3) — display only.
  const data = pfConfirmed
    ? themed.data
    : themed.data.map((t) =>
        t.name ? { ...t, name: displayPhase(t.name, false) } : t
      );
  const layout = themed.layout;

  const canEdit = editable && Array.isArray(localWindows) && localWindows.length > 0;

  // Overlay draggable boundary lines for the internal stage splits.
  let shapes = Array.isArray(layout.shapes) ? layout.shapes : [];
  if (canEdit) {
    const boundaryShapes = windowsToBoundaries(localWindows).map((b) => ({
      type: 'line',
      xref: 'x',
      yref: 'paper',
      x0: b,
      x1: b,
      y0: 0,
      y1: 1,
      line: { color: BOUNDARY_COLOR, width: 3 },
      editable: true,
    }));
    shapes = [...shapes, ...boundaryShapes];
  }

  // Overlay blasting events as non-editable labeled vertical lines (issue 7).
  let annotations = Array.isArray(layout.annotations) ? layout.annotations : [];
  if (Array.isArray(blastEvents) && blastEvents.length > 0) {
    const blastShapes = blastEvents.map((b) => ({
      type: 'line',
      xref: 'x',
      yref: 'paper',
      x0: b.time,
      x1: b.time,
      y0: 0,
      y1: 1,
      line: { color: BLAST_COLOR, width: 1.5, dash: 'dot' },
    }));
    const blastAnnos = blastEvents.map((b) => ({
      x: b.time,
      xref: 'x',
      y: 0.04,
      yref: 'paper',
      text: `💥 Blasting${b.label ? ` ${b.label}` : ''}`,
      showarrow: false,
      textangle: -90,
      font: { color: BLAST_COLOR, size: 9 },
      xanchor: 'left',
      yanchor: 'bottom',
      bgcolor: 'rgba(0,0,0,0.55)',
      bordercolor: BLAST_COLOR,
      borderpad: 2,
    }));
    shapes = [...shapes, ...blastShapes];
    annotations = [...annotations, ...blastAnnos];
  }

  // Overlay the actual failure time when provided (issue 3).
  if (actualFailureTime) {
    shapes = [
      ...shapes,
      {
        type: 'line',
        xref: 'x',
        yref: 'paper',
        x0: actualFailureTime,
        x1: actualFailureTime,
        y0: 0,
        y1: 1,
        line: { color: ACTUAL_FAILURE_COLOR, width: 2.5 },
      },
    ];
    annotations = [
      ...annotations,
      {
        x: actualFailureTime,
        xref: 'x',
        y: 0.99,
        yref: 'paper',
        text: '⚑ Actual Failure',
        showarrow: false,
        font: { color: ACTUAL_FAILURE_COLOR, size: 10 },
        xanchor: 'left',
        yanchor: 'top',
        bgcolor: 'rgba(0,0,0,0.6)',
        bordercolor: ACTUAL_FAILURE_COLOR,
        borderpad: 3,
      },
    ];
  }

  // Optimistically apply the new windows locally (smooth UI), then re-classify.
  const commit = (newWindows) => {
    setMenu(null);
    if (newWindows) {
      setLocalWindows(newWindows);
      onApplyBoundaries?.(newWindows);
    }
  };

  // ── Drag handler: reposition boundaries, revert anything else. ──
  const handleRelayout = (ed) => {
    if (!canEdit || isBusy) return;
    const keys = Object.keys(ed || {});
    const movedIdx = new Set();
    keys.forEach((k) => {
      const m = k.match(/^shapes\[(\d+)\]\.(x0|x1)$/);
      if (m) movedIdx.add(Number(m[1]));
    });
    if (movedIdx.size === 0) return;

    const gd = graphDivRef.current;
    const all = gd?.layout?.shapes ?? [];
    const allMovedAreBoundaries = [...movedIdx].every((i) => isBoundaryShape(all[i]));
    if (!allMovedAreBoundaries) {
      forceRerender(); // discard accidental phase-band / vline drags
      return;
    }
    const boundaries = all.filter(isBoundaryShape).map((s) => s.x0);
    commit(repositionBoundaries(localWindows, boundaries));
  };

  // ── Right-click context menu (Add / Delete / Rename). ──
  const handleContextMenu = (e) => {
    if (!canEdit) return;
    e.preventDefault();
    const gd = graphDivRef.current;
    const xaxis = gd?._fullLayout?.xaxis;
    if (!xaxis) return;
    const rect = gd.getBoundingClientRect();
    const px = e.clientX - rect.left - xaxis._offset;
    if (px < 0 || px > xaxis._length) {
      setMenu(null);
      return;
    }
    // p2d may return a number (ms) or a date string depending on axis state;
    // normalise to epoch-ms (tz-naive treated as UTC) for downstream logic.
    const rawX = xaxis.p2d(px);
    const dataMs =
      typeof rawX === 'number'
        ? rawX
        : new Date(`${String(rawX).replace(' ', 'T')}Z`).getTime();
    const bnds = (gd.layout?.shapes ?? []).filter(isBoundaryShape);
    let near = -1;
    let best = Infinity;
    bnds.forEach((s, i) => {
      const d = Math.abs(xaxis.d2p(new Date(`${String(s.x0).replace(' ', 'T')}Z`).getTime()) - px);
      if (d < best) {
        best = d;
        near = i;
      }
    });
    setMenu({
      x: e.clientX,
      y: e.clientY,
      dataMs,
      near: best <= NEAR_PX ? near : -1,
      stageIdx: stageAtMs(localWindows, dataMs),
    });
  };

  const handleAdd = () => commit(addBoundaryAt(localWindows, menu.dataMs));
  const handleDelete = () => commit(deleteBoundaryAt(localWindows, menu.near));
  const handleRename = (phase) =>
    commit(renameStage(localWindows, menu.stageIdx, phase));

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        borderRadius: '8px',
        border: '1px solid var(--dtg-border-medium)',
        background: 'var(--dtg-bg-card)',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Chart header: label only (download via Plotly mode-bar camera button) */}
      {label && (
        <div
          style={{
            padding: '10px 14px 0 14px',
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: '0.875rem',
              fontWeight: 600,
              color: 'var(--dtg-text-primary)',
            }}
          >
            {label}
          </h3>
        </div>
      )}

      {canEdit && (
        <p
          style={{
            margin: 0,
            padding: '0 14px',
            fontSize: '0.75rem',
            color: 'var(--dtg-text-secondary)',
          }}
        >
          Drag the yellow lines to move stage boundaries. Right-click for add /
          delete / rename.{isBusy ? ' (applying…)' : ''}
        </p>
      )}

      {/* Plotly chart — combinedChartJson rendered with boundary/blast overlays */}
      <div style={{ width: '100%' }} onContextMenu={handleContextMenu}>
        <Plot
          data={data ?? []}
          layout={{
            ...(layout ?? {}),
            shapes,
            annotations,
            autosize: true,
            margin: { l: 60, r: 20, t: 40, b: 60 },
            // Stable revision so Plotly preserves zoom/pan across re-renders
            // (boundary edits update shapes without resetting the view).
            uirevision: 'pr-combined-chart',
          }}
          config={{
            ...(chartConfig ?? {}),
            responsive: true,
            displayModeBar: true,
            displaylogo: false,
            ...(canEdit ? { edits: { shapePosition: true }, doubleClick: false } : {}),
          }}
          style={{ width: '100%' }}
          useResizeHandler
          onInitialized={(_fig, gd) => {
            graphDivRef.current = gd;
          }}
          onUpdate={(_fig, gd) => {
            graphDivRef.current = gd;
          }}
          onRelayout={handleRelayout}
        />
      </div>

      {/* Context menu */}
      {menu && (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            left: menu.x,
            top: menu.y,
            zIndex: 1000,
            minWidth: '200px',
            padding: '4px 0',
            background: 'var(--dtg-bg-card)',
            color: 'var(--dtg-text-primary)',
            border: '1px solid var(--dtg-border-medium)',
            borderRadius: '6px',
            boxShadow: '0 4px 14px rgba(0,0,0,0.4)',
            fontSize: '0.8125rem',
            userSelect: 'none',
          }}
        >
          <MenuItem onClick={handleAdd}>➕ Add boundary here</MenuItem>
          {menu.near >= 0 ? (
            <MenuItem onClick={handleDelete}>🗑 Delete this boundary</MenuItem>
          ) : (
            <MenuItem disabled>🗑 Delete (right-click on a line)</MenuItem>
          )}
          {menu.stageIdx >= 0 && (
            <>
              <div style={{ height: 1, margin: '4px 0', background: 'var(--dtg-border-medium)' }} />
              <div
                style={{
                  padding: '4px 14px',
                  fontSize: '0.6875rem',
                  textTransform: 'uppercase',
                  color: 'var(--dtg-text-secondary)',
                }}
              >
                Rename stage {menu.stageIdx + 1}
                {localWindows[menu.stageIdx]
                  ? ` (now: ${displayPhase(localWindows[menu.stageIdx].phase, pfConfirmed)})`
                  : ''}
              </div>
              {PHASE_OPTIONS.map((p) => (
                <MenuItem key={p} onClick={() => handleRename(p)}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 9,
                      height: 9,
                      borderRadius: 2,
                      marginRight: 7,
                      background: PHASE_COLORS[p] ?? '#9E9E9E',
                      verticalAlign: 'middle',
                    }}
                  />
                  {displayPhase(p, pfConfirmed)}
                  {localWindows[menu.stageIdx]?.phase === p ? ' ✓' : ''}
                </MenuItem>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Single context-menu row. */
function MenuItem({ children, onClick, disabled }) {
  return (
    <div
      role="menuitem"
      onClick={disabled ? undefined : onClick}
      style={{
        padding: '6px 14px',
        cursor: disabled ? 'default' : 'pointer',
        whiteSpace: 'nowrap',
        color: disabled ? 'var(--dtg-text-secondary)' : 'var(--dtg-text-primary)',
        opacity: disabled ? 0.6 : 1,
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = 'var(--dtg-bg-secondary, rgba(255,255,255,0.06))';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      {children}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

/**
 * ResultsArea
 *
 * Composes the full results section of the Pattern Recognition Popup:
 * - VCPSelector tab strip (when ≥ 2 VCPs)
 * - Per-VCP combined chart with Download button
 * - Multi-VCP comparison chart with Download button (when ≥ 2 VCPs)
 * - VCPSummaryTable
 * - StageSummaryTable (for active VCP)
 * - StageEditor (for active VCP)
 * - "Use Results to Fill Form" button (disabled when no VCP has a PF stage)
 *
 * Props:
 *   vcpResults                {VCPResult[]}   - Array of per-VCP analysis results
 *   multiVcpComparisonChartJson {object|null} - Plotly figure JSON for comparison chart
 *   forecastingEnabled        {boolean}       - Controls visibility of forecasting columns
 *   longestVcpName            {string|null}   - Name of the Longest VCP (highlighted row)
 *   onApplyStages             {(vcpIndex, updatedWindows) => void}
 *   onResetStages             {(vcpIndex) => void}
 *   isApplyingStages          {boolean}
 *   isResettingStages         {boolean}
 *   onUseResults              {() => void}
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6,
 *               10.1, 10.2, 10.3, 10.4, 10.5
 */
export default function ResultsArea({
  vcpResults,
  multiVcpComparisonChartJson,
  forecastingEnabled,
  longestVcpName,
  onApplyStages,
  onResetStages,
  isApplyingStages,
  isResettingStages,
  onUseResults,
  blastEvents = null,
}) {
  // ── Active VCP state (Requirement 5.4) ────────────────────────────────────
  const [activeVcpIndex, setActiveVcpIndex] = useState(0);
  // Actual failure time for back-analysis / forecast error (issue 2).
  const [actualFailureTime, setActualFailureTime] = useState('');

  const results = Array.isArray(vcpResults) ? vcpResults : [];
  const hasMultipleVcps = results.length >= 2;

  // Clamp activeVcpIndex to valid range when vcpResults changes
  const safeActiveIndex = Math.min(activeVcpIndex, Math.max(0, results.length - 1));
  const activeVcp = results[safeActiveIndex] ?? null;

  // Combined stage rows across ALL VCPs (issue 5) — each row tagged with its
  // VCP's native velocity unit for per-row display conversion.
  const allStageRows = results.flatMap((v) =>
    (v.stageSummaryRows ?? []).map((r) => ({
      ...r,
      __velocityUnit: v.velocityUnit ?? 'mm/day',
    }))
  );

  // "Progressive Failure" terminology is only confirmed once an actual failure
  // time is entered (issue 3).
  const pfConfirmed = Boolean(actualFailureTime);

  // Requirement 10.5: disable "Use Results to Fill Form" when no VCP has a PF stage
  const canUseResults = anyVcpHasProgressiveFailure(results);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleVcpSelect = (index) => {
    setActiveVcpIndex(index);
  };

  const handleApplyStages = (updatedWindows) => {
    onApplyStages?.(safeActiveIndex, updatedWindows);
  };

  const handleResetStages = () => {
    onResetStages?.(safeActiveIndex);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (results.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
      }}
    >
      {/* ── VCP Selector tab strip (Requirement 5.4: shown when ≥ 2 VCPs) ── */}
      {hasMultipleVcps && (
        <VCPSelector
          vcpResults={results}
          activeIndex={safeActiveIndex}
          onSelect={handleVcpSelect}
        />
      )}

      {/* ── Per-VCP combined chart with editable stage boundaries + blasts ── */}
      {activeVcp?.combinedChartJson && (
        <ChartPanel
          chartJson={activeVcp.combinedChartJson}
          label={
            hasMultipleVcps
              ? `Combined Chart — ${activeVcp.vcpName ?? `VCP ${safeActiveIndex + 1}`}`
              : 'Combined Chart'
          }
          editable
          windows={activeVcp.windows ?? []}
          isBusy={isApplyingStages}
          onApplyBoundaries={(newWindows) =>
            onApplyStages?.(safeActiveIndex, newWindows)
          }
          blastEvents={blastEvents}
          pfConfirmed={pfConfirmed}
          actualFailureTime={actualFailureTime}
        />
      )}

      {/* ── Multi-VCP comparison chart (Requirements 5.3, 10.1: shown when ≥ 2 VCPs) ── */}
      {hasMultipleVcps && multiVcpComparisonChartJson && (
        <ChartPanel
          chartJson={multiVcpComparisonChartJson}
          label="Multi-VCP Comparison"
          blastEvents={blastEvents}
          pfConfirmed={pfConfirmed}
          actualFailureTime={actualFailureTime}
        />
      )}

      {/* ── Actual Failure Time (back-analysis / forecast error, issue 2) ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          flexWrap: 'wrap',
        }}
      >
        <label
          htmlFor="prp-actual-failure-time"
          style={{
            fontSize: '0.8125rem',
            fontWeight: 600,
            color: 'var(--dtg-text-primary)',
          }}
        >
          Actual Failure Time
        </label>
        <input
          id="prp-actual-failure-time"
          type="datetime-local"
          value={actualFailureTime}
          onChange={(e) => setActualFailureTime(e.target.value)}
          style={{
            padding: '6px 8px',
            borderRadius: '6px',
            border: '1px solid var(--dtg-border-medium)',
            background: 'var(--dtg-bg-secondary)',
            color: 'var(--dtg-text-primary)',
            fontSize: '0.8125rem',
          }}
        />
        {actualFailureTime && (
          <button
            type="button"
            onClick={() => setActualFailureTime('')}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--dtg-text-secondary)',
              fontSize: '0.75rem',
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            clear
          </button>
        )}
        <span
          style={{
            fontSize: '0.7rem',
            color: 'var(--dtg-text-secondary)',
            fontStyle: 'italic',
          }}
        >
          Set to compute forecast error (predicted − actual) per VCP.
        </span>
      </div>

      {/* ── VCP Summary Table (Requirements 10.2–10.5) ── */}
      <VCPSummaryTable
        vcpResults={results}
        longestVcpName={longestVcpName}
        forecastingEnabled={forecastingEnabled}
        actualFailureTime={actualFailureTime}
        pfConfirmed={pfConfirmed}
      />

      {/* ── Combined Stage Summary across all VCPs (issue 5) ── */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: '0.875rem',
            fontWeight: 600,
            color: 'var(--dtg-text-primary)',
          }}
        >
          Stage Summary {hasMultipleVcps ? '— All VCPs' : ''}
        </h3>
        <StageSummaryTable stageSummaryRows={allStageRows} pfConfirmed={pfConfirmed} />
      </div>

      {/* ── Stage Editor for active VCP (Requirements 6.1–6.5) ── */}
      {activeVcp && (
        <StageEditor
          windows={activeVcp.windows ?? []}
          autoWindows={activeVcp.autoWindows ?? activeVcp.windows ?? []}
          isApplyingStages={isApplyingStages}
          isResettingStages={isResettingStages}
          onApply={handleApplyStages}
          onReset={handleResetStages}
          pfConfirmed={pfConfirmed}
        />
      )}

      {/* ── "Use Results to Fill Form" button (Requirement 10.5) ── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          paddingTop: '4px',
        }}
      >
        {/* Informational message when no PF stage exists (Requirement 10.5) */}
        {!canUseResults && (
          <p
            style={{
              margin: '0 12px 0 0',
              fontSize: '0.8125rem',
              color: 'var(--dtg-text-secondary)',
              fontStyle: 'italic',
              alignSelf: 'center',
            }}
          >
            No {pfConfirmed ? 'Progressive Failure' : 'Progressive'} detected across all VCPs
          </p>
        )}

        <button
          type="button"
          onClick={onUseResults}
          disabled={!canUseResults}
          aria-disabled={!canUseResults}
          style={{
            padding: '10px 22px',
            borderRadius: '6px',
            border: 'none',
            background: canUseResults
              ? 'var(--dtg-brand-orange, #e67e22)'
              : 'rgba(230, 126, 34, 0.3)',
            color: canUseResults ? '#fff' : 'rgba(255,255,255,0.4)',
            fontSize: '0.9rem',
            fontWeight: 600,
            cursor: canUseResults ? 'pointer' : 'not-allowed',
            opacity: canUseResults ? 1 : 0.6,
            transition: 'opacity 0.15s, background 0.15s',
          }}
          onMouseEnter={(e) => {
            if (canUseResults) {
              e.currentTarget.style.opacity = '0.85';
            }
          }}
          onMouseLeave={(e) => {
            if (canUseResults) {
              e.currentTarget.style.opacity = '1';
            }
          }}
        >
          Use Results to Fill Form
        </button>
      </div>

      {/* Spinner keyframe (shared with StageEditor) */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
