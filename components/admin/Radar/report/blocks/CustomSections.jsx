'use client';

/**
 * The three custom section blocks: a table, a paragraph, an image.
 *
 * These are what a site's own additions print as — Hidden Valley's per-radar
 * rainfall summary is a `CustomTable` — and nothing here knows which site it is
 * rendering for. The shape comes from the saved layout (utils/reportLayout.js)
 * and the content from the report being written, so a new client asking for a
 * table is a row in `report_layouts`, not a new component in this folder.
 *
 * Three rules inherited from the rest of the page frame, all load-bearing:
 *
 *   1. Colours are inline hex from ../constants. html2canvas 1.x rasterizes CSS
 *      custom properties and oklch() as transparent, so a Tailwind class here
 *      would print as a hole in the PDF.
 *   2. `lineHeight` is explicit wherever text sits in a box on its own — the
 *      default `normal` shows up as a baseline shift in the raster.
 *   3. These blocks are NOT interactive, in either pass. Every other editable
 *      thing in these reports (the summary's weather line, the figures) is
 *      edited on the page and has to be built twice — once live, once inert —
 *      so the hidden measurement layer does not steal the refs. Custom sections
 *      are edited in the config pane instead, which means the measured copy and
 *      the printed copy are the same component with the same props, and cannot
 *      measure differently.
 */

import { INK, MUTED, LINE, DARK, ZEBRA } from '../constants';
import { SectionBar } from '../pageFrame';

const th = {
    background: DARK,
    color: '#fff',
    fontSize: 8,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    padding: '4px 6px',
    textAlign: 'left',
    border: `1px solid ${DARK}`,
    lineHeight: 1.25,
};

const td = {
    fontSize: 8.5,
    color: INK,
    padding: '3px 6px',
    border: `1px solid ${LINE}`,
    verticalAlign: 'top',
    lineHeight: 1.25,
    wordBreak: 'break-word',
};

/**
 * A custom table.
 *
 * @param {string} title    Section bar text. Rendered only on the first chunk.
 * @param {string[]} columns
 * @param {string[][]} rows  ONE CHUNK of the table (see chunkTableRows) — a
 *   table longer than a page arrives here as several blocks, each of which
 *   repeats the column headers so a continuation is readable on its own.
 * @param {boolean} withHeader  False on a continuation chunk: repeating the
 *   section bar would read as a second, different table.
 * @param {boolean} joinPrev    Sit flush against the block above (resolved from
 *   the packed pages by the template, as the movement table does).
 */
