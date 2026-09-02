/**
 * The Daily Radar Report's "Informasi Status Pergerakan" table, and the rule
 * that reddens its Data Update card.
 *
 * Pure: no React, no Supabase, no clock of its own — every instant is passed
 * in, so the same inputs always produce the same table and the wording can be
 * unit-tested without rendering a page.
 *
 * The table lists one row per ACTIVE DEFORMATION CHAIN — the head of each, the
 * record no other active record names as a precursor. That is the same set the
 * Comprehensive report's timeline draws its chains from; this report just prints
 * the head of each instead of the whole history.
 *
 * It is deliberately NOT one row per area. Two distinct movements can be
 * tracked at one location — a TARP 4 Linear and a TARP 3 Progressive on the same
 * wall are two findings, not one — and collapsing them to the worst would hide a
 * chain the site is being asked to act on. It is also not one row per record:
 * a superseded precursor can still be flagged active, and printing it beside the
 * record that replaced it states the wall is in two states at once.
 */

import {
  COLOUR_RANK,
  recordColour,
  defTypeColour,
  tarpPriority,
  recordBadgeLabel,
  labelColour,
  NO_SIGNIFICANT,
} from '@/config/riskDisplay';
import { resolveChainHeads } from './tabHelpers';
import { velocityUnit } from './reportDefDetails';
import { dailyRemark } from '@/config/dailyReportLocale';

/**
 * Record types the movement table never lists.
 *
 * A blast and a rainfall event are CAUSES logged against an area, not states
 * the area is in — printing "Blast Event / TARP 2" in a status column reads as
 * the wall currently deforming when the blast finished hours ago. A forecast is
 * a prediction about a failure rather than an observation of one, and the areas
 * it concerns are already listed by the trend that produced it.
 *
 * Matched on lower-cased substrings because `def_type` is not enum-constrained:
 * historical rows carry free-typed variants ("Blast", "Rainfall").
 */
export const EXCLUDED_STATUS_DEF_TYPES = ['blast', 'rainfall', 'forecast'];

/** Is this record one of the excluded causes? */
export const isExcludedFromStatus = (record) => {
  const type = String(record?.def_type ?? '').trim().toLowerCase();
  if (!type) return false;
  return EXCLUDED_STATUS_DEF_TYPES.some((needle) => type.includes(needle));
};

/**
 * The head of each chain: every record no OTHER record in the set has moved past.
 *
 * Identical to the `heads` derivation in useComprehensiveReportData and to the
 * board's own card set, so the two reports and the screen agree on what is
 * currently happening — `resolveChainHeads` is the one implementation all three
 * call. A plain record is superseded as soon as anything names it; a Rainfall or
 * Blast is the current node of every trend that ran into it and stays a head
 * until each of them has been continued past it.
 *
 * Ids are compared as strings there because `precursors` is an INT[] while `id`
 * arrives as whatever PostgREST gave it — a numeric/string mismatch would
 * silently mark every record a head and print the whole chain.
 */
export function chainHeads(records) {
  return resolveChainHeads(records).heads;
}

/**
 * The velocity behind a record, as the Keterangan sentence needs it.
 *
 * Reads `def_records.properties` with the same field names and the same
 * VCP-driven unit rule as the Comprehensive report's timeline
 * (utils/reportDefDetails.js) — a Linear carries `AverageVelocity`, a
 * Progressive carries the `Vmin`/`Vmax` band, and a VCP under a day means mm/h.
 * Duplicating the unit call rather than the rule keeps the two documents from
 * ever stating one event's speed in different units.
 *
 * @returns {{from: string|null, to: string|null, unit: string}|null}
 */
export function statusVelocity(record) {
  const p = record?.properties ?? {};
  const type = String(record?.def_type ?? '').trim().toLowerCase();
  const unit = velocityUnit(p.VCP);
  const num = (v) => (v === null || v === undefined || v === '' ? null : String(v));

  if (type === 'linear') {
    const from = num(p.AverageVelocity);
    return from ? { from, to: null, unit } : null;
  }
  if (type === 'progressive' || type === 'linear accelerating') {
    const from = num(p.Vmin);
    const to = num(p.Vmax);
    return from || to ? { from, to, unit } : null;
  }
  return null;
}

