/**
 * The report layout model.
 *
 * The behaviours worth pinning are the ones that fail SILENTLY — a report that
 * still renders, still exports, and is simply missing or repeating something
 * nobody notices until the client does:
 *
 *   * a section added to a template after a site saved its layout
 *   * a section removed from a template that a saved layout still names
 *   * this morning's readings surviving into tomorrow's report
 *   * a table longer than a page losing its tail off the bottom
 */

import {
    normalizeLayout,
    defaultLayout,
    serializeLayout,
    newCustomSection,
    addSection,
    moveEntry,
    toggleEntry,
    removeEntry,
    addColumn,
    removeColumn,
    addRow,
    removeRow,
    setColumnLabel,
    sectionContent,
    setCellValue,
    chunkTableRows,
    layoutSignature,
    visibleEntries,
    rectify,
    TABLE_ROWS_PER_BLOCK,
} from '@/utils/reportLayout';
import { TABULATION_SECTIONS, sectionsForCategory } from '@/config/reportSections';

const CAT = [
    { key: 'header', label: 'Header' },
    { key: 'summary', label: 'Summary' },
    { key: 'movement', label: 'Movement' },
    { key: 'appendix', label: 'Appendix' },
];

const keysOf = (entries) => entries.map((e) => (e.kind === 'custom' ? e.type : e.key));

describe('normalizeLayout', () => {
    it('gives the default order when nothing is saved', () => {
        expect(keysOf(normalizeLayout(null, CAT))).toEqual(['header', 'summary', 'movement', 'appendix']);
        expect(keysOf(normalizeLayout(undefined, CAT))).toEqual(keysOf(defaultLayout(CAT)));
    });

    it('re-inserts a catalogue section a saved layout never heard of, in place', () => {
        // A layout saved before `movement` existed. It must not be dropped, and
        // it must not land at the end after the appendix.
        const saved = {
            version: 1,
            entries: [
                { kind: 'default', key: 'header' },
                { kind: 'default', key: 'summary' },
                { kind: 'default', key: 'appendix' },
            ],
        };
        expect(keysOf(normalizeLayout(saved, CAT))).toEqual(['header', 'summary', 'movement', 'appendix']);
    });

    it('keeps a re-inserted section next to its catalogue neighbours even when the saved order is scrambled', () => {
        const saved = {
            version: 1,
            entries: [
                { kind: 'default', key: 'appendix' },
                { kind: 'default', key: 'header' },
            ],
        };
        const out = keysOf(normalizeLayout(saved, CAT));
        // `summary` and `movement` follow `header`, which is where the catalogue
        // puts them relative to the sections that ARE saved.
        expect(out).toEqual(['appendix', 'header', 'summary', 'movement']);
    });

    it('drops a default key the catalogue no longer has', () => {
        const saved = { version: 1, entries: [{ kind: 'default', key: 'retired-section' }] };
        expect(keysOf(normalizeLayout(saved, CAT))).toEqual(['header', 'summary', 'movement', 'appendix']);
    });

    it('drops a duplicated key rather than rendering the section twice', () => {
        const saved = {
            version: 1,
            entries: [
                { kind: 'default', key: 'header' },
                { kind: 'default', key: 'header' },
            ],
        };
        expect(keysOf(normalizeLayout(saved, CAT)).filter((k) => k === 'header')).toHaveLength(1);
    });

    it('preserves disabled state and custom sections in their saved positions', () => {
        const saved = {
            version: 1,
            entries: [
                { kind: 'default', key: 'header' },
                { kind: 'custom', id: 'cs_rain', type: 'table', title: 'Rainfall', columns: ['Radar', '24H'], rows: [['SSR777XT', '']] },
                { kind: 'default', key: 'summary', enabled: false },
                { kind: 'default', key: 'movement' },
                { kind: 'default', key: 'appendix' },
            ],
        };
        const out = normalizeLayout(saved, CAT);
        expect(keysOf(out)).toEqual(['header', 'table', 'summary', 'movement', 'appendix']);
        expect(out[2].enabled).toBe(false);
        expect(out[1].columns).toEqual(['Radar', '24H']);
    });

    it('survives a damaged payload rather than refusing to render a report', () => {
        const saved = { version: 1, entries: [null, 'nonsense', { kind: 'custom', type: 'unknown' }, 7] };
        expect(keysOf(normalizeLayout(saved, CAT))).toEqual(['header', 'summary', 'movement', 'appendix']);
    });

    it('accepts a bare array of entries as well as the wrapped payload', () => {
        const out = normalizeLayout([{ kind: 'default', key: 'summary' }], CAT);
        expect(keysOf(out)).toEqual(['header', 'summary', 'movement', 'appendix']);
    });

    it('repairs a table whose grid disagrees with its own column list', () => {
        const saved = {
            entries: [
                { kind: 'custom', id: 'cs_x', type: 'table', columns: ['a', 'b', 'c'], rows: [['1'], ['1', '2', '3', '4']] },
            ],
        };
        const table = normalizeLayout(saved, CAT).find((e) => e.kind === 'custom');
        expect(table.rows).toEqual([
            ['1', '', ''],
            ['1', '2', '3'],
        ]);
    });
});

