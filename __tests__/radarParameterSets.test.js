const {
  classifyRadar,
  buildInitialDqpValues,
} = require('../config/radarParameterSets');

// Real rows from the parameters table.
const PARAMS = [
  { id: 1, parent_id: null, level: 0, weight: null },
  { id: 2, parent_id: 1, level: 1, weight: null },
  { id: 3, parent_id: 1, level: 1, weight: null },
  { id: 4, parent_id: 1, level: 1, weight: null },
  { id: 5, parent_id: 1, level: 1, weight: null },
  { id: 6, parent_id: 1, level: 1, weight: null },
  { id: 7, parent_id: 1, level: 1, weight: null },
  { id: 8, parent_id: 1, level: 1, weight: null },
  { id: 9, parent_id: 2, level: 2, weight: 0.2 },
  { id: 10, parent_id: 2, level: 2, weight: 0.05 },
  { id: 11, parent_id: 2, level: 2, weight: 0.08 },
  { id: 12, parent_id: 3, level: 2, weight: 0.06 },
  { id: 13, parent_id: 3, level: 2, weight: 0.08 },
  { id: 14, parent_id: 3, level: 2, weight: 0.13 },
  { id: 15, parent_id: 3, level: 2, weight: 0.04 },
  { id: 16, parent_id: 4, level: 2, weight: 0.02 },
  { id: 17, parent_id: 4, level: 2, weight: 0.02 },
  { id: 18, parent_id: 5, level: 2, weight: 0.02 },
  { id: 19, parent_id: 5, level: 2, weight: 0.02 },
  { id: 20, parent_id: 6, level: 2, weight: 0.07 },
  { id: 21, parent_id: 6, level: 2, weight: 0.06 },
  { id: 22, parent_id: 7, level: 2, weight: 0.03 },
  { id: 23, parent_id: 7, level: 2, weight: 0.02 },
  { id: 24, parent_id: 7, level: 2, weight: 0.02 },
  { id: 25, parent_id: 7, level: 2, weight: 0.02 },
  { id: 26, parent_id: 7, level: 2, weight: 0.02 },
  { id: 27, parent_id: 8, level: 2, weight: 0.02 },
  { id: 28, parent_id: 8, level: 2, weight: 0.02 },
  // The Reutech-only rows, added after this fixture was first written.
  { id: 31, parent_id: 2, level: 2, weight: 0.05 },
  { id: 32, parent_id: 3, level: 2, weight: 0.13 },
  { id: 33, parent_id: 3, level: 2, weight: 0.04 },
  { id: 34, parent_id: 4, level: 2, weight: 0.04 },
  { id: 35, parent_id: 7, level: 2, weight: 0.11 },
  { id: 36, parent_id: 5, level: 2, weight: 0.04 },
];

test('classifies real radar numbers', () => {
  expect(classifyRadar('SSR844FX')).toBe('FX');
  expect(classifyRadar('SSR994FX')).toBe('FX');
  expect(classifyRadar('SSR460XT')).toBe('XT');
  expect(classifyRadar('SSR461XT')).toBe('XT');
  expect(classifyRadar('PS2000')).toBe('PS');
  expect(classifyRadar('MSR254')).toBe('MSR');
  expect(classifyRadar('SSR530Omni')).toBe('ALL');
  expect(classifyRadar('ssr844fx')).toBe('FX');
});

const idsFor = (radar) => buildInitialDqpValues(radar, PARAMS, 1).map((v) => v.parameter_id);
const numeric = (radar, id) =>
  buildInitialDqpValues(radar, PARAMS, 1).find((v) => v.parameter_id === id)?.value_numeric;

test('FX keeps the 28 SSR rows, drops the Reutech ones, and Overall sums to 1.0', () => {
  const ids = idsFor('SSR844FX');
  expect(ids).toHaveLength(28);
  for (const reutechOnly of [31, 32, 33, 34, 35, 36]) expect(ids).not.toContain(reutechOnly);
  expect(numeric('SSR844FX', 1)).toBeCloseTo(1.0, 6);
  expect(numeric('SSR844FX', 2)).toBeCloseTo(0.33, 6); // System Health
  expect(numeric('SSR844FX', 3)).toBeCloseTo(0.31, 6); // Scan Area
  expect(numeric('SSR844FX', 7)).toBeCloseTo(0.11, 6); // Atmospheric Correction
});

