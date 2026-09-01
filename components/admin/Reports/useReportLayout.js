'use client';

/**
 * The report layout a site's report is being built from, and this report's
 * content for its custom sections.
 *
 * Two pieces of state that look alike and are not:
 *
 *   entries  The LAYOUT — order, which defaults print, what custom sections
 *            exist and what shape they are. Loaded from `report_layouts`,
 *            edited in the config pane, saved back deliberately. Reused by
 *            every future report for this site.
 *
 *   values   THIS REPORT's content for those custom sections — the readings
 *            typed into the rainfall table, the pasted figure. Never persisted
 *            with the layout unless the analyst explicitly folds it in, and
 *            thrown away when the modal closes.
 *
 * Both live HERE, in the modal, and not inside the templates — the same reason
 * the annotation and figure state does. The export path mounts a SECOND copy of
 * the template in a detached container to rasterize it; state owned by the
 * template would start empty in that copy, and the custom sections would print
 * blank in the PDF while looking correct on screen.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { sectionsForCategory } from '@/config/reportSections';
import {
    normalizeLayout,
    serializeLayout,
    defaultLayout,
    newCustomSection,
    addSection,
    removeEntry,
    moveEntry,
    toggleEntry,
    updateSection,
    setColumnLabel,
    addColumn,
    removeColumn,
    addRow,
    removeRow,
    setCellValue,
    setSectionValue,
    layoutSignature,
} from '@/utils/reportLayout';

/**
 * Read a File into a data URL.
 *
 * Data URL and not an object URL, the same invariant every figure in these
 * reports holds: html2canvas cannot fetch during rasterization, so a `blob:`
 * src snapshots blank into the PDF while looking perfect in the preview.
 */
function readAsDataUrl(file) {
    return new Promise((resolve) => {
        if (!file || !file.type?.startsWith('image/')) return resolve(null);
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
    });
}

/** First image on a DataTransfer / ClipboardData, or null. */
function firstImageFile(source) {
    const items = source?.items;
    if (items?.length) {
        for (const item of items) {
            if (item.kind === 'file' && item.type?.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) return file;
            }
        }
    }
    const files = source?.files;
    if (files?.length) {
        for (const file of files) if (file.type?.startsWith('image/')) return file;
    }
    return null;
}

/** Stable identities, so a derived fallback is not a new object each render. */
const EMPTY_VALUES = {};
const IDLE = { kind: 'idle', message: '' };

/**
 * @param {string|number} siteId    clients.id — the report's site.
 * @param {string} category         'Tabulation' | 'Comprehensive' | anything else.
 * @param {string} updatedBy        Free text, filed against the saved row.
 * @param {boolean} enabled         False for the categories that are not
 *   block-composed (Data Quality, InSAR, Handover) — they have no measured
 *   blocks to reorder, so they get no editor rather than a broken one.
 */
