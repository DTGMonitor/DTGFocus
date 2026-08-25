/**
 * tarpXlsx.js — export a TARP document as `DTG Radar TARP - <Company>_DDMMYYYY.xlsx`.
 *
 * Two sheets, mirroring the client workbooks this feature was modelled on:
 *   1. the trigger chart, colour-banded by risk rating
 *   2. "TARP History" — the DOCUMENT CONTROL audit trail
 *
 * `buildTarpVersionsWorkbook` writes the same two things for a whole chain: one
 * chart sheet per version, newest first, and a single audit trail merged across
 * them — what someone reviewing a past incident actually needs, since the chart
 * in force then is not the chart in force now.
 *
 * ExcelJS is loaded from its browser bundle via dynamic import, so the ~1 MB
 * library only reaches users who actually press Export.
 *
 * On an Indonesian site the workbook is written in Bahasa Indonesia
 * (`meta.locale`). The translation happens here, on the way out — the document
 * itself stays in the English the email engine matches on. See
 * config/tarpLocale.ts.
 */

import { resolveResponseRequirement } from '@/config/tarpDocument';
import {
  tarpStrings,
  translateDocumentText,
  translateNotice,
  translateResponseLabel,
  translateTriggerRow,
} from '@/config/tarpLocale';

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

const COLUMN_WIDTHS = [16, 22, 26, 40, 30, 30, 44, 26];

/**
 * Charts imported from a matrix-layout workbook carry a parameter axis
 * ("Pola Deformasi", "Koneksi Data"). It becomes a leading column so the site
 * gets back a workbook that reads the way theirs does — and is absent entirely
 * for the row-layout sites, whose export is unchanged.
 */
const PARAMETER_WIDTH = 24;

const THIN_BORDER = {
  top: { style: 'thin', color: { argb: 'FF808080' } },
  left: { style: 'thin', color: { argb: 'FF808080' } },
  bottom: { style: 'thin', color: { argb: 'FF808080' } },
  right: { style: 'thin', color: { argb: 'FF808080' } },
};

/**
 * DDMMYYYY, as used by the existing client workbooks.
 *
 * Accepts an ISO date string as well as a Date, and reads the string's own
 * digits rather than parsing it: `new Date('2026-07-22')` is UTC midnight, which
 * a site west of Greenwich would render as the 21st — the wrong day on a
 * controlled document.
 */
