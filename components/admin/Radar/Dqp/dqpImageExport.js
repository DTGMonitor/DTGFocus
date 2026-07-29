'use client';

/**
 * Single-image (PNG) export of the DQP quality table.
 *
 * The on-screen table is dark-themed, interactive, and painted entirely with
 * CSS custom properties — none of which html2canvas 1.4.1 resolves. So instead
 * of snapshotting the live DOM this builds a throwaway light-themed copy
 * off-screen using inline hex only, rasterizes that, and discards it.
 *
 * Two deliberate differences from the on-screen table, both forced by
 * html2canvas 1.4.1:
 *   - the rotated vertical group column becomes a full-width group band
 *     (`writing-mode: vertical-rl` does not rasterize)
 *   - checkboxes become filled / outlined swatches, so no glyph is drawn and
 *     no font fallback can go missing
 *
 * The rest follows the house html2canvas rules used by the report exports:
 * inline hex only, `marginBottom` never flex `gap`, explicit `lineHeight`.
 */

import { loadScript, applyHtml2CanvasBaselineFix } from '@/components/admin/Radar/report/pdfExport';

const HTML2CANVAS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';

const STATUSES = ['Optimal', 'Acceptable', 'Sub-Optimal', 'Critical'];

const STATUS_STYLE = {
  Optimal: { solid: '#16a34a', tint: '#dcfce7', text: '#15803d' },
  Acceptable: { solid: '#eab308', tint: '#fef9c3', text: '#a16207' },
  'Sub-Optimal': { solid: '#f97316', tint: '#ffedd5', text: '#c2410c' },
  Critical: { solid: '#dc2626', tint: '#fee2e2', text: '#b91c1c' },
};
const NEUTRAL = { solid: '#9ca3af', tint: '#f3f4f6', text: '#4b5563' };

const FONT = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
const CARD_W = 1100;
const BORDER = '#e5e7eb';
const BORDER_STRONG = '#d1d5db';
const INK = '#111827';
const INK_SOFT = '#4b5563';

/** Alarm children are the only rows allowed to sit at N/A. */
const ALARMS_PARENT_ID = 6;

const statusStyle = (value) => STATUS_STYLE[value] || NEUTRAL;

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const isRowInvalid = (item) => item.parameter?.parent_id !== ALARMS_PARENT_ID && item.value === 'N/A';

/** A 15px swatch: filled when selected, outlined when available, muted when the parameter cannot take that status. */
function swatch(state, solid) {
  const base = 'display:inline-block;width:15px;height:15px;border-radius:3px;line-height:15px;';
  if (state === 'on') return `<span style="${base}background:${solid};border:1px solid ${solid}"></span>`;
  if (state === 'off') return `<span style="${base}background:#ffffff;border:1px solid ${BORDER_STRONG}"></span>`;
  return `<span style="${base}background:#f9fafb;border:1px solid #f3f4f6"></span>`;
}

function headerHtml(title, subtitle, generatedAt) {
  return (
    `<div style="margin-bottom:18px">` +
      `<table style="width:100%;border-collapse:collapse"><tr>` +
        `<td style="vertical-align:bottom;padding:0">` +
          `<div style="font-size:20px;font-weight:700;color:${INK};line-height:1.25">${esc(title)}</div>` +
          (subtitle
            ? `<div style="font-size:13px;color:${INK_SOFT};line-height:1.4;margin-top:3px">${esc(subtitle)}</div>`
            : '') +
        `</td>` +
        `<td style="vertical-align:bottom;text-align:right;padding:0;font-size:11px;color:#6b7280;line-height:1.4">` +
          `Generated ${esc(generatedAt)}` +
        `</td>` +
      `</tr></table>` +
      `<div style="height:3px;background:#14b8a6;margin-top:10px"></div>` +
    `</div>`
  );
}

function legendHtml() {
  const items = STATUSES.map((s) => {
    const { solid } = statusStyle(s);
    return (
      `<span style="display:inline-block;margin-right:18px;font-size:11px;color:${INK_SOFT};line-height:15px">` +
        `${swatch('on', solid)}<span style="display:inline-block;margin-left:6px;vertical-align:top">${esc(s)}</span>` +
      `</span>`
    );
  }).join('');

  return (
    `<div style="margin-top:14px;padding-top:10px;border-top:1px solid ${BORDER}">` +
      items +
      `<span style="display:inline-block;font-size:11px;color:${INK_SOFT};line-height:15px">` +
        `${swatch('na', '')}<span style="display:inline-block;margin-left:6px;vertical-align:top">Not applicable</span>` +
      `</span>` +
    `</div>`
  );
}

