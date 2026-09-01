'use client';

/**
 * The config pane's section editor — the surface that replaced "ask an engineer
 * to add a table to this client's report".
 *
 * SCREEN-ONLY. Nothing here is ever rendered into the paginated paper: the
 * printed blocks are in components/admin/Radar/report/blocks/CustomSections.jsx,
 * and the templates render those from the layout this component edits.
 *
 * Editing happens HERE and not on the page, unlike the report's other editable
 * fields (the weather line, the data-update stamp). That is not a style choice.
 * Every template is mounted twice — once visibly and once into a hidden
 * measurement layer that decides the page breaks — and the two copies have to
 * measure identically. An input on the page has to be built twice, live and
 * inert, and the pair kept in step forever. A custom section edited from the
 * pane is one component with one set of props, so the two passes cannot
 * disagree by construction.
 *
 * The preview beside it still updates on every keystroke, so the analyst is not
 * typing blind.
 */

import { useRef, useState } from 'react';

import { sectionContent, MIN_IMAGE_HEIGHT, MAX_IMAGE_HEIGHT } from '@/utils/reportLayout';
import { sectionsForCategory } from '@/config/reportSections';

const panel = {
    background: '#111418',
    color: '#fff',
    borderRadius: 6,
    padding: 10,
};

const btn = {
    padding: '3px 8px',
    borderRadius: 5,
    border: '1px solid rgba(255,255,255,0.2)',
    background: 'rgba(255,255,255,0.08)',
    color: '#fff',
    fontSize: 11,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    lineHeight: 1.4,
};

const primaryBtn = {
    ...btn,
    background: '#0f766e',
    borderColor: '#0f766e',
    fontWeight: 600,
};

const iconBtn = {
    ...btn,
    padding: '1px 6px',
    fontSize: 12,
};

const field = {
    border: '1px solid rgba(255,255,255,0.2)',
    background: 'rgba(255,255,255,0.08)',
    color: '#fff',
    borderRadius: 3,
    padding: '3px 6px',
    fontSize: 11,
    fontFamily: 'inherit',
    width: '100%',
    boxSizing: 'border-box',
};

const muted = { fontSize: 10, color: 'rgba(255,255,255,0.5)', lineHeight: 1.4 };

const STATUS_TONE = {
    error: '#f87171',
    saved: '#4ade80',
    saving: '#fbbf24',
    loaded: 'rgba(255,255,255,0.5)',
    idle: 'rgba(255,255,255,0.5)',
};

/** A default section's row: name, hint, on/off, and the two move buttons. */
function DefaultRow({ def, entry, first, last, onMove, onToggle }) {
    const off = entry.enabled === false;
    return (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '5px 0' }}>
            <MoveButtons first={first} last={last} onMove={onMove} />
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, flex: 1, cursor: 'pointer' }}>
                <input
                    type="checkbox"
                    checked={!off}
                    onChange={onToggle}
                    style={{ marginTop: 2, accentColor: '#0f766e' }}
                />
                <span style={{ flex: 1 }}>
                    <span style={{ fontSize: 11.5, opacity: off ? 0.45 : 1, textDecoration: off ? 'line-through' : 'none' }}>
                        {def?.label ?? entry.key}
                    </span>
                    {def?.hint ? <span style={{ ...muted, display: 'block' }}>{def.hint}</span> : null}
                </span>
            </label>
        </div>
    );
}

function MoveButtons({ first, last, onMove }) {
    return (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <button
                type="button"
                onClick={() => onMove(-1)}
                disabled={first}
                title="Move up"
                style={{ ...iconBtn, opacity: first ? 0.3 : 1, cursor: first ? 'default' : 'pointer' }}
            >
                ▲
            </button>
            <button
                type="button"
                onClick={() => onMove(1)}
                disabled={last}
                title="Move down"
                style={{ ...iconBtn, opacity: last ? 0.3 : 1, cursor: last ? 'default' : 'pointer' }}
            >
                ▼
            </button>
        </span>
    );
}

