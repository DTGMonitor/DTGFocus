'use client';

/**
 * PostBlastReportModal
 *
 * Print-ready "POST BLAST ANALYSIS REPORT" generated from the pattern-recognition
 * results. Content is measured and laid out into real A4 page divs so the preview
 * matches the exported PDF exactly (no mid-element cuts).
 *
 * Sections:
 *   1. Header        — company logo + title + inline metadata grid (pipe dividers)
 *   2. Risk strip    — TARP level coloured by the latest stage + monitoring window
 *   3. Pit viewport  — drag-and-drop pit-wall photo + manual polygon boundaries
 *   4. Analysis Chart— the exact PR combined chart(s) — one image per VCP
 *   5. Stage table   — dense font-mono grid (units follow the analysis result)
 *   6. Summary       — boxed numbered analytical takeaways (selectable VCP)
 *   7. Footer        — grey DTG Focus mark + branding + per-page number
 */

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { displayPhase, shortVcpLabel } from '@/utils/stageBoundaries';
import { emailStrings, resolveEmailLocale, translatePhase } from '@/config/emailLocale';
import { DTG_INTERNAL_GROUP } from '@/config/tarpDocument';
import { supabase } from '@/lib/supabaseClient';
import {
  PAGE_W,
  NAVY,
  DARK,
  ACCENT,
  INK,
  MUTED,
  LINE,
  ZEBRA,
  IMAGE_MAX_H as PIT_MAX_H,
  FALLBACK_LOGO,
} from '../report/constants';
import {
  EVENT_SHORT,
  buildEventOverlays,
  applyChartView,
  timeAxisOnly,
} from './chartOverlays';
import { PageSheet, ReportPages, SectionBar } from '../report/pageFrame';
import { useReportPagination, resolvePages } from '../report/useReportPagination';
import { useImageAnnotation } from '../report/useImageAnnotation';
import { AnnotatedImage } from '../report/AnnotatedImage';
import {
  urlToDataUrl,
  printLocal as printPages,
  generatePdfBlob as rasterizePages,
} from '../report/pdfExport';

// Public dashboard link included in the emailed report draft.
const DASHBOARD_URL = 'https://dashboard.digitaltwingeotechnical.com/';

// ── Outlook draft + Supabase helpers ────────────────────────────────────────────

/** Open the user's default mail client (Outlook) with a pre-filled draft. */
function openOutlookDraft(subject, body, toGroup = '', ccGroup = '') {
  const safeSubject = encodeURIComponent(subject);
  const safeBody = encodeURIComponent(body);
  const safeTo = encodeURIComponent(toGroup);
  const safeCc = encodeURIComponent(ccGroup);
  let mailtoLink = `mailto:${safeTo}?subject=${safeSubject}&body=${safeBody}`;
  if (safeCc) mailtoLink += `&cc=${safeCc}`;
  window.location.href = mailtoLink;
}

/** Human-readable file size (matches ReportTemplateModal). */
function formatFileSize(bytes) {
  const kb = (bytes / 1024).toFixed(2);
  const mb = (bytes / (1024 * 1024)).toFixed(2);
  return bytes > 1024 * 1024 ? `${mb} MB` : `${kb} KB`;
}

const ROWS_PER_CHUNK = 12;          // stage-table rows per page slice

/** Latest deformation stage → TARP level (per spec). Keyed on raw phase. */
const PHASE_TO_TARP = {
  'No Significant Movement': 'TARP 1',
  Regressive: 'TARP 2',
  Linear: 'TARP 3',
  'Progressive Failure': 'TARP 4',
};

/** Stage band colours — mirror ResultsArea.PHASE_COLORS. */
const PHASE_COLOR = {
  'No Significant Movement': '#00B050',
  Linear: '#E97132',
  'Progressive Failure': '#FF0000',
  Regressive: '#FFFF00',
  Unclassified: '#9E9E9E',
};

// ── Colour helpers ─────────────────────────────────────────────────────────────
function hexToRgb(h) {
  const m = String(h).replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function tint(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}
function readableText(hex) {
  const { r, g, b } = hexToRgb(hex);
  const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return L > 0.6 ? '#1f2937' : '#ffffff';
}

// ── Date / number helpers ──────────────────────────────────────────────────────

/** DD/MM/YY HH:mm — header / monitoring window. */
function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T').replace('Z', ''));
  if (Number.isNaN(d.getTime())) return String(s);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Compact DD/MM HH:mm — table cells (saves width). */
function fmtTableDate(s) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T').replace('Z', ''));
  if (Number.isNaN(d.getTime())) return String(s);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtLongDate(d) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Parse a tz-naive timestamp (window edge or blast time) to epoch-ms locally. */
function toMs(s) {
  if (!s) return NaN;
  return new Date(String(s).replace(' ', 'T').replace('Z', '')).getTime();
}

/** Human duration "Xd Yh Zm" from a millisecond span. */
function formatDurationMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalMin = Math.round(ms / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m || parts.length === 0) parts.push(`${m}m`);
  return parts.join(' ');
}