function tableHtml(groups, parameterConfig) {
  const th = `padding:8px 10px;font-size:11px;font-weight:700;color:${INK_SOFT};background:#f9fafb;`;

  let html =
    `<table style="width:100%;border-collapse:collapse;table-layout:fixed;border:1px solid ${BORDER_STRONG}">` +
    `<colgroup>` +
      `<col style="width:280px"><col style="width:92px"><col style="width:92px">` +
      `<col style="width:92px"><col style="width:92px"><col>` +
    `</colgroup>` +
    `<thead><tr>` +
      `<th rowspan="2" style="${th}text-align:left;border-right:1px solid ${BORDER_STRONG};border-bottom:1px solid ${BORDER_STRONG}">Parameter</th>` +
      `<th colspan="4" style="${th}text-align:center;border-bottom:1px solid ${BORDER}">Status</th>` +
      `<th rowspan="2" style="${th}text-align:left;border-left:1px solid ${BORDER_STRONG};border-bottom:1px solid ${BORDER_STRONG}">Notes</th>` +
    `</tr><tr>`;

  STATUSES.forEach((s, i) => {
    const { text } = statusStyle(s);
    html +=
      `<th style="${th}text-align:center;color:${text};border-bottom:1px solid ${BORDER_STRONG};` +
      `${i < 3 ? `border-right:1px solid ${BORDER};` : ''}">${esc(s)}</th>`;
  });

  html += `</tr></thead><tbody>`;

  groups.forEach((group) => {
    const band = statusStyle(group.status);
    html +=
      `<tr>` +
        `<td colspan="2" style="background:${band.tint};color:${band.text};font-size:11px;font-weight:700;` +
        `letter-spacing:0.08em;text-transform:uppercase;padding:7px 10px;line-height:1.3;` +
        `border-top:1px solid ${BORDER_STRONG};border-bottom:1px solid ${BORDER_STRONG}">${esc(group.name)}</td>` +
        `<td colspan="4" style="background:${band.tint};color:${band.text};font-size:11px;font-weight:600;` +
        `text-align:right;padding:7px 10px;line-height:1.3;` +
        `border-top:1px solid ${BORDER_STRONG};border-bottom:1px solid ${BORDER_STRONG}">${esc(group.status || 'N/A')}</td>` +
      `</tr>`;

    group.items.forEach((item) => {
      const invalid = isRowInvalid(item);
      const rowBg = invalid ? '#fef2f2' : '#ffffff';
      const cell = `padding:8px 10px;font-size:12px;line-height:1.4;border-bottom:1px solid ${BORDER};background:${rowBg};`;
      const allowed = parameterConfig?.[item.parameter?.name];

      html +=
        `<tr>` +
        `<td style="${cell}color:${invalid ? '#b91c1c' : INK};font-weight:500;border-right:1px solid ${BORDER}">` +
          `${esc(item.parameter?.name)}</td>`;

      STATUSES.forEach((s, i) => {
        const isAllowed = allowed ? allowed.includes(s) : true;
        const state = !isAllowed ? 'na' : item.value === s ? 'on' : 'off';
        html +=
          `<td style="${cell}text-align:center;${i < 3 ? `border-right:1px solid ${BORDER};` : ''}">` +
          `${swatch(state, statusStyle(s).solid)}</td>`;
      });

      // The badge counts the figures rather than just flagging their presence —
      // a row with three attachments must not read the same as a row with one.
      const imageCount = item.images?.length ?? 0;
      const attachment = imageCount
        ? `<span style="display:inline-block;margin-left:6px;padding:1px 5px;border-radius:3px;background:#e0f2fe;` +
          `color:#0369a1;font-size:10px;font-weight:600;line-height:1.4">` +
          `${imageCount > 1 ? `${imageCount} IMG` : 'IMG'}</span>`
        : '';

      html +=
        `<td style="${cell}color:${INK_SOFT};border-left:1px solid ${BORDER};word-wrap:break-word">` +
          `${esc(item.notes || '')}${attachment}</td>` +
        `</tr>`;
    });
  });

  return `${html}</tbody></table>`;
}

/** The complete card. Returned as a string so the caller mounts it in one write. */
export function buildDqpCardHtml({ groups, title, subtitle, generatedAt, parameterConfig }) {
  return (
    `<div style="width:${CARD_W}px;box-sizing:border-box;padding:28px 32px;background:#ffffff;` +
    `font-family:${FONT};color:${INK}">` +
      headerHtml(title, subtitle, generatedAt) +
      tableHtml(groups, parameterConfig) +
      legendHtml() +
    `</div>`
  );
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick — Safari cancels the download if the URL dies first.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const slug = (v) =>
  String(v || 'data-quality')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'data-quality';

/**
 * Rasterize the light-themed copy of `groups` and download it as one PNG.
 *
 * @param {Array}  groups           Grouped rows, as built by QualityTable.
 * @param {string} title            Card heading.
 * @param {string} subtitle         Sub-heading (radar / site).
 * @param {object} parameterConfig  PARAMETER_CONFIG — which statuses each row can take.
 * @param {string} [filename]       Overrides the derived filename.
 */
export async function exportDqpTableImage({ groups, title, subtitle, parameterConfig, filename }) {
  if (!groups || groups.length === 0) throw new Error('There is no data quality data to export.');

  const now = new Date();
  const generatedAt = now.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, {
    position: 'fixed', left: '-100000px', top: '0', zIndex: '-1', background: '#ffffff',
  });
  host.innerHTML = buildDqpCardHtml({ groups, title, subtitle, generatedAt, parameterConfig });
  document.body.appendChild(host);

  const undoBaselineFix = applyHtml2CanvasBaselineFix();
  try {
    await loadScript(HTML2CANVAS_SRC);
    if (document.fonts?.ready) await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const canvas = await window.html2canvas(host.firstElementChild, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
    });

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('The image could not be encoded.');

    const date = now.toISOString().slice(0, 10);
    triggerDownload(blob, filename || `data-quality-${slug(subtitle || title)}-${date}.png`);
  } finally {
    undoBaselineFix();
    if (host.parentNode) host.parentNode.removeChild(host);
  }
}