export const stampFor = (date = new Date()) => {
  if (typeof date === 'string') {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
    if (iso) return `${iso[3]}${iso[2]}${iso[1]}`;
  }
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}${mm}${date.getFullYear()}`;
};

/**
 * The date a version carries, for the file name — when it took effect, not when
 * somebody happened to press Export. Two people exporting v3 a month apart
 * should produce the same file.
 *
 * `effective_from` is what the tab prints and what `tarp_save_revision` stamps
 * on publish. A document created by import or clone may not have one, so the
 * newest revision's dates stand in, and today's date is the last resort.
 */
export const tarpDocumentDate = (doc) => {
  if (doc?.effectiveFrom) return doc.effectiveFrom;

  const latest = [...(doc?.revisions || [])].sort((a, b) => a.seq - b.seq).pop();
  return latest?.modifiedDate || latest?.approvalDate || new Date();
};

/** Excel forbids : \ / ? * [ ] in sheet names and caps them at 31 chars. */
const safeSheetName = (name, fallback) => {
  const cleaned = String(name || '').replace(/[:\\/?*[\]]/g, ' ').trim();
  return (cleaned || fallback).slice(0, 31);
};

/**
 * The single-version name. `date` is the version's own date — see
 * `tarpDocumentDate`. `version` is appended only for a SUPERSEDED version, so
 * the file a client is normally sent keeps exactly the name they already file it
 * under, and an archived one cannot be mistaken for the current chart.
 */
export const tarpFileName = (company, date = new Date(), version = null) =>
  `DTG Radar TARP - ${company || 'Site'}${version ? ` v${version}` : ''}_${stampFor(date)}.xlsx`;

/** The whole version history, one workbook, dated by its NEWEST version. */
export const tarpAllVersionsFileName = (company, date = new Date()) =>
  `DTG Radar TARP - ${company || 'Site'} All Versions_${stampFor(date)}.xlsx`;

const fillCell = (cell, argb) => {
  if (!argb) return;
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
  if (LIGHT_TEXT.has(argb)) {
    cell.font = { ...(cell.font || {}), color: { argb: 'FFFFFFFF' }, bold: true };
  }
};

/** ExcelJS only reaches users who actually press Export. */
const newWorkbook = async () => {
  const ExcelJS = (await import('exceljs/dist/exceljs.min.js')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'DTG FOCUS';
  return workbook;
};

/**
 * Writes one version's trigger chart onto a sheet of its own.
 *
 * Named rather than positional, because the every-version workbook puts several
 * of these side by side and the tab is the only thing telling them apart.
 *
 * @param {object} workbook  the ExcelJS workbook being built
 * @param {object} doc       normalised TARP document (config/tarpDocument.ts)
 * @param {object} meta      { company, siteName, locale }
 * @param {string} sheetName already sanitised by the caller
 */
function addChartSheet(workbook, doc, meta, sheetName) {
  const locale = meta.locale === 'id' ? 'id' : 'en';
  const t = tarpStrings(locale);

  const sheet = workbook.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 4 }] });

  // The parameter column only exists for charts that have one, so every other
  // site's workbook keeps exactly the layout its client already signs off.
  const hasParameter = doc.triggers.some((trigger) => trigger.parameter);
  const lead = hasParameter ? 1 : 0;
  const lastColumn = COLUMN_WIDTHS.length + lead;
  const pad = (cells) => (hasParameter ? cells : cells.slice(1));

  sheet.columns = [{ width: PARAMETER_WIDTH }, ...COLUMN_WIDTHS.map((width) => ({ width }))]
    .slice(hasParameter ? 0 : 1);

  const headingRow = sheet.addRow([doc.heading || meta.company || '']);
  headingRow.font = { bold: true, size: 14 };

  const titleRow = sheet.addRow([translateDocumentText(doc.title, locale)]);
  titleRow.font = { bold: true, size: 12 };

  const ownerRow = sheet.addRow(
    pad(['', '', '', '', '', translateDocumentText(doc.responseOwner, locale)])
  );
  ownerRow.font = { bold: true };
  ownerRow.alignment = { horizontal: 'center' };
  sheet.mergeCells(ownerRow.number, 5 + lead, ownerRow.number, lastColumn);

  const headerRow = sheet.addRow(pad([t.parameter, ...t.sheetHeaders]));
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  headerRow.eachCell((cell) => {
    cell.border = THIN_BORDER;
    fillCell(cell, 'FFD9D9D9');
  });

  const firstTriggerRow = headerRow.number + 1;

  doc.triggers.forEach((source) => {
    // A row that departs from the site's normal response is called out in the
    // Note column rather than in a new column, so the chart keeps the layout
    // clients already know while the deviation stays impossible to miss.
    //
    // Resolved from the ENGLISH row: `inferResponseMethod` reads the day-shift
    // cell for the words "call" / "email", which a translated cell no longer
    // contains.
    const response = resolveResponseRequirement(source, {
      defaultResponseMethod: doc.defaultResponseMethod || 'call',
    });
    const note = [
      response?.deviates
        ? `** ${translateResponseLabel(response.label, locale).toUpperCase()} — `
          + `${translateNotice(response.notice, locale)} **`
        : '',
      source.extraNote || '',
    ].filter(Boolean).join('\n\n');

    const trigger = translateTriggerRow(source, locale);

    const row = sheet.addRow(pad([
      source.parameter || '',
      trigger.riskRating || '',
      trigger.bandLabel || '',
      trigger.triggerLabel || '',
      trigger.description || '',
      trigger.dayShift || '',
      trigger.nightShift || '',
      (trigger.comments || []).join('\n'),
      note,
    ]));
    row.alignment = { vertical: 'top', wrapText: true };
    row.eachCell({ includeEmpty: true }, (cell) => { cell.border = THIN_BORDER; });

    // Both fills are keyed on the untranslated row: the colours are the band,
    // not the wording.
    fillCell(row.getCell(1 + lead), RISK_FILL[source.riskRating]);
    const bandFill = COLOUR_FILL[source.colour];
    fillCell(row.getCell(2 + lead), bandFill);
    fillCell(row.getCell(3 + lead), bandFill);

    if (response?.deviates) {
      fillCell(row.getCell(lastColumn), 'FFFFFF00');
      row.getCell(lastColumn).font = { bold: true };
    }
  });

  // Merge the risk-rating column down each contiguous band, as the chart prints it.
  let runStart = 0;
  for (let i = 1; i <= doc.triggers.length; i += 1) {
    const current = doc.triggers[i]?.riskRating ?? null;
    const previous = doc.triggers[runStart]?.riskRating ?? null;
    if (current !== previous || i === doc.triggers.length) {
      if (previous && i - runStart > 1) {
        sheet.mergeCells(
          firstTriggerRow + runStart, 1 + lead,
          firstTriggerRow + i - 1, 1 + lead
        );
      }
      runStart = i;
    }
  }

  // ── Footer blocks ─────────────────────────────────────────────────────────
  sheet.addRow([]);

  if (doc.footerNote) {
    const noteRow = sheet.addRow(pad(['', '', translateDocumentText(doc.footerNote, locale)]));
    noteRow.font = { bold: true };
    sheet.mergeCells(noteRow.number, 2 + lead, noteRow.number, lastColumn);
  }

  const escalation = doc.contacts.filter((c) => c.kind === 'escalation');
  if (escalation.length) {
    sheet.addRow([]);
    const label = sheet.addRow(pad(['', '', t.contacts]));
    label.font = { bold: true };
    escalation.forEach((contact) => {
      sheet.addRow(pad([
        '',
        '',
        [contact.role, contact.name].filter(Boolean).join(': '),
        '',
        '',
        contact.phone || '',
        contact.email || '',
      ]));
    });
  }

  if (doc.escalationNote) {
    const row = sheet.addRow(pad(['', '', translateDocumentText(doc.escalationNote, locale)]));
    sheet.mergeCells(row.number, 2 + lead, row.number, lastColumn);
    row.alignment = { wrapText: true };
  }

  // The distribution list is a single free-text block on the document, so it
  // round-trips to the workbook exactly as the engineer maintains it.
  if (doc.distributionRaw) {
    sheet.addRow([]);
    const label = sheet.addRow(pad(['', '', t.distributionList]));
    label.font = { bold: true };

    const row = sheet.addRow(pad(['', '', doc.distributionRaw]));
    sheet.mergeCells(row.number, 2 + lead, row.number, lastColumn);
    row.alignment = { wrapText: true, vertical: 'top' };
  }

  return sheet;
}

/**
 * The DOCUMENT CONTROL sheet.
 *
 * Takes the revision rows rather than the document, because the every-version
 * workbook prints ONE audit trail assembled from the whole chain — a version
 * created by import starts its own history, so the newest document's carried
 * -forward list is not always the superset.
 */
function addHistorySheet(workbook, revisions, meta = {}) {
  const locale = meta.locale === 'id' ? 'id' : 'en';
  const t = tarpStrings(locale);

  const history = workbook.addWorksheet(t.historySheet);
  history.columns = [
    { width: 6 }, { width: 26 }, { width: 11 }, { width: 15 }, { width: 22 },
    { width: 24 }, { width: 22 }, { width: 22 }, { width: 14 }, { width: 44 },
    { width: 52 },
  ];

  const controlRow = history.addRow([t.documentControl]);
  controlRow.font = { bold: true, size: 14 };
  history.mergeCells(controlRow.number, 1, controlRow.number, 11);
  history.addRow([]);

  const historyHeader = history.addRow(t.historyHeaders);
  historyHeader.font = { bold: true };
  historyHeader.alignment = { vertical: 'middle', wrapText: true };
  historyHeader.eachCell((cell) => {
    cell.border = THIN_BORDER;
    fillCell(cell, 'FFD9D9D9');
  });

  (revisions || []).forEach((revision) => {
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
      // The remark is the engineer's own summary of that revision, so it passes
      // through as written.
      translateDocumentText(revision.sectionsModified || '', locale),
      revision.remark || '',
    ]);
    row.alignment = { vertical: 'top', wrapText: true };
    row.eachCell({ includeEmpty: true }, (cell) => { cell.border = THIN_BORDER; });
  });

  return history;
}

/**
 * Builds the workbook for ONE version. Exported separately from the download so
 * it can be unit-tested without a DOM.
 *
 * @param {object} doc      normalised TARP document (config/tarpDocument.ts)
 * @param {object} meta     { company, siteName, locale }
 */
export async function buildTarpWorkbook(doc, meta = {}) {
  const workbook = await newWorkbook();
  addChartSheet(workbook, doc, meta, safeSheetName(meta.siteName || doc.heading, 'TARP'));
  addHistorySheet(workbook, doc.revisions, meta);
  return workbook;
}

/** "v3 (in force)" — the tab that tells two versions of the same chart apart. */
export const versionSheetName = (doc, locale = 'en') => {
  const status = tarpStrings(locale).versionStatus[doc.status];
  return safeSheetName(
    `v${doc.version}${status ? ` (${status})` : ''}`,
    `v${doc.version ?? '?'}`
  );
};

/**
 * Every revision the chain knows about, newest document first, de-duplicated.
 *
 * `tarp_save_revision` carries the history forward, so the same row appears on
 * every later version. It is keyed by (version, seq) — the pair that identifies
 * a revision across the chain — and the newest copy of a row wins, since that is
 * the wording the current document control sheet shows.
 */
const mergeRevisions = (docs) => {
  const seen = new Map();
  docs.forEach((doc) => {
    (doc.revisions || []).forEach((revision) => {
      const key = `${revision.versionNo ?? '-'}|${revision.seq}`;
      if (!seen.has(key)) seen.set(key, revision);
    });
  });
  return [...seen.values()].sort(
    (a, b) => (a.versionNo ?? 0) - (b.versionNo ?? 0) || a.seq - b.seq
  );
};

/**
 * Builds one workbook holding EVERY version of a site's TARP: a chart sheet per
 * version, newest first, then the combined DOCUMENT CONTROL trail.
 *
 * One file rather than one download per version, because a browser blocks the
 * second and later saves of a burst — and because what an auditor asks for is
 * the history as a single document.
 *
 * @param {object[]} docs  normalised documents, any order
 * @param {object}   meta  { company, siteName, locale }
 */
export async function buildTarpVersionsWorkbook(docs, meta = {}) {
  const ordered = [...(docs || [])].sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
  if (!ordered.length) throw new Error('No TARP versions to export.');

  const locale = meta.locale === 'id' ? 'id' : 'en';
  const workbook = await newWorkbook();

  ordered.forEach((doc) => {
    addChartSheet(workbook, doc, meta, versionSheetName(doc, locale));
  });
  addHistorySheet(workbook, mergeRevisions(ordered), meta);

  return workbook;
}

const saveWorkbook = async (workbook, fileName) => {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

/** Builds the workbook and triggers a browser download. */
export async function downloadTarpXlsx(doc, meta = {}) {
  const workbook = await buildTarpWorkbook(doc, meta);
  await saveWorkbook(
    workbook,
    tarpFileName(
      meta.company || meta.siteName,
      tarpDocumentDate(doc),
      // Only an archived version is stamped — see tarpFileName.
      doc.status === 'superseded' ? doc.version : null
    )
  );
}

/** Every version of a site's TARP, as one workbook. */
export async function downloadTarpAllVersionsXlsx(docs, meta = {}) {
  const workbook = await buildTarpVersionsWorkbook(docs, meta);
  const newest = [...docs].sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0];
  await saveWorkbook(
    workbook,
    tarpAllVersionsFileName(meta.company || meta.siteName, tarpDocumentDate(newest))
  );
}