/** Display unit + multiplier for a convertible column — mirrors StageSummaryTable. */
function unitInfo(kind, isMmH) {
  if (kind === 'velocity') return { unit: isMmH ? 'mm/h' : 'mm/day', factor: isMmH ? 1 / 24 : 1 };
  if (kind === 'inverse') return { unit: isMmH ? 'h/mm' : 'day/mm', factor: isMmH ? 24 : 1 };
  return { unit: '', factor: 1 };
}

/** Format a stage-table cell. */
function formatStageCell(col, row, pfConfirmed) {
  const raw = row[col.key];
  if (col.key === 'VCP') return shortVcpLabel(String(raw ?? ''));
  if (col.phase) return displayPhase(String(raw ?? ''), pfConfirmed);
  if (col.dateFmt) return fmtTableDate(raw);
  if (!col.num) return raw ?? '—';
  if (raw === null || raw === undefined || raw === '') return '—';
  const n = Number(raw);
  if (Number.isNaN(n)) return String(raw);
  if (col.kind) {
    const info = unitInfo(col.kind, row.__velocityUnit === 'mm/h');
    return `${(n * info.factor).toFixed(3)} ${info.unit}`;
  }
  return n.toFixed(3);
}

/**
 * Re-theme a PR Plotly figure for a white printed page, replaying the analyst's
 * on-screen view (hidden traces + zoom, via `view`) and re-drawing the
 * deformation-event markers, which live as overlays on the interactive chart
 * and are not part of the stored figure JSON.
 */
function printFigure(
  chartJson,
  { view = null, matchByIndex = false, overlays = null, pfConfirmed = true } = {}
) {
  const viewed = applyChartView(chartJson, view, {
    matchByIndex,
    // Other VCPs share the time axis but not the displacement / velocity scales.
    axisFilter: matchByIndex ? null : timeAxisOnly,
  });

  const data = viewed.data.map((trace) => {
    // Legend wording follows the same rule as the stage tables: "Progressive"
    // until an actual failure time confirms the failure (issue 3).
    const t = pfConfirmed || !trace?.name
      ? trace
      : { ...trace, name: displayPhase(trace.name, false) };
    const c = t?.line?.color;
    if (typeof c === 'string' && (c.toUpperCase() === '#FFFFFF' || c.toLowerCase() === '#fff')) {
      return { ...t, line: { ...t.line, color: INK } };
    }
    return t;
  });
  const layout = { ...viewed.layout };
  if (overlays) {
    layout.shapes = [...(Array.isArray(layout.shapes) ? layout.shapes : []), ...overlays.shapes];
    layout.annotations = [
      ...(Array.isArray(layout.annotations) ? layout.annotations : []),
      ...overlays.annotations,
    ];
  }
  layout.paper_bgcolor = '#ffffff';
  layout.plot_bgcolor = '#ffffff';
  layout.font = { ...(layout.font ?? {}), color: INK, size: 11 };
  for (const k of Object.keys(layout)) {
    if (/^[xy]axis\d*$/.test(k) && layout[k] && typeof layout[k] === 'object') {
      layout[k] = {
        ...layout[k],
        gridcolor: 'rgba(0,0,0,0.10)',
        zerolinecolor: 'rgba(0,0,0,0.12)',
        linecolor: 'rgba(0,0,0,0.30)',
      };
    }
  }
  return { data, layout };
}

