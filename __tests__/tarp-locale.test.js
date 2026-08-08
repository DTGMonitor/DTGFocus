/**
 * Indonesian TARP charts.
 *
 * The contract these lock down: the TARP tab's chart and the .xlsx a client is
 * sent read in Bahasa Indonesia for an Indonesian site, while the document
 * itself — the rows the email engine matches on — stays in English.
 */

import {
  resolveTarpLocale,
  tarpStrings,
  translateBandLabel,
  translateComment,
  translateDescription,
  translateDocumentText,
  translateNotice,
  translateResponseLabel,
  translateRiskRating,
  translateShiftResponse,
  translateTriggerLabel,
  translateTriggerRow,
} from '../config/tarpLocale';
import { normalizeTarpDocument } from '../config/tarpDocument';
import { buildTarpWorkbook } from '../utils/tarpXlsx';

/** The DTG standard chart, as tarp_create_from_standard seeds it. */
const standardDoc = (overrides = {}) => normalizeTarpDocument({
  id: 11,
  site_id: 3,
  heading: 'PT Contoh Tambang',
  footer_note: 'ALL CALLS FROM REMOTE ENGINEER TO SITE ENGINEER MUST BE FOLLOWED BY AN EMAIL SUMMARY',
  default_response_method: 'call',
  triggers: [
    {
      id: 1, sort_order: 1, risk_rating: 'Extreme', band_label: 'TARP Trigger 4 (Red)',
      trigger_label: 'Progressive trend', colour: 'red',
      description: 'Progressive (accelerating) slope displacement trend is identified',
      day_shift: 'Call Geotech', night_shift: 'Call Geotech',
      comments: ['1. State area of concern', '2. Advise to respond as per site TARP'],
      def_type: 'Progressive', tarp_level: 4, requires_alarm: false, response_method: 'call',
    },
    {
      id: 2, sort_order: 2, risk_rating: 'Intermediate', band_label: 'TARP Trigger 2 (Yellow)',
      trigger_label: 'Regressive trend', colour: 'yellow',
      description: 'A regressive (decelerating) displacement trend is identified.',
      day_shift: 'Email Geotech', night_shift: 'Email Geotech',
      comments: ['1. Monitor as per TARP Trigger 2 procedures', '2. Record in daily log'],
      def_type: 'Regressive', tarp_level: 2, requires_alarm: false, response_method: 'email',
    },
  ],
  contacts: [
    { id: 1, kind: 'escalation', sort_order: 1, name: 'Budi Santoso', role: 'Geotech Engineer', phone: '0812' },
  ],
  revisions: [
    {
      id: 1, seq: 1, site_label: 'PT Contoh Tambang', version_no: 1,
      approval_date: '2026-08-01', sections_modified: 'All parts', remark: 'Seed',
    },
  ],
  ...overrides,
});

describe('resolveTarpLocale', () => {
  it('follows the site timezone, as the email drafts do', () => {
    expect(resolveTarpLocale({ site_name: 'Contoh' }, 'Asia/Makassar')).toBe('id');
    expect(resolveTarpLocale({ site_name: 'Contoh' }, 'Asia/Jakarta')).toBe('id');
    expect(resolveTarpLocale({ site_name: 'Leonora' }, 'Australia/Perth')).toBe('en');
  });

  it('reads an explicit locale off the site ahead of the zone', () => {
    expect(resolveTarpLocale({ email_locale: 'en' }, 'Asia/Jakarta')).toBe('en');
  });
});

