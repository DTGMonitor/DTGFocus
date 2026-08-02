const { getDqpGuidance, docVariantFor } = require('../config/dqpGuidance');
const { getAllowedStatuses, canBeNotApplicable } = require('../config/parameterConfig');
const { excludedParameterIds } = require('../config/radarParameterSets');

// Real rows from the parameters table, as DqpTable hands them over.
const PARAM = {
  dataAvailability: { id: 9, name: 'Data Availability', parent_id: 2 },
  scanMode: { id: 10, name: 'SSR Type & Scan Mode', parent_id: 2 },
  signalQuality: { id: 11, name: 'Signal Quality', parent_id: 2 },
  coherence: { id: 14, name: 'Coherence', parent_id: 3 },
  cameraAlignment: { id: 16, name: 'Camera Alignment', parent_id: 4 },
  alarmSettings: { id: 20, name: 'Alarm Settings', parent_id: 6 },
  masks: { id: 36, name: 'Masks', parent_id: 5 },
  refractivity: { id: 25, name: 'Refractivity', parent_id: 7 },
  atmosGraph: { id: 26, name: 'Atmospheric Correction Graph', parent_id: 7 },
  msrSystemStatus: { id: 31, name: 'MSR System Status', parent_id: 2 },
};

describe('docVariantFor', () => {
  it('routes each radar family to its document', () => {
    expect(docVariantFor('SSR461XT')).toBe('XT');
    expect(docVariantFor('SSR500FX')).toBe('FX');
    expect(docVariantFor('MSR300')).toBe('MSR');
  });

  it('gives PS its own variant and falls back to the SSR-FX sheet otherwise', () => {
    // PS reads the FX sheet but scores the DTM the way a Reutech does.
    expect(docVariantFor('PS2000')).toBe('PS');
    expect(docVariantFor('SSR530Omni')).toBe('FX');
    expect(docVariantFor('')).toBe('FX');
  });
});

describe('getDqpGuidance', () => {
  it('quotes the FX sheet for an FX radar and the XT sheet for an XT radar', () => {
    expect(getDqpGuidance(PARAM.scanMode, 'SSR500FX').entries[0].description).toMatch(/< 2\.8 km/);
    expect(getDqpGuidance(PARAM.scanMode, 'SSR461XT').entries[0].description).toMatch(/short range mode/);
  });

  it('quotes the Reutech sheet for an MSR', () => {
    const guidance = getDqpGuidance(PARAM.signalQuality, 'MSR300');
    expect(guidance.evidence).toMatch(/Amplitude Dispersion Index/);
    expect(guidance.entries[0].description).toMatch(/ADI patterns are stable/);
  });

  it('returns null for a parameter the radar-specific document does not cover', () => {
    // Coherence is an SSR concept; the Reutech sheet scores Confidence instead.
    expect(getDqpGuidance(PARAM.coherence, 'MSR300')).toBeNull();
    expect(getDqpGuidance(PARAM.msrSystemStatus, 'SSR500FX')).toBeNull();
    expect(getDqpGuidance({ id: 999, name: 'Levelling', parent_id: 3 }, 'SSR500FX')).toBeNull();
  });

  it('re-bands shared parameters onto the scale the row is scored on', () => {
    // The Reutech sheet calls intermittent data Sub-Optimal, a band this row does
    // not offer; the SSR sheets call the same condition Critical.
    const availability = getDqpGuidance(PARAM.dataAvailability, 'MSR300').entries;
    expect(availability.map((e) => e.status)).toEqual(['Optimal', 'Critical', 'Critical']);
    expect(availability[1].description).toMatch(/intermittent/);

    // Vector Loss: 50% is Sub-Optimal on the Reutech sheet, Acceptable on the SSR
    // scale this row uses; 30% moves from Critical to Sub-Optimal with it.
    const vectorLoss = getDqpGuidance({ id: 13, name: 'Vector Loss', parent_id: 3 }, 'MSR300').entries;
    expect(vectorLoss.map((e) => e.status)).toEqual(['Optimal', 'Acceptable', 'Sub-Optimal']);
    expect(vectorLoss[1].description).toMatch(/only 50%/);
    expect(vectorLoss[2].description).toMatch(/only 30%/);
  });

  it('bands 3D-DTM by how much the product leans on the DTM', () => {
    const dtm = { id: 28, name: '3D-DTM', parent_id: 8 };
    // Supporting data on an SSR - it never fails critically.
    expect(getDqpGuidance(dtm, 'SSR500FX').entries.map((e) => e.status)).toEqual([
      'Optimal',
      'Acceptable',
      'Sub-Optimal',
    ]);
    // Load-bearing on a PS: the SSR ladder plus the Reutech Critical band.
    expect(getDqpGuidance(dtm, 'PS2000').entries.map((e) => e.status)).toEqual([
      'Optimal',
      'Acceptable',
      'Sub-Optimal',
      'Critical',
    ]);
    // The Reutech sheet keeps its own three bands.
    expect(getDqpGuidance(dtm, 'MSR300').entries.map((e) => e.status)).toEqual([
      'Optimal',
      'Sub-Optimal',
      'Critical',
    ]);
  });

  it('scores alarm settings on the Reutech ladder for every radar', () => {
    const statuses = (radar) => getDqpGuidance(PARAM.alarmSettings, radar).entries.map((e) => e.status);
    const expected = ['Optimal', 'Acceptable', 'Sub-Optimal', 'Critical', 'N/A'];
    for (const radar of ['SSR500FX', 'SSR461XT', 'PS2000', 'MSR300']) {
      expect(statuses(radar).sort()).toEqual([...expected].sort());
    }
  });

  it('never describes a status the row cannot be set to', () => {
    const radars = ['SSR500FX', 'SSR461XT', 'MSR300', 'PS2000'];
    for (const radar of radars) {
      for (const param of Object.values(PARAM)) {
        const guidance = getDqpGuidance(param, radar);
        if (!guidance) continue;
        const allowed = getAllowedStatuses(param.name, radar);
        for (const entry of guidance.entries) {
          if (entry.status === 'N/A') {
            expect(canBeNotApplicable(param)).toBe(true);
          } else {
            expect(allowed).toContain(entry.status);
          }
        }
      }
    }
  });

  it('keeps the N/A band on the rows that may be left blank', () => {
    // Alarm rows, and the Reutech Masks row, which its sheet scores at 100%
    // when nothing needs masking.
    expect(getDqpGuidance(PARAM.alarmSettings, 'SSR500FX').entries.map((e) => e.status)).toContain('N/A');
    expect(getDqpGuidance(PARAM.masks, 'MSR300').entries.map((e) => e.status)).toContain('N/A');
    expect(
      getDqpGuidance({ id: 21, name: 'Manual/Alarm Masks', parent_id: 6 }, 'SSR500FX').entries.map((e) => e.status)
    ).toContain('N/A');

    // Everywhere else N/A means "not assessed" and is never described.
    expect(getDqpGuidance(PARAM.coherence, 'SSR500FX').entries.map((e) => e.status)).not.toContain('N/A');
  });

  it('splits the two atmospheric correction graphs between Refractivity and the graph row', () => {
    expect(getDqpGuidance(PARAM.refractivity, 'SSR500FX').title).toMatch(/at least one day of data/);
    expect(getDqpGuidance(PARAM.atmosGraph, 'SSR500FX').title).toMatch(/at least two days of data/);
  });

  it('gives the FX and XT sheets their own camera alignment wording', () => {
    expect(getDqpGuidance(PARAM.cameraAlignment, 'SSR500FX').entries[0].description).toMatch(/front view image/);
    expect(getDqpGuidance(PARAM.cameraAlignment, 'SSR461XT').entries[0].description).toMatch(/≤ 2 pixels/);
  });
});

