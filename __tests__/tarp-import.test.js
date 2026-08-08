/**
 * Reading a client's TARP workbook — both chart layouts.
 *
 * The grids here are transcribed from the two shapes that actually arrive:
 * the one-row-per-trigger workbooks the export was modelled on, and the
 * Indonesian parameter x risk-band matrix.
 */

import {
  classifyParameterRow,
  detectLayout,
  matchDefType,
  parseTarpGrid,
  splitCellText,
  toImportPayload,
} from '../utils/tarpImport';

// The attached chart, as ExcelJS reads it: bold trigger name over a plain
// description, and "Koneksi Data" merged down two rows so only the first
// carries the text.
const bold = (label, description) => ({
  text: description ? `${label}\n${description}` : label,
  boldPrefix: label,
});

const MATRIX_GRID = [
  ['PARAMETER', 'N/A', 'Low', 'Intermediate', 'Moderate', 'Extreme'],
  [
    'Pola Deformasi',
    '',
    bold('Indikasi Pola Longsoran',
      'Terjadi indikasi pola longsoran setelah adanya tren deformasi yang teridentifikasi'),
    '',
    bold('Pola Deformasi Linear',
      'Teridentifikasi tren pergerakan lereng yang konsisten (kecepatan konstan)'),
    bold('Pola Deformasi Progresif',
      'Terindikasi pergerakan lereng progresif (akseleratif)'),
  ],
  ['Koneksi Data', 'Offline Scheduled', 'Kontaminasi Data', 'Pembaruan Data Terputus', '', ''],
  ['', '', '', 'Koneksi Terputus', '', ''],
];

const ROW_GRID = [
  ['Genesis Minerals'],
  ['Radar - Trigger Action Response Plan Chart'],
  [],
  ['RISK RATING', 'TARP Band', 'Trigger', 'Description', 'Day Shift', 'NightShift', 'Comment', 'Note'],
  ['Extreme', 'TARP Trigger 4 - Red', 'Progressive trend',
    'Progressive (accelerating) slope displacement trend is identified',
    'Call Geotech', 'Call Geotech', '1. State area of concern\n2. Conduct velocity analysis', ''],
  ['', 'TARP Trigger 4 - Red', 'Red Alarm', 'A genuine Red Alarm is triggered',
    'Call Geotech', 'Call Geotech', '1. State alarm area', ''],
  ['Moderate', 'TARP Trigger 3 - Orange', 'Linear trend',
    'A consistent linear (constant velocity) displacement trend is identified',
    'Email Geotech', 'Email Geotech', '', 'Version 3 moved this to email'],
];

describe('layout detection', () => {
  it('reads a band header row as the matrix layout', () => {
    const detected = detectLayout(MATRIX_GRID);
    expect(detected.layout).toBe('matrix');
    expect(detected.headerRow).toBe(0);
    expect(detected.parameterColumn).toBe(0);
    // N/A is a band, not an absence of one — it maps to a null risk rating.
    expect(detected.columns).toEqual({
      1: null, 2: 'Low', 3: 'Intermediate', 4: 'Moderate', 5: 'Extreme',
    });
  });

  it('reads an attribute header row as the row layout, past the title rows', () => {
    const detected = detectLayout(ROW_GRID);
    expect(detected.layout).toBe('row');
    expect(detected.headerRow).toBe(3);
    expect(detected.columns[2]).toBe('triggerLabel');
    expect(detected.columns[5]).toBe('nightShift');
  });

  it('recognises Indonesian headers in either layout', () => {
    expect(detectLayout([['PARAMETER', 'Rendah', 'Menengah', 'Sedang', 'Ekstrem']]).layout)
      .toBe('matrix');
    expect(detectLayout([['Tingkat Risiko', 'Pemicu', 'Deskripsi', 'Shift Siang']]).layout)
      .toBe('row');
  });

  it('returns null when the sheet holds no TARP table', () => {
    expect(detectLayout([['Date', 'Sensor', 'Velocity'], ['1 Jan', 'R01', '2.4']])).toBeNull();
  });
});