describe('the dictionary', () => {
  it('leaves an English chart byte-for-byte alone', () => {
    expect(translateTriggerLabel('Progressive trend', 'en')).toBe('Progressive trend');
    expect(translateRiskRating('Extreme', 'en')).toBe('Extreme');
    expect(translateComment('1. State area of concern', 'en')).toBe('1. State area of concern');
  });

  it('translates the standard chart wording', () => {
    expect(translateRiskRating('Extreme', 'id')).toBe('Ekstrem');
    expect(translateTriggerLabel('Red Alarm', 'id')).toBe('Alarm Merah');
    expect(translateShiftResponse('Call Geotech', 'id')).toBe('Telepon Geotech');
    expect(translateResponseLabel('Email only', 'id')).toBe('Email saja');
    expect(translateNotice('Email only — do NOT call.', 'id'))
      .toBe('Email saja — JANGAN menelepon.');
  });

  it('calls a trend a "pola", not a "tren"', () => {
    expect(translateTriggerLabel('Progressive trend', 'id')).toBe('Pola Progresif');
    expect(translateTriggerLabel('Linear trend', 'id')).toBe('Pola Linear');
    expect(translateTriggerLabel('Regressive trend', 'id')).toBe('Pola Regresif');
    expect(translateDescription('A regressive (decelerating) displacement trend is identified', 'id'))
      .toContain('pola perpindahan regresif');
    expect(translateComment('2. Monitor closely for any change in deformation trend', 'id'))
      .toContain('pola deformasi');
  });

  it('says "Offline Terjadwal", never "Pemeliharaan"', () => {
    expect(translateTriggerLabel('Scheduled Offline', 'id')).toBe('Offline Terjadwal');
    expect(translateTriggerLabel('Scheduled Radar Offline', 'id')).toBe('Radar Offline Terjadwal');
  });

  it('keeps the TARP number in a band label and translates only the colour', () => {
    expect(translateBandLabel('TARP Trigger 4 (Red)', 'id')).toBe('TARP Trigger 4 (Merah)');
    expect(translateBandLabel('TARP Trigger 3 - Orange', 'id')).toBe('TARP Trigger 3 - Oranye');
  });

  it('matches a sentence with or without its final full stop', () => {
    expect(translateDescription('A genuine Red Alarm is triggered.', 'id'))
      .toBe('Terjadi Alarm Merah yang genuine.');
    expect(translateDescription('A genuine Red Alarm is triggered', 'id'))
      .toBe('Terjadi Alarm Merah yang genuine');
  });

  it('keeps a comment’s step number where it was', () => {
    expect(translateComment('3. Conduct velocity analysis', 'id'))
      .toBe('3. Lakukan analisis velocity');
    expect(translateComment('2) Record in daily log', 'id'))
      .toBe('2) Catat dalam daily log');
  });

  it('passes a client’s own wording through untouched', () => {
    const siteSpecific = 'Call Supervisor and Mine Manager and email off-site Geotechs.';
    expect(translateShiftResponse(siteSpecific, 'id')).toBe(siteSpecific);
    expect(translateComment('7. Telepon pengawas tambang', 'id')).toBe('7. Telepon pengawas tambang');
    expect(translateTriggerLabel('Zona Merah Pit Utara', 'id')).toBe('Zona Merah Pit Utara');
  });

  it('translates the document-level prose', () => {
    expect(translateDocumentText('Radar - Trigger Action Response Plan Chart', 'id'))
      .toBe('Radar - Bagan Trigger Action Response Plan');
    expect(translateDocumentText(
      'ALL CALLS FROM REMOTE ENGINEER TO SITE ENGINEER MUST BE FOLLOWED BY AN EMAIL SUMMARY', 'id'
    )).toContain('WAJIB DITINDAKLANJUTI');
  });
});

describe('translateTriggerRow', () => {
  const source = standardDoc().triggers[0];

  it('returns the row untouched in English', () => {
    expect(translateTriggerRow(source, 'en')).toBe(source);
  });

  it('does not mutate the row the email engine reads', () => {
    const translated = translateTriggerRow(source, 'id');
    expect(translated).not.toBe(source);
    expect(source.triggerLabel).toBe('Progressive trend');
    expect(source.comments).toEqual(['1. State area of concern', '2. Advise to respond as per site TARP']);
    expect(translated.triggerLabel).toBe('Pola Progresif');
    expect(translated.comments[0]).toBe('1. Sampaikan area yang menjadi perhatian');
  });

  it('leaves the engine columns alone', () => {
    const translated = translateTriggerRow(source, 'id');
    expect(translated.defType).toBe('Progressive');
    expect(translated.tarpLevel).toBe(4);
    expect(translated.colour).toBe('red');
  });
});

