/**
 * Daily Radar Report contracts.
 *
 * These cover the decisions a later tidy-up would quietly break — which records
 * reach the movement table, how the Keterangan sentence is worded, when the
 * Data Update card turns red, and that the page is written in the site's
 * language — rather than the pixels, which jsdom cannot see anyway.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';

import {
  buildStatusRows,
  splitStatusRows,
  isDataUpdateLate,
  statusVelocity,
  isExcludedFromStatus,
  hasActiveRisk,
  SINGLE_COLUMN_MAX_ROWS,
  NO_TARP_LABEL,
} from '@/utils/dailyStatusRows';
import {
  dailyStrings,
  dailyRemark,
  dailyLongDate,
  formatDataUpdate,
  normaliseQualityTier,
  qualityActionText,
  dailyRiskSentence,
  dailyQualitySummary,
  dailySubtitle,
} from '@/config/dailyReportLocale';
import { resolveRiskPresentation, riskSentence } from '@/config/riskDisplay';
import { getStatusDefinition } from '@/config/statusConfig';
import { dailyGlossaryGroups } from '@/config/dailyGlossary';
import { buildQualityNote, buildAppendixItems } from '@/utils/reportDqp';
import { DailyAppendixItem } from '@/components/admin/Radar/report/blocks/DailyAppendix';
import { DailySummary, DailyMovementTable, DailyLegend } from '@/components/admin/Radar/report/blocks/DailySummary';
import { DailyHeader } from '@/components/admin/Radar/report/blocks/DailyHeader';
import { DailyScanArea, DailyAnalysisImage } from '@/components/admin/Radar/report/blocks/DailyFigures';

const rec = (over = {}) => ({
  id: over.id ?? 'r1',
  created_at: over.created_at ?? '2026-08-07T02:00:00Z',
  location: 'Top dk 1',
  def_type: 'No Significant',
  tarp_level: 'TARP 1',
  isactive: 'Yes',
  properties: {},
  ...over,
});

// ---------------------------------------------------------------------------
// Which records reach the table
// ---------------------------------------------------------------------------

describe('movement table membership', () => {
  test('excludes blast, rainfall and forecast records', () => {
    expect(isExcludedFromStatus(rec({ def_type: 'Blast Event' }))).toBe(true);
    expect(isExcludedFromStatus(rec({ def_type: 'Rainfall Event' }))).toBe(true);
    expect(isExcludedFromStatus(rec({ def_type: 'Forecast' }))).toBe(true);
    // Free-typed historical variants land the same way.
    expect(isExcludedFromStatus(rec({ def_type: 'Blast' }))).toBe(true);
    expect(isExcludedFromStatus(rec({ def_type: 'Progressive' }))).toBe(false);
    expect(isExcludedFromStatus(rec({ def_type: 'Rock Fall' }))).toBe(false);
  });

  test('lists both chains when one area carries two', () => {
    // The reported bug: a TARP 4 Linear and a TARP 3 Progressive on the same
    // wall are two findings the site has to act on, and collapsing them to the
    // worst hid one of them entirely.
    const rows = buildStatusRows([
      rec({ id: 'a', location: 'Poli Dk', def_type: 'Linear', tarp_level: 'TARP 4' }),
      rec({ id: 'b', location: 'Poli Dk', def_type: 'Progressive', tarp_level: 'TARP 3' }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => `${r.tarp} ${r.pattern}`)).toEqual([
      'TARP 4 Linear',
      'TARP 3 Progressive',
    ]);
  });

  test('drops a superseded precursor, keeping only the chain head', () => {
    const rows = buildStatusRows([
      rec({ id: 'root', location: 'Poli Dk', def_type: 'Linear', tarp_level: 'TARP 3' }),
      rec({
        id: 'head',
        location: 'Poli Dk',
        def_type: 'Progressive',
        tarp_level: 'TARP 4',
        precursors: ['root'],
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].pattern).toBe('Progressive');
  });

  test('matches precursor ids across the INT[]/string boundary', () => {
    // `precursors` is INT[] and `id` arrives as whatever PostgREST gave it. A
    // strict compare would mark every record a head and print the whole chain.
    const rows = buildStatusRows([
      rec({ id: 12, location: 'Poli Dk', def_type: 'Linear' }),
      rec({ id: 13, location: 'Poli Dk', def_type: 'Progressive', precursors: ['12'] }),
    ]);
    expect(rows).toHaveLength(1);
  });

  test('a blast at an otherwise quiet area does not create a row', () => {
    const rows = buildStatusRows([rec({ location: '102', def_type: 'Blast Event', tarp_level: 'TARP 2' })]);
    expect(rows).toEqual([]);
  });

  test('orders worst area first', () => {
    const rows = buildStatusRows([
      rec({ id: 'a', location: 'Quiet' }),
      rec({ id: 'b', location: 'Moving', def_type: 'Progressive', tarp_level: 'TARP 4' }),
      rec({ id: 'c', location: 'Slow', def_type: 'Linear', tarp_level: 'TARP 3' }),
    ]);
    expect(rows.map((r) => r.area)).toEqual(['Moving', 'Slow', 'Quiet']);
  });

  test('a levelless record falls back to the no-risk baseline', () => {
    const [row] = buildStatusRows([rec({ def_type: 'Rock Fall', tarp_level: null })]);
    expect(row.tarp).toBe('TARP 1');
  });

  test('a Rapid Movement prints a dash, never TARP 1', () => {
    // It sits ABOVE the scale, so the "nothing active" fallback would print the
    // worst thing on the board as the calmest.
    const [row] = buildStatusRows([rec({ def_type: 'Rapid Movement', tarp_level: null })]);
    expect(row.tarp).toBe(NO_TARP_LABEL);
    expect(row.tarpColour).toBeNull();
    // The pattern column still carries the band, so the row is not colourless.
    expect(row.colour).toBe('darkred');
    expect(row.patternColour).toBe('darkred');
  });

  test('a Rapid Movement a site DID level keeps that level', () => {
    const [row] = buildStatusRows([rec({ def_type: 'Rapid Movement', tarp_level: 'TARP 4' })]);
    expect(row.tarp).toBe('TARP 4');
  });

  test('each column is coloured by its own fact, and the row ranks on the worse', () => {
    // A site whose levels are alarm thresholds: a Linear trend on a red alarm.
    // Colouring both columns from the shape printed the trigger orange and
    // understated the response; colouring both from the row's overall band
    // printed "Linear" in red and claimed a shape the trend does not have.
    const [row] = buildStatusRows([rec({ def_type: 'Linear', tarp_level: 'TARP 4' })]);
    expect(row.tarpColour).toBe('red'); // the trigger
    expect(row.patternColour).toBe('orange'); // the shape — a Linear is orange, always
    expect(row.colour).toBe('red'); // the rank: the more severe of the two

    // The other direction: a shape worse than the level it was notified at.
    const [quiet] = buildStatusRows([rec({ def_type: 'Progressive', tarp_level: 'TARP 2' })]);
    expect(quiet.tarpColour).toBe('yellow');
    expect(quiet.patternColour).toBe('red');
    expect(quiet.colour).toBe('red');

    const [calm] = buildStatusRows([rec({ def_type: 'Linear', tarp_level: 'TARP 2' })]);
    expect(calm.tarpColour).toBe('yellow');
    expect(calm.patternColour).toBe('orange');
    expect(calm.colour).toBe('orange');
  });

  test('a free-typed pattern the scale cannot read still takes the row’s band', () => {
    // `def_type` is not enum-constrained. Colourless would be worse than the
    // record's own band, which is what the column printed before.
    const [row] = buildStatusRows([rec({ def_type: 'Wedge slip (site term)', tarp_level: 'TARP 3' })]);
    expect(row.patternColour).toBe('orange');
  });

  test('every TARP level maps to its own band', () => {
    const colours = ['TARP 1', 'TARP 2', 'TARP 3', 'TARP 4'].map(
      (level) => buildStatusRows([rec({ def_type: 'No Significant', tarp_level: level })])[0].tarpColour
    );
    expect(colours).toEqual(['green', 'yellow', 'orange', 'red']);
  });

  test('a site that quotes no TARP level gets no invented one', () => {
    const [row] = buildStatusRows([rec({ def_type: 'Regressive', tarp_level: 'TARP 2' })], {
      riskMode: 'notification',
      noLevelLabel: '',
    });
    // Hidden Valley names the band, never the number their chart lacks.
    expect(row.tarp).toBe('Yellow');
  });
});

// ---------------------------------------------------------------------------
// Velocity and the Keterangan sentence
// ---------------------------------------------------------------------------

describe('velocity resolution', () => {
  test('a Linear carries its average velocity, in the VCP-implied unit', () => {
    expect(statusVelocity(rec({ def_type: 'Linear', properties: { AverageVelocity: 0.8, VCP: 60 } })))
      .toEqual({ from: '0.8', to: null, unit: 'mm/h' });
    // A VCP of a day or more reads in mm/d — the same rule the timeline uses.
    expect(statusVelocity(rec({ def_type: 'Linear', properties: { AverageVelocity: 4, VCP: 1440 } })).unit)
      .toBe('mm/d');
  });

  test('a Progressive carries the Vmin–Vmax band', () => {
    expect(
      statusVelocity(rec({ def_type: 'Progressive', properties: { Vmin: 1.2, Vmax: 3.4, VCP: 120 } }))
    ).toEqual({ from: '1.2', to: '3.4', unit: 'mm/h' });
  });

  test('types that define no velocity return none', () => {
    expect(statusVelocity(rec({ def_type: 'Regressive' }))).toBeNull();
    expect(statusVelocity(rec({ def_type: 'No Significant' }))).toBeNull();
  });
});

describe('dailyRemark', () => {
  test('Indonesian wording matches the issued report', () => {
    expect(dailyRemark('No Significant', null, 'id')).toBe('Tidak teramati pergerakan signifikan.');
    expect(dailyRemark('Regressive', null, 'id')).toBe('Pergerakan menuju stabil.');
    expect(dailyRemark('Rapid Movement', null, 'id')).toBe('Pergerakan melebihi limitasi radar.');
    expect(dailyRemark('Linear', { from: '0.8', unit: 'mm/h' }, 'id')).toBe(
      'Pergerakan konstan, kecepatan 0.8 mm/jam.'
    );
    expect(dailyRemark('Progressive', { from: '1.2', to: '3.4', unit: 'mm/h' }, 'id')).toBe(
      'Pergerakan akseleratif, kecepatan 1.2 - 3.4 mm/jam.'
    );
  });

  test('units translate but the rest of the metric vocabulary does not', () => {
    expect(dailyRemark('Linear', { from: '4', unit: 'mm/d' }, 'id')).toContain('mm/hari');
    expect(dailyRemark('Linear', { from: '4', unit: 'mm/d' }, 'en')).toContain('mm/d');
  });

  test('a record with no velocity is not padded with a dash', () => {
    // "velocity — mm/jam" would read as a measurement that failed.
    expect(dailyRemark('Linear', null, 'id')).not.toContain('—');
    expect(dailyRemark('Linear', null, 'en')).toBe('Constant movement, velocity not recorded.');
  });

  test('an unrecognised type still says something', () => {
    expect(dailyRemark('Rock Fall', null, 'en')).toBe('Rock Fall recorded.');
    expect(dailyRemark('Rock Fall', null, 'id')).toBe('Rock Fall teramati.');
  });
});

// ---------------------------------------------------------------------------
// The Data Update card
// ---------------------------------------------------------------------------

describe('isDataUpdateLate', () => {
  const DAY = '2026-08-07';

  test('within two hours of the deadline prints black', () => {
    expect(isDataUpdateLate('2026-08-07T04:30', '06:00', DAY)).toBe(false);
    expect(isDataUpdateLate('2026-08-07T05:59', '06:00', DAY)).toBe(false);
  });

  test('more than two hours before the deadline prints red', () => {
    expect(isDataUpdateLate('2026-08-07T03:59', '06:00', DAY)).toBe(true);
    expect(isDataUpdateLate('2026-08-07T00:10', '06:00', DAY)).toBe(true);
  });

  test('an update from a previous day is late whatever the clock says', () => {
    // 05:00 yesterday is not 05:00 today, and comparing minutes alone said it was.
    expect(isDataUpdateLate('2026-08-06T05:00', '06:00', DAY)).toBe(true);
  });

  test('does not accuse when it cannot establish lateness', () => {
    expect(isDataUpdateLate('', '06:00', DAY)).toBe(false);
    expect(isDataUpdateLate('not a date', '06:00', DAY)).toBe(false);
    expect(isDataUpdateLate('2026-08-07T01:00', null, DAY)).toBe(false);
  });

  test('is read on the site wall clock, not re-projected through the browser', () => {
    // The suite runs in Asia/Jakarta. A naive value parsed as an instant and
    // re-read locally would shift, so this asserts the component-wise read.
    expect(isDataUpdateLate('2026-08-07T04:30', '06:00', DAY)).toBe(false);
    expect(formatDataUpdate('2026-08-07T04:30', 'Asia/Makassar')).toBe('07/08/2026 04:30 WITA');
    expect(formatDataUpdate('2026-08-07T04:30', 'Australia/Perth')).toBe('07/08/2026 04:30');
  });
});

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

describe('splitStatusRows', () => {
  const areas = (n) => Array.from({ length: n }, (_, i) => ({ area: `A${i + 1}` }));
  const names = (side) => side.map((r) => r.area);

  test('nothing to monitor yields no rows at all', () => {
    expect(splitStatusRows([])).toEqual({ left: [], right: [], twoUp: false });
  });

  test('up to five chains stay one full-width column', () => {
    for (let n = 1; n <= SINGLE_COLUMN_MAX_ROWS; n += 1) {
      const split = splitStatusRows(areas(n));
      expect(split.twoUp).toBe(false);
      expect(split.left).toHaveLength(n);
      expect(split.right).toEqual([]);
    }
  });

  test('past five it splits, filling the left column first', () => {
    const split = splitStatusRows(areas(6));
    expect(split.twoUp).toBe(true);
    expect(names(split.left)).toEqual(['A1', 'A2', 'A3']);
    expect(names(split.right)).toEqual(['A4', 'A5', 'A6']);
  });

  test('an odd count leaves the extra row on the left, never a padded slot', () => {
    const split = splitStatusRows(areas(7));
    expect(names(split.left)).toEqual(['A1', 'A2', 'A3', 'A4']);
    expect(names(split.right)).toEqual(['A5', 'A6', 'A7']);
    // No nulls anywhere — the table renders the one missing half-cell itself.
    expect([...split.left, ...split.right].every(Boolean)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The data-quality note
// ---------------------------------------------------------------------------

describe('buildQualityNote', () => {
  const row = (id, name, level, parent_id, value, notes) => ({
    value,
    notes,
    parameters: { id, name, level, parent_id },
  });

  test('quotes the analyst notes behind a downgrade', () => {
    const note = buildQualityNote([
      row(1, 'Overall', 0, null, 'Acceptable'),
      row(10, 'System Health', 1, null, 'Acceptable'),
      row(11, 'Latency', 2, 10, 'Acceptable', 'Latency issue'),
      row(12, 'Coherence', 2, 10, 'Optimal', ''),
    ]);
    expect(note).toBe('Latency issue');
  });

  test('deduplicates a cause shared by several parameters', () => {
    const note = buildQualityNote([
      row(11, 'Latency', 2, 10, 'Acceptable', 'Latency issue'),
      row(12, 'Coherence', 2, 10, 'Acceptable', 'Latency issue'),
    ]);
    expect(note).toBe('Latency issue');
  });

  test('falls back to the parameter name so a downgrade is never unexplained', () => {
    expect(buildQualityNote([row(11, 'Vector Loss', 2, 10, 'Sub-Optimal', '')])).toBe('Vector Loss');
  });

  test('an optimal period carries no note', () => {
    expect(buildQualityNote([row(11, 'Latency', 2, 10, 'Optimal', '')])).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------

describe('locale', () => {
  test('the Indonesian page uses the issued report wording', () => {
    const s = dailyStrings('id');
    expect(s.reportTitle).toBe('LAPORAN HARIAN - RADAR');
    expect(s.summaryHeading).toBe('RANGKUMAN INFORMASI');
    expect(s.colTarp).toBe('TARP Terkini');
    expect(s.preparedByRole).toBe('Geotechnical Engineer');
    expect(s.northLetter).toBe('U');
  });

  test('the role is never translated — it is the same title at every site', () => {
    expect(dailyStrings('en').preparedByRole).toBe(dailyStrings('id').preparedByRole);
  });

  test('dates follow the language', () => {
    expect(dailyLongDate('2026-08-07', 'en')).toBe('7 August 2026');
    expect(dailyLongDate('2026-08-07', 'id')).toContain('Agustus');
  });

  test('a bare date is not shifted a day by UTC parsing', () => {
    expect(dailyLongDate('2026-01-01', 'en')).toBe('1 January 2026');
  });

  test('the glossary covers the movement patterns in both languages', () => {
    for (const locale of ['en', 'id']) {
      const terms = dailyGlossaryGroups(locale).flatMap((g) => g.entries);
      expect(terms.filter((t) => t.shape)).toHaveLength(3);
      expect(terms.some((t) => t.term.startsWith('TARP'))).toBe(true);
      expect(terms.some((t) => t.term.startsWith('Speed Reciprocal'))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Appendix
// ---------------------------------------------------------------------------

describe('appendix', () => {
  // A DQP row as the daily hook hands it over: notes are what promotes a row
  // into the appendix, `images` is what attachDqpImages resolved for it.
  const dqpRow = (over = {}) => ({
    value: 'Sub-Optimal',
    notes: 'Latency issue',
    appendix: 'The link dropped for 40 minutes.',
    parameters: { id: 12, name: 'Data Latency', level: 2, parent_id: 3 },
    images: [],
    ...over,
  });

  test('carries the same entries the comprehensive report would build', () => {
    // Both documents read the same rows through buildAppendixItems, so a row
    // with a note and nothing to show is still an entry, and a row with neither
    // is not one at all.
    const items = buildAppendixItems([
      dqpRow(),
      dqpRow({ parameters: { id: 4, name: 'Alignment', level: 2 }, notes: null, appendix: 'ignored' }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0].letter).toBe('A');
    expect(items[0].name).toBe('Data Latency');
  });

  test('is written in the site language, like every other block', () => {
    const [item] = buildAppendixItems([
      dqpRow({ images: [{ id: 7, caption: 'Availability trace', image_url: 'a/b.png' }] }),
    ]);
    // Rendered as the template renders it: figures already inlined.
    const inlined = { ...item, images: item.images.map((i) => ({ ...i, imageUrl: 'data:image/png;base64,x' })) };

    const { unmount } = render(
      <DailyAppendixItem strings={dailyStrings('id')} item={inlined} withHeader />
    );
    expect(screen.getByText('LAMPIRAN')).toBeInTheDocument();
    expect(screen.getByText(/Lampiran A/)).toBeInTheDocument();
    expect(screen.getByText('Gambar 1.')).toBeInTheDocument();
    unmount();

    render(<DailyAppendixItem strings={dailyStrings('en')} item={inlined} withHeader />);
    expect(screen.getByText('APPENDIX')).toBeInTheDocument();
    expect(screen.getByText(/Appendix A/)).toBeInTheDocument();
    expect(screen.getByText('Figure 1.')).toBeInTheDocument();
  });

  test('a figure that never resolved leaves its number unused', () => {
    // Numbering follows the row's declared order. Renumbering around a missing
    // figure would make the caption disagree with any reference to it.
    const [item] = buildAppendixItems([
      dqpRow({
        images: [
          { id: 1, caption: 'lost', image_url: 'gone.png' },
          { id: 2, caption: 'kept', image_url: 'here.png' },
        ],
      }),
    ]);
    const partial = {
      ...item,
      images: [item.images[0], { ...item.images[1], imageUrl: 'data:image/png;base64,x' }],
    };

    render(<DailyAppendixItem strings={dailyStrings('en')} item={partial} withHeader />);
    expect(screen.queryByText('Figure 1.')).not.toBeInTheDocument();
    expect(screen.getByText('Figure 2.')).toBeInTheDocument();
  });
});

describe('the two verdict sentences', () => {
  const present = (records) => resolveRiskPresentation(records, 'tarp');

  test('English delegates to the shared derivations, word for word', () => {
    // An English daily report and the Comprehensive report must state the same
    // day identically — so this asserts equality, not just similarity.
    const p = present([rec({ def_type: 'Progressive', tarp_level: 'TARP 4' })]);
    expect(dailyRiskSentence(p, 'en')).toBe(riskSentence(p));
    expect(dailyQualitySummary('Acceptable', 'en')).toBe(
      getStatusDefinition('Acceptable').summary
    );
  });

  test('Indonesian translates the prose but never the labels', () => {
    const p = present([rec({ def_type: 'Progressive', tarp_level: 'TARP 4' })]);
    const sentence = dailyRiskSentence(p, 'id');
    expect(sentence).toContain('Risiko keseluruhan berada pada TARP 4');
    // 'TARP 4' is what the site's own chart says; 'Critical' is prose.
    expect(sentence).toContain('Kritis');
    expect(sentence).not.toContain('Critical');
  });

  test('an Indonesian quiet day reads as one, on the same branch English takes', () => {
    // The "nothing active" branch is keyed on the LABEL, so it fires only where
    // the site's wording produces one — a tarp-mode site with no records still
    // says "TARP 1", in both languages. Mirroring riskSentence exactly is the
    // point: the two documents must not diverge on which branch they took.
    const quiet = resolveRiskPresentation([], 'notification');
    expect(quiet.label).toBe('No Significant');
    expect(dailyRiskSentence(quiet, 'id')).toBe(
      'Tidak teramati risiko deformasi signifikan pada periode ini.'
    );

    const tarpQuiet = present([]);
    expect(dailyRiskSentence(tarpQuiet, 'id')).toBe(
      'Risiko keseluruhan berada pada TARP 1 — kondisi Tidak Signifikan.'
    );
    expect(dailyRiskSentence(tarpQuiet, 'en')).toBe(riskSentence(tarpQuiet));
  });

  test('every quality tier has an Indonesian summary', () => {
    for (const tier of ['Optimal', 'Acceptable', 'Sub-Optimal', 'Critical']) {
      const id = dailyQualitySummary(tier, 'id');
      expect(id).toBeTruthy();
      expect(id).not.toBe(dailyQualitySummary(tier, 'en'));
    }
  });

  test('every band subtitle has an Indonesian form', () => {
    for (const sub of ['Critical', 'Moderate Risk', 'Intermediate Risk', 'Event Recorded', 'No Significant']) {
      expect(dailySubtitle(sub, 'id')).not.toBe(sub);
    }
    // A label outside the scale passes through rather than vanishing.
    expect(dailySubtitle('Something else', 'id')).toBe('Something else');
    expect(dailySubtitle('Critical', 'en')).toBe('Critical');
  });

  test('an unrecognised quality label yields no sentence rather than a crash', () => {
    expect(dailyQualitySummary(null, 'id')).toBe('');
    expect(dailyQualitySummary('Unknown', 'id')).toBe('');
  });
});

describe('hasActiveRisk', () => {
  const present = (records) => resolveRiskPresentation(records, 'tarp');

  test('a quiet day needs no Area Analysis section', () => {
    expect(hasActiveRisk(present([]))).toBe(false);
    expect(hasActiveRisk(present([rec({ def_type: 'No Significant', tarp_level: 'TARP 1' })]))).toBe(false);
    expect(hasActiveRisk(null)).toBe(false);
  });

  test('anything active demands one', () => {
    expect(hasActiveRisk(present([rec({ def_type: 'Regressive', tarp_level: 'TARP 2' })]))).toBe(true);
    expect(hasActiveRisk(present([rec({ def_type: 'Progressive', tarp_level: 'TARP 4' })]))).toBe(true);
    // A Rock Fall quotes no TARP level but is still an event to analyse.
    expect(hasActiveRisk(present([rec({ def_type: 'Rock Fall', tarp_level: null })]))).toBe(true);
  });
});

describe('quality tiers', () => {
  test("the DQP's 'Sub-Optimal' matches the legend's 'SubOptimal' row", () => {
    expect(normaliseQualityTier('Sub-Optimal')).toBe('SubOptimal');
    expect(normaliseQualityTier('sub optimal')).toBe('SubOptimal');
    expect(normaliseQualityTier('Acceptable')).toBe('Acceptable');
    expect(normaliseQualityTier('nonsense')).toBeNull();
  });

  test('actions are short enough for the printed column', () => {
    expect(qualityActionText('Critical', 'id')).toBe('Diperlukan respon tindakan segera');
    expect(qualityActionText('Optimal', 'en')).toBe('No action required');
  });
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe('rendering', () => {
  const strings = dailyStrings('id');

  test('the movement table prints every area with its remark', () => {
    const rows = buildStatusRows(
      [
        rec({ id: 'a', location: 'Top dk 1' }),
        rec({
          id: 'b',
          location: 'Poli Dk',
          def_type: 'Linear',
          tarp_level: 'TARP 3',
          properties: { AverageVelocity: 0.8, VCP: 60 },
        }),
      ],
      { locale: 'id' }
    );

    render(<DailyMovementTable strings={strings} split={splitStatusRows(rows)} />);

    expect(screen.getByText('Top dk 1')).toBeInTheDocument();
    expect(screen.getByText('Poli Dk')).toBeInTheDocument();
    expect(screen.getByText('Pergerakan konstan, kecepatan 0.8 mm/jam.')).toBeInTheDocument();
    expect(screen.getByText('Tidak teramati pergerakan signifikan.')).toBeInTheDocument();

    // Two records, two rows — no padding underneath them.
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3); // header + 2
    // One column group, so four headers rather than eight.
    expect(screen.getAllByText('Area')).toHaveLength(1);
  });

  test('the printed Pattern cell takes the shape’s ink, not the trigger’s', () => {
    // The reported bug: on a site whose levels are alarm thresholds, "Linear"
    // printed in the red of the TARP 4 beside it.
    const rows = buildStatusRows([rec({ def_type: 'Linear', tarp_level: 'TARP 4' })]);
    render(<DailyMovementTable strings={strings} split={splitStatusRows(rows)} />);

    // #b5620a is severityTextColor(SEV.subOptimal) — the orange band at text
    // weight; #C00000 is the critical red the TARP cell carries.
    expect(screen.getByText('Linear')).toHaveStyle({ color: '#b5620a' });
    expect(screen.getByText('TARP 4')).toHaveStyle({ color: '#C00000' });
  });

  test('a wall folder with no monitoring points says so instead of showing an empty grid', () => {
    render(<DailyMovementTable strings={strings} split={splitStatusRows([])} />);

    expect(screen.getByText('Tidak ada point monitoring pada MAS dashboard')).toBeInTheDocument();
    // No headers promising columns there are no rows for.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('Area')).not.toBeInTheDocument();
  });

  test('past five chains the table goes two-up, with no padded rows', () => {
    const records = Array.from({ length: 7 }, (_, i) =>
      rec({ id: `r${i}`, location: `Area ${i + 1}` })
    );
    render(<DailyMovementTable strings={strings} split={splitStatusRows(buildStatusRows(records))} />);

    const table = screen.getByRole('table');
    // Seven chains over two columns: four rows, not seven and not a padded eight.
    expect(within(table).getAllByRole('row')).toHaveLength(5); // header + 4
    // Two column groups.
    expect(screen.getAllByText('Area')).toHaveLength(2);
  });

  test('the legend ticks the tier this edition reached, and says why', () => {
    const { container } = render(
      <DailyLegend
        strings={strings}
        locale="id"
        currentQuality="Acceptable"
        currentRisk="TARP 2"
        qualityNote="Latency issue"
      />
    );

    // Exactly two ticks: one per legend table.
    expect(within(container).getAllByText('x')).toHaveLength(2);
    expect(screen.getByText('Latency issue')).toBeInTheDocument();
  });

  test('a risk label outside the TARP scale is still stated', () => {
    render(
      <DailyLegend
        strings={strings}
        locale="id"
        currentQuality="Optimal"
        currentRisk="Rapid Movement"
        qualityNote=""
      />
    );
    // The four TARP rows cannot tick, so the label is printed under them
    // rather than leaving the reader to conclude nothing was found.
    expect(screen.getByText('Rapid Movement')).toBeInTheDocument();
  });

  test('the header prints the radar number, the company and the four cards', () => {
    render(
      <DailyHeader
        title={strings.reportTitle}
        radarNumber="PS2000"
        company="PT. Vale Indonesia"
        strings={strings}
        cards={{
          date: '7 Agustus 2026',
          dataUpdate: '07/08/2026 04:30 WITA',
          dataUpdateLate: false,
          quality: 'Acceptable',
          risk: { label: 'TARP 1', colour: 'green', subtitle: 'No Significant' },
        }}
      />
    );

    expect(screen.getByText(/LAPORAN HARIAN - RADAR PS2000/)).toBeInTheDocument();
    expect(screen.getByText('PT. Vale Indonesia')).toBeInTheDocument();
    expect(screen.getByText('TANGGAL')).toBeInTheDocument();
    expect(screen.getByText('07/08/2026 04:30 WITA')).toBeInTheDocument();
    expect(screen.getByText('Acceptable')).toBeInTheDocument();
    expect(screen.getByText('TARP 1')).toBeInTheDocument();
  });

  test('observations are typed onto the page, and print as plain text', () => {
    const onManualChange = jest.fn();
    const { rerender } = render(
      <DailySummary
        strings={strings}
        deformation="Tidak teramati risiko deformasi signifikan pada periode ini."
        quality="Acceptable"
        manual={{ weather: '', fog: 'Tidak ada', rainfall: '' }}
        editable
        onManualChange={onManualChange}
      />
    );

    const weather = screen.getByLabelText('Kondisi Cuaca');
    fireEvent.change(weather, { target: { value: 'Cerah' } });
    expect(onManualChange).toHaveBeenCalledWith('weather', 'Cerah');
    expect(screen.getByLabelText('Kondisi Kabut')).toHaveValue('Tidak ada');

    // The export render carries no form controls — it is paper.
    rerender(
      <DailySummary
        strings={strings}
        deformation="Tidak teramati risiko deformasi signifikan pada periode ini."
        quality="Acceptable"
        manual={{ weather: 'Cerah', fog: 'Tidak ada', rainfall: '0.0 mm/jam' }}
      />
    );
    expect(screen.queryByLabelText('Kondisi Cuaca')).not.toBeInTheDocument();
    expect(screen.getByText('Cerah')).toBeInTheDocument();
  });

  /**
   * The strip is the report's only stored manual field, so the two things worth
   * pinning are that it reads left-to-right newest-first — the analyst fills the
   * left cell and the client reads the same way — and that a committed figure is
   * handed back with its DATE, not its column. A commit keyed to a position
   * would rewrite the wrong day the moment the window moved.
   */
  test('the generator strip runs latest-first and commits against the day, not the column', () => {
    const onChange = jest.fn();
    const onCommit = jest.fn();
    const columns = [
      { date: '2026-08-06', label: '06/08', value: '' },
      { date: '2026-08-05', label: '05/08', value: '612' },
      { date: '2026-08-04', label: '04/08', value: '0' },
    ];

    const { rerender } = render(
      <DailySummary
        strings={strings}
        quality="Acceptable"
        manual={{}}
        editable
        generator={{ columns, onChange, onCommit }}
      />
    );

    expect(screen.getByText('Waktu Operasi Genset (menit)')).toBeInTheDocument();

    const headings = screen.getAllByRole('columnheader').map((th) => th.textContent);
    expect(headings).toEqual(['06/08', '05/08', '04/08']);

    const yesterday = screen.getByLabelText('Waktu Operasi Genset (menit) 06/08');
    fireEvent.change(yesterday, { target: { value: '540' } });
    expect(onChange).toHaveBeenCalledWith('2026-08-06', '540');
    fireEvent.blur(yesterday);
    expect(onCommit).toHaveBeenCalledWith('2026-08-06');

    // A generator that did not run is a reading. Printed as 0, not as blank.
    rerender(
      <DailySummary
        strings={strings}
        quality="Acceptable"
        manual={{}}
        generator={{ columns, onChange, onCommit }}
      />
    );
    const printed = screen.getAllByRole('cell').map((cell) => cell.textContent);
    expect(printed).toEqual(['—', '612', '0']);
  });

  test('a report composed without the strip prints as it always did', () => {
    render(<DailySummary strings={strings} quality="Acceptable" manual={{}} />);
    expect(screen.queryByText('Waktu Operasi Genset (menit)')).not.toBeInTheDocument();
  });

  test('the data update is edited on the card itself', () => {
    const onDataUpdateChange = jest.fn();
    render(
      <DailyHeader
        title={strings.reportTitle}
        strings={strings}
        cards={{ date: '7 Agustus 2026', dataUpdate: '', dataUpdateLate: false }}
        editable
        dataUpdateValue="2026-08-07T04:30"
        onDataUpdateChange={onDataUpdateChange}
      />
    );

    const input = screen.getByLabelText('DATA UPDATE');
    expect(input).toHaveValue('2026-08-07T04:30');
    fireEvent.change(input, { target: { value: '2026-08-07T05:15' } });
    expect(onDataUpdateChange).toHaveBeenCalledWith('2026-08-07T05:15');
  });

  test('a late data update prints red', () => {
    const { rerender } = render(
      <DailyHeader
        title={strings.reportTitle}
        strings={strings}
        cards={{ date: '7 Agustus 2026', dataUpdate: '07/08/2026 01:00 WITA', dataUpdateLate: true }}
      />
    );
    // SEV.critical — the same ink every other critical state prints in.
    expect(screen.getByText('07/08/2026 01:00 WITA')).toHaveStyle({ color: '#C00000' });

    rerender(
      <DailyHeader
        title={strings.reportTitle}
        strings={strings}
        cards={{ date: '7 Agustus 2026', dataUpdate: '07/08/2026 05:00 WITA', dataUpdateLate: false }}
      />
    );
    expect(screen.getByText('07/08/2026 05:00 WITA')).not.toHaveStyle({ color: '#C00000' });
  });
});