describe('cell text', () => {
  it('takes the bold run as the trigger name and the rest as the description', () => {
    expect(splitCellText(bold('Pola Deformasi Linear', 'Teridentifikasi tren.')))
      .toEqual({ label: 'Pola Deformasi Linear', description: 'Teridentifikasi tren.' });
  });

  it('falls back to the first line when nothing is bold', () => {
    expect(splitCellText('Kontaminasi Data\nData terkontaminasi'))
      .toEqual({ label: 'Kontaminasi Data', description: 'Data terkontaminasi' });
  });

  it('leaves a single-line cell as a name with no description', () => {
    expect(splitCellText('Koneksi Terputus'))
      .toEqual({ label: 'Koneksi Terputus', description: null });
  });
});

describe('deformation types', () => {
  it('matches the Indonesian wording the matrix charts use', () => {
    expect(matchDefType('Pola Deformasi Progresif', 'pergerakan lereng progresif (akseleratif)'))
      .toBe('Progressive');
    expect(matchDefType('Pola Deformasi Linear', 'tren yang konsisten (kecepatan konstan)'))
      .toBe('Linear');
    expect(matchDefType('Indikasi Pola Longsoran', 'terjadi indikasi pola longsoran'))
      .toBe('Failure');
  });

  it('prefers the accelerating variant over a plain linear trend', () => {
    expect(matchDefType('Linear accelerating trend')).toBe('Linear Accelerating');
    expect(matchDefType('Linear trend')).toBe('Linear');
  });

  it('gives connection and data-quality rows no type at all', () => {
    // These print on the chart and must drive no email subject.
    expect(matchDefType('Koneksi Terputus')).toBeNull();
    expect(matchDefType('Kontaminasi Data')).toBeNull();
    expect(matchDefType('Offline Scheduled')).toBeNull();
    expect(matchDefType('Pembaruan Data Terputus')).toBeNull();
  });

  it('still reads Fall of Ground as a failure', () => {
    expect(matchDefType('Fall of Ground', 'Uncontrolled fall of ground (FOG) occurs'))
      .toBe('Failure');
  });
});

describe('parsing the matrix layout', () => {
  const result = parseTarpGrid(MATRIX_GRID);
  const byLabel = (label) => result.triggers.find((t) => t.triggerLabel === label);

  it('makes one trigger of every populated cell', () => {
    expect(result.layout).toBe('matrix');
    // Three across the Pola Deformasi row, three across Koneksi Data, and the
    // one on the continuation row beneath it.
    expect(result.triggers).toHaveLength(7);
  });

  it('takes the risk band from the column and the parameter from the row', () => {
    expect(byLabel('Pola Deformasi Progresif')).toMatchObject({
      parameter: 'Pola Deformasi', riskRating: 'Extreme', colour: 'red', tarpLevel: 4,
      defType: 'Progressive',
    });
    expect(byLabel('Kontaminasi Data')).toMatchObject({
      parameter: 'Koneksi Data', riskRating: 'Low', defType: null,
    });
  });

  it('carries a merged parameter cell down the rows it spans', () => {
    // "Koneksi Terputus" sits on the row where the parameter cell is blank.
    expect(byLabel('Koneksi Terputus').parameter).toBe('Koneksi Data');
  });

  it('treats the N/A column as the absence of a band, not a band called N/A', () => {
    expect(byLabel('Offline Scheduled')).toMatchObject({
      riskRating: null, colour: 'grey', tarpLevel: null,
    });
  });

  it('orders the rows most severe first, so the chart merges each band', () => {
    // N/A brings up the rear, as it does on every reference chart.
    expect(result.triggers.map((t) => t.riskRating))
      .toEqual(['Extreme', 'Moderate', 'Intermediate', 'Intermediate', 'Low', 'Low', null]);
  });

  it('says the shift columns are missing rather than inventing them', () => {
    expect(result.triggers.every((t) => t.dayShift === null)).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/Day Shift/);
  });
});