// Every level-2 row in the parameters table, as the DB holds them.
const ALL_PARAMS = [
  { id: 9, name: 'Data Availability', parent_id: 2 },
  { id: 10, name: 'SSR Type & Scan Mode', parent_id: 2 },
  { id: 11, name: 'Signal Quality', parent_id: 2 },
  { id: 12, name: 'Scan Area Coverage', parent_id: 3 },
  { id: 13, name: 'Vector Loss', parent_id: 3 },
  { id: 14, name: 'Coherence', parent_id: 3 },
  { id: 15, name: 'Image Alignment', parent_id: 3 },
  { id: 16, name: 'Camera Alignment', parent_id: 4 },
  { id: 17, name: 'Photo Quality', parent_id: 4 },
  { id: 18, name: 'Sky-Short Range', parent_id: 5 },
  { id: 19, name: 'EDM', parent_id: 5 },
  { id: 20, name: 'Alarm Settings', parent_id: 6 },
  { id: 21, name: 'Manual/Alarm Masks', parent_id: 6 },
  { id: 22, name: 'Correction Source', parent_id: 7 },
  { id: 23, name: 'DSRA', parent_id: 7 },
  { id: 24, name: 'SRA Spread', parent_id: 7 },
  { id: 25, name: 'Refractivity', parent_id: 7 },
  { id: 26, name: 'Atmospheric Correction Graph', parent_id: 7 },
  { id: 27, name: 'Geo-Positioning', parent_id: 8 },
  { id: 28, name: '3D-DTM', parent_id: 8 },
  { id: 31, name: 'MSR System Status', parent_id: 2 },
  { id: 32, name: 'Confidence and Coverage', parent_id: 3 },
  { id: 33, name: 'Data Flags', parent_id: 3 },
  { id: 34, name: 'CCTV Availability', parent_id: 4 },
  { id: 35, name: 'MSR Atmospheric Correction', parent_id: 7 },
  { id: 36, name: 'Masks', parent_id: 5 },
];

/**
 * Rows a radar carries whose checkboxes the documents do not fully describe.
 * Every family is currently clean: each box an operator can tick has wording
 * behind it. A radar picking up an entry here means either a parameter was
 * added without guidance, or EXCLUDED_PARAMETER_IDS is handing a radar a row
 * from another product's sheet.
 *
 * Format: `{ [parameterId]: ['Missing', 'Statuses'] }`, or `'*'` for a row with
 * no guidance at all.
 */
const KNOWN_GAPS = {
  SSR500FX: {},
  SSR461XT: {},
  PS2000: {},
  MSR300: {},
};

describe('document coverage', () => {
  for (const radar of Object.keys(KNOWN_GAPS)) {
    it(`describes every box a ${radar} operator can tick, except the known gaps`, () => {
      const excluded = excludedParameterIds(radar);
      const gaps = {};

      for (const param of ALL_PARAMS) {
        if (excluded.has(param.id)) continue;

        const allowed = [...(getAllowedStatuses(param.name, radar) || [])];
        if (canBeNotApplicable(param)) allowed.push('N/A');

        const guidance = getDqpGuidance(param, radar);
        if (!guidance) {
          gaps[param.id] = '*';
          continue;
        }

        const covered = new Set(guidance.entries.map((e) => e.status));
        const missing = allowed.filter((s) => !covered.has(s));
        if (missing.length) gaps[param.id] = missing;
      }

      expect(gaps).toEqual(KNOWN_GAPS[radar]);
    });
  }
});