const STAGE_COLS = [
  { key: 'VCP', label: 'VCP' },
  { key: 'Stage', label: 'Stage', phase: true, wrap: true },
  { key: 'Start', label: 'Start', mono: true, dateFmt: true },
  { key: 'End', label: 'End', mono: true, dateFmt: true },
  { key: 'Duration', label: 'Duration', mono: true },
  { key: 'Deformation Δ (mm)', label: 'Def. Δ (mm)', mono: true, num: true },
  { key: 'Velocity min (mm/day)', label: 'Vel. min', mono: true, num: true, kind: 'velocity' },
  { key: 'Velocity max (mm/day)', label: 'Vel. max', mono: true, num: true, kind: 'velocity' },
  { key: 'Inv. Velocity min (day/mm)', label: 'Inv.V min', mono: true, num: true, kind: 'inverse' },
  { key: 'Inv. Velocity max (day/mm)', label: 'Inv.V max', mono: true, num: true, kind: 'inverse' },
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function PostBlastReportModal({
  isOpen,
  onClose,
  vcpResults = [],
  activeVcp = null,
  stageRows = [],
  meta = {},
  actualFailureTime = '',
  pfConfirmed = false,
  blastEvents = [],
  analysisTitle = 'Post-Blast Analysis',
  chartView = null,
  chartViewVcpIndex = null,
}) {
  const imageRef = useRef(null);

  const [chartImgs, setChartImgs] = useState([]); // [{ name, url }]
  const [chartLoading, setChartLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const [summaryVcpIndex, setSummaryVcpIndex] = useState(0);

  // Pit image + zone drawing — shared with the Comprehensive radar report.
  // `isOpen`, not the default: this modal stays mounted while closed, and an
  // armed document paste listener would swallow clipboard images app-wide.
  const annotation = useImageAnnotation(null, { pasteEnabled: isOpen });
  const {
    image: pitImage,
    boundaries,
    draft,
    color,
    setColor,
    readImageFile,
    handleDrop,
    handlePaste,
    startDraft,
    undoPoint,
    finishDraft,
    clearBoundaries,
    updateLabel,
  } = annotation;
  const handleImageClick = (e) => annotation.addPoint(e, imageRef.current);

  // Declared before buildBlocks: the blocks close over `bumpMeasure`.
  // Deps name the *sources* of the old derived deps (latestPhase, transitions,
  // failureTakeaway all fall out of vcpResults/summaryVcpIndex/blastEvents/pfConfirmed).
  const { pages, measureRef, measureLayer, bumpMeasure } = useReportPagination([
    isOpen, pitImage, chartImgs, boundaries, stageRows, summaryVcpIndex, vcpResults, blastEvents, pfConfirmed,
  ]);

  // ── Reset summary VCP to the active one on open ────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const idx = vcpResults.findIndex((v) => v === activeVcp);
    setSummaryVcpIndex(idx >= 0 ? idx : 0);
  }, [isOpen, vcpResults, activeVcp]);

  // ── One chart image per VCP (Plotly → PNG) ─────────────────────────────────
  useEffect(() => {
    if (!isOpen) {
      setChartImgs([]);
      return undefined;
    }
    const list = (vcpResults || [])
      .map((v, idx) => ({ vcp: v, idx }))
      .filter(({ vcp }) => vcp?.combinedChartJson);
    if (list.length === 0) {
      setChartImgs([]);
      return undefined;
    }
    let cancelled = false;
    setChartLoading(true);
    (async () => {
      try {
        const Plotly = (await import('plotly.js-dist-min')).default;
        const overlays = buildEventOverlays({
          events: blastEvents,
          actualFailureTime,
          print: true,
        });
        const imgs = await Promise.all(
          list.map(async ({ vcp: v, idx }) => {
            const fig = printFigure(v.combinedChartJson, {
              view: chartView,
              matchByIndex: idx === chartViewVcpIndex,
              overlays,
              pfConfirmed,
            });
            const url = await Plotly.toImage(
              { data: fig.data, layout: { ...fig.layout, margin: { l: 60, r: 60, t: 28, b: 50 } } },
              { format: 'png', width: 1000, height: 430, scale: 2 }
            );
            return { name: v.vcpName ?? `VCP ${idx + 1}`, url };
          })
        );
        if (!cancelled) setChartImgs(imgs);
      } catch (err) {
        console.error('Failed to render chart image(s) for report:', err);
        if (!cancelled) setChartImgs([]);
      } finally {
        if (!cancelled) setChartLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, vcpResults, chartView, chartViewVcpIndex, blastEvents, actualFailureTime, pfConfirmed]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // ── Summary source VCP & derived content ───────────────────────────────────
  const summaryVcp = vcpResults[summaryVcpIndex] ?? activeVcp;
  const windows = useMemo(
    () => (Array.isArray(summaryVcp?.windows) ? summaryVcp.windows : []),
    [summaryVcp]
  );
  const lastWindow = windows.length ? windows[windows.length - 1] : null;
  const latestRawPhase = lastWindow?.phase ?? '';
  const latestPhase = lastWindow ? displayPhase(latestRawPhase, pfConfirmed) : '—';
  const tarp = PHASE_TO_TARP[latestRawPhase] ?? '—';
  const stageColor = PHASE_COLOR[latestRawPhase] ?? ACCENT;
  const monitoringStart = windows.length ? windows[0].start : null;
  const monitoringEnd = windows.length ? windows[windows.length - 1].end : null;

  // Slope-behaviour transition sequence with blast events interleaved by time
  // (issue 4): e.g. No Significant → Blast → Regressive → Blast → Linear.
  const transitions = useMemo(() => {
    const phasePts = windows.map((w) => ({
      time: toMs(w.start),
      label: displayPhase(w.phase, pfConfirmed),
    }));
    const dedup = phasePts.filter((p, i) => i === 0 || p.label !== phasePts[i - 1].label);
    const startMs = windows.length ? toMs(windows[0].start) : null;
    const endMs = windows.length ? toMs(windows[windows.length - 1].end) : null;
    const blastPts = (blastEvents ?? [])
      .map((b) => ({
        time: toMs(b.time),
        label: EVENT_SHORT[b.type] ?? b.type ?? 'Blast',
      }))
      .filter(
        (p) =>
          !Number.isNaN(p.time) &&
          (startMs == null || (p.time >= startMs && p.time <= endMs))
      );
    return [...dedup, ...blastPts]
      .sort((a, b) => a.time - b.time)
      .map((p) => p.label);
  }, [windows, blastEvents, pfConfirmed]);

  // Settling time (issue 2): from the most recent blast up to the start of the
  // (last) No Significant Movement trend — how long the slope took to settle.
  const settlingInfo = useMemo(() => {
    const nsm = [...windows].reverse().find((w) => w.phase === 'No Significant Movement');
    if (!nsm) return null;
    const startMs = toMs(nsm.start);
    if (Number.isNaN(startMs)) return null;
    const priorBlasts = (blastEvents ?? [])
      .filter((b) => (b.type ?? 'Blast Event') === 'Blast Event')
      .map((b) => ({ ms: toMs(b.time), time: b.time }))
      .filter((b) => !Number.isNaN(b.ms) && b.ms <= startMs)
      .sort((a, b) => a.ms - b.ms);
    if (priorBlasts.length === 0) return null;
    const chosen = priorBlasts[priorBlasts.length - 1];
    const span = startMs - chosen.ms;
    if (span <= 0) return null;
    return {
      duration: formatDurationMs(span),
      blastTimeStr: chosen.time,
      settledTimeStr: nsm.start,
    };
  }, [windows, blastEvents]);

  /**
   * The Outlook sentence, in `locale`. The printed report always asks for
   * English; only the emailed draft follows the site's language, so the wording
   * lives in config/emailLocale.ts and the branching stays here — one source of
   * truth for WHICH sentence applies, two for how it reads.
   */
  const takeawayFor = useCallback(
    (locale) => {
      const t = emailStrings(locale);
      const forecastIso =
        summaryVcp?.fukuzono?.predictedFailureTime ?? summaryVcp?.slo?.predictedFailureTime ?? null;
      const method = summaryVcp?.fukuzono?.predictedFailureTime
        ? 'Inverse Velocity (Fukuzono)'
        : summaryVcp?.slo?.predictedFailureTime
          ? 'Spline (SLO)'
          : null;
      const vcp = summaryVcp?.smoothingWindow != null ? `VCP ${summaryVcp.smoothingWindow}` : '';
      const phase = latestRawPhase;
      // The phase reads as a lower-cased clause in English ("slope is regressive");
      // Indonesian keeps its label capitalised, so translate before casing.
      const phaseText =
        locale === 'id'
          ? translatePhase(displayPhase(phase, pfConfirmed), locale)
          : displayPhase(phase, pfConfirmed).toLowerCase();

      if (actualFailureTime) {
        const err = forecastIso
          ? (new Date(forecastIso).getTime() - new Date(actualFailureTime).getTime()) / 3_600_000
          : null;
        return (
          t.pbActualFailure(fmtDateTime(actualFailureTime)) +
          (forecastIso
            ? t.pbForecastError(
                method,
                vcp,
                fmtDateTime(forecastIso),
                `${err >= 0 ? '+' : ''}${err.toFixed(1)}`
              )
            : '')
        );
      }
      if (phase === 'Progressive Failure') {
        return forecastIso
          ? t.pbEstimatedFailure(fmtDateTime(forecastIso), method, vcp)
          : t.pbNoForecast;
      }
      if (phase === 'Regressive' || phase === 'No Significant Movement') {
        // Settling measured from the blast to the start of the No Significant
        // trend, when a preceding blast exists (issue 2).
        if (settlingInfo) {
          return t.pbSettledAfterBlast(
            phaseText,
            settlingInfo.duration,
            fmtDateTime(settlingInfo.blastTimeStr),
            fmtDateTime(settlingInfo.settledTimeStr)
          );
        }
        return t.pbSettling(phaseText, lastWindow?.duration ? t.pbSettlingOver(lastWindow.duration) : '');
      }
      return t.pbStillLinear(lastWindow?.duration ? lastWindow.duration : t.pbMonitoredPeriod);
    },
    [summaryVcp, actualFailureTime, lastWindow, latestRawPhase, pfConfirmed, settlingInfo]
  );

  const failureTakeaway = useMemo(() => takeawayFor('en'), [takeawayFor]);

  // ── PDF export ─────────────────────────────────────────────────────────────
  const fileName = useMemo(() => {
    const date = new Date().toLocaleDateString('en-CA').replaceAll('-', '');
    const id = (meta.blastId || meta.radarNumber || 'report').toString().replace(/[^\w-]+/g, '_');
    const slug = String(analysisTitle).replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '');
    return `${date}_${slug}_${id}`;
  }, [meta.blastId, meta.radarNumber, analysisTitle]);

  // Predefined-but-editable report title / PDF filename (issue 6). Seeded from
  // the auto-generated name on open; the analyst can override it before export.
  const [reportTitle, setReportTitle] = useState('');
  useEffect(() => {
    if (isOpen) setReportTitle(fileName);
  }, [isOpen, fileName]);
  const effectiveTitle = (reportTitle || fileName).trim() || fileName;

  // ── Outlook draft content (subject + body) ─────────────────────────────────
  // The printed PDF stays English — it is the archived report. Only the DRAFT
  // the analyst sends follows the site's language (config/emailLocale.ts).
  const emailLocale = resolveEmailLocale(meta, meta.timezone);
  const t = emailStrings(emailLocale);

  // Plain-text mirror of the on-page Summary section, for the email body.
  const summaryText = useMemo(
    () => {
      const s = emailStrings(emailLocale);
      const sequence = transitions.length
        ? transitions.map((p) => translatePhase(p, emailLocale)).join(' -> ')
        : s.pbNoStages;
      return [
        s.pbRiskStatus(tarp, translatePhase(latestPhase, emailLocale)),
        s.pbTransition(sequence),
        s.pbOutlook(takeawayFor(emailLocale)),
      ].join('\n');
    },
    [tarp, latestPhase, transitions, takeawayFor, emailLocale]
  );

  const emailSubject =
    emailLocale === 'id'
      ? `Laporan ${analysisTitle} ${meta.radarNumber || 'Sensor'} periode ${fmtLongDate(new Date())}`
      : `${analysisTitle} Report of ${meta.radarNumber || 'Sensor'} period of ${fmtLongDate(new Date())}`;

  const emailBody = [
    `${t.postBlastSensor}: ${meta.radarNumber || '—'} - ${meta.siteName || '—'}`,
    ...(meta.blastId ? [`${t.postBlastBlastId}: ${meta.blastId}`] : []),
    '',
    t.postBlastSummary,
    summaryText,
    '',
    t.postBlastLink(DASHBOARD_URL),
    '',
    t.kindRegards,
    meta.author || '',
  ].join('\n');

  /** The export pages, with the logo pre-decoded so nothing snapshots blank. */
  const buildExportPages = async () => {
    const logoDataUrl = await urlToDataUrl(headerLogo);
    const exportBlocks = buildBlocks(false, logoDataUrl);
    return (
      <>
        {effectivePages.map((idxs, i) => (
          <PageSheet key={i} blocks={exportBlocks} idxs={idxs} pageNum={i + 1} total={effectivePages.length} />
        ))}
      </>
    );
  };

  // Local download via the browser's NATIVE print engine — vector, selectable
  // text, which html2canvas can't do reliably at small sizes.
  const printLocal = async () => {
    if (!effectivePages || effectivePages.length === 0) return;
    try {
      await printPages(await buildExportPages(), effectiveTitle);
    } catch (err) {
      console.error('PDF print failed:', err);
    }
  };

  // Rasterized copy for the Supabase archive (the print dialog can't give us a
  // Blob). Page count comes from the DOM, so it can't drift from the measured
  // pagination.
  const generatePdfBlob = async () => rasterizePages(await buildExportPages(), PAGE_W);

  // Persist the generated report PDF to Supabase — same flow/logic as the daily
  // radar and InSAR water-body reports (reports table + Reports bucket + work_log).
  const saveReportToSupabase = async (blob) => {
    const clientId = meta.clientId ?? meta.client_id ?? null;
    const safeName = (effectiveTitle || 'report').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '');
    const pdfFileName = `${safeName}.pdf`;
    const storagePath = clientId ? `${clientId}/${pdfFileName}` : pdfFileName;

    const title = `${analysisTitle} Report`;
    const category = /back/i.test(analysisTitle) ? 'back analysis' : 'post blast';
    const description = `${analysisTitle} report for ${meta.radarNumber || 'sensor'}`;
    const todayCa = new Date().toLocaleDateString('en-CA');

    const { error: metadataError } = await supabase.from('reports').insert({
      title,
      type: 'radar',
      category,
      created_at: new Date().toISOString(),
      status: 'Completed',
      client_id: clientId,
      filename: storagePath,
      description,
      generatedby: meta.author || '',
      date: todayCa,
      size: formatFileSize(blob.size),
    });
    if (metadataError) throw metadataError;

    const { error: uploadError } = await supabase.storage.from('Reports').upload(
      storagePath,
      blob,
      { contentType: 'application/pdf', upsert: true }
    );
    if (uploadError) throw uploadError;

    // Work log (best-effort) — matches the daily/InSAR report behaviour.
    try {
      await supabase.from('work_log').insert([{
        created_at: new Date().toISOString(),
        subject: 1,
        location: meta.siteName || '',
        category: `${category} report`,
        action: 'No action required',
        notes: `${title} has been generated`,
        submitted_by: meta.userId ?? null,
        type: 'radar',
      }]);
    } catch (logErr) {
      console.warn('Failed to create work log.', logErr);
    }
  };

  // Orchestrate the export: archive a PDF copy to Supabase, open an Outlook draft,
  // and finally trigger the local (vector) print/save dialog.
  const handleExport = async () => {
    if (!effectivePages || effectivePages.length === 0) return;
    setIsExporting(true);
    try {
      // Supabase archive (best-effort — never blocks the local export/email).
      try {
        const blob = await generatePdfBlob();
        await saveReportToSupabase(blob);
      } catch (err) {
        console.error('Saving report to Supabase failed:', err);
      }

      // Pre-filled Outlook draft. Post-blast and failure back-analysis reports are
      // internal work product — the reasoning is DTG's, and a forecast error the
      // engineer has not reviewed yet is not something to put in front of a mine.
      // Addressed to DTG with no CC rather than left blank, which relied on the
      // sender remembering to type a recipient at all.
      openOutlookDraft(emailSubject, emailBody, DTG_INTERNAL_GROUP, '');

      // Local high-quality download.
      await printLocal();
    } finally {
      setIsExporting(false);
    }
  };

  // ── Build the ordered content blocks (interactive vs static for measuring) ──
  const headerLogo = meta.logoPath || FALLBACK_LOGO;
  const metaItems = [
    { label: 'Edition', value: fmtLongDate(new Date()) },
    { label: 'Author', value: meta.author || '—' },
    { label: 'Sensor', value: meta.radarNumber || '—' },
    // Blast ID is only carried for a Post-Blast Analysis (omitted otherwise).
    ...(meta.blastId ? [{ label: 'Blast ID', value: meta.blastId }] : []),
  ];
  const summaryItems = [
    <>
      <strong>Current risk status:</strong> {tarp} — slope classified as <strong>{latestPhase}.</strong>
    </>,
    <>
      <strong>Slope behaviour transition:</strong>{' '}
      {transitions.length ? transitions.join(' → ') : 'No staged behaviour detected.'}
    </>,
    <>
      <strong>Outlook:</strong> {failureTakeaway}
    </>,
  ];

  const buildBlocks = (interactive, logoSrc = headerLogo) => {
    const blocks = [];

    // 1. HEADER
    blocks.push(
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src={logoSrc} alt="Company" style={{ height: 46, maxWidth: 140, objectFit: 'contain' }} crossOrigin="anonymous" onLoad={bumpMeasure} />
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: NAVY, letterSpacing: '0.01em' }}>
              {String(analysisTitle).toUpperCase()} REPORT
            </h1>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: MUTED, fontWeight: 600 }}>
              {(meta.company || '—')} – {(meta.siteName || '—')}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 0, marginTop: 12, fontSize: 12 }}>
          {metaItems.map((it, i) => (
            <div key={it.label} style={{ display: 'flex', alignItems: 'center' }}>
              {i > 0 && <span style={{ color: LINE, margin: '0 12px' }}>|</span>}
              <span style={{ color: MUTED, marginRight: 5 }}>{it.label}:</span>
              <span style={{ color: INK, fontWeight: 700 }}>{it.value}</span>
            </div>
          ))}
        </div>
        {/* Black line below the header (req 1) */}
        <div style={{ height: 2, background: '#000', marginTop: 12 }} />
      </div>
    );

    // 2. RISK STRIP — coloured by the latest stage (req 1)
    blocks.push(
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          background: tint(stageColor, 0.14),
          border: `1px solid ${stageColor}`,
          borderLeft: `6px solid ${stageColor}`,
          padding: '8px 12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <span
            style={{
              background: stageColor,
              color: readableText(stageColor),
              fontWeight: 800,
              padding: '2px 8px',
              borderRadius: 4,
              fontSize: 12,
              whiteSpace: 'nowrap',
            }}
          >
            {tarp}
          </span>
          <span style={{ fontWeight: 800, color: INK }}>{latestPhase} Deformation Trend</span>
        </div>
        <div style={{ fontSize: 12, color: MUTED, fontWeight: 600, whiteSpace: 'nowrap' }}>
          {fmtDateTime(monitoringStart)} – {fmtDateTime(monitoringEnd)}
        </div>
      </div>
    );

    // 3. PIT VIEWPORT
    blocks.push(
      <AnnotatedImage
        image={pitImage}
        boundaries={boundaries}
        draft={draft}
        interactive={interactive}
        imageRef={imageRef}
        onDrop={handleDrop}
        onPaste={handlePaste}
        onImageClick={handleImageClick}
        onImageLoad={bumpMeasure}
        maxHeight={PIT_MAX_H}
        emptyHint="Drag, drop or paste (Ctrl+V) the pit-wall photograph here, or use “Upload pit image”."
      />
    );

    // 4. ANALYSIS CHART(S) — bar grouped with first chart; rest standalone
    const firstChart = chartImgs[0];
    blocks.push(
      <div>
        <SectionBar title="Analysis Chart" />
        <div style={{ border: `1px solid ${LINE}`, borderTop: 'none', padding: 8 }}>
          {firstChart ? (
            <>
              {chartImgs.length > 1 && <div style={{ fontSize: 10, fontWeight: 700, color: DARK, marginBottom: 4 }}>{firstChart.name}</div>}
              <img src={firstChart.url} alt={`Analysis chart ${firstChart.name}`} style={{ width: '100%', display: 'block' }} onLoad={bumpMeasure} />
            </>
          ) : (
            <div style={{ textAlign: 'center', color: MUTED, fontSize: 12, padding: 20 }}>
              {chartLoading ? 'Rendering chart(s)…' : 'Chart unavailable.'}
            </div>
          )}
        </div>
      </div>
    );
    for (let k = 1; k < chartImgs.length; k++) {
      const c = chartImgs[k];
      blocks.push(
        <div style={{ border: `1px solid ${LINE}`, padding: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: DARK, marginBottom: 4 }}>{c.name}</div>
          <img src={c.url} alt={`Analysis chart ${c.name}`} style={{ width: '100%', display: 'block' }} onLoad={bumpMeasure} />
        </div>
      );
    }

    // 5. STAGE TABLE — split into row chunks so no table block exceeds a page.
    //    Each chunk repeats the column header.
    const renderStageTable = (rows, startIndex) => (
      <table style={{ width: '100%', borderCollapse: 'collapse', border: `1px solid ${LINE}`, borderTop: 'none', fontSize: 9, tableLayout: 'fixed' }}>
        <thead>
          <tr>
            {STAGE_COLS.map((c) => (
              <th key={c.key} style={{ textAlign: c.num ? 'right' : 'left', padding: '4px 5px', background: '#eef2f3', color: DARK, fontWeight: 700, fontSize: 9, borderBottom: `1px solid ${LINE}`, whiteSpace: 'nowrap' }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={STAGE_COLS.length} style={{ padding: 10, textAlign: 'center', color: MUTED }}>
                No stage data available.
              </td>
            </tr>
          ) : (
            rows.map((row, j) => {
              const ri = startIndex + j;
              return (
                <tr key={ri} style={{ background: ri % 2 ? ZEBRA : '#fff' }}>
                  {STAGE_COLS.map((c) => (
                    <td
                      key={c.key}
                      style={{
                        padding: '3px 5px',
                        textAlign: c.num ? 'right' : 'left',
                        borderBottom: `1px solid ${LINE}`,
                        whiteSpace: c.wrap || c.num ? 'normal' : 'nowrap',
                        wordBreak: c.wrap || c.num ? 'break-word' : 'normal',
                        fontFamily: c.mono ? 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' : undefined,
                        fontVariantNumeric: 'tabular-nums',
                        color: INK,
                      }}
                    >
                      {formatStageCell(c, row, pfConfirmed)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    );

    const chunks = stageRows.length === 0 ? [[]] : [];
    for (let i = 0; i < stageRows.length; i += ROWS_PER_CHUNK) {
      chunks.push(stageRows.slice(i, i + ROWS_PER_CHUNK));
    }
    chunks.forEach((chunk, ci) => {
      blocks.push(
        <div>
          <SectionBar title={ci === 0 ? 'Deformation Stage Data' : 'Deformation Stage Data (cont.)'} />
          {renderStageTable(chunk, ci * ROWS_PER_CHUNK)}
        </div>
      );
    });

    // 6. SUMMARY (numbered, req 4 earlier)
    blocks.push(
      <div>
        <SectionBar title="Summary" />
        <div style={{ border: `1px solid ${LINE}`, borderTop: 'none', padding: '10px 14px' }}>
          {summaryItems.map((node, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: i < summaryItems.length - 1 ? 7 : 0 }}>
              <span style={{ fontWeight: 800, color: DARK, minWidth: 16, fontSize: 12 }}>{i + 1}.</span>
              <div style={{ flex: 1, fontSize: 12, lineHeight: 1.55, color: INK }}>{node}</div>
            </div>
          ))}
        </div>
      </div>
    );

    return blocks;
  };

  const measureBlocks = buildBlocks(false);
  const displayBlocks = buildBlocks(true);
  const effectivePages = resolvePages(pages, displayBlocks);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Post Blast Analysis Report"
      style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.65)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
    >
      {/* ── Toolbar ── */}
      <div style={{ width: '100%', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 16px', background: '#111418', borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}>
        <strong style={{ fontSize: 14 }}>{analysisTitle} Report — Preview</strong>

        {/* Editable report title / PDF filename (issue 6) */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginRight: 'auto' }}>
          <span style={{ color: '#cbd5e1' }}>Title</span>
          <input
            type="text"
            value={reportTitle}
            onChange={(e) => setReportTitle(e.target.value)}
            aria-label="Report title / filename"
            style={{
              background: 'rgba(255,255,255,0.1)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 6,
              padding: '5px 8px',
              fontSize: 13,
              width: 280,
            }}
          />
        </label>

        {vcpResults.length > 1 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <span style={{ color: '#cbd5e1' }}>Summary VCP</span>
            <select value={summaryVcpIndex} onChange={(e) => setSummaryVcpIndex(Number(e.target.value))} style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, padding: '5px 8px', fontSize: 13 }}>
              {vcpResults.map((v, i) => (
                <option key={i} value={i} style={{ color: '#111' }}>
                  {v.vcpName ?? `VCP ${i + 1}`}
                </option>
              ))}
            </select>
          </span>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
          <input type="file" accept="image/*" onChange={(e) => readImageFile(e.target.files?.[0])} style={{ display: 'none' }} />
          <span style={tbBtn}>{pitImage ? 'Replace pit image' : 'Upload pit image'}</span>
        </label>

        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <span style={{ color: '#cbd5e1' }}>Boundary colour</span>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 32, height: 24, border: 'none', background: 'transparent', cursor: 'pointer' }} />
        </span>

        {!draft ? (
          <button type="button" onClick={startDraft} disabled={!pitImage} style={tbBtn}>✏ Draw boundary</button>
        ) : (
          <>
            <button type="button" onClick={undoPoint} style={tbBtn}>↶ Undo point</button>
            <button type="button" onClick={finishDraft} style={{ ...tbBtn, background: ACCENT, color: '#111' }}>✓ Finish ({draft.points.length})</button>
          </>
        )}
        <button type="button" onClick={clearBoundaries} disabled={!boundaries.length} style={tbBtn}>Clear</button>

        <button type="button" onClick={handleExport} disabled={isExporting} style={{ ...tbBtn, background: ACCENT, color: '#111', fontWeight: 700 }}>
          {isExporting ? 'Exporting…' : '⬇ Export to PDF'}
        </button>
        <button type="button" onClick={onClose} style={{ ...tbBtn, padding: '6px 12px' }} aria-label="Close">✕</button>
      </div>

      {/* ── Boundary label editor (screen only, outside the paginated paper) ── */}
      {boundaries.length > 0 && (
        <div style={{ width: '100%', flexShrink: 0, display: 'flex', flexWrap: 'wrap', gap: 10, padding: '8px 16px', background: '#1b1f24', color: '#cbd5e1', fontSize: 12 }}>
          <span style={{ alignSelf: 'center' }}>Boundary labels:</span>
          {boundaries.map((b, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 10, height: 10, background: b.color, borderRadius: 2, display: 'inline-block' }} />
              <input value={b.label} onChange={(e) => updateLabel(i, e.target.value)} style={{ border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)', color: '#fff', borderRadius: 3, padding: '2px 6px', fontSize: 12, width: 100 }} />
            </span>
          ))}
        </div>
      )}

      {/* ── Scrollable preview ── */}
      <div style={{ flex: 1, overflow: 'auto', width: '100%', display: 'flex', justifyContent: 'center', padding: 24 }}>
        <ReportPages blocks={displayBlocks} pages={effectivePages} />
      </div>

      {/* ── Hidden measurement layer (static, non-interactive) ── */}
      <div ref={measureRef} aria-hidden="true" style={measureLayer}>
        {measureBlocks.map((node, i) => (
          <div key={i}>{node}</div>
        ))}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
// PageSheet / ReportPages / FooterLogo / SectionBar now live in ../report/pageFrame.

const tbBtn = {
  padding: '6px 12px',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.2)',
  background: 'rgba(255,255,255,0.08)',
  color: '#fff',
  fontSize: 13,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