describe('reordering and visibility', () => {
    const base = () => normalizeLayout(null, CAT);

    it('moves an entry one place and no further', () => {
        expect(keysOf(moveEntry(base(), 'summary', -1))).toEqual(['summary', 'header', 'movement', 'appendix']);
        expect(keysOf(moveEntry(base(), 'summary', 1))).toEqual(['header', 'movement', 'summary', 'appendix']);
    });

    it('does not wrap a move off either end', () => {
        expect(keysOf(moveEntry(base(), 'header', -1))).toEqual(keysOf(base()));
        expect(keysOf(moveEntry(base(), 'appendix', 1))).toEqual(keysOf(base()));
    });

    it('hides a default section without deleting it, so it can come back', () => {
        const off = toggleEntry(base(), 'movement');
        expect(off.find((e) => e.id === 'movement').enabled).toBe(false);
        expect(keysOf(visibleEntries(off))).toEqual(['header', 'summary', 'appendix']);
        expect(keysOf(visibleEntries(toggleEntry(off, 'movement')))).toEqual(keysOf(base()));
    });

    it('refuses to delete a default section', () => {
        expect(keysOf(removeEntry(base(), 'header'))).toEqual(keysOf(base()));
    });

    it('deletes a custom section', () => {
        const section = newCustomSection('text', 'Note');
        const withCustom = addSection(base(), section);
        expect(keysOf(removeEntry(withCustom, section.id))).toEqual(keysOf(base()));
    });

    it('inserts a custom section directly after the entry it was added against', () => {
        const section = newCustomSection('table', 'Rainfall');
        expect(keysOf(addSection(base(), section, 'movement'))).toEqual([
            'header', 'summary', 'movement', 'table', 'appendix',
        ]);
    });
});

describe('table structure', () => {
    const withTable = () => {
        const t = newCustomSection('table', 'Rainfall');
        return [addSection([], t), t.id];
    };

    it('keeps the grid rectangular when a column is added or removed', () => {
        let [entries, id] = withTable();
        entries = addColumn(entries, id);
        let t = entries[0];
        expect(t.columns).toHaveLength(4);
        expect(t.rows.every((r) => r.length === 4)).toBe(true);

        entries = removeColumn(entries, id, 1);
        t = entries[0];
        expect(t.columns).toHaveLength(3);
        expect(t.rows.every((r) => r.length === 3)).toBe(true);
    });

    it('never removes the last column, which would leave no edge to grab', () => {
        let [entries, id] = withTable();
        entries = removeColumn(entries, id, 0);
        entries = removeColumn(entries, id, 0);
        entries = removeColumn(entries, id, 0);
        expect(entries[0].columns).toHaveLength(1);
    });

    it('adds and removes rows at the declared width', () => {
        let [entries, id] = withTable();
        entries = addRow(entries, id);
        expect(entries[0].rows).toHaveLength(4);
        expect(entries[0].rows[3]).toEqual(['', '', '']);
        entries = removeRow(entries, id, 0);
        expect(entries[0].rows).toHaveLength(3);
    });

    it('renames a column heading without touching the cells', () => {
        let [entries, id] = withTable();
        entries = setColumnLabel(entries, id, 0, 'Radar');
        expect(entries[0].columns[0]).toBe('Radar');
        expect(entries[0].rows[0]).toEqual(['', '', '']);
    });
});

