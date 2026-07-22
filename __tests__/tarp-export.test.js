/**
 * TARP export helpers + workbook construction.
 */

import { stampFor, tarpFileName, buildTarpWorkbook } from '../utils/tarpXlsx';
import { groupByRiskBand } from '../components/admin/Radar/Tarp/TarpChart';
import { normalizeTarpDocument } from '../config/tarpDocument';

const doc = normalizeTarpDocument({
  id: 1,
  site_id: 7,
  heading: 'Genesis Minerals',
  version: 3,
  status: 'active',
  footer_note: 'ALL CALLS MUST BE FOLLOWED BY AN EMAIL SUMMARY',
  triggers: [
    {
      id: 1, sort_order: 1, risk_rating: 'Extreme', band_label: 'TARP Trigger 4 - Red',
      trigger_label: 'Progressive (accelerating) trend', colour: 'red',
      description: 'Progressive trend identified', day_shift: 'Call Supervisor',
      night_shift: 'Call Supervisor', comments: ['1. State area of concern'],
      def_type: 'Progressive', tarp_level: 4, requires_alarm: false,
    },
    {
      id: 2, sort_order: 2, risk_rating: 'Extreme', band_label: 'TARP Trigger 4 - Red',
      trigger_label: 'Red Alarm', colour: 'red', comments: ['1. State alarm area'],
      def_type: null, tarp_level: 4, requires_alarm: true,
    },
    {
      id: 3, sort_order: 3, risk_rating: 'Moderate', trigger_label: 'Linear trend',
      colour: 'orange', comments: [], def_type: 'Linear', tarp_level: 3, requires_alarm: true,
    },
    {
      id: 4, sort_order: 4, risk_rating: null, trigger_label: 'Scheduled Radar Offline',
      colour: 'green', comments: [], def_type: null, tarp_level: null, requires_alarm: false,
    },
  ],
  distribution_raw: '"Leonora Geotech" <LeonoraGeotech@genesisminerals.com.au>\n"Hub Engineers" <HubEngineers@genesisminerals.com.au>',
  contacts: [
    { id: 1, kind: 'escalation', sort_order: 1, name: 'Thulio Cesar Fernandes', role: 'Open Pit Manager', phone: '466437593' },
  ],
  revisions: [
    {
      id: 1, seq: 1, site_label: 'Leonora - Genesis Minerals', version_no: 3,
      approval_date: '2026-07-22', approved_by_site: 'Shanny Chokkaiyan',
      sections_modified: 'Linear trend protocol', remark: 'Changing linear trend from calling to email',
    },
  ],
});

describe('file naming', () => {
  it('stamps DDMMYYYY', () => {
    expect(stampFor(new Date(2026, 6, 22))).toBe('22072026');
    expect(stampFor(new Date(2026, 0, 5))).toBe('05012026');
  });

  it('matches the client workbook naming convention', () => {
    expect(tarpFileName('Genesis Minerals', new Date(2026, 6, 22)))
      .toBe('DTG Radar TARP - Genesis Minerals_22072026.xlsx');
  });

  it('falls back when no company is known', () => {
    expect(tarpFileName('', new Date(2026, 6, 22)))
      .toBe('DTG Radar TARP - Site_22072026.xlsx');
  });
});

describe('groupByRiskBand', () => {
  it('groups consecutive rows sharing a risk rating', () => {
    const bands = groupByRiskBand(doc.triggers);
    expect(bands.map((b) => [b.riskRating, b.triggers.length]))
      .toEqual([['Extreme', 2], ['Moderate', 1], [null, 1]]);
  });

  it('handles an empty document', () => {
    expect(groupByRiskBand([])).toEqual([]);
  });
});

describe('buildTarpWorkbook', () => {
  let workbook;

  beforeAll(async () => {
    workbook = await buildTarpWorkbook(doc, {
      company: 'Genesis Minerals',
      siteName: 'Leonora',
    });
  });

  it('produces the chart sheet and the audit-trail sheet', () => {
    expect(workbook.worksheets.map((w) => w.name)).toEqual(['Leonora', 'TARP History']);
  });

  it('writes one row per trigger under the header', () => {
    const sheet = workbook.getWorksheet('Leonora');
    // rows 1-3 are heading/title/owner, row 4 is the column header
    expect(sheet.getRow(4).getCell(1).value).toBe('RISK RATING');
    expect(sheet.getRow(5).getCell(3).value).toBe('Progressive (accelerating) trend');
    expect(sheet.getRow(6).getCell(3).value).toBe('Red Alarm');
    expect(sheet.getRow(7).getCell(3).value).toBe('Linear trend');
  });

  it('joins the comment list into one wrapped cell', () => {
    const sheet = workbook.getWorksheet('Leonora');
    expect(sheet.getRow(5).getCell(7).value).toBe('1. State area of concern');
    expect(sheet.getRow(5).alignment.wrapText).toBe(true);
  });

  it('colour-fills the risk band', () => {
    const sheet = workbook.getWorksheet('Leonora');
    expect(sheet.getRow(5).getCell(1).fill.fgColor.argb).toBe('FFFF0000');
    expect(sheet.getRow(7).getCell(1).fill.fgColor.argb).toBe('FFFFC000');
  });

  it('calls out a de-escalated row in the Note column', async () => {
    const deescalated = normalizeTarpDocument({
      id: 2,
      site_id: 7,
      heading: 'Genesis Minerals',
      default_response_method: 'call',
      triggers: [{
        id: 1, sort_order: 1, risk_rating: 'Moderate', trigger_label: 'Linear trend',
        colour: 'orange', day_shift: 'Email Geotech', comments: [],
        def_type: 'Linear', tarp_level: 3, requires_alarm: true,
        response_method: 'email',
        response_notice: 'Email only — do not call.',
      }],
      contacts: [],
      revisions: [],
    });

    const wb = await buildTarpWorkbook(deescalated, { siteName: 'Leonora' });
    const noteCell = wb.getWorksheet('Leonora').getRow(5).getCell(8);
    expect(noteCell.value).toContain('EMAIL ONLY');
    expect(noteCell.value).toContain('do not call');
    expect(noteCell.fill.fgColor.argb).toBe('FFFFFF00');
    expect(noteCell.font.bold).toBe(true);
  });

  it('leaves the Note column alone when the row matches the site default', () => {
    // every trigger in `doc` inherits the default, so nothing is flagged
    const sheet = workbook.getWorksheet('Leonora');
    expect(sheet.getRow(5).getCell(8).value).toBe('');
  });

  it('writes the distribution list as one free-text block', () => {
    const sheet = workbook.getWorksheet('Leonora');
    let found = null;
    sheet.eachRow((row) => {
      if (String(row.getCell(2).value || '').includes('LeonoraGeotech@')) found = row;
    });
    expect(found).not.toBeNull();
    expect(found.getCell(2).value).toContain('HubEngineers@genesisminerals.com.au');
    expect(found.alignment.wrapText).toBe(true);
  });

  it('carries the revision history onto sheet 2', () => {
    const history = workbook.getWorksheet('TARP History');
    expect(history.getRow(3).getCell(1).value).toBe('No.');
    expect(history.getRow(4).getCell(11).value).toBe('Changing linear trend from calling to email');
  });

  it('sanitises sheet names Excel would reject', async () => {
    const wb = await buildTarpWorkbook(doc, { siteName: 'Pit A/B [North]' });
    expect(wb.worksheets[0].name).toBe('Pit A B  North');
  });
});