export function CustomTable({ title, columns = [], rows = [], withHeader = true, joinPrev = false }) {
    const cols = columns.length > 0 ? columns : [''];
    // Even split. A custom table has no semantics this component can use to
    // decide that one column deserves more room than another, and `tableLayout:
    // fixed` with equal widths at least never collapses a column to nothing.
    const width = `${(100 / cols.length).toFixed(4)}%`;

    return (
        <div>
            {withHeader && title ? <SectionBar title={title} /> : null}
            <table
                style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    tableLayout: 'fixed',
                    // The bar above already closes this edge; so does a joined block.
                    borderTop: (withHeader && title) || joinPrev ? 'none' : undefined,
                }}
            >
                <thead>
                    <tr>
                        {cols.map((c, i) => (
                            <th key={i} style={{ ...th, width }}>
                                {c}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.length === 0 ? (
                        <tr>
                            <td
                                colSpan={cols.length}
                                style={{ ...td, textAlign: 'center', color: MUTED, fontStyle: 'italic', padding: '10px 6px' }}
                            >
                                No rows
                            </td>
                        </tr>
                    ) : (
                        rows.map((row, r) => (
                            <tr key={r} style={{ background: r % 2 ? ZEBRA : '#fff' }}>
                                {cols.map((_, c) => (
                                    <td key={c} style={td}>
                                        {row?.[c] ?? ''}
                                    </td>
                                ))}
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>
    );
}

/**
 * A free-text section.
 *
 * Blank lines split paragraphs and single newlines are preserved, which is what
 * an analyst typing into a textarea expects. `white-space: pre-wrap` would have
 * done both in the browser — html2canvas 1.x measures it inconsistently across
 * the two passes, so the text is split into real elements instead.
 */
export function CustomText({ title, body = '' }) {
    const paragraphs = String(body).split(/\n{2,}/).filter((p) => p.trim().length > 0);

    return (
        <div>
            {title ? <SectionBar title={title} /> : null}
            <div
                style={{
                    border: `1px solid ${LINE}`,
                    borderTop: title ? 'none' : `1px solid ${LINE}`,
                    padding: '8px 10px',
                    fontSize: 9,
                    color: INK,
                    lineHeight: 1.45,
                }}
            >
                {paragraphs.length === 0 ? (
                    <span style={{ color: MUTED, fontStyle: 'italic' }}>No text entered</span>
                ) : (
                    paragraphs.map((p, i) => (
                        <p key={i} style={{ margin: i === 0 ? 0 : '6px 0 0' }}>
                            {p.split('\n').map((line, j) => (
                                <span key={j}>
                                    {j > 0 ? <br /> : null}
                                    {line}
                                </span>
                            ))}
                        </p>
                    ))
                )}
            </div>
        </div>
    );
}

/**
 * An image slot.
 *
 * The image is a DATA URL or nothing — the same invariant as every other figure
 * in these reports. html2canvas cannot fetch during rasterization, so a network
 * or blob: src snapshots blank into the PDF; the config pane's paste and file
 * handlers both go through FileReader for exactly this reason.
 *
 * With no image, the block prints a bordered box of the declared height rather
 * than collapsing. That is deliberate: it is a PLACEHOLDER section, and an
 * empty one that took no space would let a report go out with the space for the
 * figure quietly closed up and nothing saying a figure was expected.
 */
export function CustomImage({ title, image, caption = '', maxHeight = 320, onImageLoad }) {
    return (
        <div>
            {title ? <SectionBar title={title} /> : null}
            <div
                style={{
                    border: `1px solid ${LINE}`,
                    borderTop: title ? 'none' : `1px solid ${LINE}`,
                    padding: 5,
                }}
            >
                {image ? (
                    <div style={{ textAlign: 'center' }}>
                        <img
                            src={image}
                            alt={caption || title || 'Report figure'}
                            onLoad={onImageLoad}
                            crossOrigin="anonymous"
                            style={{
                                maxWidth: '100%',
                                maxHeight,
                                objectFit: 'contain',
                                display: 'inline-block',
                                border: `1px solid ${LINE}`,
                            }}
                        />
                    </div>
                ) : (
                    <div
                        style={{
                            height: maxHeight,
                            border: `1px dashed ${LINE}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 9,
                            color: MUTED,
                            fontStyle: 'italic',
                            lineHeight: 1.25,
                        }}
                    >
                        Image placeholder — paste or upload in the config pane
                    </div>
                )}
                {caption ? (
                    <div style={{ fontSize: 8, fontStyle: 'italic', color: MUTED, marginTop: 3, lineHeight: 1.25 }}>
                        {caption}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

/**
 * Every block one custom section produces, in order.
 *
 * A table is several blocks when it is long; the other two are always one. The
 * caller splices the result into its block array, so the paginator places them
 * with everything else and there is no per-section page arithmetic anywhere.
 *
 * `keyPrefix` distinguishes the interactive and measured passes' React keys
 * from each other only in that both arrays are built by the same function —
 * within one array the section id is already unique.
 */
export function buildCustomSectionBlocks(section, content, { onImageLoad, chunk } = {}) {
    if (section.type === 'text') {
        return [<CustomText key={`cs-${section.id}`} title={section.title} body={content.body} />];
    }
    if (section.type === 'image') {
        return [
            <CustomImage
                key={`cs-${section.id}`}
                title={section.title}
                image={content.image}
                caption={content.caption}
                maxHeight={content.maxHeight}
                onImageLoad={onImageLoad}
            />,
        ];
    }
    const chunks = chunk(content.rows);
    return chunks.map((rows, i) => (
        <CustomTable
            key={i === 0 ? `cs-${section.id}` : `cs-${section.id}-${i}`}
            title={section.title}
            columns={content.columns}
            rows={rows}
            withHeader={i === 0}
        />
    ));
}