describe('parsing the row layout', () => {
  const result = parseTarpGrid(ROW_GRID);

  it('reads each row as a trigger, skipping the title rows above the header', () => {
    expect(result.layout).toBe('row');
    expect(result.triggers.map((t) => t.triggerLabel))
      .toEqual(['Progressive trend', 'Red Alarm', 'Linear trend']);
  });

  it('carries a merged risk-rating cell down its band', () => {
    expect(result.triggers[1]).toMatchObject({ triggerLabel: 'Red Alarm', riskRating: 'Extreme' });
  });

  it('keeps the workbook band label rather than substituting its own', () => {
    expect(result.triggers[0].bandLabel).toBe('TARP Trigger 4 - Red');
  });

  it('splits the numbered comment list back into its lines', () => {
    expect(result.triggers[0].comments)
      .toEqual(['1. State area of concern', '2. Conduct velocity analysis']);
  });

  it('reads an alarm row as gated on an alarm and driving no deformation type', () => {
    expect(result.triggers[1]).toMatchObject({
      requiresAlarm: true, defType: null, colour: 'red',
    });
  });

  it('takes the response from what the shift cell actually says', () => {
    expect(result.triggers[0].responseMethod).toBe('call');
    expect(result.triggers[2].responseMethod).toBe('email');
  });
});

describe('guardrails', () => {
  it('assigns a deformation type to one row only', () => {
    const result = parseTarpGrid([
      ['RISK RATING', 'Trigger', 'Description'],
      ['Extreme', 'Progressive trend', 'A progressive trend is identified'],
      ['Extreme', 'Progressive trend (repeat)', 'Another progressive trend'],
    ]);

    expect(result.triggers.map((t) => t.defType)).toEqual(['Progressive', null]);
    expect(result.warnings.join(' ')).toMatch(/both look like Progressive/);
  });

  it('counts the rows it could not place', () => {
    // The four Koneksi Data cells: connectivity and data quality are not trends.
    expect(parseTarpGrid(MATRIX_GRID).warnings.join(' '))
      .toMatch(/4 rows could not be matched to a deformation type/);
  });

  it('says what it looked for when the sheet is not a TARP', () => {
    const result = parseTarpGrid([['Date', 'Sensor'], ['1 Jan', 'R01']]);
    expect(result.layout).toBeNull();
    expect(result.triggers).toEqual([]);
    expect(result.warnings[0]).toMatch(/No TARP table was recognised/);
  });
});

/**
 * The PTVI chart, as issued. It differs from the crop above in three ways that
 * each break a naive cell sweep: a second label column, parameter rows that
 * state responses rather than triggers, and appendices below the table.
 */