test('Omni falls back to the full SSR set', () => {
  expect(idsFor('SSR530Omni')).toHaveLength(28);
  expect(numeric('SSR530Omni', 1)).toBeCloseTo(1.0, 6);
});

test('XT drops Visual Data (8, 27, 28) and Image Alignment (15)', () => {
  const ids = idsFor('SSR460XT');
  expect(ids).toHaveLength(24);
  for (const dropped of [8, 15, 27, 28]) expect(ids).not.toContain(dropped);
  expect(numeric('SSR460XT', 3)).toBeCloseTo(0.27, 6); // 0.31 - 0.04
  expect(numeric('SSR460XT', 1)).toBeCloseTo(0.92, 6); // 1.0 - 0.04 - 0.04
});

test('PS drops Photograph, Masks and the whole Atmospheric group', () => {
  const ids = idsFor('PS2000');
  expect(ids).toHaveLength(14);
  for (const d of [4, 5, 7, 10, 14, 16, 17, 18, 19, 22, 23, 24, 25, 26]) expect(ids).not.toContain(d);
  expect(numeric('PS2000', 2)).toBeCloseTo(0.28, 6); // 0.2 + 0.08
  expect(numeric('PS2000', 3)).toBeCloseTo(0.18, 6); // 0.06 + 0.08 + 0.04
});

test('MSR keeps the Reutech rows and drops the SSR-only ones', () => {
  const ids = idsFor('MSR254');
  expect(ids).toHaveLength(20);
  // Coherence, Manual/Alarm Masks and Refractivity have no Reutech counterpart.
  for (const d of [10, 14, 15, 16, 17, 18, 19, 21, 22, 23, 24, 25, 26, 27]) expect(ids).not.toContain(d);
  for (const kept of [31, 32, 33, 34, 35, 36]) expect(ids).toContain(kept);
  // Groups 4 and 5 survive on one child each — CCTV Availability and Masks.
  expect(ids).toContain(4);
  expect(ids).toContain(5);
  expect(numeric('MSR254', 4)).toBeCloseTo(0.04, 6); // CCTV Availability only
  expect(numeric('MSR254', 5)).toBeCloseTo(0.04, 6); // Masks only
  expect(numeric('MSR254', 7)).toBeCloseTo(0.11, 6); // Atmospheric Correction only
  expect(numeric('MSR254', 8)).toBeCloseTo(0.02, 6); // 3D-DTM only
  // Matches the Reutech sheet, whose own weights add up to 92%.
  expect(numeric('MSR254', 1)).toBeCloseTo(0.92, 6);
});

test('no parent is left with children that were all excluded', () => {
  for (const radar of ['SSR844FX', 'SSR460XT', 'PS2000', 'MSR254', 'SSR530Omni']) {
    const rows = buildInitialDqpValues(radar, PARAMS, 1);
    for (const row of rows) {
      const p = PARAMS.find((x) => x.id === row.parameter_id);
      if (p.level !== 1) continue;
      expect(row.value_numeric).toBeGreaterThan(0);
    }
  }
});

test('every row is Optimal and Overall equals the sum of its groups', () => {
  for (const radar of ['SSR844FX', 'SSR460XT', 'PS2000', 'MSR254']) {
    const rows = buildInitialDqpValues(radar, PARAMS, 7);
    expect(rows.every((r) => r.value === 'Optimal')).toBe(true);
    expect(rows.every((r) => r.dqp_record_id === 7)).toBe(true);

    const groups = rows.filter((r) => PARAMS.find((p) => p.id === r.parameter_id).level === 1);
    const overall = rows.find((r) => r.parameter_id === 1).value_numeric;
    expect(overall).toBeCloseTo(groups.reduce((a, g) => a + g.value_numeric, 0), 6);

    const leaves = rows.filter((r) => PARAMS.find((p) => p.id === r.parameter_id).level === 2);
    expect(overall).toBeCloseTo(leaves.reduce((a, l) => a + l.value_numeric, 0), 6);
  }
});