/**
 * An empty figure occupies the page whether or not it can be typed into.
 *
 * Every template is mounted twice: once for the analyst, once non-interactively
 * into the hidden layer that MEASURES the page breaks. These blocks used to draw
 * their empty drop zone only when `interactive`, so the measured copy was ~190px
 * shorter than the one on screen — the paginator packed each page that much too
 * full and the block at the bottom printed under the footer, clipped.
 */
describe('daily figures — geometry does not depend on `interactive`', () => {
  const strings = dailyStrings('en');

  test('the scan area draws its drop zone in the measurement pass too', () => {
    const { container, rerender } = render(
      <DailyScanArea strings={strings} annotation={{ image: null }} interactive placeholder />
    );
    const shown = container.innerHTML.length;

    // The measurement pass: same block, no handlers, SAME BOX.
    rerender(<DailyScanArea strings={strings} annotation={{ image: null }} interactive={false} placeholder />);
    expect(screen.getByText(/Drag, drop or paste/i)).toBeInTheDocument();
    // Not byte-identical — the interactive copy carries a tabIndex and a
    // drop-zone marker — but the same order of magnitude, not an empty node.
    expect(container.innerHTML.length).toBeGreaterThan(shown * 0.8);
  });

  test('an analysis figure does the same', () => {
    render(<DailyAnalysisImage strings={strings} api={{ image: null }} areaName="AREA 1" interactive={false} placeholder />);
    expect(screen.getByText(/Drag, drop or paste/i)).toBeInTheDocument();
    expect(screen.getByText('AREA 1')).toBeInTheDocument();
  });

  test('but an empty figure still prints nothing when nobody can fill it', () => {
    // The export path: no image, no drop zone to offer — the block is dropped
    // entirely, and the template leaves it out of BOTH passes to match.
    const { container } = render(
      <DailyScanArea strings={strings} annotation={{ image: null }} interactive={false} placeholder={false} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