/**
 * A table's editor.
 *
 * Column headings are STRUCTURE and go straight to the layout; cells are this
 * report's CONTENT and go to `values`. They sit in the same grid because that
 * is the only way to see the table, but they are stored in different places and
 * saved on different terms — hence the note under the grid rather than a
 * silently different colour.
 */
function TableEditor({ section, content, api, onCell }) {
    return (
        <div>
            <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
                <table style={{ borderCollapse: 'separate', borderSpacing: 2 }}>
                    <thead>
                        <tr>
                            <th style={{ width: 18 }} />
                            {content.columns.map((col, c) => (
                                <th key={c} style={{ minWidth: 92 }}>
                                    <input
                                        value={col}
                                        onChange={(e) => api.setColumnLabel(section.id, c, e.target.value)}
                                        placeholder={`Column ${c + 1}`}
                                        style={{ ...field, fontWeight: 700, fontSize: 10.5 }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => api.removeColumn(section.id, c)}
                                        disabled={content.columns.length <= 1}
                                        title="Remove this column"
                                        style={{
                                            ...iconBtn,
                                            width: '100%',
                                            marginTop: 2,
                                            opacity: content.columns.length <= 1 ? 0.3 : 1,
                                        }}
                                    >
                                        − col
                                    </button>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {content.rows.map((row, r) => (
                            <tr key={r}>
                                <td>
                                    <button
                                        type="button"
                                        onClick={() => api.removeRow(section.id, r)}
                                        title="Remove this row"
                                        style={iconBtn}
                                    >
                                        −
                                    </button>
                                </td>
                                {row.map((cell, c) => (
                                    <td key={c}>
                                        <input
                                            value={cell}
                                            onChange={(e) => onCell(section, r, c, e.target.value)}
                                            style={field}
                                        />
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <button type="button" onClick={() => api.addRow(section.id)} style={btn}>
                    + Row
                </button>
                <button type="button" onClick={() => api.addColumn(section.id)} style={btn}>
                    + Column
                </button>
            </div>
            <p style={{ ...muted, marginTop: 6 }}>
                Column headings and the table’s shape are saved with the layout. Cell text belongs to
                this report only — tick “also save cell values” below to keep it, which is how fixed
                labels like a radar name become part of the layout.
            </p>
        </div>
    );
}

/** An image slot's editor: paste, drop, or pick a file. */
function ImageEditor({ section, content, api, onImage, onClearImage, onCaption }) {
    const inputRef = useRef(null);
    const [over, setOver] = useState(false);
    const [error, setError] = useState('');

    const take = async (source) => {
        setError('');
        const ok = await onImage(section.id, source);
        if (!ok) setError('That was not an image.');
    };

    return (
        <div>
            <div
                tabIndex={0}
                onPaste={(e) => take(e.clipboardData)}
                onDragOver={(e) => {
                    e.preventDefault();
                    setOver(true);
                }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => {
                    e.preventDefault();
                    setOver(false);
                    take(e.dataTransfer);
                }}
                onClick={() => inputRef.current?.click()}
                style={{
                    border: `1px dashed ${over ? '#0f766e' : 'rgba(255,255,255,0.3)'}`,
                    background: over ? 'rgba(15,118,110,0.15)' : 'rgba(255,255,255,0.04)',
                    borderRadius: 5,
                    padding: 10,
                    textAlign: 'center',
                    fontSize: 11,
                    cursor: 'pointer',
                }}
            >
                {content.image ? (
                    <img
                        src={content.image}
                        alt=""
                        style={{ maxWidth: '100%', maxHeight: 90, objectFit: 'contain' }}
                    />
                ) : (
                    'Click, drop, or focus here and paste an image'
                )}
            </div>
            <input
                ref={inputRef}
                type="file"
                accept="image/*"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) take(file);
                    e.target.value = '';
                }}
                style={{ display: 'none' }}
            />
            {error ? <p style={{ fontSize: 10, color: '#f87171', marginTop: 4 }}>{error}</p> : null}

            <input
                value={content.caption}
                onChange={(e) => onCaption(section.id, e.target.value)}
                placeholder="Caption (optional)"
                style={{ ...field, marginTop: 6 }}
            />

            <label style={{ ...muted, display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                Height
                <input
                    type="range"
                    min={MIN_IMAGE_HEIGHT}
                    max={MAX_IMAGE_HEIGHT}
                    step={20}
                    value={content.maxHeight}
                    onChange={(e) => api.setImageHeight(section.id, Number(e.target.value))}
                    style={{ flex: 1, accentColor: '#0f766e' }}
                />
                {content.maxHeight}px
            </label>

            {content.image ? (
                <button type="button" onClick={() => onClearImage(section.id)} style={{ ...btn, marginTop: 6 }}>
                    Remove image
                </button>
            ) : null}

            <p style={{ ...muted, marginTop: 6 }}>
                The image belongs to this report and is never saved into the layout — the slot, its
                height and its caption are.
            </p>
        </div>
    );
}

/** A custom section's row: header line plus, when open, its type editor. */
function CustomRow({ entry, first, last, api, values, onCell, onBody, onCaption, onImage, onClearImage }) {
    const [open, setOpen] = useState(false);
    const off = entry.enabled === false;
    const content = sectionContent(entry, values[entry.id]);

    return (
        <div
            style={{
                border: '1px solid rgba(255,255,255,0.14)',
                borderRadius: 5,
                padding: 6,
                margin: '5px 0',
                background: 'rgba(255,255,255,0.03)',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <MoveButtons first={first} last={last} onMove={(d) => api.move(entry.id, d)} />
                <input
                    type="checkbox"
                    checked={!off}
                    onChange={() => api.toggle(entry.id)}
                    title={off ? 'Print this section' : 'Hide this section'}
                    style={{ marginTop: 4, accentColor: '#0f766e' }}
                />
                <input
                    value={entry.title}
                    onChange={(e) => api.setTitle(entry.id, e.target.value)}
                    placeholder={`Untitled ${entry.type}`}
                    style={{ ...field, opacity: off ? 0.45 : 1 }}
                />
                <button type="button" onClick={() => setOpen((v) => !v)} style={iconBtn} title="Edit contents">
                    {open ? '▴' : '▾'}
                </button>
                <button
                    type="button"
                    onClick={() => api.remove(entry.id)}
                    style={{ ...iconBtn, color: '#fca5a5' }}
                    title="Delete this section"
                >
                    ✕
                </button>
            </div>

            <div style={{ ...muted, marginTop: 3, marginLeft: 30 }}>
                {entry.type === 'table'
                    ? `Table · ${content.columns.length} × ${content.rows.length}`
                    : entry.type === 'text'
                        ? 'Text'
                        : 'Image placeholder'}
                {off ? ' · hidden' : ''}
            </div>

            {open ? (
                <div style={{ marginTop: 8 }}>
                    {entry.type === 'table' ? (
                        <TableEditor section={entry} content={content} api={api} onCell={onCell} />
                    ) : entry.type === 'text' ? (
                        <>
                            <textarea
                                value={content.body}
                                onChange={(e) => onBody(entry.id, e.target.value)}
                                rows={5}
                                placeholder="Type the section’s text. A blank line starts a new paragraph."
                                style={{ ...field, resize: 'vertical', lineHeight: 1.45 }}
                            />
                            <p style={{ ...muted, marginTop: 6 }}>
                                Belongs to this report only unless “also save cell values” is ticked below.
                            </p>
                        </>
                    ) : (
                        <ImageEditor
                            section={entry}
                            content={content}
                            api={api}
                            onImage={onImage}
                            onClearImage={onClearImage}
                            onCaption={onCaption}
                        />
                    )}
                </div>
            ) : null}
        </div>
    );
}

/**
 * @param {object} layout  A useReportLayout() bundle.
 * @param {string} category  The report category, for the default-section labels.
 */
export function ReportLayoutEditor({ layout, category }) {
    const [includeValues, setIncludeValues] = useState(false);
    const [collapsed, setCollapsed] = useState(false);

    if (!layout?.supported) return null;

    const catalogue = sectionsForCategory(category) ?? [];
    const defs = new Map(catalogue.map((d) => [d.key, d]));
    const { entries, status, dirty, loading, active } = layout;

    // A layout is stored against a SITE, so there is nothing to edit or save
    // until one is chosen. Said out loud rather than shown as an empty list.
    if (!active) {
        return (
            <div style={panel}>
                <strong style={{ fontSize: 12 }}>Report sections</strong>
                <p style={{ ...muted, marginTop: 6 }}>Select a client to edit this report’s sections.</p>
            </div>
        );
    }

    const headerHidden = entries.some((e) => e.kind === 'default' && e.key === 'header' && e.enabled === false);

    return (
        <div style={panel}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong style={{ fontSize: 12, flex: 1 }}>Report sections</strong>
                {dirty ? <span style={{ fontSize: 10, color: '#fbbf24' }}>unsaved</span> : null}
                <button type="button" onClick={() => setCollapsed((v) => !v)} style={iconBtn}>
                    {collapsed ? '▾' : '▴'}
                </button>
            </div>

            {collapsed ? null : (
                <>
                    <p style={{ ...muted, marginTop: 4 }}>
                        Reorder with ▲▼, untick to leave a section out, or add your own. Saved against this
                        client and reused by every future {category} report.
                    </p>

                    {loading ? (
                        <p style={{ ...muted, marginTop: 8 }}>Loading saved layout…</p>
                    ) : (
                        <div style={{ marginTop: 8, maxHeight: '46vh', overflowY: 'auto', paddingRight: 4 }}>
                            {entries.map((entry, i) =>
                                entry.kind === 'custom' ? (
                                    <CustomRow
                                        key={entry.id}
                                        entry={entry}
                                        first={i === 0}
                                        last={i === entries.length - 1}
                                        api={layout}
                                        values={layout.values}
                                        onCell={layout.setCell}
                                        onBody={layout.setBody}
                                        onCaption={layout.setCaption}
                                        onImage={layout.setImage}
                                        onClearImage={layout.clearImage}
                                    />
                                ) : (
                                    <DefaultRow
                                        key={entry.id}
                                        def={defs.get(entry.key)}
                                        entry={entry}
                                        first={i === 0}
                                        last={i === entries.length - 1}
                                        onMove={(d) => layout.move(entry.id, d)}
                                        onToggle={() => layout.toggle(entry.id)}
                                    />
                                )
                            )}
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                        <button type="button" onClick={() => layout.add('table')} style={btn}>
                            + Table
                        </button>
                        <button type="button" onClick={() => layout.add('text')} style={btn}>
                            + Text
                        </button>
                        <button type="button" onClick={() => layout.add('image')} style={btn}>
                            + Image
                        </button>
                    </div>

                    {/* The one way to lose a section without meaning to. Said where
                        it happens, not left for the analyst to notice in the PDF. */}
                    {headerHidden ? (
                        <p style={{ fontSize: 10, color: '#fbbf24', marginTop: 8, lineHeight: 1.4 }}>
                            The header is hidden — this report will print with no masthead, date or client
                            logo on page 1.
                        </p>
                    ) : null}

                    <label style={{ ...muted, display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 10 }}>
                        <input
                            type="checkbox"
                            checked={includeValues}
                            onChange={(e) => setIncludeValues(e.target.checked)}
                            style={{ marginTop: 1, accentColor: '#0f766e' }}
                        />
                        <span>
                            Also save cell values and text as defaults — for fixed labels. Anything typed
                            for today will then reprint on every future report.
                        </span>
                    </label>

                    <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <button type="button" onClick={() => layout.save({ includeValues })} style={primaryBtn}>
                            Save layout
                        </button>
                        <button type="button" onClick={layout.reset} style={btn}>
                            Reset to default
                        </button>
                    </div>

                    {status?.message ? (
                        <p style={{ fontSize: 10, marginTop: 6, color: STATUS_TONE[status.kind], lineHeight: 1.4 }}>
                            {status.message}
                        </p>
                    ) : null}
                </>
            )}
        </div>
    );
}

export default ReportLayoutEditor;