const PTVI_GRID = [
  ['PTVI'],
  ['Radar - Bagan Trigger Action Response Plan'],
  ['Diajukan Oleh:', 'Lintang Putra Sadewa', '', '', 'Tanggal Pengesahan', '8-Aug-26'],
  ['Disetujui Oleh:'],
  ['PARAMETER', '', 'N/A', 'Low', 'Intermediate', 'Moderate', 'Extreme'],
  ['Pola Deformasi', '', '',
    bold('Indikasi Pola Longsoran',
      'Terjadi indikasi pola longsoran setelah adanya pola deformasi yang teridentifikasi'),
    '',
    bold('Pola Deformasi Linear',
      'Terindikasi pola pergerakan lereng yang konsisten (kecepatan konstan)'),
    bold('Pola Deformasi Progresif', 'Terindikasi pergerakan lereng progresif (akseleratif)')],
  ['', '', '',
    bold('Kontaminasi Data',
      'Kontaminasi data yang signifikan mengganggu kemampuan engineer untuk menganalisis dan menginterpretasi data'),
    '', '', ''],
  ['Koneksi Data', '',
    bold('Offline Terjadwal',
      'Monitoring Centre tidak dapat melakukan pemantauan jarak jauh karena adanya pemeliharaan terjadwal'),
    '', '', '', ''],
  ['', '', bold('Pembaruan Data Terputus', 'Tidak ada data terbaru pada dashboard'), '', '', '', ''],
  ['', '', bold('Koneksi Terputus',
    'Koneksi antara Monitoring Centre DTG dan lokasi tambang terputus'), '', '', '', ''],
  ['TARP Site', '', '',
    'LEVEL 1\n1. Pergerakan total 0-100 mm, atau\n2. Kecepatan pergerakan <5 mm/hari',
    'LEVEL 2\n1. Pergerakan total 100-150 mm, atau\n2. Kecepatan pergerakan 5-35 mm/hari.',
    'LEVEL 3\n1. Pergerakan total >150 mm, atau\n2. Kecepatan pergerakan 35-100 mm/hari.',
    'LEVEL 4\n1. Kecepatan pergerakan >100 mm/hari.'],
  ['', '', '', '', 'Hujan\n1. Intensitas hujan per jam (hourly) >20 mm/jam', '', ''],
  ['Action', 'GILIR KERJA: PAGI',
    '1. Telfon Geotek/IT\n2. WhatsApp\n3. Email semua kontak',
    '1. WhatsApp\n2. Email semua kontak',
    '1. WhatsApp\n2. Email semua kontak',
    '1. Telfon Geotek (Apabila memenuhi TARP 3)\n2. WhatsApp\n3. Email semua kontak',
    '1. Telfon Geotek\n2. WhatsApp\n3. Email semua kontak'],
  ['', 'GILIR KERJA: MALAM',
    '1. Telfon Geotek\n2. WhatsApp\n3. Email semua kontak',
    '1. WhatsApp\n2. Email semua kontak',
    '1. WhatsApp\n2. Email semua kontak',
    '1. Telfon Geotek (Apabila memenuhi TARP 3)\n2. WhatsApp\n3. Email semua kontak',
    '1. Telfon Geotek\n2. WhatsApp\n3. Email semua kontak'],
  ['Keterangan', '',
    '1. Nyatakan periode waktu sistem offline.\n2. Sampaikan bahwa tautan pemantauan terputus.',
    '1. LEVEL 1: Pantau sesuai prosedur TARP Trigger 1.\n2. Indikasi pola longsoran: harus dilaporkan.',
    '1. Pantau sesuai prosedur TARP Trigger 2\n2. Hujan: harus dilaporkan.',
    '1. Pantau sesuai prosedur TARP Trigger 3',
    '1. Nyatakan area yang menjadi perhatian\n2. Lakukan analisis kecepatan pergerakan'],
  [],
  ['Dedicated 24/7 Phone Line Contact'],
  ['Contact', 'Name', 'Role / Position', 'Telephone', 'Email', 'Remarks'],
  ['', 'Dadang Aryanda', 'Spv Mine Geotech', '085255675433', '', ''],
  ['', 'Novika Chandra', 'Geotech Engineer', '089654060826', '', ''],
  [],
  ['Email Distribution List'],
  ['Contact', 'Name', 'Role / Position', 'Telephone', 'Email', 'Remarks'],
  ['', 'Rusmin', 'Mgr Geotech & Hydrology', '', 'Rusmin.Syahid.Arianto@vale.com', ''],
  ['', 'Dadang', 'Spv Mine Geotech', '', 'Dadang.aryanda@vale.com', ''],
];