describe('the workbook', () => {
  it('writes the chart in Bahasa Indonesia', async () => {
    const wb = await buildTarpWorkbook(standardDoc(), { siteName: 'Contoh', locale: 'id' });
    const sheet = wb.getWorksheet('Contoh');

    expect(sheet.getRow(4).getCell(1).value).toBe('TINGKAT RISIKO');
    expect(sheet.getRow(4).getCell(5).value).toBe('Shift Siang');
    expect(sheet.getRow(5).getCell(1).value).toBe('Ekstrem');
    expect(sheet.getRow(5).getCell(2).value).toBe('TARP Trigger 4 (Merah)');
    expect(sheet.getRow(5).getCell(3).value).toBe('Pola Progresif');
    expect(sheet.getRow(5).getCell(4).value)
      .toBe('Teridentifikasi pola perpindahan lereng progresif (akselerasi)');
    expect(sheet.getRow(5).getCell(5).value).toBe('Telepon Geotech');
    expect(sheet.getRow(5).getCell(7).value)
      .toBe('1. Sampaikan area yang menjadi perhatian\n2. Sarankan penanganan sesuai TARP site');
  });

  it('keeps the band colours, which are keyed on the untranslated row', async () => {
    const wb = await buildTarpWorkbook(standardDoc(), { siteName: 'Contoh', locale: 'id' });
    const sheet = wb.getWorksheet('Contoh');
    expect(sheet.getRow(5).getCell(1).fill.fgColor.argb).toBe('FFFF0000');
    expect(sheet.getRow(5).getCell(2).fill.fgColor.argb).toBe('FFFF0000');
  });

  it('still flags a de-escalated row, in Bahasa Indonesia', async () => {
    // Row 2 is emailed on a site whose normal response is a call.
    const wb = await buildTarpWorkbook(standardDoc(), { siteName: 'Contoh', locale: 'id' });
    const note = wb.getWorksheet('Contoh').getRow(6).getCell(8).value;
    expect(note).toContain('EMAIL SAJA');
    expect(note).toContain('JANGAN menelepon');
    expect(wb.getWorksheet('Contoh').getRow(6).getCell(8).fill.fgColor.argb).toBe('FFFFFF00');
  });

  it('translates the section labels and the audit-trail sheet', async () => {
    const wb = await buildTarpWorkbook(standardDoc(), { siteName: 'Contoh', locale: 'id' });
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Contoh', 'Riwayat TARP']);

    const history = wb.getWorksheet('Riwayat TARP');
    expect(history.getRow(1).getCell(1).value).toBe('KENDALI DOKUMEN');
    expect(history.getRow(3).getCell(2).value).toBe('Nama Site');
    expect(history.getRow(4).getCell(10).value).toBe('Seluruh bagian');

    const sheet = wb.getWorksheet('Contoh');
    const labels = [];
    sheet.eachRow((row) => labels.push(row.getCell(2).value));
    expect(labels).toContain('Kontak');
    expect(labels).toContain('SELURUH PANGGILAN TELEPON DARI REMOTE ENGINEER KEPADA SITE ENGINEER WAJIB DITINDAKLANJUTI DENGAN RINGKASAN MELALUI EMAIL');
  });

  it('is unchanged when no locale is passed', async () => {
    const wb = await buildTarpWorkbook(standardDoc(), { siteName: 'Contoh' });
    const sheet = wb.getWorksheet('Contoh');
    expect(sheet.getRow(4).getCell(1).value).toBe('RISK RATING');
    expect(sheet.getRow(5).getCell(3).value).toBe('Progressive trend');
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Contoh', 'TARP History']);
  });
});

describe('tarpStrings', () => {
  it('keeps the workbook header row the same width in both languages', () => {
    expect(tarpStrings('id').sheetHeaders).toHaveLength(tarpStrings('en').sheetHeaders.length);
    expect(tarpStrings('id').historyHeaders).toHaveLength(tarpStrings('en').historyHeaders.length);
  });
});
