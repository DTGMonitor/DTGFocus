// utils/reportLayout.js
//
// The report layout model: which sections a site's report is made of, in what
// order, and what the custom ones contain.
//
// This is the whole point of the feature. Before it, "Hidden Valley wants a
// rainfall table" was a code change — a new block component, a new entry in
// DailyRadarTemplate's block array, and a site check somewhere to decide who
// sees it. Every client that asked for something added another branch to a
// template every other client also renders. This file replaces that with DATA:
// a layout is a list of entries, an entry is either a default section (by key)
// or a custom one (a table, a paragraph, or an image placeholder), and both
// kinds move in the same list.
//
// ---------------------------------------------------------------------------
// STRUCTURE vs CONTENT
// ---------------------------------------------------------------------------
//
// The two are deliberately not the same thing, and are not stored in the same
// place:
//
//   STRUCTURE  lives in the saved layout (report_layouts.sections) — the column
//              headings, how many rows there are, the section titles, the
//              order. Defined once per site and reused every report.
//
//   CONTENT    lives in per-report VALUES, held in React state by the modal and
//              thrown away when the modal closes — this morning's 30.38 mm.
//
// A layout that stored today's rainfall numbers would reprint them tomorrow,
// and a stale number in a client report is worse than a blank one: nothing on
// the page says it is yesterday's. So `sectionContent` merges the two with the
// per-report value winning, and saving the layout back only carries content
// across when the analyst explicitly asks for it (`includeValues`), which is
// how row labels like "SSR777XT" become part of the structure without the
// readings following them.
//
// Images are never saved into a layout at any setting. They are data URLs —
// megabytes of base64 that jsonb would happily swallow and reprint under
// tomorrow's date.
//
// ---------------------------------------------------------------------------
// Pure. No React, no Supabase — see useReportLayout.js for both.

/**
 * Bumped only for a change the normaliser cannot absorb on its own. Stored with
 * every layout so an old row can be recognised rather than guessed at.
 */
export const LAYOUT_VERSION = 1;

/** The custom section kinds an analyst can add. */
export const CUSTOM_SECTION_TYPES = ['table', 'text', 'image'];

/**
 * Rows per table BLOCK.
 *
 * The paginator never splits a block: one taller than a page gets a page to
 * itself and overflows off the bottom, losing its tail silently. Every other
 * variable-length section in these reports pre-chunks for the same reason (see
 * chunkImprovements, splitStatusRowsIntoBlocks). A custom table's length is
 * chosen by the analyst, so it is the one most likely to run long.
 */
export const TABLE_ROWS_PER_BLOCK = 20;

/** Default geometry for a new custom section. */
const NEW_TABLE_COLS = 3;
const NEW_TABLE_ROWS = 3;
export const DEFAULT_IMAGE_HEIGHT = 320;
export const MIN_IMAGE_HEIGHT = 120;
export const MAX_IMAGE_HEIGHT = 560; // IMAGE_MAX_H — taller cannot fit one page

/**
 * Ids only have to be unique within one layout, and they are written into the
 * saved JSON, so they must not collide with a default section KEY either. The
 * `cs_` prefix guarantees that much on its own; the counter and timestamp make
 * two sections added in the same millisecond distinct.
 */