/**
 * What the TARP column prints for a record the scale cannot express.
 *
 * A Rapid Movement sits ABOVE the TARP scale — the ground is already going,
 * faster than any trend the plan has a trigger for (see COLOUR_RANK, where it
 * outranks a TARP 4). So it carries no level, and the "nothing active" fallback
 * that serves every other levelless record would print the WORST thing on the
 * board as the calmest. A dash says the scale does not reach it.
 */
export const NO_TARP_LABEL = '-';

/** Is this record above the TARP scale, rather than merely unlevelled? */
const aboveTarpScale = (record) => recordColour(record) === 'darkred';

/**
 * Ink for the TARP column, resolved from the LEVEL and not from the record's
 * band.
 *
 * The two are deliberately different columns: a Linear trend reported at TARP 4
 * is an orange pattern on a red trigger, and colouring both from the band
 * printed the trigger orange — understating what the site is being asked to
 * respond to. `labelColour` reads a level, then a band name (for the sites that
 * quote colours rather than numbers), so both wordings resolve here.
 *
 * Null for the dash: there is no level to colour, and green would say TARP 1.
 */
const tarpLabelColour = (label) =>
  !label || label === NO_TARP_LABEL ? null : labelColour(label);

/**
 * Ink for the PATTERN column — the trend shape's own band, and nothing else.
 *
 * Read from the deformation TYPE alone, not from `recordColour`. The two are
 * the same fact at most sites, because the level is derived FROM the shape; at
 * a site whose levels are alarm thresholds they diverge, and `recordColour`
 * deliberately takes the MORE SEVERE of the two so that no surface can
 * under-state a record. That is right for the row's ranking and for the risk
 * tile. It is wrong here: it printed "Linear" in the red of the TARP 4 alarm it
 * sat on, and a Pattern column that reddens with the trigger is no longer
 * describing the pattern — a Linear trend is an orange shape whatever alarm it
 * crossed.
 *
 * Falls back to the record's band for a type the scale does not recognise
 * (`def_type` is free text), which is what the column printed before and is
 * still better than colourless.
 */
const patternInkColour = (record) => defTypeColour(record?.def_type) ?? recordColour(record);

/**
 * One printed row per active deformation chain.
 *
 * Worst first, so what the site has to act on is at the top of the box; areas
 * tie-break alphabetically and, within one area, the newer chain leads. An
 * unnamed location is printed as a dash rather than dropped — a record with no
 * location is a data-entry gap the report should surface, not hide.
 *
 * @param {object[]} records   ACTIVE def_records rows for the wall folder, with
 *   `precursors`. Without that column every record looks like a head, so a
 *   superseded precursor would print beside the record that replaced it.
 * @param {object} options
 * @param {string} options.locale     'en' | 'id' — drives the Keterangan text.
 * @param {object|string} options.riskMode  A sensor row, or a RiskDisplayMode.
 *   Decides whether the TARP column quotes a level or names the band, exactly
 *   as the timeline cards do.
 * @param {string} options.noLevelLabel  What the TARP column prints for a
 *   record carrying no level. 'TARP 1' at a TARP-mode site (nothing active is
 *   the no-risk baseline); the caller passes '' elsewhere so the column is
 *   simply blank rather than asserting a number the site's chart lacks.
 * @returns {{area: string, tarp: string, tarpColour: string|null, pattern: string,
 *            remark: string, colour: string, patternColour: string, record: object}[]}
 *   Three colours, because the row is making three different statements:
 *
 *     colour         the record's overall band — the more severe of its shape
 *                    and its level. RANKS the row; never printed. Taking the
 *                    worse of the two is what stops a Rapid Movement carrying
 *                    no level from sorting below a TARP 4.
 *     tarpColour     the LEVEL's band, colouring the TARP column.
 *     patternColour  the TYPE's band, colouring the Pattern column.
 *
 *   At most sites all three agree, because the level is derived from the shape.
 *   At a site whose levels are alarm thresholds they diverge — a Linear trend
 *   on a red alarm is an orange pattern on a red trigger — and each column must
 *   state its own fact rather than the worst of them.
 */