export function useReportLayout(siteId, category, { updatedBy = '', enabled = true } = {}) {
    const catalogue = useMemo(() => sectionsForCategory(category), [category]);
    const active = Boolean(enabled && catalogue && siteId);

    /**
     * The layout that was loaded, TAGGED with the site and category it belongs
     * to, and edited in place from there.
     *
     * One object rather than five useStates, and tagged rather than reset, so
     * that everything this hook returns can be DERIVED from whether the tag
     * matches what is being asked for. That closes two holes at once:
     *
     *   * A slow load for the previous site landing after a fast one for the
     *     current site — one client's layout shown under another client's name.
     *   * The window between switching client and the new layout arriving, where
     *     the old client's sections were still in state and would have been
     *     rendered into the preview.
     *
     * It also keeps every setState out of the effect body, where React would be
     * made to render twice for each one.
     */
    const stateKey = active ? `${siteId}|${category}` : '';
    const [state, setState] = useState({ key: null, entries: [], values: {}, dirty: false, status: IDLE });

    const fresh = Boolean(stateKey) && state.key === stateKey;

    // Everything below is what the CALLER sees. Until the row for this site and
    // category has actually landed, that is the default order — which is the
    // report the site was getting before layouts existed.
    // Memoised: an unmemoised fallback would be a NEW array every render, and
    // it is passed straight into the template as a prop.
    const fallback = useMemo(() => defaultLayout(catalogue ?? []), [catalogue]);
    const entries = fresh ? state.entries : fallback;
    const values = fresh ? state.values : EMPTY_VALUES;
    const dirty = fresh ? state.dirty : false;
    const status = fresh ? state.status : IDLE;
    const loading = active && !fresh;

    useEffect(() => {
        if (!active) return undefined;

        let cancelled = false;
        (async () => {
            const { data, error } = await supabase
                .from('report_layouts')
                .select('sections, updated_at')
                .eq('site_id', siteId)
                .eq('category', category)
                .maybeSingle();

            if (cancelled) return;

            if (error) {
                // A layout that cannot be read is not a reason to refuse to write
                // a report. The default order IS the report this site was getting
                // before layouts existed, so falling back to it degrades to the
                // familiar document rather than to nothing — but the analyst is
                // told, because saving from here would overwrite whatever is in
                // the row they could not read.
                setState({
                    key: stateKey,
                    entries: defaultLayout(catalogue),
                    values: {},
                    dirty: false,
                    status: {
                        kind: 'error',
                        message: `Saved layout could not be loaded (${error.message}). Showing the default order.`,
                    },
                });
                return;
            }

            setState({
                key: stateKey,
                entries: normalizeLayout(data?.sections, catalogue),
                values: {},
                dirty: false,
                status: data
                    ? { kind: 'loaded', message: `Layout saved ${new Date(data.updated_at).toLocaleDateString()}` }
                    : { kind: 'idle', message: 'No saved layout — using the default order.' },
            });
        })();

        return () => {
            cancelled = true;
        };
    }, [active, stateKey, siteId, category, catalogue]);

    /**
     * Every STRUCTURAL edit goes through here, so `dirty` cannot be forgotten —
     * and so an edit that arrives after the client was switched (a keystroke
     * racing a dropdown) lands on nothing instead of on the new client's layout.
     */
    const edit = useCallback(
        (fn) => {
            setState((s) =>
                s.key !== stateKey
                    ? s
                    : {
                        ...s,
                        entries: fn(s.entries),
                        dirty: true,
                        status: s.status.kind === 'saved' ? IDLE : s.status,
                    }
            );
        },
        [stateKey]
    );

    /**
     * A CONTENT edit. Deliberately does not set `dirty`: typing today's rainfall
     * into the table has not changed the site's layout, and a Save prompt every
     * time an analyst fills the report in would train them to save readings into
     * the structure.
     */
    const editValues = useCallback(
        (fn) => {
            setState((s) => (s.key !== stateKey ? s : { ...s, values: fn(s.values) }));
        },
        [stateKey]
    );

    const api = useMemo(
        () => ({
            add: (type) => edit((e) => addSection(e, newCustomSection(type))),
            remove: (id) => edit((e) => removeEntry(e, id)),
            move: (id, delta) => edit((e) => moveEntry(e, id, delta)),
            toggle: (id) => edit((e) => toggleEntry(e, id)),
            setTitle: (id, title) => edit((e) => updateSection(e, id, { title })),
            setImageHeight: (id, maxHeight) => edit((e) => updateSection(e, id, { maxHeight })),
            setColumnLabel: (id, i, label) => edit((e) => setColumnLabel(e, id, i, label)),
            addColumn: (id) => edit((e) => addColumn(e, id)),
            removeColumn: (id, i) => edit((e) => removeColumn(e, id, i)),
            addRow: (id) => edit((e) => addRow(e, id)),
            removeRow: (id, i) => edit((e) => removeRow(e, id, i)),
        }),
        [edit]
    );

    const setCell = useCallback(
        (section, r, c, text) => editValues((v) => setCellValue(v, section, r, c, text)),
        [editValues]
    );

    const setBody = useCallback((id, body) => editValues((v) => setSectionValue(v, id, { body })), [editValues]);

    const setCaption = useCallback(
        (id, caption) => editValues((v) => setSectionValue(v, id, { caption })),
        [editValues]
    );

    const setImage = useCallback(
        async (id, fileOrSource) => {
            const file = fileOrSource instanceof File ? fileOrSource : firstImageFile(fileOrSource);
            const dataUrl = await readAsDataUrl(file);
            if (dataUrl) editValues((v) => setSectionValue(v, id, { image: dataUrl }));
            return Boolean(dataUrl);
        },
        [editValues]
    );

    const clearImage = useCallback((id) => editValues((v) => setSectionValue(v, id, { image: null })), [editValues]);

    // --- Persistence -------------------------------------------------------

    const save = useCallback(
        async ({ includeValues = false } = {}) => {
            if (!active) return false;
            setState((s) => (s.key !== stateKey ? s : { ...s, status: { kind: 'saving', message: 'Saving…' } }));

            const payload = serializeLayout(entries, values, includeValues);
            const { error } = await supabase
                .from('report_layouts')
                .upsert(
                    { site_id: siteId, category, sections: payload, updated_by: updatedBy || null },
                    { onConflict: 'site_id,category' }
                );

            setState((s) => {
                if (s.key !== stateKey) return s;
                if (error) return { ...s, status: { kind: 'error', message: `Save failed: ${error.message}` } };
                return {
                    ...s,
                    // Folding the cells in makes them part of the STRUCTURE, so
                    // the draft has to be re-read from what was written —
                    // otherwise the next save without the box ticked would write
                    // the old structure back and silently undo it.
                    entries: includeValues ? normalizeLayout(payload, catalogue) : s.entries,
                    dirty: false,
                    status: {
                        kind: 'saved',
                        message: includeValues ? 'Layout and cell values saved.' : 'Layout saved.',
                    },
                };
            });

            return !error;
        },
        [active, stateKey, entries, values, siteId, category, updatedBy, catalogue]
    );

    /** Back to the untouched default order. Not written until Save is pressed. */
    const reset = useCallback(() => {
        setState((s) =>
            s.key !== stateKey
                ? s
                : {
                    ...s,
                    entries: defaultLayout(catalogue ?? []),
                    values: {},
                    dirty: true,
                    status: { kind: 'idle', message: 'Reset to the default order — not saved yet.' },
                }
        );
    }, [stateKey, catalogue]);

    /**
     * The pagination dep. See layoutSignature: entries and values are new
     * objects on every keystroke, so passing them directly would re-measure the
     * whole report on each one, and passing neither would leave the page breaks
     * describing a table that has since grown.
     */
    const signature = useMemo(() => layoutSignature(entries, values), [entries, values]);

    return {
        supported: Boolean(catalogue),
        active,
        loading,
        dirty,
        status,
        entries,
        values,
        signature,
        ...api,
        setCell,
        setBody,
        setCaption,
        setImage,
        clearImage,
        save,
        reset,
    };
}

export default useReportLayout;
