/**
 * tarpXlsx.js — export a TARP document as `DTG Radar TARP - <Company>_DDMMYYYY.xlsx`.
 *
 * Two sheets, mirroring the client workbooks this feature was modelled on:
 *   1. the trigger chart, colour-banded by risk rating
 *   2. "TARP History" — the DOCUMENT CONTROL audit trail
 *
 * ExcelJS is loaded from its browser bundle via dynamic import, so the ~1 MB
 * library only reaches users who actually press Export.
 */

import { resolveResponseRequirement } from '@/config/tarpDocument';

const RISK_FILL = {
  Extreme: 'FFFF0000',
  Moderate: 'FFFFC000',
  Intermediate: 'FFFFFF00',
};

const COLOUR_FILL = {
  red: 'FFFF0000',
  orange: 'FFFFC000',
  yellow: 'FFFFFF00',
  grey: 'FFBFBFBF',
  green: 'FF92D050',
};

/** White text reads better on the darker bands. */
const LIGHT_TEXT = new Set(['FFFF0000']);

const HEADERS = [
  'RISK RATING',
  'TARP Band',
  'Trigger',
  'Description',
  'Day Shift',
  'NightShift',
  'Comment',
  'Note',
];

const COLUMN_WIDTHS = [16, 22, 26, 40, 30, 30, 44, 26];

const THIN_BORDER = {
  top: { style: 'thin', color: { argb: 'FF808080' } },
  left: { style: 'thin', color: { argb: 'FF808080' } },
  bottom: { style: 'thin', color: { argb: 'FF808080' } },
  right: { style: 'thin', color: { argb: 'FF808080' } },
};

