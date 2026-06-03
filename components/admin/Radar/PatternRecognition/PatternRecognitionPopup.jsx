'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
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

/**
 * In production the endpoints are Vercel Python functions at
 * /api/pattern-recognition/*. In local development those aren't served by
 * `next dev`, so we use the dev-only Next routes that spawn local Python.
 */
const PR_API_BASE =
  process.env.NODE_ENV === 'development'
    ? '/api/pr-local'
    : '/api/pattern-recognition';

// ── Constants / helpers ─────────────────────────────────────────────────────

/**
 * Deformation event types overlaid on the analysis charts and folded into the
 * slope-behaviour summary (request 2). Archived records are included.
 */
const EVENT_DEF_TYPES = ['Material Detachment', 'Rock Fall', 'Blast Event', 'Failure'];

/** Parse a tz-naive timestamp (window edge / event time) to epoch-ms locally. */
function localMs(s) {
  if (!s) return NaN;
  return new Date(String(s).replace(' ', 'T').replace('Z', '')).getTime();
}

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
  onArchive,
  isArchiving = false,
  sensor = null,
  userSite = null,
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

  // ── Per-VCP re-run in-flight index (issue 5) ───────────────────────────────
  const [rerunningVcpIndex, setRerunningVcpIndex] = useState(null);

  // ── Deformation events for the related wall-folder (request 2) ─────────────
  // All Material Detachment / Rock Fall / Blast Event / Failure records for the
  // wall folder, including archived ones. Filtered to the analysis period and
  // toggled in/out by the analyst before plotting / summarising.
  const [deformationEvents, setDeformationEvents] = useState([]);
  const [excludedEventIds, setExcludedEventIds] = useState(() => new Set());
  const wallFolderId = precursorInitialValues?.WallFolderID ?? null;

  useEffect(() => {
    if (!isOpen || !wallFolderId) {
      setDeformationEvents([]);
      setExcludedEventIds(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('def_records')
          .select('id, start, def_type, location, isactive')
          .eq('wallfolder_id', wallFolderId)
          .in('def_type', EVENT_DEF_TYPES)
          .not('start', 'is', null);
        if (error) throw error;
        if (cancelled) return;
        const events = (data ?? [])
          .map((r) => {
            const local = isoToDatetimeLocal(r.start, timezone); // local-naive, matches chart axis
            if (!local) return null;
            return {
              id: r.id,
              time: local,
              type: r.def_type,
              location: r.location ?? null,
              isactive: r.isactive ?? null,
            };
          })
          .filter(Boolean);
        setDeformationEvents(events);
        setExcludedEventIds(new Set()); // default: include all
      } catch (err) {
        console.error('Failed to load deformation events:', err);
        if (!cancelled) {
          setDeformationEvents([]);
          setExcludedEventIds(new Set());
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, wallFolderId, timezone]);

  const handleToggleEvent = useCallback((id) => {
    setExcludedEventIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Analysis period = union of all VCP window ranges. Events outside it are not
  // shown (request 2: "within timestamp period").
  const analysisPeriod = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of vcpResults) {
      for (const w of v.windows ?? []) {
        const s = localMs(w.start);
        const e = localMs(w.end);
        if (!Number.isNaN(s)) lo = Math.min(lo, s);
        if (!Number.isNaN(e)) hi = Math.max(hi, e);
      }
    }
    return Number.isFinite(lo) && Number.isFinite(hi) ? { lo, hi } : null;
  }, [vcpResults]);

  // Events within the period, tagged with their current include flag.
  const periodEvents = useMemo(() => {
    if (!analysisPeriod) return [];
    return deformationEvents
      .filter((ev) => {
        const t = localMs(ev.time);
        return !Number.isNaN(t) && t >= analysisPeriod.lo && t <= analysisPeriod.hi;
      })
      .sort((a, b) => localMs(a.time) - localMs(b.time))
      .map((ev) => ({ ...ev, included: !excludedEventIds.has(ev.id) }));
  }, [deformationEvents, analysisPeriod, excludedEventIds]);

  // ── Client (site / company / logo) for the Post-Blast Report header ─────────
  // The report describes the SENSOR's site, not the signed-in user's own site,
  // so we resolve company + logo from the clients table by sensor.site_id.
  const [clientInfo, setClientInfo] = useState(null);
  const sensorSiteId = sensor?.site_id ?? null;

  useEffect(() => {
    if (!isOpen || !sensorSiteId) {
      setClientInfo(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('clients')
          .select('site_name, company, location, logo_path')
          .eq('id', sensorSiteId)
          .maybeSingle();
        if (error) throw error;
        if (!cancelled) setClientInfo(data ?? null);
      } catch (err) {
        console.error('Failed to load client for report:', err);
        if (!cancelled) setClientInfo(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, sensorSiteId]);

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

      const response = await fetch(`${PR_API_BASE}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        // A Vercel function timeout (504) or gateway error (502) returns an
        // HTML/plain error page, not JSON — so parse defensively and map the
        // common platform limits to actionable messages for the analyst.
        let serverError = null;
        try {
          serverError = (await response.json())?.error || null;
        } catch {
          serverError = null;
        }

        if (response.status === 504 || response.status === 502) {
          // Function exceeded the 60-second server time limit — almost always
          // because the dataset is too large to process in time.
          setAnalysisError(
            'The dataset is too large to analyse within the 60-second server ' +
              'time limit. Please reduce it to roughly 900 rows or fewer (or ' +
              'split it into smaller files) and try again.'
          );
        } else if (response.status === 413) {
          // Request body exceeded Vercel's ~4.5 MB cap.
          setAnalysisError(
            'The uploaded file is too large for the server (max ~4.5 MB per ' +
              'request). Please upload a smaller file or split it into parts.'
          );
        } else {
          setAnalysisError(
            serverError || `Analysis failed (HTTP ${response.status}).`
          );
        }
        return;
      }

      const data = await response.json();

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
        const response = await fetch(`${PR_API_BASE}/classify-manual`, {
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

  // ── Re-run a single VCP with adjusted parameters (issue 5) ────────────────

  const handleRerunVcp = useCallback(
    async (vcpIndex, overrideParams, newSmoothingWindow) => {
      const target = vcpResults[vcpIndex];
      if (!target) return;

      const sw = Number(newSmoothingWindow) || target.smoothingWindow;

      // VCP names follow `${prefix}_${sw}min`; recover the prefix to locate the
      // original uploaded file so we can re-run just this VCP.
      const oldSuffix = `_${target.smoothingWindow}min`;
      const prefix =
        typeof target.vcpName === 'string' && target.vcpName.endsWith(oldSuffix)
          ? target.vcpName.slice(0, -oldSuffix.length)
          : target.vcpName;
      const cfg = uploadedFiles.find(
        (c) => !c.parseError && c.file && c.vcpNamePrefix === prefix
      );
      if (!cfg) {
        setStageError(
          `Could not locate the source file for ${target.vcpName} to re-run.`
        );
        return;
      }

      setRerunningVcpIndex(vcpIndex);
      setStageError(null);

      try {
        const payload = {
          files: [
            {
              name: cfg.file.name,
              contentBase64: await fileToBase64(cfg.file),
              vcpNamePrefix: cfg.vcpNamePrefix,
              smoothingWindows: [sw],
            },
          ],
          params: overrideParams ?? params,
        };

        const response = await fetch(`${PR_API_BASE}/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          let serverError = null;
          try {
            serverError = (await response.json())?.error || null;
          } catch {
            serverError = null;
          }
          if (response.status === 504 || response.status === 502) {
            setStageError(
              'This VCP is too large to re-run within the 60-second server ' +
                'time limit. Try reducing the dataset (~900 rows or fewer).'
            );
          } else if (response.status === 413) {
            setStageError(
              'The source file is too large for the server (max ~4.5 MB).'
            );
          } else {
            setStageError(serverError || 'Failed to re-run this VCP.');
          }
          return;
        }

        const data = await response.json();
        const newVcp = Array.isArray(data.vcps) ? data.vcps[0] : null;
        if (!newVcp) {
          setStageError('Re-run returned no VCP result.');
          return;
        }
        if (newVcp.errors?.length && !newVcp.combinedChartJson) {
          setStageError(newVcp.errors[0]);
          return;
        }

        setVcpResults((prev) => {
          const updated = [...prev];
          updated[vcpIndex] = newVcp;
          setLongestVcpName(deriveLongestVcpName(updated));
          return updated;
        });
        setOriginalVcpResults((prev) => {
          const updated = [...prev];
          updated[vcpIndex] = newVcp;
          return updated;
        });
      } catch (err) {
        setStageError('An unexpected error occurred while re-running the VCP.');
      } finally {
        setRerunningVcpIndex(null);
      }
    },
    [vcpResults, uploadedFiles, params]
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

  // Metadata for the Post-Blast Analysis Report header. Company + logo come from
  // the sensor's client record (resolved above); author from the signed-in user;
  // blast id from the precursor record's location. Logo paths stored as
  // "../CompanyLogo/…" are rewritten to the public "/logo/…" path.
  const normalizeLogoPath = (p) => (p ? String(p).replace(/^\.\./, '/logo') : '');
  const reportMeta = {
    company: clientInfo?.company ?? userSite?.site?.company ?? '',
    siteName: clientInfo?.site_name ?? sensor?.site_name ?? userSite?.site?.site_name ?? '',
    location: clientInfo?.location ?? '',
    radarNumber: sensor?.radar_number ?? '',
    author: userSite?.displayname ?? '',
    blastId: precursorInitialValues?.Location ?? '',
    logoPath: normalizeLogoPath(clientInfo?.logo_path ?? userSite?.site?.logo_path),
    // Carried so the report export can persist to Supabase (reports table +
    // Reports storage bucket + work_log), mirroring the daily/InSAR reports.
    clientId: sensorSiteId,
    userId: userSite?.user_id ?? null,
  };

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
                  onArchive={onArchive}
                  isArchiving={isArchiving}
                  params={params}
                  onRerunVcp={handleRerunVcp}
                  rerunningVcpIndex={rerunningVcpIndex}
                  events={periodEvents}
                  onToggleEvent={handleToggleEvent}
                  reportMeta={reportMeta}
                />
              </section>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
