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

import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { displayPhase, shortVcpLabel } from '@/utils/stageBoundaries';
import { supabase } from '@/lib/supabaseClient';

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

/** Inject a CDN script once (html2canvas / jsPDF) — mirrors the daily/InSAR flow. */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function loadPdfScripts() {
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
}

/** Human-readable file size (matches ReportTemplateModal). */
function formatFileSize(bytes) {
  const kb = (bytes / 1024).toFixed(2);
  const mb = (bytes / (1024 * 1024)).toFixed(2);
  return bytes > 1024 * 1024 ? `${mb} MB` : `${kb} KB`;
}

// ── Palette (inline hex so html2canvas reproduces print colours faithfully) ──
const NAVY = '#142850';
const DARK = '#0D3036';
const ACCENT = '#F78E1E';
const INK = '#1f2937';
const MUTED = '#6b7280';
const LINE = '#d1d5db';
const ZEBRA = '#f5f7f9';

// A4 @ 96dpi
const PAGE_W = 794;
const PAGE_H = 1123;
const PAD_X = 34;
const PAD_TOP = 28;
const FOOTER_RESERVE = 64;          // space kept at the bottom for the footer
const BLOCK_GAP = 10;               // vertical gap between stacked blocks
const CONTENT_W = PAGE_W - PAD_X * 2;
const USABLE_H = PAGE_H - PAD_TOP - FOOTER_RESERVE;
const PIT_MAX_H = 560;              // cap so the pit block always fits one page
const ROWS_PER_CHUNK = 12;          // stage-table rows per page slice

const DEFAULT_BOUNDARY_COLOR = '#FF1744';
const FALLBACK_LOGO = '/logo/DTG/DTGlogo.png';

/** Latest deformation stage → TARP level (per spec). Keyed on raw phase. */
const PHASE_TO_TARP = {
  'No Significant Movement': 'TARP 1',
  Regressive: 'TARP 2',
  Linear: 'TARP 3',
  'Progressive Failure': 'TARP 4',
};

/** Short labels for deformation events shown in the transition sequence. */
const EVENT_LABEL = {
  'Blast Event': 'Blast',
  'Rock Fall': 'Rock Fall',
  'Material Detachment': 'Material Detachment',
  Failure: 'Failure',
};

/** Stage band colours — mirror ResultsArea.PHASE_COLORS. */
const PHASE_COLOR = {
  'No Significant Movement': '#00B050',
  Linear: '#E97132',
  'Progressive Failure': '#FF0000',
  Regressive: '#FFFF00',
  Unclassified: '#9E9E9E',
};

// SSR-safe layout effect.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

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