let idCounter = 0;
export function newSectionId() {
    idCounter += 1;
    return `cs_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (v == null ? '' : String(v));

/** A rectangular grid of empty strings. */
export function emptyGrid(rows, cols) {
    return Array.from({ length: Math.max(0, rows) }, () =>
        Array.from({ length: Math.max(0, cols) }, () => '')
    );
}

/**
 * Force a grid to exactly `cols` wide, padding short rows and truncating long
 * ones.
 *
 * Called on every read, not only on edit. A layout is hand-editable JSON in the
 * database and a grid that disagrees with its own column list would render a
 * table with holes in it — or, worse, one silently missing its last column.
 */
export function rectify(rows, cols) {
    const width = Math.max(0, cols);
    return (Array.isArray(rows) ? rows : []).map((row) => {
        const cells = (Array.isArray(row) ? row : []).slice(0, width).map(str);
        while (cells.length < width) cells.push('');
        return cells;
    });
}

// ---------------------------------------------------------------------------
// Custom sections
// ---------------------------------------------------------------------------

/**
 * A new, empty custom section of the given type.
 *
 * A table starts 3×3 rather than 1×1: an analyst adding a table has a shape in
 * mind and trimming is faster than growing, and a 1×1 table does not look like
 * a table in the preview.
 */
export function newCustomSection(type, title = '') {
    const id = newSectionId();
    if (type === 'text') {
        return { kind: 'custom', id, type: 'text', title, body: '' };
    }
    if (type === 'image') {
        return { kind: 'custom', id, type: 'image', title, caption: '', maxHeight: DEFAULT_IMAGE_HEIGHT };
    }
    return {
        kind: 'custom',
        id,
        type: 'table',
        title,
        columns: Array.from({ length: NEW_TABLE_COLS }, (_, i) => `Column ${i + 1}`),
        rows: emptyGrid(NEW_TABLE_ROWS, NEW_TABLE_COLS),
    };
}

/**
 * Coerce anything read out of the database into a well-formed custom section,
 * or null if it is too damaged to render.
 */
function normalizeCustom(raw) {
    if (!isObj(raw)) return null;
    const type = CUSTOM_SECTION_TYPES.includes(raw.type) ? raw.type : null;
    if (!type) return null;
    const id = str(raw.id) || newSectionId();
    const title = str(raw.title);

    if (type === 'text') return { kind: 'custom', id, type, title, body: str(raw.body) };

    if (type === 'image') {
        const h = Number(raw.maxHeight);
        return {
            kind: 'custom',
            id,
            type,
            title,
            caption: str(raw.caption),
            maxHeight: Number.isFinite(h)
                ? Math.min(MAX_IMAGE_HEIGHT, Math.max(MIN_IMAGE_HEIGHT, Math.round(h)))
                : DEFAULT_IMAGE_HEIGHT,
        };
    }

    const columns = (Array.isArray(raw.columns) ? raw.columns : []).map(str);
    // A table with no columns has nothing to render and no edge the editor can
    // grab to give it one, so it gets a single blank column back.
    const cols = columns.length > 0 ? columns : [''];
    return { kind: 'custom', id, type, title, columns: cols, rows: rectify(raw.rows, cols.length) };
}

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------

/** The untouched layout for a catalogue: every default section, in order, on. */
export function defaultLayout(catalogue) {
    return (catalogue || []).map((s) => ({ kind: 'default', id: s.key, key: s.key, enabled: true }));
}

/**
 * Merge a saved layout with the current catalogue.
 *
 * Two things go wrong without this, and both are silent:
 *
 *   1. A section ADDED to a template after a site saved its layout would never
 *      print for that site — the saved list simply does not mention it. So a
 *      catalogue key with no saved entry is inserted at its catalogue position
 *      relative to the sections either side of it that ARE saved, enabled.
 *
 *   2. A section REMOVED from a template would still be in the saved list, and
 *      the renderer would look up blocks for a key that no longer produces any.
 *      Unknown default keys are dropped.
 *
 * Custom entries are kept as-is, in their saved positions.
 *
 * @param {object|null} saved  A report_layouts.sections payload, or null.
 * @param {object[]} catalogue  From config/reportSections.
 */
export function normalizeLayout(saved, catalogue) {
    const cat = catalogue || [];
    const known = new Set(cat.map((s) => s.key));
    const rawEntries = Array.isArray(saved) ? saved : Array.isArray(saved?.entries) ? saved.entries : null;
    if (!rawEntries) return defaultLayout(cat);

    const entries = [];
    const seen = new Set();
    for (const raw of rawEntries) {
        if (!isObj(raw)) continue;
        if (raw.kind === 'custom') {
            const section = normalizeCustom(raw);
            if (section && !seen.has(section.id)) {
                seen.add(section.id);
                entries.push({ ...section, enabled: raw.enabled !== false });
            }
            continue;
        }
        const key = str(raw.key || raw.id);
        if (!known.has(key) || seen.has(key)) continue;
        seen.add(key);
        entries.push({ kind: 'default', id: key, key, enabled: raw.enabled !== false });
    }

    // Re-insert catalogue keys the saved list never mentioned. Walking the
    // catalogue in order and tracking the last placed key keeps a new section
    // next to the ones it was designed to sit between, rather than dumped at
    // the end where it would print after the disclaimer.
    let cursor = 0;
    for (const def of cat) {
        const at = entries.findIndex((e) => e.kind === 'default' && e.key === def.key);
        if (at >= 0) {
            cursor = at + 1;
            continue;
        }
        entries.splice(cursor, 0, { kind: 'default', id: def.key, key: def.key, enabled: true });
        cursor += 1;
    }

    return entries;
}

/** Strip an entry down to what belongs in the database. */
function forSave(entry, values, includeValues) {
    if (entry.kind !== 'custom') {
        return { kind: 'default', key: entry.key, enabled: entry.enabled !== false };
    }
    const base = { kind: 'custom', id: entry.id, type: entry.type, title: entry.title, enabled: entry.enabled !== false };
    const value = includeValues ? values?.[entry.id] : null;

    if (entry.type === 'text') return { ...base, body: str(value?.body ?? entry.body) };
    if (entry.type === 'image') {
        // `image` is absent on purpose — see the file header. The caption is
        // structure enough to keep.
        return { ...base, caption: str(value?.caption ?? entry.caption), maxHeight: entry.maxHeight };
    }
    const columns = entry.columns.map(str);
    const rows = rectify(value?.rows ?? entry.rows, columns.length);
    return { ...base, columns, rows };
}

/**
 * The `sections` payload to write to report_layouts.
 *
 * @param {object[]} entries
 * @param {object} values      Per-report content, keyed by section id.
 * @param {boolean} includeValues  Fold this report's cell content into the
 *   saved structure. Off by default: see the file header.
 */
export function serializeLayout(entries, values = {}, includeValues = false) {
    return {
        version: LAYOUT_VERSION,
        entries: (entries || []).map((e) => forSave(e, values, includeValues)),
    };
}

// ---------------------------------------------------------------------------
// Editing — all pure, all returning new arrays
// ---------------------------------------------------------------------------

const replace = (entries, id, fn) => entries.map((e) => (e.id === id ? fn(e) : e));

/**
 * Move an entry one place up (-1) or down (+1). A move off either end is a
 * no-op rather than a wrap: the editor's buttons are disabled at the ends, and
 * a wrap would move the header to the bottom of the report on a mis-click.
 */
export function moveEntry(entries, id, delta) {
    const from = entries.findIndex((e) => e.id === id);
    if (from < 0) return entries;
    const to = from + delta;
    if (to < 0 || to >= entries.length) return entries;
    const next = entries.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
}

export function toggleEntry(entries, id) {
    return replace(entries, id, (e) => ({ ...e, enabled: e.enabled === false }));
}

/** Only custom entries can be removed — a default is hidden, never deleted. */
export function removeEntry(entries, id) {
    return entries.filter((e) => !(e.id === id && e.kind === 'custom'));
}

/** Append a custom section, or insert it directly after `afterId`. */
export function addSection(entries, section, afterId = null) {
    const entry = { ...section, enabled: true };
    if (!afterId) return [...entries, entry];
    const at = entries.findIndex((e) => e.id === afterId);
    if (at < 0) return [...entries, entry];
    const next = entries.slice();
    next.splice(at + 1, 0, entry);
    return next;
}

/** Patch a custom section's structure (title, image height, …). */
export function updateSection(entries, id, patch) {
    return replace(entries, id, (e) => (e.kind === 'custom' ? { ...e, ...patch } : e));
}

export function setColumnLabel(entries, id, index, label) {
    return replace(entries, id, (e) => {
        if (e.kind !== 'custom' || e.type !== 'table') return e;
        return { ...e, columns: e.columns.map((c, i) => (i === index ? str(label) : c)) };
    });
}

export function addColumn(entries, id) {
    return replace(entries, id, (e) => {
        if (e.kind !== 'custom' || e.type !== 'table') return e;
        const columns = [...e.columns, `Column ${e.columns.length + 1}`];
        return { ...e, columns, rows: rectify(e.rows, columns.length) };
    });
}

/** Never below one column, for the reason normalizeCustom documents. */
export function removeColumn(entries, id, index) {
    return replace(entries, id, (e) => {
        if (e.kind !== 'custom' || e.type !== 'table' || e.columns.length <= 1) return e;
        const columns = e.columns.filter((_, i) => i !== index);
        return { ...e, columns, rows: e.rows.map((r) => r.filter((_, i) => i !== index)) };
    });
}

export function addRow(entries, id) {
    return replace(entries, id, (e) => {
        if (e.kind !== 'custom' || e.type !== 'table') return e;
        return { ...e, rows: [...e.rows, Array.from({ length: e.columns.length }, () => '')] };
    });
}

export function removeRow(entries, id, index) {
    return replace(entries, id, (e) => {
        if (e.kind !== 'custom' || e.type !== 'table') return e;
        return { ...e, rows: e.rows.filter((_, i) => i !== index) };
    });
}

// ---------------------------------------------------------------------------
// Per-report values
// ---------------------------------------------------------------------------

/**
 * What a custom section actually PRINTS: its saved structure with this report's
 * content laid over it.
 *
 * The value is authoritative wherever it exists, including when it is an empty
 * string — an analyst who clears a cell means the cell to be blank, not to fall
 * back to whatever the layout was saved with. That is why the table path merges
 * cell by cell against the grid's own shape rather than picking one grid or the
 * other.
 */
export function sectionContent(section, value) {
    if (section.type === 'text') {
        return { body: value?.body ?? section.body ?? '' };
    }
    if (section.type === 'image') {
        return {
            image: value?.image ?? null,
            caption: value?.caption ?? section.caption ?? '',
            maxHeight: section.maxHeight ?? DEFAULT_IMAGE_HEIGHT,
        };
    }
    const columns = section.columns ?? [];
    const saved = rectify(section.rows ?? [], columns.length);
    const typed = Array.isArray(value?.rows) ? value.rows : null;
    const rows = saved.map((row, r) =>
        row.map((cell, c) => {
            const v = typed?.[r]?.[c];
            return v == null ? cell : str(v);
        })
    );
    return { columns, rows };
}

/** Patch one cell of one table, without disturbing any other section. */
export function setCellValue(values, section, rowIdx, colIdx, text) {
    const current = sectionContent(section, values?.[section.id]).rows;
    const rows = current.map((row, r) =>
        r === rowIdx ? row.map((cell, c) => (c === colIdx ? str(text) : cell)) : row
    );
    return { ...values, [section.id]: { ...values?.[section.id], rows } };
}

/** Patch a non-table value (body, caption, image). */
export function setSectionValue(values, id, patch) {
    return { ...values, [id]: { ...values?.[id], ...patch } };
}

/**
 * Chunk a table's rows into page-sized blocks. See TABLE_ROWS_PER_BLOCK.
 * Always returns at least one chunk, so an empty table still renders its
 * heading and column bar rather than vanishing without explanation.
 */
export function chunkTableRows(rows, size = TABLE_ROWS_PER_BLOCK) {
    const list = Array.isArray(rows) ? rows : [];
    if (list.length === 0) return [[]];
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
}

/**
 * A cheap identity for the rendered layout, for useReportPagination's dep list.
 *
 * The hook re-measures when a dep CHANGES, and its deps are compared by
 * reference. Passing the entries array would re-measure on every keystroke
 * (each edit is a new array) and passing nothing would never re-measure at all
 * — a table that grew a row would keep the old page breaks and the last row
 * would print under the footer. This string changes exactly when the printed
 * geometry does: which sections are on, their order, and how much is in them.
 *
 * Cell TEXT is included by length, not by content: text that changes length can
 * wrap onto another line, which changes the block's height; text that does not
 * cannot.
 */
export function layoutSignature(entries, values = {}) {
    return (entries || [])
        .map((e) => {
            if (e.enabled === false) return `-${e.id}`;
            if (e.kind !== 'custom') return e.key;
            const content = sectionContent(e, values[e.id]);
            if (e.type === 'text') return `${e.id}:t:${content.body.length}`;
            if (e.type === 'image') return `${e.id}:i:${content.image ? 1 : 0}:${content.maxHeight}:${content.caption.length}`;
            const cells = content.rows.reduce((n, r) => n + r.reduce((m, c) => m + c.length, 0), 0);
            return `${e.id}:g:${content.columns.length}x${content.rows.length}:${cells}`;
        })
        .join('|');
}

/**
 * Split a layout into the map the templates consume.
 *
 * Templates build their default blocks into a keyed bag and then emit entries
 * in this order — see DailyRadarTemplate. Disabled entries are dropped HERE, so
 * neither template has to check `enabled` and they cannot disagree about what
 * "off" means.
 */
export function visibleEntries(entries) {
    return (entries || []).filter((e) => e.enabled !== false);
}