describe('the PTVI chart as issued', () => {
  const result = parseTarpGrid(PTVI_GRID);
  const byLabel = (label) => result.triggers.find((t) => t.triggerLabel === label);

  it('imports the trigger rows and the site\'s levels, not the response rows', () => {
    // The Action and Keterangan rows hold ten populated cells between them.
    // Read as triggers they would swamp the chart.
    expect(result.triggers.map((t) => t.triggerLabel)).toEqual([
      'Pola Deformasi Progresif',
      'LEVEL 4',
      'Pola Deformasi Linear',
      'LEVEL 3',
      'LEVEL 2',
      'Hujan',
      'Indikasi Pola Longsoran',
      'Kontaminasi Data',
      'LEVEL 1',
      'Offline Terjadwal',
      'Pembaruan Data Terputus',
      'Koneksi Terputus',
    ]);
  });

  it('reads LEVEL 1-4 as the site\'s alarm settings', () => {
    // The same rows the DTG standard charts call Red / Orange / Yellow Alarm,
    // written as thresholds instead of colours. findAlarmTrigger() matches them
    // on colour, so the colour is what has to be right.
    expect(byLabel('LEVEL 4')).toMatchObject({
      requiresAlarm: true, defType: null, colour: 'red', tarpLevel: 4,
      bandLabel: 'TARP Trigger 4 (Red)',
    });
    expect(byLabel('LEVEL 3')).toMatchObject({ requiresAlarm: true, colour: 'orange', tarpLevel: 3 });
    expect(byLabel('LEVEL 2')).toMatchObject({ requiresAlarm: true, colour: 'yellow', tarpLevel: 2 });
    expect(byLabel('LEVEL 1')).toMatchObject({ requiresAlarm: true, colour: 'green', tarpLevel: 1 });
  });

  it('keeps each level\'s thresholds as its description', () => {
    expect(byLabel('LEVEL 3').description)
      .toBe('1. Pergerakan total >150 mm, atau 2. Kecepatan pergerakan 35-100 mm/hari.');
  });

  it('reads Hujan on the same row as rainfall, not as a threshold', () => {
    expect(byLabel('Hujan')).toMatchObject({
      defType: 'Rainfall Event', requiresAlarm: false, riskRating: 'Intermediate', tarpLevel: 2,
    });
    expect(byLabel('Hujan').description).toContain('>20 mm/jam');
  });

  it('reads the parameter axis across both label columns', () => {
    expect(byLabel('Pola Deformasi Progresif').parameter).toBe('Pola Deformasi');
    expect(byLabel('Koneksi Terputus').parameter).toBe('Koneksi Data');
  });

  it('gives each trigger the shift responses stated for its band', () => {
    expect(byLabel('Pola Deformasi Progresif').dayShift)
      .toBe('1. Telfon Geotek\n2. WhatsApp\n3. Email semua kontak');
    expect(byLabel('Offline Terjadwal').dayShift)
      .toBe('1. Telfon Geotek/IT\n2. WhatsApp\n3. Email semua kontak');
    expect(byLabel('Offline Terjadwal').nightShift)
      .toBe('1. Telfon Geotek\n2. WhatsApp\n3. Email semua kontak');
  });

  it('reads "Telfon ... Email" as a call then an email, not email only', () => {
    // The row says to phone first. Matching only English would have seen the
    // word "Email" alone and printed EMAIL ONLY over a call.
    expect(byLabel('Pola Deformasi Progresif').responseMethod).toBe('call_then_email');
    expect(byLabel('Indikasi Pola Longsoran').responseMethod).toBe('email');
  });

  it('takes the TARP level from the site\'s own LEVEL rows', () => {
    // Low would default to no level at all; this chart numbers it 1.
    expect(byLabel('Indikasi Pola Longsoran').tarpLevel).toBe(1);
    expect(byLabel('Pola Deformasi Linear').tarpLevel).toBe(3);
    expect(byLabel('Pola Deformasi Progresif').tarpLevel).toBe(4);
  });

  it('does not repeat the thresholds onto every row of the band', () => {
    // They are a row of their own now; duplicating them would be noise.
    expect(byLabel('Pola Deformasi Linear').extraNote).toBeNull();
  });

  it('turns the Keterangan row into that band\'s comments', () => {
    expect(byLabel('Pola Deformasi Progresif').comments).toEqual([
      '1. Nyatakan area yang menjadi perhatian',
      '2. Lakukan analisis kecepatan pergerakan',
    ]);
  });

  it('still recognises the deformation types through the Indonesian', () => {
    expect(byLabel('Pola Deformasi Progresif').defType).toBe('Progressive');
    expect(byLabel('Pola Deformasi Linear').defType).toBe('Linear');
    expect(byLabel('Indikasi Pola Longsoran').defType).toBe('Failure');
    expect(byLabel('Koneksi Terputus').defType).toBeNull();
  });

  it('stops at the contact tables instead of importing them as triggers', () => {
    expect(result.triggers.some((t) => /Role|Name|Contact/i.test(t.triggerLabel))).toBe(false);
  });

  it('reads the escalation list', () => {
    expect(result.contacts).toEqual([
      { name: 'Dadang Aryanda', role: 'Spv Mine Geotech', phone: '085255675433', email: null },
      { name: 'Novika Chandra', role: 'Geotech Engineer', phone: '089654060826', email: null },
    ]);
  });

  it('reads the distribution list as the free-text block the document stores', () => {
    expect(result.distributionRaw).toBe(
      '"Rusmin" <Rusmin.Syahid.Arianto@vale.com>\n"Dadang" <Dadang.aryanda@vale.com>'
    );
  });

  it('takes the site and chart names from above the table', () => {
    expect(result.heading).toBe('PTVI');
    expect(result.title).toBe('Radar - Bagan Trigger Action Response Plan');
  });

  it('leaves no band empty, now that the levels are rows of their own', () => {
    expect(result.warnings.join(' ')).not.toMatch(/has no trigger row/);
    expect(new Set(result.triggers.map((t) => t.riskRating)))
      .toEqual(new Set(['Extreme', 'Moderate', 'Intermediate', 'Low', null]));
  });

  it('does not claim the shift columns are missing when they are not', () => {
    expect(result.warnings.join(' ')).not.toMatch(/states no shift responses/);
  });
});

