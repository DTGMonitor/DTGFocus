import {
  quantile,
  modeOf,
  summarise,
  extractVelocitySamples,
  statsByVcp,
  vcpUsage,
  numericStats,
  categoryCounts,
  formatStat,
} from '@/utils/failureStats';

const failure = (id, properties, def_type = 'Failure') => ({ id, def_type, properties });

describe('quantile', () => {
  test('matches Excel PERCENTILE.INC', () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(quantile(s, 0.5)).toBeCloseTo(5.5);
    expect(quantile(s, 0.1)).toBeCloseTo(1.9);
  });

  test('a single value is every quantile', () => {
    expect(quantile([7], 0.1)).toBe(7);
  });

  test('empty gives null', () => {
    expect(quantile([], 0.5)).toBeNull();
  });
});

describe('modeOf', () => {
  test('returns every tied value', () => {
    expect(modeOf([1, 1, 2, 2, 3])).toEqual({ values: [1, 2], count: 2 });
  });

  test('no repeat means no mode', () => {
    expect(modeOf([1, 2, 3])).toEqual({ values: [], count: 1 });
  });

  test('a lone sample is its own mode', () => {
    expect(modeOf([4])).toEqual({ values: [4], count: 1 });
  });

  test('compares at the given precision', () => {
    expect(modeOf([0.33333, 0.333301], 4).values).toEqual([0.3333]);
  });
});

describe('summarise', () => {
  test('P90 excludes the smallest 10%', () => {
    const s = summarise([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(s.n).toBe(10);
    expect(s.mean).toBeCloseTo(55);
    expect(s.median).toBeCloseTo(55);
    expect(s.p90).toBeCloseTo(19);
    expect(s.min).toBe(10);
    expect(s.max).toBe(100);
  });

  test('empty input is all nulls', () => {
    expect(summarise([])).toMatchObject({ n: 0, mean: null, median: null, p90: null });
  });
});

describe('extractVelocitySamples', () => {
  const records = [
    failure(1, { Vmax1: '2', InverseVelocity1: '0.5', VCP1: 60, Vmax2: 1, VCP2: 1440 }),
    failure(2, { Vmax1: 4, VCP1: '60' }),
    failure(3, { Vmax1: 99, VCP1: 60 }, 'Linear'),
  ];

  test('takes both sets, skips non-failures and empty sets', () => {
    const samples = extractVelocitySamples(records);
    expect(samples.map((s) => [s.recordId, s.set])).toEqual([[1, 1], [1, 2], [2, 1]]);
  });

  test('derives a missing inverse velocity from Vmax and flags it', () => {
    const [, second, third] = extractVelocitySamples(records);
    expect(second.inverseVelocity).toBeCloseTo(1);
    expect(second.inverseDerived).toBe(true);
    expect(third.inverseVelocity).toBeCloseTo(0.25);
  });

  test('a set filter narrows to that set', () => {
    expect(extractVelocitySamples(records, '2').map((s) => s.set)).toEqual([2]);
  });
});

describe('statsByVcp', () => {
  const records = [
    failure(1, { Vmax1: 2, VCP1: 60, Vmax2: 10, VCP2: 1440 }),
    failure(2, { Vmax1: 4, VCP1: 60 }),
    failure(3, { Vmax2: 6, VCP2: 60 }),
    failure(4, { Vmax1: 8 }),
  ];

  test('never pools velocities measured over different VCPs', () => {
    const rows = statsByVcp(records, 'velocity');
    expect(rows.map((r) => [r.vcp, r.unit, r.n])).toEqual([
      [60, 'mm/h', 3],
      [1440, 'mm/d', 1],
      [null, null, 1],
    ]);
    expect(rows[0].mean).toBeCloseTo(4);
  });

  test('inverse velocity takes the inverse unit', () => {
    const rows = statsByVcp(records, 'inverseVelocity');
    expect(rows[0].unit).toBe('h/mm');
    expect(rows[1].unit).toBe('d/mm');
  });
});

describe('vcpUsage', () => {
  test('counts failures per VCP, not samples', () => {
    const records = [
      failure(1, { VCP1: 60, VCP2: 60 }),
      failure(2, { VCP1: 60, VCP2: 720 }),
    ];
    const { usage, stats } = vcpUsage(records);
    expect(usage).toEqual([
      { vcp: 60, records: 2, share: 1 },
      { vcp: 720, records: 1, share: 0.5 },
    ]);
    expect(stats.n).toBe(4);
  });
});

describe('numericStats and categoryCounts', () => {
  const records = [
    failure(1, { MaximumDeformation: '12.5', TypeOfFailure: 'Wedge', Materials: '' }),
    failure(2, { MaximumDeformation: 7.5, TypeOfFailure: 'wedge ' }),
    failure(3, { TypeOfFailure: 'Planar' }),
  ];

  test('numeric properties ignore blanks', () => {
    expect(numericStats(records, 'MaximumDeformation')).toMatchObject({ n: 2, mean: 10 });
  });

  test('categories fold case and whitespace, blanks last', () => {
    expect(categoryCounts(records, 'TypeOfFailure').map((c) => [c.label, c.count])).toEqual([
      ['Wedge', 2],
      ['Planar', 1],
    ]);
    expect(categoryCounts(records, 'Materials').map((c) => [c.label, c.count])).toEqual([
      ['Not recorded', 3],
    ]);
  });
});

test('formatStat trims trailing zeros and dashes blanks', () => {
  expect(formatStat(1.5, 4)).toBe('1.5');
  expect(formatStat(null)).toBe('—');
});