/** DDMMYYYY, as used by the existing client workbooks. */
export const stampFor = (date = new Date()) => {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}${mm}${date.getFullYear()}`;
};

/** Excel forbids : \ / ? * [ ] in sheet names and caps them at 31 chars. */
const safeSheetName = (name, fallback) => {
  const cleaned = String(name || '').replace(/[:\\/?*[\]]/g, ' ').trim();
  return (cleaned || fallback).slice(0, 31);
};

export const tarpFileName = (company, date = new Date()) =>
  `DTG Radar TARP - ${company || 'Site'}_${stampFor(date)}.xlsx`;

const fillCell = (cell, argb) => {
  if (!argb) return;
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
  if (LIGHT_TEXT.has(argb)) {
    cell.font = { ...(cell.font || {}), color: { argb: 'FFFFFFFF' }, bold: true };
  }
};

/**
 * Builds the workbook. Exported separately from the download so it can be
 * unit-tested without a DOM.
 *
 * @param {object} doc      normalised TARP document (config/tarpDocument.ts)
 * @param {object} meta     { company, siteName }
 */
export async function buildTarpWorkbook(doc, meta = {}) {
  const ExcelJS = (await import('exceljs/dist/exceljs.min.js')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'DTG FOCUS';

  // ── Sheet 1: the trigger chart ────────────────────────────────────────────
  const sheet = workbook.addWorksheet(
    safeSheetName(meta.siteName || doc.heading, 'TARP'),
    { views: [{ state: 'frozen', ySplit: 4 }] }
  );

  sheet.columns = COLUMN_WIDTHS.map((width) => ({ width }));

  const headingRow = sheet.addRow([doc.heading || meta.company || '']);
  headingRow.font = { bold: true, size: 14 };

  const titleRow = sheet.addRow([doc.title]);
  titleRow.font = { bold: true, size: 12 };

  const ownerRow = sheet.addRow(['', '', '', '', doc.responseOwner]);
  ownerRow.font = { bold: true };
  ownerRow.alignment = { horizontal: 'center' };
  sheet.mergeCells(ownerRow.number, 5, ownerRow.number, 8);

  const headerRow = sheet.addRow(HEADERS);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  headerRow.eachCell((cell) => {
    cell.border = THIN_BORDER;
    fillCell(cell, 'FFD9D9D9');
  });

  const firstTriggerRow = headerRow.number + 1;

  doc.triggers.forEach((trigger) => {
    // A row that departs from the site's normal response is called out in the
    // Note column rather than in a new column, so the chart keeps the layout
    // clients already know while the deviation stays impossible to miss.
    const response = resolveResponseRequirement(trigger, {
      defaultResponseMethod: doc.defaultResponseMethod || 'call',
    });
    const note = [
      response?.deviates ? `** ${response.label.toUpperCase()} — ${response.notice} **` : '',
      trigger.extraNote || '',
    ].filter(Boolean).join('\n\n');

    const row = sheet.addRow([
      trigger.riskRating || '',
      trigger.bandLabel || '',
      trigger.triggerLabel || '',
      trigger.description || '',
      trigger.dayShift || '',
      trigger.nightShift || '',
      (trigger.comments || []).join('\n'),
      note,
    ]);
    row.alignment = { vertical: 'top', wrapText: true };
    row.eachCell({ includeEmpty: true }, (cell) => { cell.border = THIN_BORDER; });

    fillCell(row.getCell(1), RISK_FILL[trigger.riskRating]);
    const bandFill = COLOUR_FILL[trigger.colour];
    fillCell(row.getCell(2), bandFill);
    fillCell(row.getCell(3), bandFill);

    if (response?.deviates) {
      fillCell(row.getCell(8), 'FFFFFF00');
      row.getCell(8).font = { bold: true };
    }
  });

  // Merge the risk-rating column down each contiguous band, as the chart prints it.
  let runStart = 0;
  for (let i = 1; i <= doc.triggers.length; i += 1) {
    const current = doc.triggers[i]?.riskRating ?? null;
    const previous = doc.triggers[runStart]?.riskRating ?? null;
    if (current !== previous || i === doc.triggers.length) {
      if (previous && i - runStart > 1) {
        sheet.mergeCells(firstTriggerRow + runStart, 1, firstTriggerRow + i - 1, 1);
      }
      runStart = i;
    }
  }

  // ── Footer blocks ─────────────────────────────────────────────────────────
  sheet.addRow([]);

  if (doc.footerNote) {
    const noteRow = sheet.addRow(['', doc.footerNote]);
    noteRow.font = { bold: true };
    sheet.mergeCells(noteRow.number, 2, noteRow.number, 8);
  }

  const escalation = doc.contacts.filter((c) => c.kind === 'escalation');
  if (escalation.length) {
    sheet.addRow([]);
    const label = sheet.addRow(['', 'Contacts']);
    label.font = { bold: true };
    escalation.forEach((contact) => {
      sheet.addRow([
        '',
        [contact.role, contact.name].filter(Boolean).join(': '),
        '',
        '',
        contact.phone || '',
        contact.email || '',
      ]);
    });
  }

  if (doc.escalationNote) {
    const row = sheet.addRow(['', doc.escalationNote]);
    sheet.mergeCells(row.number, 2, row.number, 8);
    row.alignment = { wrapText: true };
  }

  // The distribution list is a single free-text block on the document, so it
  // round-trips to the workbook exactly as the engineer maintains it.
  if (doc.distributionRaw) {
    sheet.addRow([]);
    const label = sheet.addRow(['', 'Email Distribution List']);
    label.font = { bold: true };

    const row = sheet.addRow(['', doc.distributionRaw]);
    sheet.mergeCells(row.number, 2, row.number, 8);
    row.alignment = { wrapText: true, vertical: 'top' };
  }

  // ── Sheet 2: DOCUMENT CONTROL ─────────────────────────────────────────────
  const history = workbook.addWorksheet('TARP History');
  history.columns = [
    { width: 6 }, { width: 26 }, { width: 11 }, { width: 15 }, { width: 22 },
    { width: 24 }, { width: 22 }, { width: 22 }, { width: 14 }, { width: 44 },
    { width: 52 },
  ];

  const controlRow = history.addRow(['DOCUMENT CONTROL']);
  controlRow.font = { bold: true, size: 14 };
  history.mergeCells(controlRow.number, 1, controlRow.number, 11);
  history.addRow([]);

  const historyHeader = history.addRow([
    'No.', 'Site Name', 'Version No.', 'Approval Date',
    'Approved / Modified by\nSite', 'Role',
    'Approved / Modified by DTG Engineer', 'Role', 'Modified Date',
    'Sections Modified and Summary of Changes', 'Remark',
  ]);
  historyHeader.font = { bold: true };
  historyHeader.alignment = { vertical: 'middle', wrapText: true };
  historyHeader.eachCell((cell) => {
    cell.border = THIN_BORDER;
    fillCell(cell, 'FFD9D9D9');
  });

  doc.revisions.forEach((revision) => {
    const row = history.addRow([
      revision.seq,
      revision.siteLabel || meta.siteName || '',
      revision.versionNo,
      revision.approvalDate || '',
      revision.approvedBySite || '',
      revision.siteRole || '',
      revision.approvedByDtg || '',
      revision.dtgRole || '',
      revision.modifiedDate || '',
      revision.sectionsModified || '',
      revision.remark || '',
    ]);
    row.alignment = { vertical: 'top', wrapText: true };
    row.eachCell({ includeEmpty: true }, (cell) => { cell.border = THIN_BORDER; });
  });

  return workbook;
}

/** Builds the workbook and triggers a browser download. */
export async function downloadTarpXlsx(doc, meta = {}) {
  const workbook = await buildTarpWorkbook(doc, meta);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = tarpFileName(meta.company || meta.siteName, new Date());
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