describe('parameter row roles', () => {
  it('reads the deepest label, so Action defers to the shift beneath it', () => {
    expect(classifyParameterRow(['Action', 'GILIR KERJA: PAGI'])).toBe('dayShift');
    expect(classifyParameterRow(['Action', 'GILIR KERJA: MALAM'])).toBe('nightShift');
    expect(classifyParameterRow(['Action'])).toBe('response');
    expect(classifyParameterRow(['Keterangan'])).toBe('comments');
    expect(classifyParameterRow(['TARP Site'])).toBe('levels');
  });

  it('treats anything it does not recognise as a trigger row', () => {
    expect(classifyParameterRow(['Pola Deformasi'])).toBe('trigger');
    expect(classifyParameterRow(['Koneksi Data'])).toBe('trigger');
    expect(classifyParameterRow([])).toBe('trigger');
  });
});

describe('payload', () => {
  it('maps a parsed row onto what the TARP RPCs take', () => {
    const [first] = parseTarpGrid(MATRIX_GRID).triggers;
    expect(toImportPayload(first, 0)).toMatchObject({
      sort_order: 1,
      parameter: 'Pola Deformasi',
      risk_rating: 'Extreme',
      trigger_label: 'Pola Deformasi Progresif',
      def_type: 'Progressive',
      // The RPC casts this with NULLIF(...,'')::smallint, so a level of none
      // has to travel as an empty string rather than as null.
      tarp_level: '4',
      requires_alarm: false,
    });
  });

  it('sends an absent TARP level as the empty string the RPC expects', () => {
    const offline = parseTarpGrid(MATRIX_GRID).triggers
      .find((t) => t.triggerLabel === 'Offline Scheduled');
    expect(toImportPayload(offline, 5).tarp_level).toBe('');
  });
});
