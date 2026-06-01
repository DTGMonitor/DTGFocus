'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import FileUploadPanel from './FileUploadPanel';
import AnalysisParametersPanel, { DEFAULT_PARAMS } from './AnalysisParametersPanel';
import ResultsArea from './ResultsArea';
import {
  buildAutoFillInitialValues,
  buildPatternRecognitionSummary,
  selectFormVcp,
} from '@/utils/patternRecognitionMapper';
import { isoToDatetimeLocal } from '@/utils/tabHelpers';
import { supabase } from '@/lib/supabaseClient';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Client-side request timeout in milliseconds (Requirement 4.7) */
const ANALYSIS_TIMEOUT_MS = 90_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Derive the name of the VCP used to fill the form (issue 4): the single VCP,
 * or the one with the shortest smoothing window when several are present. This
 * is the row highlighted in the VCP summary. Returns null when empty.
 */
function deriveLongestVcpName(vcpResults) {
  if (!Array.isArray(vcpResults) || vcpResults.length === 0) return null;
  try {
    return selectFormVcp(vcpResults).vcpName ?? null;
  } catch {
    return null;
  }
}

/**
 * Build the multipart FormData payload for the analyze API call.
 * Appends all file binaries and parameter fields per the design's API request table.
 */
/** Read a File as a base64 string (no data: prefix), chunked to avoid stack overflow. */
async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Build the JSON payload for the analyze function. Files are base64-encoded
 * (the Vercel Python function reads JSON, not multipart). Params are sent as
 * native JSON types.
 */
async function buildAnalysisPayload(uploadedFiles, params) {
  const files = [];
  for (const cfg of uploadedFiles) {
    if (!cfg.parseError && cfg.file) {
      files.push({
        name: cfg.file.name,
        contentBase64: await fileToBase64(cfg.file),
        vcpNamePrefix: cfg.vcpNamePrefix,
        smoothingWindows: cfg.smoothingWindows,
      });
    }
  }
  return { files, params };
}

// ── Loading Spinner ───────────────────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: '16px',
        height: '16px',
        border: '2px solid rgba(255,255,255,0.3)',
        borderTopColor: '#fff',
        borderRadius: '50%',
        animation: 'prp-spin 0.7s linear infinite',
        flexShrink: 0,
      }}
    />
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

/**
 * PatternRecognitionPopup
 *
 * Full-screen modal overlay that embeds the complete pattern-recognition
 * workflow: file upload → parameter configuration → run analysis → review
 * results → use results to fill the deformation form.
 *
 * Props:
 *   isOpen                {boolean}
 *   precursor             {string|number|null}  - Precursor record ID
 *   precursorInitialValues {object|undefined}   - initialValues from the precursor record
 *   timezone              {string}              - Client timezone (e.g. "Australia/Perth")
 *   onClose               {() => void}          - Dismiss without modifying records
 *   onUseResults          {(autoFillValues, summary) => void}
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1–3.5, 4.1, 4.3, 4.4,
 *               4.7, 5.1–5.6, 6.3, 6.4, 8.2, 8.3, 10.1–10.5
 */