export function buildStatusRows(records, { locale = 'en', riskMode = 'tarp', noLevelLabel = 'TARP 1' } = {}) {
  return chainHeads(records)
    .filter((r) => !isExcludedFromStatus(r))
    .map((record) => {
      const tarp =
        recordBadgeLabel(record, riskMode) ||
        (aboveTarpScale(record) ? NO_TARP_LABEL : noLevelLabel);
      return {
        area: String(record?.location ?? '').trim() || '—',
        tarp,
        tarpColour: tarpLabelColour(tarp),
        pattern: String(record?.def_type ?? '').trim() || 'No Significant',
        remark: dailyRemark(record?.def_type, statusVelocity(record), locale),
        colour: recordColour(record),
        patternColour: patternInkColour(record),
        record,
      };
    })
    .sort(
      (a, b) =>
        COLOUR_RANK[b.colour] - COLOUR_RANK[a.colour] ||
        tarpPriority(b.record?.tarp_level) - tarpPriority(a.record?.tarp_level) ||
        a.area.localeCompare(b.area, undefined, { numeric: true, sensitivity: 'base' }) ||
        new Date(b.record?.created_at ?? 0).getTime() - new Date(a.record?.created_at ?? 0).getTime()
    );
}

// ---------------------------------------------------------------------------
// The area roster ('roster' style — see config/movementTableStyle.ts)
// ---------------------------------------------------------------------------

/**
 * The key an area NAME is matched on.
 *
 * `def_records.location` is free text and `monitoring_areas.name` is what an
 * operator typed at commissioning, so the two agree on the point and disagree
 * on the spelling: "Kaki disp 1", "Kaki Disp 1" and "Kaki  disp 1" are one
 * area. Case is folded and runs of whitespace collapse to one space — the same
 * key the roster's unique index enforces in the database.
 */
