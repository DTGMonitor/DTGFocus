/**
 * tarpImport.js — read a client's own TARP workbook into trigger rows.
 *
 * Sites do not all draw their TARP the same way, and neither layout is wrong,
 * so the importer reads both rather than asking a client to redraw theirs:
 *
 *   ROW layout — the Leonora / Telfer / Genesis workbooks and this app's own
 *   export. One row per trigger, one column per attribute:
 *
 *     RISK RATING | TARP Band | Trigger | Description | Day Shift | ...
 *     Extreme     | Trigger 4 | Progressive trend | ...
 *
 *   MATRIX layout — the newer Indonesian charts. Parameters down the side,
 *   risk bands across the top, and each populated CELL is a trigger:
 *
 *     PARAMETER      | N/A | Low          | Intermediate | Moderate | Extreme
 *     Pola Deformasi |     | Indikasi ... |              | Linear   | Progresif
 *     Koneksi Data   | ... | Kontaminasi  | Pembaruan .. |          |
 *
 * The matrix has no Day Shift / Night Shift / Comment columns at all, and its
 * cells carry a bold trigger name over a description. What it does carry that
 * the row layout does not is the PARAMETER — which is why `parameter` exists on
 * tarp_triggers (migration 011).
 *
 * Everything above `readTarpFile` is DOM-free and ExcelJS-free so it can be
 * unit-tested against a plain cell grid.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * A spreadsheet cannot state which rows drive an email. `defType`, `tarpLevel`
 * and `requiresAlarm` decide what a client's inbox receives at 2am, so they are
 * SUGGESTED here — matched on wording, in both languages — and every suggestion
 * is surfaced for the engineer to confirm before anything is published. A row
 * the importer could not place keeps `defType: null`, which is inert: it prints
 * on the chart and drives nothing.
 */

import { inferResponseMethod } from '@/config/tarpDocument';

// ---------------------------------------------------------------------------
// Cells
//
// A cell is `{ text, boldPrefix }`. `boldPrefix` is the run of bold characters
// at the START of the cell, which is how a matrix chart names its trigger —
// bold title, plain description beneath. Plain strings are accepted too, so
// tests and non-Excel sources can pass a bare grid.
// ---------------------------------------------------------------------------

const EMPTY_CELL = { text: '', boldPrefix: '' };

const squash = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

export const readCell = (cell) => {
  if (cell === null || cell === undefined) return EMPTY_CELL;
  if (typeof cell === 'string' || typeof cell === 'number') {
    return { text: String(cell).trim(), boldPrefix: '' };
  }
  return {
    text: String(cell.text ?? '').trim(),
    boldPrefix: String(cell.boldPrefix ?? '').trim(),
  };
};

/** Header matching is case-, accent- and punctuation-blind. */
const headerKey = (value) =>
  squash(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9/ ]/g, '')
    .trim();

// ---------------------------------------------------------------------------
// Risk bands
//
// The band names are free text in the database, so the importer's job is only
// to recognise a column header as a band and record the canonical ENGLISH name
// — the language the email engine and config/tarpLocale.ts both key on.
// ---------------------------------------------------------------------------

/** Header text -> canonical risk rating. `null` is the N/A band, not "unknown". */
const RISK_BAND_HEADERS = new Map([
  ['na', null], ['n/a', null], ['not applicable', null], ['tidak berlaku', null],
  ['low', 'Low'], ['rendah', 'Low'],
  ['intermediate', 'Intermediate'], ['menengah', 'Intermediate'],
  ['moderate', 'Moderate'], ['sedang', 'Moderate'],
  ['high', 'High'], ['tinggi', 'High'],
  ['extreme', 'Extreme'], ['ekstrem', 'Extreme'], ['ekstrim', 'Extreme'],
]);

/**
 * Chart defaults for a band: colour, nominal TARP level, band label.
 *
 * A matrix chart states the band and nothing else, so these fill in what the
 * row layout would have carried in its own columns. The level is inert until
 * the engineer also confirms a deformation type — see the file header.
 */
const BAND_DEFAULTS = {
  Extreme: { colour: 'red', tarpLevel: 4 },
  High: { colour: 'red', tarpLevel: 4 },
  Moderate: { colour: 'orange', tarpLevel: 3 },
  Intermediate: { colour: 'yellow', tarpLevel: 2 },
  Low: { colour: 'green', tarpLevel: null },
};