export default function PatternRecognitionPopup({
  isOpen,
  precursor,
  precursorInitialValues,
  timezone,
  onClose,
  onUseResults,
}) {
  // ── File upload state ──────────────────────────────────────────────────────
  const [uploadedFiles, setUploadedFiles] = useState([]);

  // ── Analysis parameters state ──────────────────────────────────────────────
  const [params, setParams] = useState(DEFAULT_PARAMS);
  const [hasParamErrors, setHasParamErrors] = useState(false);

  // ── Analysis results state ─────────────────────────────────────────────────
  const [vcpResults, setVcpResults] = useState([]);
  const [originalVcpResults, setOriginalVcpResults] = useState([]); // for Reset to Auto
  const [multiVcpComparisonChartJson, setMultiVcpComparisonChartJson] = useState(null);
  const [longestVcpName, setLongestVcpName] = useState(null);

  // ── Analysis status state ──────────────────────────────────────────────────
  const [isAnalysing, setIsAnalysing] = useState(false);
  const [analysisError, setAnalysisError] = useState(null); // top-level error
  const abortControllerRef = useRef(null);

  // ── Active VCP index (lives here so popup can use it for classify-manual) ──
  const [activeVcpIndex, setActiveVcpIndex] = useState(0);

  // ── Stage editor in-flight state ───────────────────────────────────────────
  const [isApplyingStages, setIsApplyingStages] = useState(false);
  const [isResettingStages, setIsResettingStages] = useState(false);
  const [stageError, setStageError] = useState(null);

  // ── Blasting events for the related wall-folder (issue 7) ──────────────────
  const [blastEvents, setBlastEvents] = useState([]);
  const wallFolderId = precursorInitialValues?.WallFolderID ?? null;

  useEffect(() => {
    if (!isOpen || !wallFolderId) {
      setBlastEvents([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('def_records')
          .select('start')
          .eq('wallfolder_id', wallFolderId)
          .eq('def_type', 'Blast Event')
          .eq('isactive', 'Yes')
          .not('start', 'is', null);
        if (error) throw error;
        if (cancelled) return;
        const events = (data ?? [])
          .map((r) => {
            const local = isoToDatetimeLocal(r.start, timezone); // local-naive, matches chart axis
            if (!local) return null;
            return { time: local, label: local.slice(5).replace('T', ' ') };
          })
          .filter(Boolean);
        setBlastEvents(events);
      } catch (err) {
        console.error('Failed to load blasting events:', err);
        if (!cancelled) setBlastEvents([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, wallFolderId, timezone]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleFilesChange = useCallback((updatedFiles) => {
    setUploadedFiles(updatedFiles);
  }, []);

  const handleParamsChange = useCallback((updatedParams) => {
    setParams(updatedParams);
  }, []);

  const handleValidationChange = useCallback((hasErrors) => {
    setHasParamErrors(hasErrors);
  }, []);

  // ── Run Analysis ───────────────────────────────────────────────────────────

  const handleRunAnalysis = useCallback(async () => {
    if (hasParamErrors) return;

    const validFiles = uploadedFiles.filter((cfg) => !cfg.parseError && cfg.file);
    if (validFiles.length === 0) return;

    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Set up 90-second timeout (Requirement 4.7)
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, ANALYSIS_TIMEOUT_MS);

    setIsAnalysing(true);
    setAnalysisError(null);
    setVcpResults([]);
    setOriginalVcpResults([]);
    setMultiVcpComparisonChartJson(null);
    setLongestVcpName(null);
    setActiveVcpIndex(0);
    setStageError(null);

    try {
      const payload = await buildAnalysisPayload(uploadedFiles, params);

      const response = await fetch('/api/pattern-recognition/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      if (!response.ok) {
        // HTTP 4xx or 5xx
        const errorMsg = data?.error || `Analysis failed (HTTP ${response.status}).`;
        setAnalysisError(errorMsg);
        return;
      }

      // Success — populate results
      const results = Array.isArray(data.vcps) ? data.vcps : [];
      const comparisonChart = data.multiVcpComparisonChartJson ?? null;

      setVcpResults(results);
      setOriginalVcpResults(results); // snapshot for Reset to Auto
      setMultiVcpComparisonChartJson(comparisonChart);
      setLongestVcpName(deriveLongestVcpName(results));
      setActiveVcpIndex(0);

      // Check if all VCPs failed (Requirement 4.4)
      const allFailed =
        results.length > 0 && results.every((vcp) => vcp.errors && vcp.errors.length > 0);
      if (allFailed) {
        const firstError = results[0]?.errors?.[0] ?? 'All VCPs failed to process.';
        setAnalysisError(firstError);
      }
    } catch (err) {
      clearTimeout(timeoutId);

      if (err.name === 'AbortError') {
        // Timeout or manual abort (Requirement 4.7)
        setAnalysisError(
          'Analysis timed out after 90 seconds. Please try again or reduce the dataset size.'
        );
      } else {
        setAnalysisError('An unexpected error occurred. Please try again.');
      }
    } finally {
      setIsAnalysing(false);
      abortControllerRef.current = null;
    }
  }, [hasParamErrors, uploadedFiles, params]);

  // ── Apply Stage Labels (Requirement 6.3) ──────────────────────────────────

  const handleApplyStages = useCallback(
    async (vcpIndex, updatedWindows) => {
      const targetVcp = vcpResults[vcpIndex];
      if (!targetVcp) return;

      setIsApplyingStages(true);
      setStageError(null);

      try {
        const response = await fetch('/api/pattern-recognition/classify-manual', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vcpName: targetVcp.vcpName,
            smoothingWindow: targetVcp.smoothingWindow,
            fileIndex: vcpIndex,
            // Replay the preprocessed series the analysis returned so the
            // runner can re-classify against the same data range.
            displacement: targetVcp.displacementSeries ?? { x: [], y: [] },
            velocity_smooth: targetVcp.velocitySmoothSeries ?? { x: [], y: [] },
            // Forecasting params so editing PF boundaries recomputes the
            // prediction (issue 4).
            params,
            windows: updatedWindows.map((w) => ({
              phase: w.phase,
              start: w.start,
              end: w.end,
            })),
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          setStageError(data?.error || 'Failed to apply stage labels.');
          return;
        }

        // Update only the active VCP's result with the response, including the
        // recomputed forecast (fukuzono / slo can become null when the edited
        // windows have no Progressive Failure stage).
        setVcpResults((prev) => {
          const updated = [...prev];
          updated[vcpIndex] = {
            ...updated[vcpIndex],
            windows: data.windows ?? updated[vcpIndex].windows,
            onsetOfFailure: data.onsetOfFailure ?? updated[vcpIndex].onsetOfFailure,
            fukuzono: 'fukuzono' in data ? data.fukuzono : updated[vcpIndex].fukuzono,
            slo: 'slo' in data ? data.slo : updated[vcpIndex].slo,
            combinedChartJson: data.combinedChartJson ?? updated[vcpIndex].combinedChartJson,
            stageSummaryRows: data.stageSummaryRows ?? updated[vcpIndex].stageSummaryRows,
          };
          return updated;
        });

        // Recompute longestVcpName after stage update
        setVcpResults((prev) => {
          setLongestVcpName(deriveLongestVcpName(prev));
          return prev;
        });
      } catch (err) {
        setStageError('An unexpected error occurred while applying stage labels.');
      } finally {
        setIsApplyingStages(false);
      }
    },
    [vcpResults, params]
  );

  // ── Reset to Auto (Requirement 6.4) ───────────────────────────────────────

  const handleResetStages = useCallback(
    async (vcpIndex) => {
      setIsResettingStages(true);
      setStageError(null);

      try {
        // Restore from the original analysis snapshot
        const originalVcp = originalVcpResults[vcpIndex];
        if (!originalVcp) return;

        setVcpResults((prev) => {
          const updated = [...prev];
          updated[vcpIndex] = { ...originalVcp };
          return updated;
        });

        setLongestVcpName(deriveLongestVcpName(originalVcpResults));
      } finally {
        setIsResettingStages(false);
      }
    },
    [originalVcpResults]
  );

  // ── Use Results to Fill Form (Requirements 8.2, 8.3) ─────────────────────

  const handleUseResults = useCallback(() => {
    if (!vcpResults || vcpResults.length === 0) return;

    const autoFillValues = buildAutoFillInitialValues(
      vcpResults,
      precursorInitialValues,
      timezone
    );

    const summary = buildPatternRecognitionSummary(vcpResults);

    onUseResults?.(autoFillValues, summary);
  }, [vcpResults, precursorInitialValues, timezone, onUseResults]);

  // ── Derived state ──────────────────────────────────────────────────────────

  const validFileCount = uploadedFiles.filter((cfg) => !cfg.parseError).length;
  const canRunAnalysis = !hasParamErrors && validFileCount > 0 && !isAnalysing;
  const hasResults = vcpResults.length > 0;
  const forecastingEnabled = params.enableForecasting ?? DEFAULT_PARAMS.enableForecasting;

  // ── Early return when not open ─────────────────────────────────────────────

  if (!isOpen) return null;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Keyframe for spinner */}
      <style>{`
        @keyframes prp-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* ── Full-screen overlay (Requirement 2.1) ── */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Pattern Recognition"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1000,
          background: 'rgba(0, 0, 0, 0.6)',
          display: 'flex',
          alignItems: 'stretch',
          justifyContent: 'stretch',
        }}
      >
        {/* ── Modal panel ── */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--dtg-bg-card)',
            color: 'var(--dtg-text-primary)',
            border: '1px solid var(--dtg-border-medium)',
            overflow: 'hidden',
          }}
        >
          {/* ── PRP Header (Requirement 2.7) ── */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 20px',
              borderBottom: '1px solid var(--dtg-border-medium)',
              flexShrink: 0,
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: '1.1rem',
                fontWeight: 700,
                color: 'var(--dtg-text-primary)',
              }}
            >
              Pattern Recognition
              {precursor ? (
                <span
                  style={{
                    marginLeft: '10px',
                    fontSize: '0.85rem',
                    fontWeight: 400,
                    color: 'var(--dtg-text-secondary)',
                  }}
                >
                  — Precursor #{precursor}
                </span>
              ) : null}
            </h2>

            {/* Close button — dismisses without modifying records (Requirement 2.7) */}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Pattern Recognition popup"
              style={{
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '6px',
                border: '1px solid var(--dtg-border-medium)',
                background: 'transparent',
                color: 'var(--dtg-text-secondary)',
                fontSize: '1.25rem',
                lineHeight: 1,
                cursor: 'pointer',
                padding: 0,
                transition: 'background 0.15s, color 0.15s',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background =
                  'var(--dtg-bg-secondary, rgba(255,255,255,0.08))';
                e.currentTarget.style.color = 'var(--dtg-text-primary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--dtg-text-secondary)';
              }}
            >
              ×
            </button>
          </div>

          {/* ── Scrollable body ── */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
            }}
          >
            {/* ── File Upload Panel (Requirements 2.2–2.6) ── */}
            <section aria-label="File upload">
              <h3
                style={{
                  margin: '0 0 12px 0',
                  fontSize: '0.9rem',
                  fontWeight: 600,
                  color: 'var(--dtg-text-primary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Upload VCP Files
              </h3>
              <FileUploadPanel
                uploadedFiles={uploadedFiles}
                onFilesChange={handleFilesChange}
              />
            </section>

            {/* ── Analysis Parameters Panel (Requirements 3.1–3.5) ── */}
            <section aria-label="Analysis parameters">
              <AnalysisParametersPanel
                params={params}
                onParamsChange={handleParamsChange}
                onValidationChange={handleValidationChange}
              />
            </section>

            {/* ── Run Analysis button + loading indicator (Requirements 4.1, 4.3) ── */}
            <section aria-label="Run analysis">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  flexWrap: 'wrap',
                }}
              >
                <button
                  type="button"
                  onClick={handleRunAnalysis}
                  disabled={!canRunAnalysis}
                  aria-disabled={!canRunAnalysis}
                  aria-busy={isAnalysing}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '10px 24px',
                    borderRadius: '6px',
                    border: 'none',
                    background: canRunAnalysis
                      ? 'var(--dtg-brand-orange, #e67e22)'
                      : 'rgba(230, 126, 34, 0.3)',
                    color: canRunAnalysis ? '#fff' : 'rgba(255,255,255,0.4)',
                    fontSize: '0.9rem',
                    fontWeight: 600,
                    cursor: canRunAnalysis ? 'pointer' : 'not-allowed',
                    opacity: canRunAnalysis ? 1 : 0.6,
                    transition: 'opacity 0.15s, background 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    if (canRunAnalysis) e.currentTarget.style.opacity = '0.85';
                  }}
                  onMouseLeave={(e) => {
                    if (canRunAnalysis) e.currentTarget.style.opacity = '1';
                  }}
                >
                  {isAnalysing && <LoadingSpinner />}
                  {isAnalysing ? 'Analysing…' : 'Run Analysis'}
                </button>

                {/* Hint when no valid files */}
                {validFileCount === 0 && !isAnalysing && (
                  <span
                    style={{
                      fontSize: '0.8125rem',
                      color: 'var(--dtg-text-secondary)',
                      fontStyle: 'italic',
                    }}
                  >
                    Upload at least one valid file to run analysis.
                  </span>
                )}

                {/* Hint when param errors */}
                {hasParamErrors && !isAnalysing && (
                  <span
                    role="alert"
                    style={{
                      fontSize: '0.8125rem',
                      color: '#ef4444',
                    }}
                  >
                    Fix parameter errors before running analysis.
                  </span>
                )}
              </div>
            </section>

            {/* ── Top-level analysis error (Requirement 4.4) ── */}
            {analysisError && (
              <div
                role="alert"
                style={{
                  padding: '12px 16px',
                  borderRadius: '8px',
                  border: '1px solid rgba(239,68,68,0.4)',
                  background: 'rgba(239,68,68,0.08)',
                  color: '#ef4444',
                  fontSize: '0.875rem',
                }}
              >
                <strong>Analysis Error:</strong> {analysisError}
              </div>
            )}

            {/* ── Stage editor error ── */}
            {stageError && (
              <div
                role="alert"
                style={{
                  padding: '12px 16px',
                  borderRadius: '8px',
                  border: '1px solid rgba(239,68,68,0.4)',
                  background: 'rgba(239,68,68,0.08)',
                  color: '#ef4444',
                  fontSize: '0.875rem',
                }}
              >
                <strong>Stage Error:</strong> {stageError}
              </div>
            )}

            {/* ── Results Area (shown after successful analysis) ── */}
            {hasResults && (
              <section aria-label="Analysis results">
                <ResultsArea
                  vcpResults={vcpResults}
                  multiVcpComparisonChartJson={multiVcpComparisonChartJson}
                  forecastingEnabled={forecastingEnabled}
                  longestVcpName={longestVcpName}
                  onApplyStages={handleApplyStages}
                  onResetStages={handleResetStages}
                  isApplyingStages={isApplyingStages}
                  isResettingStages={isResettingStages}
                  onUseResults={handleUseResults}
                  blastEvents={blastEvents}
                />
              </section>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