export const areaKey = (name) =>
  String(name ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

/** A roster entry, however the caller holds it. Blank names are dropped. */
const rosterEntries = (roster) =>
  (roster ?? [])
    .map((entry) => (typeof entry === 'string' ? { name: entry } : entry))
    .filter((entry) => areaKey(entry?.name));

/**
 * Merge the wall's monitoring-point roster into the movement rows.
 *
 * Additive by design: `buildStatusRows` is untouched and still produces exactly
 * what the 'chain' style prints, and this runs over its output. A radar on the
 * standard style never calls it, so the two tables cannot drift apart.
 *
 * The join is a LEFT join FROM the roster, plus everything the records already
 * produced:
 *
 *   - a roster area with an active chain keeps that chain's row, verbatim.
 *     Two chains on one point stay two rows, exactly as they do today.
 *   - a roster area with nothing active gets a baseline row: the site's no-risk
 *     level, "No Significant", and the "nothing observed" remark. This is the
 *     whole point of the style — nothing in the system lowers a record back to
 *     TARP 1, so a calm point has no record to print and would otherwise
 *     silently vanish from a report the client reads as a checklist.
 *   - an ACTIVE record whose location is not on the roster still prints. An
 *     unregistered area is a roster that has fallen behind the wall, and the
 *     report must not answer that by hiding live movement.
 *
 * Ordering: severity first, so what has to be acted on is still at the top of
 * the box; then the roster's own `sort_order`, so the calm tail reads in the
 * sequence the client knows their points by rather than an alphabetical one
 * they do not. Unregistered areas sort after the roster, alphabetically.
 *
 * @param {object[]} rows    `buildStatusRows` output.
 * @param {Array<string|{name: string}>} roster  Ordered monitoring areas.
 * @param {object} options
 * @param {string} options.locale        'en' | 'id' — the baseline remark.
 * @param {string} options.noLevelLabel  What a levelless row prints in the TARP
 *   column. 'TARP 1' at a TARP-mode site; '' where the site's chart carries no
 *   numbers, exactly as `buildStatusRows` treats it.
 * @returns {object[]} Rows in the same shape, plus `rosterOnly` on the baselines.
 */
export function applyAreaRoster(rows, roster, { locale = 'en', noLevelLabel = 'TARP 1' } = {}) {
  const list = (rows ?? []).filter(Boolean);
  const entries = rosterEntries(roster);
  if (entries.length === 0) return list;

  // First occurrence wins: a roster holding one point twice is a data problem,
  // not a reason to print it twice.
  const order = new Map();
  entries.forEach((entry, i) => {
    const key = areaKey(entry.name);
    if (!order.has(key)) order.set(key, { index: i, name: String(entry.name).trim() });
  });

  const covered = new Set(list.map((row) => areaKey(row?.area)));

  const baseline = [...order.entries()]
    .filter(([key]) => !covered.has(key))
    .map(([, entry]) => ({
      area: entry.name,
      tarp: noLevelLabel,
      tarpColour: tarpLabelColour(noLevelLabel),
      // Not translated, deliberately: "No Significant" is the radar software's
      // own vocabulary and the Indonesian report prints it in English too — see
      // the conventions at the top of config/dailyReportLocale.ts.
      pattern: NO_SIGNIFICANT,
      // dailyRemark's own no-movement sentence, so the baseline row is worded
      // by the same function as every other row in the column.
      remark: dailyRemark(null, null, locale),
      colour: 'green',
      patternColour: 'green',
      record: null,
      rosterOnly: true,
    }));

  const rank = (row) => order.get(areaKey(row?.area))?.index ?? Number.MAX_SAFE_INTEGER;

  return [...list, ...baseline].sort(
    (a, b) =>
      COLOUR_RANK[b.colour] - COLOUR_RANK[a.colour] ||
      tarpPriority(b.record?.tarp_level) - tarpPriority(a.record?.tarp_level) ||
      rank(a) - rank(b) ||
      a.area.localeCompare(b.area, undefined, { numeric: true, sensitivity: 'base' }) ||
      new Date(b.record?.created_at ?? 0).getTime() - new Date(a.record?.created_at ?? 0).getTime()
  );
}

/**
 * Up to this many rows, the table stays a single full-width column.
 *
 * Below the threshold a two-up table is worse than a tall one: the columns are
 * half as wide, so the Keterangan sentence wraps over three lines to save a
 * vertical centimetre the page was not short of. Past it the wrapping costs
 * less than the height does.
 */
export const SINGLE_COLUMN_MAX_ROWS = 5;

/**
 * Lay the rows out for the printed table.
 *
 * The table is sized to the data and nothing else — no padding rows. A fixed
 * box was easier to keep visually steady between editions, but it printed empty
 * rows under a two-record day, and an empty row in a status table reads as an
 * area that was checked and found blank rather than as an area that does not
 * exist.
 *
 * Past SINGLE_COLUMN_MAX_ROWS the rows split into two side-by-side column
 * pairs, filling the LEFT first so the table reads top-to-bottom down one side
 * and then the other, not alternating between them. An odd count leaves the
 * last right-hand slot empty; that is one blank half-row, not a blank row.
 *
 * @returns {{left: object[], right: object[], twoUp: boolean}}
 */
export function splitStatusRows(rows) {
  const list = (rows ?? []).filter(Boolean);
  if (list.length <= SINGLE_COLUMN_MAX_ROWS) {
    return { left: list, right: [], twoUp: false };
  }
  const half = Math.ceil(list.length / 2);
  return { left: list.slice(0, half), right: list.slice(half), twoUp: true };
}

/**
 * How many rows one movement-table BLOCK may hold before the table is broken
 * into another one.
 *
 * The paginator never splits a block (see useReportPagination): a block taller
 * than the usable page height does not overflow onto the next sheet, it is
 * clipped. A chain table is bounded by how many things are moving at once and
 * has always fitted; a roster table is bounded by how many points the wall has,
 * which is a number the report does not control.
 *
 * 24 entries is 12 printed lines two-up, comfortably under half a page at
 * 8.5pt, so a block can always be packed somewhere without leaving a large
 * hole. Splitting into slightly-too-small blocks costs a repeated header row;
 * getting it wrong the other way costs the client rows they never see.
 */
export const MOVEMENT_ROWS_PER_BLOCK = 24;

/**
 * Lay a long table out as SEVERAL blocks the paginator can break between.
 *
 * Each block is an independent `splitStatusRows`-shaped payload and renders as
 * a complete table with its own column headers, so a table continued onto page
 * 2 is still readable there.
 *
 * The two-up decision is taken once, from the TOTAL row count, and applied to
 * every block. Deciding it per block would print the last four rows of a 28-row
 * table as a full-width single column under 24 rows of half-width ones.
 *
 * Only the roster style calls this. The chain table stays exactly one block —
 * see the note on MOVEMENT_ROWS_PER_BLOCK for why it can afford to.
 *
 * @returns {{left: object[], right: object[], twoUp: boolean}[]} Never empty:
 *   an empty table is one empty block, which renders the "no monitoring points"
 *   message.
 */
export function splitStatusRowsIntoBlocks(rows, { maxRows = MOVEMENT_ROWS_PER_BLOCK } = {}) {
  const list = (rows ?? []).filter(Boolean);
  if (list.length <= SINGLE_COLUMN_MAX_ROWS) {
    return [{ left: list, right: [], twoUp: false }];
  }

  const size = Math.max(2, Math.floor(maxRows));
  const blocks = [];
  for (let i = 0; i < list.length; i += size) {
    const chunk = list.slice(i, i + size);
    const half = Math.ceil(chunk.length / 2);
    blocks.push({ left: chunk.slice(0, half), right: chunk.slice(half), twoUp: true });
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Is there anything to analyse?
// ---------------------------------------------------------------------------

/**
 * Does this edition have a risk worth an Area Analysis section?
 *
 * A day on which nothing is moving has nothing to zoom into and no curve to
 * plot, so the section is dropped entirely rather than printed empty — and on
 * the days it IS there, the analyst is required to fill it before the PDF can
 * be generated (see the modal's `analysisComplete`).
 *
 * The test is the BAND, not the label: 'TARP 1' and 'No Significant' are the
 * two ways the scale spells "nothing active", and a site that words its risk as
 * a band colour or a deformation type prints neither. Green is exactly the set
 * of records that are neither — see COLOUR_RANK in config/riskDisplay.ts, where
 * even a Rock Fall ranks above it.
 */
export const hasActiveRisk = (presentation) => {
  if (!presentation) return false;
  return String(presentation.colour ?? '').toLowerCase() !== 'green';
};

// ---------------------------------------------------------------------------
// The Data Update card
// ---------------------------------------------------------------------------

/** How far before the deadline the data may be and still print in black. */
export const DATA_UPDATE_GRACE_MINUTES = 120;

/** "06:00" -> 360 minutes since midnight. null on anything unparseable. */
const hhmmToMinutes = (time) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(time ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
};

/**
 * Minutes since midnight of a `<input type="datetime-local">` value.
 *
 * Read component-wise, NOT through `new Date()`. The analyst types this value
 * while reading the SITE's clock, so it is already site-local and tz-naive;
 * parsing it as an instant would re-project it through the browser's timezone
 * and shift a Jakarta 04:00 by seven hours in a Perth browser — turning an
 * on-time update red, or worse, a late one black.
 */
const localValueParts = (value) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(value ?? '').trim());
  if (!m) return null;
  return { day: `${m[1]}-${m[2]}-${m[3]}`, minutes: Number(m[4]) * 60 + Number(m[5]) };
};

/**
 * Is the manually entered Data Update stale enough to print red?
 *
 * The rule: the data must be no older than the site's report deadline minus a
 * two-hour grace. A radar whose last scan landed at 03:30 for an 06:00 deadline
 * is fine; one that last updated at 03:00 is not, and the card says so in red
 * before the report reaches the client.
 *
 * An update from an EARLIER DAY than the report is always late, whatever the
 * clock says — 05:00 yesterday is not 05:00 today. A blank field, an
 * unparseable one, or a site with no deadline configured returns false: the
 * card must not accuse the analyst of lateness it cannot actually establish.
 *
 * @param {string} dataUpdate  The datetime-local value, in SITE wall time.
 * @param {string} deadline    "HH:MM" from site_report_schedules.
 * @param {string} reportDay   'YYYY-MM-DD', the report's day on the site's calendar.
 * @param {number} graceMinutes
 */
export function isDataUpdateLate(
  dataUpdate,
  deadline,
  reportDay,
  graceMinutes = DATA_UPDATE_GRACE_MINUTES
) {
  const parts = localValueParts(dataUpdate);
  const due = hhmmToMinutes(deadline);
  if (!parts || due == null) return false;

  const day = String(reportDay ?? '').slice(0, 10);
  // Lexical compare on 'YYYY-MM-DD' is chronological.
  if (day && parts.day < day) return true;
  if (day && parts.day > day) return false;

  return parts.minutes < due - graceMinutes;
}

export default buildStatusRows;
