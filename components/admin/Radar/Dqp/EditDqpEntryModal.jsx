// EditDqpEntryModal.jsx
import { useState, useEffect, useRef } from 'react';
import { X, Image as ImageIcon, RefreshCw, Loader, Pencil } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabaseClient';
import ImprovementResolution from '@/components/admin/Radar/Dqp/ImprovementResolution';
import { useOpenImprovements } from '@/components/admin/Radar/Dqp/useOpenImprovements';
import { isResolved } from '@/utils/dqpImprovements';

/** The DQP parameters that carry alarm recommendations. */
const ALARM_PARAM_IDS = [20, 21];

/**
 * Correcting what a DQP row *says*, without touching what it *scores*.
 *
 * The ActionRequiredModal exists to move a row to a new status, and every
 * submission through it RAISES an improvement: on an alarm row it writes a row
 * per region into alarm_improvement, logs work and opens an email draft. That is
 * the wrong instrument for fixing a typo or swapping a screenshot that was
 * uploaded upside down — repeating the improvement is not a side effect the
 * analyst asked for.
 *
 * So this modal deliberately cannot change the status, cannot add a figure the
 * row never had, and raises no new improvement. It edits three things: the
 * notes, the caption/file behind each existing figure, and the appendix.
 *
 * On an alarm row it can also CLOSE recommendations already raised — which is
 * the opposite operation and safe here for that reason. Feedback on one of three
 * raised alarms usually arrives while the row itself stays where it is, and
 * before this the only way to record it was to declare the row Optimal, which
 * closes all three and asserts something about the radar that is not true.
 * Every recommendation defaults to "leave open", so an edit that ignores the
 * section writes nothing to alarm_improvement.
 *
 * Props:
 *   isOpen    {boolean}
 *   onClose   {function}
 *   onSubmit  {function}  - ({ notes, appendix, figures, improvementResolutions }, item)
 *   item      {object}    - the dqp_values row, with `images` already attached
 *   regions   {Array}     - the wall folder's alarm regions
 */