const NA_DEFAULTS = { colour: 'grey', tarpLevel: null };

const bandDefaults = (riskRating) =>
  (riskRating && BAND_DEFAULTS[riskRating]) || NA_DEFAULTS;

const bandLabelFor = (riskRating) => {
  const { tarpLevel, colour } = bandDefaults(riskRating);
  if (tarpLevel === null) return null;
  return `TARP Trigger ${tarpLevel} (${colour.charAt(0).toUpperCase()}${colour.slice(1)})`;
};

// ---------------------------------------------------------------------------
// Row-layout columns
// ---------------------------------------------------------------------------

/** Header text -> the trigger field it fills. Both languages, both exports. */
const ROW_COLUMN_HEADERS = new Map([
  ['parameter', 'parameter'], ['parameters', 'parameter'],
  ['risk rating', 'riskRating'], ['risk', 'riskRating'],
  ['tingkat risiko', 'riskRating'], ['tingkat resiko', 'riskRating'],
  ['tarp band', 'bandLabel'], ['band', 'bandLabel'], ['band tarp', 'bandLabel'],
  ['tarp trigger', 'bandLabel'],
  ['trigger', 'triggerLabel'], ['triggers', 'triggerLabel'],
  ['pemicu', 'triggerLabel'],
  ['description', 'description'], ['deskripsi', 'description'],
  ['day shift', 'dayShift'], ['dayshift', 'dayShift'], ['shift siang', 'dayShift'],
  ['night shift', 'nightShift'], ['nightshift', 'nightShift'], ['shift malam', 'nightShift'],
  ['comment', 'comments'], ['comments', 'comments'], ['keterangan', 'comments'],
  ['note', 'extraNote'], ['notes', 'extraNote'], ['catatan', 'extraNote'],
]);

// ---------------------------------------------------------------------------
// Deformation types
//
// Matched on wording in either language, longest/most specific first —
// "Linear Accelerating" must beat "Linear", and "Pola Progresif" must not be
// read as a plain linear trend just because the description mentions one.
// ---------------------------------------------------------------------------

