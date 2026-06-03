'use client';

import { useState, useCallback } from 'react';
import AnalysisParametersPanel, { DEFAULT_PARAMS } from './AnalysisParametersPanel';

/**
 * VcpParameterEditor
 *
 * Per-VCP analysis-parameter adjustment shown beneath a VCP's results (issue 5).
 * After the initial multi-VCP run, the analyst can tweak the calculation period
 * and/or any analysis parameter for a single VCP and re-run just that VCP via
 * the Apply button — the other VCPs are left untouched.
 *
 * The local parameter state is seeded from the current global params and the
 * VCP's calculation period, and re-seeded whenever those change (e.g. after a
 * successful re-run swaps in the new result).
 *
 * Props:
 *   vcpName         {string}
 *   globalParams    {object|null}  - Current global analysis params (seed)
 *   smoothingWindow {number}       - This VCP's calculation period in minutes
 *   isBusy          {boolean}      - True while this VCP's re-run is in flight
 *   onApply         {(params, smoothingWindow) => void}
 */

const MIN_PERIOD = 2;
const MAX_PERIOD = 1440;

export default function VcpParameterEditor({
  vcpName,
  globalParams,
  smoothingWindow,
  isBusy = false,
  onApply,
}) {
  const seedParams = globalParams ?? DEFAULT_PARAMS;

  const [isExpanded, setIsExpanded] = useState(false);
  const [localParams, setLocalParams] = useState(seedParams);
  const [hasParamErrors, setHasParamErrors] = useState(false);
  const [periodInput, setPeriodInput] = useState(String(smoothingWindow ?? 60));

  // Re-seed when the upstream params / period change (e.g. a re-run swaps in a
  // new result) using the "adjust state during render" pattern — re-seeds only
  // when the source reference/value actually changes.
  const [prevGlobal, setPrevGlobal] = useState(globalParams);
  if (globalParams !== prevGlobal) {
    setPrevGlobal(globalParams);
    setLocalParams(globalParams ?? DEFAULT_PARAMS);
  }
  const [prevPeriod, setPrevPeriod] = useState(smoothingWindow);
  if (smoothingWindow !== prevPeriod) {
    setPrevPeriod(smoothingWindow);
    setPeriodInput(String(smoothingWindow ?? 60));
  }

  const handleValidationChange = useCallback((hasErrors) => {
    setHasParamErrors(hasErrors);
  }, []);

  const parsedPeriod = parseInt(periodInput, 10);
  const periodValid =
    Number.isInteger(parsedPeriod) && parsedPeriod >= MIN_PERIOD && parsedPeriod <= MAX_PERIOD;
  const canApply = !isBusy && !hasParamErrors && periodValid;

  const handleApply = () => {
    if (!canApply) return;
    onApply?.(localParams, parsedPeriod);
  };

  return (
    <div
      style={{
        border: '1px dashed var(--dtg-border-medium)',
        borderRadius: '8px',
        background: 'var(--dtg-bg-card)',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        aria-expanded={isExpanded}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: '10px 14px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--dtg-text-primary)',
          fontSize: '0.875rem',
          fontWeight: 600,
          textAlign: 'left',
        }}
      >
        <span>
          Adjust Parameters &amp; Re-run
          <span style={{ marginLeft: 6, fontWeight: 400, color: 'var(--dtg-text-secondary)' }}>
            — {vcpName ?? 'this VCP'}
          </span>
        </span>
        <span aria-hidden="true" style={{ fontSize: '0.75rem', opacity: 0.7 }}>
          {isExpanded ? '▲' : '▼'}
        </span>
      </button>

      {isExpanded && (
        <div
          style={{
            padding: '12px 14px 16px',
            borderTop: '1px solid var(--dtg-border-medium)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          {/* Calculation period (the VCP's defining window) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxWidth: '220px' }}>
            <label
              htmlFor={`vcp-period-${vcpName}`}
              style={{
                fontSize: '0.75rem',
                fontWeight: 500,
                color: 'var(--dtg-text-secondary)',
              }}
            >
              Calculation Period (minutes)
            </label>
            <input
              id={`vcp-period-${vcpName}`}
              type="number"
              min={MIN_PERIOD}
              max={MAX_PERIOD}
              step={1}
              value={periodInput}
              onChange={(e) => setPeriodInput(e.target.value)}
              aria-invalid={!periodValid}
              style={{
                padding: '6px 8px',
                borderRadius: '6px',
                border: `1px solid ${periodValid ? 'var(--dtg-border-medium)' : '#ef4444'}`,
                background: 'var(--dtg-bg-secondary)',
                color: 'var(--dtg-text-primary)',
                fontSize: '0.875rem',
                outline: 'none',
                width: '100%',
                boxSizing: 'border-box',
              }}
            />
            {!periodValid && (
              <span role="alert" style={{ fontSize: '0.7rem', color: '#ef4444' }}>
                Must be an integer between {MIN_PERIOD} and {MAX_PERIOD}
              </span>
            )}
          </div>

          {/* Full analysis parameter set, seeded from the global params */}
          <AnalysisParametersPanel
            params={localParams}
            onParamsChange={setLocalParams}
            onValidationChange={handleValidationChange}
          />

          <div>
            <button
              type="button"
              onClick={handleApply}
              disabled={!canApply}
              aria-busy={isBusy}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 18px',
                borderRadius: '6px',
                border: 'none',
                background: canApply
                  ? 'var(--dtg-brand-orange, #e67e22)'
                  : 'rgba(230, 126, 34, 0.4)',
                color: '#fff',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: canApply ? 'pointer' : 'not-allowed',
                opacity: canApply ? 1 : 0.6,
                transition: 'opacity 0.15s, background 0.15s',
              }}
            >
              {isBusy && (
                <span
                  aria-hidden="true"
                  style={{
                    display: 'inline-block',
                    width: '12px',
                    height: '12px',
                    border: '2px solid rgba(255,255,255,0.4)',
                    borderTopColor: '#fff',
                    borderRadius: '50%',
                    animation: 'spin 0.7s linear infinite',
                  }}
                />
              )}
              {isBusy ? 'Re-running…' : 'Apply & Re-run this VCP'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