/** Re-theme a PR Plotly figure for a white printed page. */
function printFigure(chartJson) {
  const data = (chartJson.data ?? []).map((t) => {
    const c = t?.line?.color;
    if (typeof c === 'string' && (c.toUpperCase() === '#FFFFFF' || c.toLowerCase() === '#fff')) {
      return { ...t, line: { ...t.line, color: INK } };
    }
    return t;
  });
  const layout = { ...(chartJson.layout ?? {}) };
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

function centroid(points) {
  if (!points.length) return { x: 0, y: 0 };
  const sx = points.reduce((a, p) => a + p.x, 0);
  const sy = points.reduce((a, p) => a + p.y, 0);
  return { x: sx / points.length, y: sy / points.length };
}

/**
 * Fetch a same-origin image URL and return a data URL, so the export render has
 * the logo decoded and ready (avoids a blank logo if the network <img> hasn't
 * finished loading when html2canvas snapshots). Falls back to the URL on error.
 */
async function urlToDataUrl(url) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => resolve(url);
      reader.readAsDataURL(blob);
    });
  } catch {
    return url;
  }
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
}) {
  const measureRef = useRef(null);
  const imageRef = useRef(null);

  const [pitImage, setPitImage] = useState(null);
  const [chartImgs, setChartImgs] = useState([]); // [{ name, url }]
  const [chartLoading, setChartLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [pages, setPages] = useState(null);       // number[][] of block indices
  const [measureTick, setMeasureTick] = useState(0);

  const [summaryVcpIndex, setSummaryVcpIndex] = useState(0);

  const [boundaries, setBoundaries] = useState([]); // [{ points, color, label }]
  const [draft, setDraft] = useState(null);
  const [color, setColor] = useState(DEFAULT_BOUNDARY_COLOR);

  const bumpMeasure = useCallback(() => setMeasureTick((t) => t + 1), []);

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
    const list = (vcpResults || []).filter((v) => v?.combinedChartJson);
    if (list.length === 0) {
      setChartImgs([]);
      return undefined;
    }
    let cancelled = false;
    setChartLoading(true);
    (async () => {
      try {
        const Plotly = (await import('plotly.js-dist-min')).default;
        const imgs = await Promise.all(
          list.map(async (v, idx) => {
            const fig = printFigure(v.combinedChartJson);
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
  }, [isOpen, vcpResults]);

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
        label: EVENT_LABEL[b.type] ?? b.type ?? 'Blast',
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

  const failureTakeaway = useMemo(() => {
    const forecastIso =
      summaryVcp?.fukuzono?.predictedFailureTime ?? summaryVcp?.slo?.predictedFailureTime ?? null;
    const method = summaryVcp?.fukuzono?.predictedFailureTime
      ? 'Inverse Velocity (Fukuzono)'
      : summaryVcp?.slo?.predictedFailureTime
        ? 'Spline (SLO)'
        : null;
    const vcp = summaryVcp?.smoothingWindow != null ? `VCP ${summaryVcp.smoothingWindow}` : '';
    const phase = latestRawPhase;

    if (actualFailureTime) {
      const err = forecastIso
        ? (new Date(forecastIso).getTime() - new Date(actualFailureTime).getTime()) / 3_600_000
        : null;
      return `Actual failure occurred at ${fmtDateTime(actualFailureTime)}.${
        forecastIso
          ? ` Predicted failure (${method}, ${vcp}) was ${fmtDateTime(forecastIso)} — forecast error ${
              err >= 0 ? '+' : ''
            }${err.toFixed(1)} h.`
          : ''
      }`;
    }
    if (phase === 'Progressive Failure') {
      return forecastIso
        ? `Estimated failure time: ${fmtDateTime(forecastIso)} (method: ${method}, ${vcp}).`
        : `Slope is in progressive failure; no forecast time could be computed for the selected VCP.`;
    }
    if (phase === 'Regressive' || phase === 'No Significant Movement') {
      // Settling measured from the blast to the start of the No Significant
      // trend, when a preceding blast exists (issue 2).
      if (settlingInfo) {
        return `Slope is ${displayPhase(phase, pfConfirmed).toLowerCase()}; settled ${settlingInfo.duration} after the blast (${fmtDateTime(
          settlingInfo.blastTimeStr
        )} → ${fmtDateTime(settlingInfo.settledTimeStr)}). No failure time is projected.`;
      }
      const dur = lastWindow?.duration ? ` over the last ${lastWindow.duration}` : '';
      return `Slope is ${displayPhase(phase, pfConfirmed).toLowerCase()}; estimated to be settling${dur}. No failure time is projected.`;
    }
    const dur = lastWindow?.duration ? lastWindow.duration : 'the monitored period';
    return `Slope remains in a linear deformation stage for the last ${dur}. Continue monitoring for any transition to progressive failure.`;
  }, [summaryVcp, actualFailureTime, lastWindow, latestRawPhase, pfConfirmed, settlingInfo]);

  // ── Pit image handlers ─────────────────────────────────────────────────────
  const readImageFile = useCallback((file) => {
    if (!file || !file.type?.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => setPitImage(e.target.result);
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      readImageFile(e.dataTransfer?.files?.[0]);
    },
    [readImageFile]
  );

  // ── Boundary drawing ───────────────────────────────────────────────────────
  const handleImageClick = useCallback(
    (e) => {
      if (!draft || !imageRef.current) return;
      const rect = imageRef.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      setDraft((d) => ({ ...d, points: [...d.points, { x, y }] }));
    },
    [draft]
  );

  const startDraft = () => setDraft({ points: [], color });
  const undoPoint = () => setDraft((d) => (d ? { ...d, points: d.points.slice(0, -1) } : d));
  const finishDraft = () => {
    setDraft((d) => {
      if (d && d.points.length >= 2) {
        setBoundaries((b) => [
          ...b,
          { points: d.points, color: d.color, label: `Zone ${String.fromCharCode(65 + b.length)}` },
        ]);
      }
      return null;
    });
  };
  const clearBoundaries = () => {
    setBoundaries([]);
    setDraft(null);
  };
  const updateLabel = (idx, label) =>
    setBoundaries((b) => b.map((bd, i) => (i === idx ? { ...bd, label } : bd)));

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
  // Plain-text mirror of the on-page Summary section, for the email body.
  const summaryText = useMemo(
    () =>
      [
        `Current risk status: ${tarp} — slope classified as ${latestPhase}.`,
        `Slope behaviour transition: ${transitions.length ? transitions.join(' -> ') : 'No staged behaviour detected.'}`,
        `Outlook: ${failureTakeaway}`,
      ].join('\n'),
    [tarp, latestPhase, transitions, failureTakeaway]
  );

  const emailSubject = `${analysisTitle} Report of ${meta.radarNumber || 'Sensor'} period of ${fmtLongDate(new Date())}`;
  const emailBody = [
    `SENSOR: ${meta.radarNumber || '—'} - ${meta.siteName || '—'}`,
    ...(meta.blastId ? [`BLAST ID: ${meta.blastId}`] : []),
    '',
    'SUMMARY:',
    summaryText,
    '',
    `The report can also be accessed from this link (${DASHBOARD_URL})`,
    '',
    'Kind regards,',
    meta.author || '',
  ].join('\n');

  // Local download via the browser's NATIVE print engine (render the pages into a
  // hidden iframe and print it). The browser rasterizes text itself — vector,
  // selectable and perfectly aligned — which html2canvas can't do reliably at
  // small sizes. The user picks "Save as PDF" in the print dialog.
  const printLocal = async () => {
    if (!effectivePages || effectivePages.length === 0) return;
    let iframe = null;
    let root = null;
    try {
      const { createRoot } = await import('react-dom/client');
      const logoDataUrl = await urlToDataUrl(headerLogo);
      const exportBlocks = buildBlocks(false, logoDataUrl);

      iframe = document.createElement('iframe');
      iframe.setAttribute('aria-hidden', 'true');
      Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
      document.body.appendChild(iframe);

      const doc = iframe.contentDocument;
      doc.open();
      doc.write(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${effectiveTitle}</title><style>` +
          '@page { size: A4; margin: 0; }' +
          '* { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }' +
          'html, body { margin: 0; padding: 0; background: #fff; }' +
          // Height a hair under the A4 printable area so the forced break never
          // spills 1px onto an extra blank page.
          '.pbr-page { box-shadow: none !important; height: 1120px !important; page-break-after: always; break-after: page; overflow: hidden; }' +
          '.pbr-page:last-child { page-break-after: auto; break-after: auto; }' +
          '</style></head><body><div id="pbr-root"></div></body></html>'
      );
      doc.close();
      // Explicitly set the frame's title — the print dialog suggests the saved
      // PDF filename from the document title (issue: filename was blank).
      doc.title = effectiveTitle;

      root = createRoot(doc.getElementById('pbr-root'));
      root.render(
        <>
          {effectivePages.map((idxs, i) => (
            <PageSheet key={i} blocks={exportBlocks} idxs={idxs} pageNum={i + 1} total={effectivePages.length} />
          ))}
        </>
      );

      // Wait for layout + all (data-URL) images.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const imgEls = Array.from(doc.querySelectorAll('img'));
      await Promise.all(
        imgEls.map((im) =>
          im.complete ? Promise.resolve() : new Promise((res) => { im.onload = res; im.onerror = res; })
        )
      );
      await new Promise((r) => setTimeout(r, 120));

      const win = iframe.contentWindow;
      // Chromium derives the "Save as PDF" filename from the *top* document's
      // title when printing a same-origin iframe — temporarily swap it so the
      // dialog pre-fills our report name, then restore it after printing.
      const prevDocTitle = document.title;
      document.title = effectiveTitle;
      let titleRestored = false;
      const restoreTitle = () => {
        if (!titleRestored) {
          document.title = prevDocTitle;
          titleRestored = true;
        }
      };
      const cleanup = () => {
        restoreTitle();
        try { if (root) root.unmount(); } catch { /* ignore */ }
        if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
      };
      win.onafterprint = cleanup;
      win.focus();
      win.print();
      // Fallback cleanup if onafterprint never fires (some browsers).
      setTimeout(cleanup, 60000);
    } catch (err) {
      console.error('PDF print failed:', err);
      try { if (root) root.unmount(); } catch { /* ignore */ }
      if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }
  };

  // Render the export pages off-screen and rasterize them into a single PDF blob
  // (html2canvas → jsPDF), mirroring the daily/InSAR report export. Used for the
  // Supabase archive copy; the local download still uses the vector print path.
  const generatePdfBlob = async () => {
    const { createRoot } = await import('react-dom/client');
    const logoDataUrl = await urlToDataUrl(headerLogo);
    const exportBlocks = buildBlocks(false, logoDataUrl);

    const container = document.createElement('div');
    Object.assign(container.style, {
      position: 'absolute',
      left: '-100000px',
      top: '0',
      width: `${PAGE_W}px`,
      background: '#fff',
    });
    document.body.appendChild(container);

    const root = createRoot(container);
    root.render(
      <>
        {effectivePages.map((idxs, i) => (
          <PageSheet key={i} blocks={exportBlocks} idxs={idxs} pageNum={i + 1} total={effectivePages.length} />
        ))}
      </>
    );

    try {
      // Wait for layout + all (data-URL / network) images to settle.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const imgEls = Array.from(container.querySelectorAll('img'));
      await Promise.all(
        imgEls.map((im) =>
          im.complete ? Promise.resolve() : new Promise((res) => { im.onload = res; im.onerror = res; })
        )
      );
      await new Promise((r) => setTimeout(r, 200));

      await loadPdfScripts();
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
      const mmW = pdf.internal.pageSize.getWidth();
      const mmH = pdf.internal.pageSize.getHeight();

      const pageEls = Array.from(container.querySelectorAll('.pbr-page'));
      for (let i = 0; i < pageEls.length; i++) {
        const canvas = await window.html2canvas(pageEls[i], {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
          logging: false,
        });
        const imgData = canvas.toDataURL('image/jpeg', 0.92);
        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, 0, mmW, mmH);
      }

      return pdf.output('blob');
    } finally {
      try { root.unmount(); } catch { /* ignore */ }
      if (container.parentNode) container.parentNode.removeChild(container);
    }
  };

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

      // Pre-filled Outlook draft.
      openOutlookDraft(emailSubject, emailBody);

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
      <div
        onDragOver={interactive ? (e) => e.preventDefault() : undefined}
        onDrop={interactive ? handleDrop : undefined}
        style={{
          position: 'relative',
          width: '100%',
          minHeight: pitImage ? undefined : 170,
          border: pitImage ? `1px solid ${LINE}` : `2px dashed ${LINE}`,
          borderRadius: 4,
          background: '#fafbfc',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {pitImage ? (
          <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', lineHeight: 0 }}>
            <img
              ref={interactive ? imageRef : undefined}
              src={pitImage}
              alt="Pit wall"
              onClick={interactive ? handleImageClick : undefined}
              onLoad={bumpMeasure}
              crossOrigin="anonymous"
              style={{ display: 'block', maxWidth: '100%', maxHeight: PIT_MAX_H, width: 'auto', height: 'auto', cursor: interactive && draft ? 'crosshair' : 'default' }}
            />
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
              {boundaries.map((b, i) => (
                <polygon key={i} points={b.points.map((p) => `${p.x},${p.y}`).join(' ')} fill={`${b.color}33`} stroke={b.color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
              ))}
              {interactive && draft && draft.points.length > 0 && (
                <polyline points={draft.points.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={draft.color} strokeWidth={2} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
              )}
            </svg>
            {boundaries.map((b, i) => {
              const c = centroid(b.points);
              return (
                <span key={i} style={{ position: 'absolute', left: `${c.x}%`, top: `${c.y}%`, transform: 'translate(-50%, -50%)', background: b.color, color: '#fff', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, whiteSpace: 'nowrap', pointerEvents: 'none' }}>
                  {b.label}
                </span>
              );
            })}
          </div>
        ) : (
          <div style={{ textAlign: 'center', color: MUTED, fontSize: 12, padding: 20 }}>
            <div style={{ fontSize: 26, marginBottom: 4 }}>⛰</div>
            Drag &amp; drop the pit-wall photograph here, or use “Upload pit image”.
          </div>
        )}
      </div>
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

  // ── Measure block heights → paginate ───────────────────────────────────────
  useIsoLayoutEffect(() => {
    if (!isOpen || !measureRef.current) return;
    const children = Array.from(measureRef.current.children);
    const heights = children.map((c) => c.getBoundingClientRect().height);
    const result = [];
    let cur = [];
    let h = 0;
    heights.forEach((ht, i) => {
      const need = ht + (cur.length ? BLOCK_GAP : 0);
      if (cur.length && h + need > USABLE_H) {
        result.push(cur);
        cur = [];
        h = 0;
      }
      cur.push(i);
      h += ht + (cur.length > 1 ? BLOCK_GAP : 0);
    });
    if (cur.length) result.push(cur);
    setPages(result.length ? result : [heights.map((_, i) => i)]);
  }, [isOpen, pitImage, chartImgs, boundaries, stageRows, latestPhase, failureTakeaway, transitions, measureTick, summaryVcpIndex]);

  if (!isOpen) return null;

  const effectivePages = pages ?? [displayBlocks.map((_, i) => i)];

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
      <div
        ref={measureRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: -100000,
          top: 0,
          width: CONTENT_W,
          boxSizing: 'border-box',
          fontFamily: 'Arial, Helvetica, sans-serif',
          color: INK,
          visibility: 'hidden',
          pointerEvents: 'none',
        }}
      >
        {measureBlocks.map((node, i) => (
          <div key={i}>{node}</div>
        ))}
      </div>
    </div>
  );
}

// ── Sub-components / styles ───────────────────────────────────────────────────

function SectionBar({ title }) {
  return (
    <div style={{ background: DARK, color: '#fff', padding: '6px 12px', fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
      {title}
    </div>
  );
}

/**
 * A single A4 page sheet. `flexShrink: 0` keeps it at full height inside the
 * preview's flex column (otherwise flexbox squishes it and the footer rides up).
 * Block spacing uses margins, not flex `gap`, because html2canvas 1.x ignores
 * flex gap — margins keep the preview and the exported PDF identical.
 */
function PageSheet({ blocks, idxs, pageNum, total }) {
  return (
    <div
      className="pbr-page"
      style={{
        position: 'relative',
        flexShrink: 0,
        width: PAGE_W,
        height: PAGE_H,
        background: '#fff',
        color: INK,
        boxShadow: '0 0 0 1px rgba(0,0,0,0.12), 0 8px 30px rgba(0,0,0,0.35)',
        fontFamily: 'Arial, Helvetica, sans-serif',
        // Explicit line-height keeps html2canvas from placing text low in a
        // tall `normal` line box (the source of the baseline shift).
        lineHeight: 1.25,
        padding: `${PAD_TOP}px ${PAD_X}px`,
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      <div>
        {idxs.map((bi, j) => (
          <div key={bi} style={{ marginBottom: j < idxs.length - 1 ? BLOCK_GAP : 0 }}>
            {blocks[bi]}
          </div>
        ))}
      </div>

      {/* Footer (per page) */}
      <div style={{ position: 'absolute', left: PAD_X, right: PAD_X, bottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: `1px solid ${LINE}`, paddingTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <FooterLogo />
          <span style={{ fontSize: 10, color: MUTED }}>Advanced Geotechnical Data Analytics. Powered by DTG Focus</span>
        </div>
        <span style={{ fontSize: 10, color: MUTED }}>Page {pageNum} of {total}</span>
      </div>
    </div>
  );
}

/** The stacked A4 page sheets for the on-screen preview. */
function ReportPages({ blocks, pages }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
      {pages.map((idxs, pageIdx) => (
        <PageSheet key={pageIdx} blocks={blocks} idxs={idxs} pageNum={pageIdx + 1} total={pages.length} />
      ))}
    </div>
  );
}

/** Grey, background-free DTG Focus mark for the footer (req 3). */
function FooterLogo() {
  const c = MUTED;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <svg width="24" height="24" viewBox="0 0 140 140" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M70 20L88 30V50L70 60L52 50V30L70 20Z" stroke={c} strokeWidth="3" />
        <path d="M38 55L56 65V85L38 95L20 85V65L38 55Z" stroke={c} strokeWidth="3" />
        <path d="M102 55L120 65V85L102 95L84 85V65L102 55Z" stroke={c} strokeWidth="3" />
        <path d="M70 90L88 100V120L70 130L52 120V100L70 90Z" fill={c} fillOpacity="0.7" />
      </svg>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 3, color: c }}>
        <span style={{ fontWeight: 900, fontSize: 13, letterSpacing: '-0.02em' }}>DTG</span>
        <span style={{ fontWeight: 300, fontSize: 13 }}>Focus</span>
        <span style={{ fontWeight: 700, fontSize: 8, opacity: 0.7 }}>TM</span>
      </span>
    </div>
  );
}

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