const DEF_TYPE_PATTERNS = [
  ['Linear Accelerating', /linear\s*(\(?\s*)?(accelerat\w*|akseleras\w*)|(\baccelerat\w*|\bakseleras\w*)\s+linear|stick[\s-]?slip/i],
  ['Progressive', /\bprogress\w*|\bprogres\w*|akselerat\w*/i],
  ['Regressive', /\bregress\w*|\bregres\w*|deseleras\w*/i],
  ['Linear', /\blinear\b|kecepatan konstan|velocity konstan/i],
  ['Failure', /\bfailure\b|fall of ground|\bfog\b|rockfall|longsoran|jatuhan material|keruntuhan/i],
  ['Forecast', /\bforecast\w*|prakiraan|prediksi/i],
  ['Blast Event', /\bblast\w*|peledakan|\bblasting\b/i],
  ['Rainfall Event', /\brainfall\b|curah hujan|\bhujan\b/i],
  ['Rapid Movement', /rapid movement|pergerakan cepat/i],
  ['Rock Fall', /rock\s?fall|runtuhan batuan/i],
  ['Material Detachment', /material detachment|pelepasan material/i],
];

/**
 * A row about connectivity or data quality is not a deformation trend.
 *
 * Fall of Ground is deliberately absent: "FOG" on a TARP chart is a fall of
 * ground, which IS a deformation type (Failure), not a visibility problem.
 */
const NON_DEFORMATION = /koneksi|connection|link down|offline|kontaminas|contaminat|pembaruan data|data update/i;

/** The deformation type this wording is about, or null when none is clear. */
export const matchDefType = (...parts) => {
  const text = squash(parts.filter(Boolean).join(' '));
  if (!text) return null;
  // A "Lost Connection" row can mention a trend it interrupted; the row is
  // still about the link, and giving it a def_type would make it drive emails.
  if (NON_DEFORMATION.test(text)) return null;
  for (const [type, pattern] of DEF_TYPE_PATTERNS) {
    if (pattern.test(text)) return type;
  }
  return null;
};

/** Alarm rows are triggers in their own right — see config/tarpDocument.ts. */
const ALARM_RE = /\balarm(s|es)?\b|\bperingatan\b/i;
const ALARM_COLOURS = [
  ['red', /\bred\b|\bmerah\b/i],
  ['orange', /\borange\b|\boranye\b/i],
  ['yellow', /\byellow\b|\bkuning\b/i],
  ['green', /\bgreen\b|\bhijau\b/i],
  ['grey', /\bgrey\b|\bgray\b|\babu-?abu\b/i],
];

const alarmColour = (text) => {
  for (const [colour, pattern] of ALARM_COLOURS) {
    if (pattern.test(text)) return colour;
  }
  return null;
};

// ---------------------------------------------------------------------------
// Parameter rows
//
// Not every row of a matrix chart names a trigger. The PTVI chart states, down
// the same parameter axis:
//
//   Pola Deformasi     -- triggers
//   Koneksi Data       -- triggers
//   TARP Site          -- triggers, of a different kind: see below
//   Action / PAGI      -- the day shift response, per band
//   Action / MALAM     -- the night shift response, per band
//   Keterangan         -- the comments, per band
//
// So the shift responses and comments are stated once per BAND rather than once
// per trigger. That is the same information the row layout carries in its Day
// Shift / Night Shift / Comment columns, only factored differently, and it is
// pushed back onto each band's triggers below.
//
// Read every one of those cells as a trigger — which is what a naive cell sweep
// does — and the chart comes out with a dozen triggers that are really four
// responses and a comment list.
//
// THE SITE'S OWN LEVELS
// "TARP Site" holds two different things. Its LEVEL 1-4 cells are this site's
// alarm settings — the same rows the DTG standard charts call Red Alarm, Orange
// Alarm and Yellow Alarm, written as displacement and velocity thresholds
// instead of colours. They become alarm rows: gated on an alarm, tied to no
// deformation type, and colour-matched so findAlarmTrigger() can pick the one
// that fired. Anything else on that row is an ordinary trigger — "Hujan" is
// rainfall, not a threshold.
// ---------------------------------------------------------------------------

const PARAMETER_ROLES = [
  ['dayShift', /gilir kerja\s*:?\s*pagi|shift\s*(siang|pagi)|day\s*shift/i],
  ['nightShift', /gilir kerja\s*:?\s*malam|shift\s*malam|night\s*shift/i],
  ['comments', /^(keterangan|comments?|catatan|remarks?)\b/i],
  ['levels', /^(tarp site|site tarp|level|kriteria|threshold|ambang|batas)\b/i],
  // A chart that names its action row but does not split it by shift means the
  // same response applies to both.
  ['response', /^(action|tindakan|respons\w*)\b/i],
];

/**
 * What a parameter row is for. The DEEPEST label wins — "Action" says only that
 * a response follows, "GILIR KERJA: PAGI" says which shift it is for.
 */
export const classifyParameterRow = (labels = []) => {
  for (let i = labels.length - 1; i >= 0; i -= 1) {
    const label = squash(labels[i]);
    if (!label) continue;
    for (const [role, pattern] of PARAMETER_ROLES) {
      if (pattern.test(label)) return role;
    }
  }
  return 'trigger';
};

/**
 * "LEVEL 2" / "TARP 3" naming one of the site's alarm settings.
 *
 * Anchored to the start of the cell's own name: a comment that merely mentions
 * "TARP Trigger 3" is not itself a level row.
 */
const LEVEL_LABEL = /^(?:level|tarp(?:\s+trigger)?)\s*([0-4])\b/i;

/**
 * Where the chart stops and the appendices start. A contact table's columns do
 * not line up with the band columns, so reading one as chart rows produces
 * triggers called "Role / Position".
 */
const SECTION_BREAK = /phone\s*line|24\s*\/\s*7|distribution list|daftar distribusi|kendali dokumen|document control|contact name|diajukan oleh|disetujui oleh/i;

// ---------------------------------------------------------------------------
// Layout detection
// ---------------------------------------------------------------------------

const HEADER_SCAN_DEPTH = 20;

/**
 * Finds the header row and decides which layout the sheet is drawn in.
 *
 * @returns {{layout: 'matrix'|'row', headerRow: number, columns: object}|null}
 *   `columns` maps a column index to a risk rating (matrix) or a field name
 *   (row layout). Null when neither layout is recognisable.
 */
export const detectLayout = (grid = []) => {
  const depth = Math.min(grid.length, HEADER_SCAN_DEPTH);

  for (let r = 0; r < depth; r += 1) {
    const cells = (grid[r] || []).map(readCell);
    const keys = cells.map((cell) => headerKey(cell.text));

    // Matrix: two or more band headers across one row. Two is enough — a chart
    // with only Moderate and Extreme populated is still a matrix.
    const bandColumns = {};
    let bandCount = 0;
    keys.forEach((key, index) => {
      if (key && RISK_BAND_HEADERS.has(key)) {
        bandColumns[index] = RISK_BAND_HEADERS.get(key);
        bandCount += 1;
      }
    });

    if (bandCount >= 2) {
      // Everything left of the first band is the parameter axis. It is often
      // more than one column: PTVI merges "PARAMETER" across two, so that
      // "Action" can span the PAGI and MALAM rows beneath it.
      const firstBand = Math.min(...Object.keys(bandColumns).map(Number));
      const labelColumns = Array.from({ length: Math.max(firstBand, 1) }, (_, i) => i);
      return {
        layout: 'matrix',
        headerRow: r,
        columns: bandColumns,
        labelColumns,
        parameterColumn: labelColumns[0],
      };
    }

    // Row layout: three or more known attribute columns, one of which must be
    // the trigger or the risk rating. Without either, this is some other table.
    const fieldColumns = {};
    keys.forEach((key, index) => {
      const field = ROW_COLUMN_HEADERS.get(key);
      // First header wins, so a stray repeat further right cannot displace it.
      if (field && !Object.values(fieldColumns).includes(field)) {
        fieldColumns[index] = field;
      }
    });

    const fields = Object.values(fieldColumns);
    if (fields.length >= 3
      && (fields.includes('triggerLabel') || fields.includes('riskRating'))) {
      return { layout: 'row', headerRow: r, columns: fieldColumns };
    }
  }

  return null;
};

// ---------------------------------------------------------------------------
// Cell -> trigger
// ---------------------------------------------------------------------------

/**
 * Splits a matrix cell into its trigger name and description.
 *
 * The bold run at the top of the cell is the name where the workbook has one.
 * Where it does not, the first line stands in — which is how these charts read
 * even without the formatting.
 */
export const splitCellText = (cell) => {
  const { text, boldPrefix } = readCell(cell);
  if (!text) return { label: '', description: null };

  if (boldPrefix && text.startsWith(boldPrefix) && boldPrefix.length < text.length) {
    return {
      label: squash(boldPrefix),
      description: squash(text.slice(boldPrefix.length)) || null,
    };
  }

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 1) return { label: squash(text), description: null };
  return {
    label: squash(lines[0]),
    description: squash(lines.slice(1).join(' ')) || null,
  };
};