describe('structure vs this report’s content', () => {
    const rainfall = {
        kind: 'custom',
        id: 'cs_rain',
        type: 'table',
        title: 'Rainfall',
        columns: ['Radar', '24H Cumulative', 'Highest 1H', 'Period'],
        // The saved structure carries the radar names and nothing else.
        rows: [
            ['SSR777XT', '', '', ''],
            ['SSR778XT', '', '', ''],
        ],
    };

    it('lays this report’s cells over the saved structure', () => {
        let values = {};
        values = setCellValue(values, rainfall, 0, 1, '9.05 mm');
        values = setCellValue(values, rainfall, 1, 1, '30.38 mm');
        const content = sectionContent(rainfall, values[rainfall.id]);
        expect(content.rows[0]).toEqual(['SSR777XT', '9.05 mm', '', '']);
        expect(content.rows[1]).toEqual(['SSR778XT', '30.38 mm', '', '']);
    });

    it('lets a cleared cell stay cleared instead of falling back to the saved text', () => {
        const values = setCellValue({}, rainfall, 0, 0, '');
        expect(sectionContent(rainfall, values[rainfall.id]).rows[0][0]).toBe('');
    });

    it('does NOT save this morning’s readings into the site’s layout by default', () => {
        const values = setCellValue({}, rainfall, 0, 1, '9.05 mm');
        const saved = serializeLayout([rainfall], values, false);
        expect(saved.entries[0].rows).toEqual([
            ['SSR777XT', '', '', ''],
            ['SSR778XT', '', '', ''],
        ]);
    });

    it('folds the cells in only when explicitly asked, which is how fixed labels are set', () => {
        const values = setCellValue({}, rainfall, 0, 1, '9.05 mm');
        const saved = serializeLayout([rainfall], values, true);
        expect(saved.entries[0].rows[0]).toEqual(['SSR777XT', '9.05 mm', '', '']);
    });

    it('never writes a pasted image into the layout, at any setting', () => {
        const slot = newCustomSection('image', 'Site photo');
        const values = { [slot.id]: { image: 'data:image/png;base64,AAAA', caption: 'Pit 3' } };
        for (const include of [false, true]) {
            const saved = serializeLayout([slot], values, include);
            expect(saved.entries[0]).not.toHaveProperty('image');
            expect(JSON.stringify(saved)).not.toContain('base64');
        }
        // The caption is structure enough to keep when asked for.
        expect(serializeLayout([slot], values, true).entries[0].caption).toBe('Pit 3');
    });

    it('round-trips a serialized layout back through the normaliser unchanged', () => {
        const entries = addSection(normalizeLayout(null, CAT), rainfall, 'movement');
        const round = normalizeLayout(serializeLayout(entries), CAT);
        expect(keysOf(round)).toEqual(keysOf(entries));
        expect(round.find((e) => e.id === 'cs_rain').columns).toEqual(rainfall.columns);
    });
});

describe('page-safety', () => {
    it('chunks a table so no block can run off the bottom of a page', () => {
        const rows = Array.from({ length: TABLE_ROWS_PER_BLOCK * 2 + 3 }, (_, i) => [String(i)]);
        const chunks = chunkTableRows(rows);
        expect(chunks).toHaveLength(3);
        expect(chunks.flat()).toHaveLength(rows.length);
        expect(chunks.every((c) => c.length <= TABLE_ROWS_PER_BLOCK)).toBe(true);
    });

    it('still emits one block for an empty table, so the heading is not lost', () => {
        expect(chunkTableRows([])).toEqual([[]]);
    });

    it('rectify pads and truncates to the declared width', () => {
        expect(rectify([['a'], ['a', 'b', 'c']], 2)).toEqual([['a', ''], ['a', 'b']]);
    });
});

describe('layoutSignature', () => {
    const table = newCustomSection('table');

    it('is stable when nothing that affects the printed geometry changed', () => {
        const entries = addSection(normalizeLayout(null, CAT), table);
        expect(layoutSignature(entries, {})).toBe(layoutSignature(normalizeLayout(serializeLayout(entries), CAT), {}));
    });

    it('changes when a row is added — the page breaks have to be recomputed', () => {
        const entries = addSection(normalizeLayout(null, CAT), table);
        expect(layoutSignature(addRow(entries, table.id), {})).not.toBe(layoutSignature(entries, {}));
    });

    it('changes when a section is reordered or hidden', () => {
        const entries = normalizeLayout(null, CAT);
        expect(layoutSignature(moveEntry(entries, 'summary', 1), {})).not.toBe(layoutSignature(entries, {}));
        expect(layoutSignature(toggleEntry(entries, 'summary'), {})).not.toBe(layoutSignature(entries, {}));
    });

    it('changes when typed text grows, since the block can wrap onto another line', () => {
        const entries = addSection(normalizeLayout(null, CAT), table);
        const values = setCellValue({}, table, 0, 0, 'a long cell value');
        expect(layoutSignature(entries, values)).not.toBe(layoutSignature(entries, {}));
    });

    it('changes when an image lands, which is what re-packs the pages around it', () => {
        const slot = newCustomSection('image');
        const entries = addSection(normalizeLayout(null, CAT), slot);
        const values = { [slot.id]: { image: 'data:image/png;base64,AAAA' } };
        expect(layoutSignature(entries, values)).not.toBe(layoutSignature(entries, {}));
    });
});

describe('the catalogue', () => {
    it('offers a layout only for the block-composed categories', () => {
        expect(sectionsForCategory('Tabulation')).toBe(TABULATION_SECTIONS);
        expect(sectionsForCategory('Comprehensive')).not.toBeNull();
        // Fixed-page templates on a different rendering path — no measured
        // blocks to reorder, so no editor rather than a broken one.
        expect(sectionsForCategory('Data Quality')).toBeNull();
        expect(sectionsForCategory('Water Body')).toBeNull();
        expect(sectionsForCategory(undefined)).toBeNull();
    });

    it('has unique keys, which is what a saved layout addresses sections by', () => {
        for (const cat of ['Tabulation', 'Comprehensive']) {
            const keys = sectionsForCategory(cat).map((s) => s.key);
            expect(new Set(keys).size).toBe(keys.length);
        }
    });
});