export default function EditDqpEntryModal({ isOpen, onClose, onSubmit, item, regions = [] }) {
    const [notes, setNotes] = useState('');
    const [appendix, setAppendix] = useState('');
    const [figures, setFigures] = useState([]);
    const [isSaving, setIsSaving] = useState(false);
    const figuresRef = useRef([]);

    // Hooks cannot be conditional, so the alarm check is a flag into the hook
    // rather than a guard around it — a non-alarm row keeps it idle and issues
    // no query. `item?.parameter?.id` is the shape the DQP list carries;
    // `parameter_id` is the raw column, and either may be the one populated.
    const isAlarmItem = ALARM_PARAM_IDS.includes(item?.parameter?.id ?? item?.parameter_id);
    const { improvements, loading: improvementsLoading, resolutions, setResolution } =
        useOpenImprovements(isOpen && isAlarmItem, regions);
    const resolvingCount = Object.values(resolutions).filter(isResolved).length;

    useEffect(() => {
        figuresRef.current = figures;
    }, [figures]);

    // Object URLs for replacement previews outlive the render that made them,
    // so they are revoked on close rather than on every figure change.
    useEffect(() => {
        if (isOpen) return;
        figuresRef.current.forEach((f) => f.replacementPreview && URL.revokeObjectURL(f.replacementPreview));
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        setNotes(item?.notes ?? '');
        setAppendix(item?.appendix ?? '');
        setFigures(
            (item?.images ?? []).map((img) => ({
                id: img.id,
                caption: img.caption ?? '',
                image_url: img.image_url,
                url: null,
                signed: false,
                removed: false,
                replacement: null,
                replacementPreview: null,
            }))
        );
        setIsSaving(false);
    }, [isOpen, item?.parameter_id, item?.notes, item?.appendix, item?.images]);

    // Sign the thumbnails once. `signed` is set even on failure so a broken
    // image cannot re-qualify and loop.
    useEffect(() => {
        if (!isOpen) return;
        const pending = figures.filter((f) => f.image_url && !f.signed);
        if (!pending.length) return;

        let cancelled = false;
        (async () => {
            const resolved = await Promise.all(
                pending.map(async (f) => {
                    const { data, error } = await supabase.storage.from('Radar').createSignedUrl(f.image_url, 3600);
                    if (error) console.error('Error signing DQP figure:', error);
                    return { id: f.id, url: error ? null : data?.signedUrl ?? null };
                })
            );
            if (cancelled) return;
            const urlById = new Map(resolved.map((r) => [r.id, r.url]));
            setFigures((prev) => prev.map((f) => (urlById.has(f.id) ? { ...f, url: urlById.get(f.id), signed: true } : f)));
        })();

        return () => { cancelled = true; };
    }, [isOpen, figures]);

    if (!isOpen || !item) return null;

    const setCaption = (id, caption) =>
        setFigures((prev) => prev.map((f) => (f.id === id ? { ...f, caption } : f)));

    const setReplacement = (id, file) =>
        setFigures((prev) =>
            prev.map((f) => {
                if (f.id !== id) return f;
                if (f.replacementPreview) URL.revokeObjectURL(f.replacementPreview);
                return {
                    ...f,
                    replacement: file ?? null,
                    replacementPreview: file ? URL.createObjectURL(file) : null,
                };
            })
        );

    const toggleRemoved = (id) =>
        setFigures((prev) => prev.map((f) => (f.id === id ? { ...f, removed: !f.removed } : f)));

    const handleSubmit = async () => {
        setIsSaving(true);
        try {
            await onSubmit(
                {
                    notes: notes.trim() ? notes : null,
                    appendix: appendix.trim() ? appendix : null,
                    // Kept figures in display order; a replaced one carries the new
                    // file, and the caller swaps its id after the upload lands.
                    figures: figures
                        .filter((f) => !f.removed)
                        .map((f) => ({ id: f.id, caption: f.caption, replacement: f.replacement })),
                    // Only the ones actually answered reach the caller; the rest
                    // stay 'Awaiting Feedback' untouched.
                    improvementResolutions: resolutions,
                },
                item
            );
        } finally {
            setIsSaving(false);
        }
    };

    const kept = figures.filter((f) => !f.removed).length;

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-5" onClick={onClose}>
            <div
                className="w-full max-w-2xl bg-[var(--dtg-bg-card)] rounded-lg overflow-hidden flex flex-col relative border border-[var(--dtg-border-medium)] max-h-[90vh]"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="px-5 py-3 border-b border-[var(--dtg-border-medium)] flex justify-between items-start gap-4 flex-shrink-0">
                    <div>
                        <h3 className="m-0 text-[var(--dtg-text-primary)] text-base flex items-center gap-2">
                            <Pencil size={16} />
                            Edit entry
                        </h3>
                        <p className="mt-1 text-xs text-[var(--dtg-text-secondary)]">
                            {item.parameter?.name} — currently {item.value}. The status is not changed and no new
                            improvement is raised.
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="bg-transparent border-none text-[var(--dtg-gray-400)] cursor-pointer p-1 flex items-center hover:text-[var(--dtg-text-primary)]"
                        title="Close"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="p-5 overflow-y-auto space-y-5">
                    <div>
                        <label className="block text-xs font-semibold text-[var(--dtg-text-secondary)] mb-1.5">Notes</label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            rows={3}
                            placeholder="What this row records"
                            className="w-full bg-[var(--dtg-bg-primary)] border border-[var(--dtg-border-medium)] rounded-md px-3 py-2 text-sm text-[var(--dtg-text-primary)] placeholder:text-[var(--dtg-gray-500)] focus:outline-none focus:ring-1 focus:ring-[var(--dtg-primary)]"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-[var(--dtg-text-secondary)] mb-1.5">
                            Figures
                            {figures.length > 0 && (
                                <span className="ml-2 font-normal text-[var(--dtg-gray-500)]">
                                    {kept} of {figures.length} kept
                                </span>
                            )}
                        </label>

                        {figures.length === 0 ? (
                            <p className="text-xs italic text-[var(--dtg-text-secondary)]">
                                This row has no figures. Attaching one is part of logging an improvement, not an edit.
                            </p>
                        ) : (
                            <div className="space-y-2">
                                {figures.map((f, index) => (
                                    <div
                                        key={f.id}
                                        className={`p-2 rounded border space-y-2 ${
                                            f.removed
                                                ? 'border-red-500/40 bg-red-500/5 opacity-60'
                                                : 'border-[var(--dtg-border-medium)] bg-[var(--dtg-bg-secondary)]'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="flex items-center gap-3 overflow-hidden">
                                                <div className="w-10 h-10 rounded overflow-hidden bg-gray-800 flex-shrink-0 border border-[var(--dtg-border-medium)] flex items-center justify-center">
                                                    {f.replacementPreview || f.url ? (
                                                        <img
                                                            src={f.replacementPreview || f.url}
                                                            alt={f.caption || `Figure ${index + 1}`}
                                                            className="w-full h-full object-cover"
                                                        />
                                                    ) : (
                                                        <ImageIcon size={16} className="text-[var(--dtg-gray-500)]" />
                                                    )}
                                                </div>
                                                <div className="flex flex-col min-w-0">
                                                    <span className="text-sm truncate text-[var(--dtg-text-primary)]">
                                                        Figure {index + 1}
                                                    </span>
                                                    <span className="text-xs text-[var(--dtg-gray-500)] truncate">
                                                        {f.removed
                                                            ? 'will be detached'
                                                            : f.replacement
                                                            ? `replaced with ${f.replacement.name}`
                                                            : 'unchanged'}
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                <label
                                                    className="cursor-pointer text-[var(--dtg-gray-400)] hover:text-[var(--dtg-text-primary)] transition-colors"
                                                    title="Replace this figure with another file"
                                                >
                                                    <RefreshCw size={16} />
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        className="hidden"
                                                        onChange={(e) => setReplacement(f.id, e.target.files?.[0] ?? null)}
                                                    />
                                                </label>
                                                <button
                                                    onClick={() => toggleRemoved(f.id)}
                                                    className="text-[var(--dtg-gray-400)] hover:text-red-500 transition-colors"
                                                    title={f.removed ? 'Keep this figure' : 'Detach this figure from the row'}
                                                >
                                                    <X size={16} />
                                                </button>
                                            </div>
                                        </div>

                                        <Input
                                            placeholder={`Caption for figure ${index + 1}`}
                                            value={f.caption}
                                            disabled={f.removed}
                                            onChange={(e) => setCaption(f.id, e.target.value)}
                                        />
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-[var(--dtg-text-secondary)] mb-1.5">
                            Appendix notes
                        </label>
                        <textarea
                            value={appendix}
                            onChange={(e) => setAppendix(e.target.value)}
                            rows={4}
                            placeholder="The longer write-up that accompanies the figures in the report"
                            className="w-full bg-[var(--dtg-bg-primary)] border border-[var(--dtg-border-medium)] rounded-md px-3 py-2 text-sm text-[var(--dtg-text-primary)] placeholder:text-[var(--dtg-gray-500)] focus:outline-none focus:ring-1 focus:ring-[var(--dtg-primary)]"
                        />
                    </div>

                    {isAlarmItem && (
                        <div className="border-t border-[var(--dtg-border-medium)] pt-4">
                            <label className="block text-xs font-semibold text-[var(--dtg-text-secondary)] mb-1.5">
                                Open recommendations
                            </label>
                            <p className="text-xs text-[var(--dtg-text-secondary)] mb-2">
                                Close out any the site has come back on. The row&apos;s status is unaffected either way.
                            </p>
                            <ImprovementResolution
                                improvements={improvements}
                                regions={regions}
                                value={resolutions}
                                onChange={setResolution}
                                loading={improvementsLoading}
                            />
                        </div>
                    )}
                </div>

                <div className="px-5 py-3 border-t border-[var(--dtg-border-medium)] flex justify-end gap-2 flex-shrink-0">
                    <Button variant="outline" onClick={onClose} disabled={isSaving}>
                        Cancel
                    </Button>
                    <Button onClick={handleSubmit} disabled={isSaving}>
                        {isSaving && <Loader size={14} className="animate-spin mr-2" />}
                        {isSaving
                            ? 'Saving…'
                            : resolvingCount > 0
                            ? `Save changes & close ${resolvingCount}`
                            : 'Save changes'}
                    </Button>
                </div>
            </div>
        </div>
    );
}