const splitComments = (value) =>
  String(value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

/** Bands print most severe first, as every reference chart is laid out. */
const BAND_ORDER = ['Extreme', 'High', 'Moderate', 'Intermediate', 'Low'];
const bandRank = (riskRating) => {
  const index = BAND_ORDER.indexOf(riskRating);
  return index === -1 ? BAND_ORDER.length : index;
};

let seq = 0;
const nextId = () => `import-${(seq += 1)}`;

/** Fills in what the chart implies, leaving what only an engineer can decide. */
const buildTrigger = (fields) => {
  const {
    parameter = null, riskRating = null, triggerLabel, description = null,
    bandLabel = null, colour = null, dayShift = null, nightShift = null,
    comments = [], extraNote = null, requiresAlarm = null, tarpLevel,
  } = fields;

  const defaults = bandDefaults(riskRating);
  // A level row is an alarm setting whether or not it uses the word.
  const isAlarm = requiresAlarm ?? ALARM_RE.test(triggerLabel);
  const defType = isAlarm ? null : matchDefType(triggerLabel, description);

  return {
    id: nextId(),
    parameter,
    riskRating,
    bandLabel: bandLabel || bandLabelFor(riskRating),
    triggerLabel,
    colour: colour || (isAlarm ? alarmColour(triggerLabel) : null) || defaults.colour,
    description,
    dayShift,
    nightShift,
    comments,
    extraNote,
    // Read from the day-shift cell where the sheet has one; the matrix layout
    // has no such column, and null there means "follow the site default".
    responseMethod: inferResponseMethod(dayShift),
    responseNotice: null,
    defType,
    tarpLevel: tarpLevel === undefined ? defaults.tarpLevel : tarpLevel,
    // An "Orange Alarm" row applies only when an alarm actually fired.
    requiresAlarm: isAlarm,
    severityBracket: null,
    subjectLabel: null,
    subjectLabelAlarm: null,
  };
};

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/** Per-band attributes gathered from the Action / Keterangan rows. */
const emptyBandAttributes = () => ({
  dayShift: null, nightShift: null, comments: [], tarpLevel: undefined,
});

const capitalise = (word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

const parseMatrix = (grid, detected, warnings) => {
  const { headerRow, columns, labelColumns } = detected;
  const bandEntries = Object.entries(columns).map(([index, risk]) => [Number(index), risk]);

  const collected = [];
  const bands = new Map(); // riskRating -> attributes
  const carried = labelColumns.map(() => '');

  const attributesFor = (riskRating) => {
    if (!bands.has(riskRating)) bands.set(riskRating, emptyBandAttributes());
    return bands.get(riskRating);
  };

  for (let r = headerRow + 1; r < grid.length; r += 1) {
    const row = grid[r] || [];
    const labelCells = labelColumns.map((c) => squash(readCell(row[c]).text));
    const bandCells = bandEntries.map(([c]) => readCell(row[c]).text);

    // The chart ends where the contact tables begin.
    if (labelCells.some((text) => text && SECTION_BREAK.test(text))) break;
    if (collected.length > 0
      && labelCells.every((text) => !text)
      && bandCells.every((text) => !text)) break;

    // A merged label only carries its value on the first row it spans. Setting
    // an outer label clears the inner ones, so "Pola Deformasi" cannot inherit
    // the "GILIR KERJA: MALAM" that belonged to the parameter above it.
    labelCells.forEach((text, i) => {
      if (!text) return;
      carried[i] = text;
      for (let j = i + 1; j < carried.length; j += 1) carried[j] = '';
    });

    const labels = carried.filter(Boolean);
    const role = classifyParameterRow(labels);

    bandEntries.forEach(([index, riskRating]) => {
      const cell = row[index];
      const text = readCell(cell).text;
      if (!text) return;

      if (role === 'trigger' || role === 'levels') {
        const { label, description } = splitCellText(cell);
        if (!label) return;

        const level = role === 'levels' ? label.match(LEVEL_LABEL) : null;
        if (level) {
          // The site's own alarm setting for this band. Recording the number
          // here as well gives the band's other triggers their TARP level.
          const attributes = attributesFor(riskRating);
          if (attributes.tarpLevel === undefined) attributes.tarpLevel = Number(level[1]);
        }

        collected.push({
          order: r,
          trigger: buildTrigger({
            parameter: labels.join(' — ') || null,
            riskRating,
            triggerLabel: label,
            description,
            // An alarm row is gated on an alarm and drives no deformation type;
            // "Hujan" on the same row is an ordinary rainfall trigger.
            requiresAlarm: level ? true : null,
            tarpLevel: level ? Number(level[1]) : undefined,
          }),
        });
        return;
      }

      const attributes = attributesFor(riskRating);
      if (role === 'dayShift') attributes.dayShift = text;
      else if (role === 'nightShift') attributes.nightShift = text;
      else if (role === 'response') {
        attributes.dayShift = attributes.dayShift ?? text;
        attributes.nightShift = attributes.nightShift ?? text;
      } else if (role === 'comments') {
        attributes.comments.push(...splitComments(text));
      }
    });
  }

  // Push each band's responses back onto the triggers that sit in it.
  collected.forEach(({ trigger }) => {
    const attributes = bands.get(trigger.riskRating);
    if (!attributes) return;

    trigger.dayShift = attributes.dayShift;
    trigger.nightShift = attributes.nightShift;
    trigger.comments = [...attributes.comments];
    trigger.responseMethod = inferResponseMethod(attributes.dayShift);

    // The site's LEVEL row is its own numbering, and beats anything the band
    // name would have implied.
    if (attributes.tarpLevel !== undefined) {
      trigger.tarpLevel = attributes.tarpLevel;
      trigger.bandLabel = trigger.bandLabel
        || `TARP Trigger ${attributes.tarpLevel} (${capitalise(trigger.colour || 'grey')})`;
    }
  });

  // A band that says what to do but names nothing to do it about is either an
  // empty column or a row the importer misread — either way the engineer needs
  // to know before the chart goes out with a gap in it.
  bands.forEach((attributes, riskRating) => {
    const hasContent = attributes.dayShift || attributes.nightShift
      || attributes.comments.length;
    if (!hasContent) return;
    if (collected.some(({ trigger }) => trigger.riskRating === riskRating)) return;
    warnings.push(
      `The ${riskRating || 'N/A'} band states a response but has no trigger row, so `
      + 'nothing was imported for it.'
    );
  });

  // Row-major order would interleave the bands — Low, Extreme, Low again — and
  // the chart merges only CONSECUTIVE rows of a band. Sorting by severity is
  // both how these charts are read and what makes the merge come out right.
  collected.sort((a, b) => {
    const rank = bandRank(a.trigger.riskRating) - bandRank(b.trigger.riskRating);
    return rank !== 0 ? rank : a.order - b.order;
  });

  return collected.map((entry) => entry.trigger);
};

const parseRows = (grid, detected) => {
  const { headerRow, columns } = detected;
  const entries = Object.entries(columns).map(([index, field]) => [Number(index), field]);
  const triggers = [];
  let currentRisk = null;

  for (let r = headerRow + 1; r < grid.length; r += 1) {
    const row = grid[r] || [];
    const values = {};
    entries.forEach(([index, field]) => {
      values[field] = readCell(row[index]).text;
    });

    const triggerLabel = squash(values.triggerLabel);
    if (!triggerLabel) continue;

    // Same merged-cell rule as the matrix: a band spans its rows and only the
    // first carries the text.
    const riskText = squash(values.riskRating);
    if (riskText) {
      const key = headerKey(riskText);
      currentRisk = RISK_BAND_HEADERS.has(key) ? RISK_BAND_HEADERS.get(key) : riskText;
    }

    triggers.push(buildTrigger({
      parameter: squash(values.parameter) || null,
      riskRating: currentRisk,
      triggerLabel,
      description: squash(values.description) || null,
      bandLabel: squash(values.bandLabel) || null,
      dayShift: squash(values.dayShift) || null,
      nightShift: squash(values.nightShift) || null,
      comments: splitComments(values.comments),
      extraNote: squash(values.extraNote) || null,
    }));
  }

  return triggers;
};

// ---------------------------------------------------------------------------
// The blocks below the chart
//
// A TARP workbook carries its own escalation list and email distribution list.
// Retyping those by hand is how a wrong phone number gets into a document
// nobody re-reads until the night it matters, so they are read too.
// ---------------------------------------------------------------------------

const ESCALATION_BLOCK = /phone\s*line|24\s*\/\s*7|kontak telepon|escalation/i;
const DISTRIBUTION_BLOCK = /distribution list|daftar distribusi/i;

const CONTACT_FIELD_HEADERS = [
  ['name', /^(name|nama)\b/i],
  ['role', /^(role|position|jabatan)|role\s*\/\s*position/i],
  ['phone', /^(telephone|phone|telepon|no\.?\s*hp)\b/i],
  ['email', /^e-?mail\b/i],
];

/** Maps a contact table's header row to column indices, or null if it isn't one. */
const contactHeader = (row) => {
  const cells = (row || []).map((cell) => squash(readCell(cell).text));
  const found = {};
  cells.forEach((text, index) => {
    if (!text) return;
    for (const [field, pattern] of CONTACT_FIELD_HEADERS) {
      if (found[field] === undefined && pattern.test(text)) found[field] = index;
    }
  });
  return found.name !== undefined && (found.email !== undefined || found.phone !== undefined)
    ? found
    : null;
};

const readContactRows = (grid, start, header) => {
  const contacts = [];
  for (let r = start; r < grid.length; r += 1) {
    const at = (field) =>
      (header[field] === undefined ? null : squash(readCell(grid[r]?.[header[field]]).text) || null);

    const name = at('name');
    const email = at('email');
    // The tables are padded with blank rows for future entries; the first one
    // with neither a name nor an address ends the block.
    if (!name && !email) break;
    contacts.push({ name, role: at('role'), phone: at('phone'), email });
  }
  return contacts;
};

/**
 * Reads the escalation and distribution tables.
 *
 * The distribution list comes back as the free-text block the document stores
 * (migration 006) rather than as rows, in the `"Name" <address>` form an
 * engineer can paste straight into Outlook.
 */
export const parseContactBlocks = (grid = []) => {
  let escalation = [];
  let distribution = [];

  for (let r = 0; r < grid.length; r += 1) {
    const line = (grid[r] || []).map((cell) => squash(readCell(cell).text)).join(' ');
    if (!line) continue;

    const isEscalation = ESCALATION_BLOCK.test(line);
    const isDistribution = DISTRIBUTION_BLOCK.test(line);
    if (!isEscalation && !isDistribution) continue;

    // The label sits on its own row above the table's header row.
    const header = contactHeader(grid[r + 1]) || contactHeader(grid[r]);
    if (!header) continue;
    const rows = readContactRows(grid, contactHeader(grid[r + 1]) ? r + 2 : r + 1, header);

    if (isDistribution) distribution = rows;
    else escalation = rows;
  }

  const distributionRaw = distribution
    .filter((contact) => contact.email)
    .map((contact) => (contact.name ? `"${contact.name}" <${contact.email}>` : contact.email))
    .join('\n');

  return { escalation, distributionRaw: distributionRaw || null };
};

/**
 * The site name and chart title printed above the table.
 *
 * Skips the approval block — "Diajukan Oleh", "Tanggal Pengesahan" — which is
 * signature metadata rather than the document's own name.
 */
const APPROVAL_LINE = /diajukan|disetujui|tanggal|approved|prepared|revision|versi\b/i;

export const parseDocumentMeta = (grid = [], headerRow = 0) => {
  const lines = [];
  for (let r = 0; r < headerRow; r += 1) {
    const text = squash((grid[r] || []).map((cell) => readCell(cell).text).join(' '));
    if (text && !APPROVAL_LINE.test(text)) lines.push(text);
  }
  return { heading: lines[0] ?? null, title: lines[1] ?? null };
};

// ---------------------------------------------------------------------------
// Public entry point (grid)
// ---------------------------------------------------------------------------

/**
 * `tarp_triggers` allows one row per deformation type per document, and the
 * email engine reads the first match anyway. Two rows claiming the same type is
 * a guess gone wrong, not a client intent, so the later ones are unassigned and
 * the engineer is told which.
 */
const dedupeDefTypes = (triggers, warnings) => {
  const seen = new Map();
  triggers.forEach((trigger) => {
    if (!trigger.defType) return;
    const first = seen.get(trigger.defType);
    if (!first) {
      seen.set(trigger.defType, trigger);
      return;
    }
    warnings.push(
      `"${trigger.triggerLabel}" and "${first.triggerLabel}" both look like `
      + `${trigger.defType}. Only "${first.triggerLabel}" was assigned it — set the `
      + 'type on the right row before publishing.'
    );
    trigger.defType = null;
  });
};

/**
 * Parses a cell grid into trigger rows.
 *
 * @param  {Array<Array>} grid rows of cells; a cell is a string or
 *                             `{ text, boldPrefix }`
 * @returns {{layout: string|null, triggers: array, warnings: string[],
 *            headerRow: number|null}}
 */
export const parseTarpGrid = (grid = []) => {
  const detected = detectLayout(grid);
  if (!detected) {
    return {
      layout: null,
      triggers: [],
      headerRow: null,
      contacts: [],
      distributionRaw: null,
      heading: null,
      title: null,
      warnings: [
        'No TARP table was recognised on this sheet. The importer looks for a '
        + 'header row of risk bands (N/A, Low, Intermediate, Moderate, Extreme) '
        + 'or of trigger columns (Risk Rating, Trigger, Description, …).',
      ],
    };
  }

  const warnings = [];
  const triggers = detected.layout === 'matrix'
    ? parseMatrix(grid, detected, warnings)
    : parseRows(grid, detected);

  if (triggers.length === 0) {
    warnings.push('The table was found but no populated trigger rows were read from it.');
  }

  dedupeDefTypes(triggers, warnings);

  const unplaced = triggers.filter((t) => !t.defType && !t.requiresAlarm).length;
  if (unplaced > 0) {
    warnings.push(
      `${unplaced} row${unplaced === 1 ? '' : 's'} could not be matched to a `
      + 'deformation type. They will print on the chart but drive no email subject '
      + 'until a type is set.'
    );
  }

  // Said once, about what was actually read, rather than assumed of the layout:
  // the PTVI chart states both shifts, the earlier ones state neither.
  if (triggers.length > 0 && triggers.every((t) => !t.dayShift && !t.nightShift)) {
    warnings.push(
      'This chart states no shift responses, so Day Shift and Night Shift are empty '
      + "on every row. Fill them in, or leave them and the site's default response "
      + 'applies.'
    );
  }

  const { escalation, distributionRaw } = parseContactBlocks(grid);
  const { heading, title } = parseDocumentMeta(grid, detected.headerRow);

  return {
    layout: detected.layout,
    headerRow: detected.headerRow,
    triggers,
    contacts: escalation,
    distributionRaw,
    heading,
    title,
    warnings,
  };
};

// ---------------------------------------------------------------------------
// Public entry point (file)
// ---------------------------------------------------------------------------

const MAX_COLUMNS = 40;

/** ExcelJS worksheet -> the plain grid the parser above works on. */
export const sheetToGrid = (sheet) => {
  const grid = [];
  const width = Math.min(sheet.columnCount || MAX_COLUMNS, MAX_COLUMNS);

  sheet.eachRow({ includeEmpty: true }, (row) => {
    const cells = [];
    for (let c = 1; c <= width; c += 1) {
      const cell = row.getCell(c);
      const value = cell.value;

      if (value && Array.isArray(value.richText)) {
        // The bold run at the top of a cell is the trigger's name.
        const text = value.richText.map((run) => run.text ?? '').join('');
        let boldPrefix = '';
        for (const run of value.richText) {
          if (!run.font?.bold) break;
          boldPrefix += run.text ?? '';
        }
        cells.push({ text, boldPrefix });
      } else {
        // `cell.text` flattens formulae, dates and numbers to what is displayed.
        cells.push({
          text: cell.text ?? '',
          boldPrefix: cell.font?.bold ? (cell.text ?? '') : '',
        });
      }
    }
    grid.push(cells);
  });

  return grid;
};

/**
 * Reads a .xlsx File/Blob and parses the first sheet that yields a TARP table.
 *
 * A client workbook routinely leads with a cover or a scope sheet, so every
 * sheet is tried rather than only the first.
 *
 * @returns the `parseTarpGrid` result plus `sheetName`.
 */
export const readTarpFile = async (file) => {
  const ExcelJS = (await import('exceljs/dist/exceljs.min.js')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());

  let fallback = null;

  for (const sheet of workbook.worksheets) {
    const result = parseTarpGrid(sheetToGrid(sheet));
    if (result.triggers.length > 0) {
      return { ...result, sheetName: sheet.name };
    }
    if (!fallback) fallback = { ...result, sheetName: sheet.name };
  }

  return fallback ?? {
    layout: null,
    triggers: [],
    headerRow: null,
    contacts: [],
    distributionRaw: null,
    heading: null,
    title: null,
    warnings: ['The workbook has no readable sheets.'],
    sheetName: null,
  };
};

/** Parsed escalation contact -> the payload the TARP RPCs take. */
export const toContactImportPayload = (contact, index) => ({
  kind: 'escalation',
  sort_order: index + 1,
  name: contact.name,
  role: contact.role,
  phone: contact.phone,
  email: contact.email,
});

/** Parsed trigger -> the snake_case payload the TARP RPCs take. */
export const toImportPayload = (trigger, index) => ({
  sort_order: index + 1,
  parameter: trigger.parameter,
  risk_rating: trigger.riskRating,
  band_label: trigger.bandLabel,
  trigger_label: trigger.triggerLabel,
  colour: trigger.colour,
  description: trigger.description,
  day_shift: trigger.dayShift,
  night_shift: trigger.nightShift,
  comments: trigger.comments || [],
  extra_note: trigger.extraNote,
  def_type: trigger.defType,
  tarp_level: trigger.tarpLevel === null || trigger.tarpLevel === undefined
    ? '' : String(trigger.tarpLevel),
  requires_alarm: Boolean(trigger.requiresAlarm),
  severity_bracket: trigger.severityBracket,
  subject_label: trigger.subjectLabel,
  subject_label_alarm: trigger.subjectLabelAlarm,
  response_method: trigger.responseMethod,
  response_notice: trigger.responseNotice,
});