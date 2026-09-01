/**
 * The seam between a saved layout and the printed page.
 *
 * utils/reportLayout is covered on its own in report-layout.test.js; this file
 * covers what the templates actually do with it — that the order in the layout
 * is the order of the blocks, that a section switched off produces no blocks at
 * all rather than an empty heading, and that a site's own table reaches the
 * paper with this report's readings in it.
 */

import { render, screen, within } from '@testing-library/react';

import { composeLayoutBlocks } from '@/components/admin/Radar/report/layoutBlocks';
import { CustomTable, CustomText, CustomImage } from '@/components/admin/Radar/report/blocks/CustomSections';
import {
    normalizeLayout,
    addSection,
    moveEntry,
    toggleEntry,
    setCellValue,
    TABLE_ROWS_PER_BLOCK,
} from '@/utils/reportLayout';

const CAT = [
    { key: 'header', label: 'Header' },
    { key: 'summary', label: 'Summary' },
    { key: 'movement', label: 'Movement' },
    { key: 'appendix', label: 'Appendix' },
];

/** A stand-in for a template's keyed bag of default blocks. */
const groups = {
    header: [<div key="h">HEADER</div>],
    summary: [<div key="s">SUMMARY</div>],
    // Two blocks, as a sliced movement table really produces.
    movement: [<div key="m0">MOVEMENT-0</div>, <div key="m1">MOVEMENT-1</div>],
    // Empty, as it is on a day with no data-quality evidence.
    appendix: [],
};

const textOf = (blocks) =>
    blocks.map((b) => {
        const { container } = render(b);
        const t = container.textContent;
        return t;
    });

describe('composeLayoutBlocks', () => {
    it('emits the default order when the layout is untouched', () => {
        const blocks = composeLayoutBlocks({ entries: normalizeLayout(null, CAT), groups });
        expect(textOf(blocks)).toEqual(['HEADER', 'SUMMARY', 'MOVEMENT-0', 'MOVEMENT-1']);
    });

    it('emits every block a section produced, not one per section', () => {
        const blocks = composeLayoutBlocks({ entries: normalizeLayout(null, CAT), groups });
        // The two movement slices stay two blocks — the paginator never splits
        // one, so collapsing them here would print a table off the page bottom.
        expect(blocks).toHaveLength(4);
    });

    it('follows the layout’s order, not the source code’s', () => {
        const entries = moveEntry(normalizeLayout(null, CAT), 'movement', -1);
        const blocks = composeLayoutBlocks({ entries, groups });
        expect(textOf(blocks)).toEqual(['HEADER', 'MOVEMENT-0', 'MOVEMENT-1', 'SUMMARY']);
    });

    it('drops a section switched off in the layout', () => {
        const entries = toggleEntry(normalizeLayout(null, CAT), 'summary');
        expect(textOf(composeLayoutBlocks({ entries, groups }))).toEqual([
            'HEADER', 'MOVEMENT-0', 'MOVEMENT-1',
        ]);
    });

    it('prints nothing for a section whose data is empty, even though it is enabled', () => {
        // `appendix` is on in the layout and contributes no blocks today. A
        // heading over an empty appendix is exactly what this must not do.
        const blocks = composeLayoutBlocks({ entries: normalizeLayout(null, CAT), groups });
        expect(textOf(blocks).join('')).not.toContain('APPENDIX');
    });

    it('ignores a layout key the template has no blocks for', () => {
        const entries = [...normalizeLayout(null, CAT), { kind: 'default', id: 'ghost', key: 'ghost', enabled: true }];
        expect(() => composeLayoutBlocks({ entries, groups })).not.toThrow();
        expect(composeLayoutBlocks({ entries, groups })).toHaveLength(4);
    });

    it('splices a custom section into the position the layout puts it', () => {
        const rainfall = {
            kind: 'custom',
            id: 'cs_rain',
            type: 'text',
            title: 'Rainfall',
            body: 'RAINFALL-SECTION',
        };
        const entries = addSection(normalizeLayout(null, CAT), rainfall, 'movement');
        const out = textOf(composeLayoutBlocks({ entries, groups }));
        // After BOTH movement slices — a section placed after the movement table
        // means after the whole table, not into the middle of it. The custom
        // block carries its own section bar, hence the title in its text.
        expect(out).toEqual(['HEADER', 'SUMMARY', 'MOVEMENT-0', 'MOVEMENT-1', 'RainfallRAINFALL-SECTION']);
    });
});

describe('the rainfall table Hidden Valley asked for', () => {
    const rainfall = {
        kind: 'custom',
        id: 'cs_rain',
        type: 'table',
        title: 'Rainfall Summary',
        columns: ['Radar', '24H Cumulative', 'Highest 1H Rainfall', 'Period'],
        rows: [
            ['SSR777XT', '', '', ''],
            ['SSR778XT', '', '', ''],
        ],
    };

    it('prints the saved labels and this report’s readings in one table', () => {
        let values = setCellValue({}, rainfall, 0, 1, '9.05 mm');
        values = setCellValue(values, rainfall, 0, 2, '6.7 mm');
        values = setCellValue(values, rainfall, 0, 3, '10.00-11.00');
        values = setCellValue(values, rainfall, 1, 1, '30.38 mm');

        const entries = addSection(normalizeLayout(null, CAT), rainfall);
        const blocks = composeLayoutBlocks({ entries, groups, values });
        const { container } = render(<>{blocks}</>);

        const table = container.querySelector('table');
        const rows = within(table).getAllByRole('row');
        expect(rows[0].textContent).toContain('24H Cumulative');
        expect(rows[1].textContent).toBe('SSR777XT9.05 mm6.7 mm10.00-11.00');
        expect(rows[2].textContent).toBe('SSR778XT30.38 mm');
    });

    it('chunks a long table so its tail cannot fall off the bottom of a page', () => {
        const long = {
            ...rainfall,
            columns: ['Radar'],
            rows: Array.from({ length: TABLE_ROWS_PER_BLOCK + 4 }, (_, i) => [`R${i}`]),
        };
        const entries = addSection(normalizeLayout(null, CAT), long);
        const blocks = composeLayoutBlocks({ entries, groups });

        // Four default blocks plus two table blocks.
        expect(blocks).toHaveLength(6);
        const { container } = render(<>{blocks.slice(4)}</>);
        const tables = container.querySelectorAll('table');
        expect(tables).toHaveLength(2);
        // Every row survives the split.
        expect(container.textContent).toContain(`R${TABLE_ROWS_PER_BLOCK + 3}`);
    });
});

describe('the printed blocks', () => {
    it('repeats the column headers on a continuation but not the section heading', () => {
        const { container: first } = render(
            <CustomTable title="Rainfall Summary" columns={['Radar']} rows={[['A']]} withHeader />
        );
        const { container: cont } = render(
            <CustomTable title="Rainfall Summary" columns={['Radar']} rows={[['B']]} withHeader={false} />
        );
        expect(first.textContent).toContain('Rainfall Summary');
        // A repeated section bar would read as a second, different table.
        expect(cont.textContent).not.toContain('Rainfall Summary');
        // The column headers DO repeat — a continuation has to be readable alone.
        expect(cont.textContent).toContain('Radar');
    });

    it('splits text on blank lines and keeps single newlines as line breaks', () => {
        const { container } = render(<CustomText title="Note" body={'One\nstill one\n\nTwo'} />);
        expect(container.querySelectorAll('p')).toHaveLength(2);
        expect(container.querySelectorAll('br')).toHaveLength(1);
    });

    it('holds the space open when an image slot is still empty', () => {
        // A placeholder that collapsed would let a report go out with the space
        // for the figure quietly closed up and nothing saying one was expected.
        render(<CustomImage title="Site photo" image={null} maxHeight={300} />);
        expect(screen.getByText(/Image placeholder/i)).toBeInTheDocument();
    });

    it('prints the pasted image and its caption once one lands', () => {
        const { container } = render(
            <CustomImage title="Site photo" image="data:image/png;base64,AAAA" caption="Pit 3, 06:00" maxHeight={300} />
        );
        expect(container.querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,AAAA');
        expect(container.textContent).toContain('Pit 3, 06:00');
        expect(container.textContent).not.toMatch(/Image placeholder/i);
    });

    it('says so rather than printing an empty frame for a table with no rows', () => {
        const { container } = render(<CustomTable title="Empty" columns={['A', 'B']} rows={[]} />);
        expect(container.textContent).toContain('No rows');
    });
});
