import { useState, useEffect, useMemo, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"; // Verify your UI path
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/lib/supabaseClient";
import { getSubjectOptions } from "@/config/formConfig";
import { Upload, Loader, AlertCircle, X, FileText, Image as ImageIcon } from 'lucide-react';
import toast, { Toaster } from 'react-hot-toast';
import ImprovementResolution from "@/components/admin/Radar/Dqp/ImprovementResolution";
import { useOpenImprovements } from "@/components/admin/Radar/Dqp/useOpenImprovements";
import { isResolved } from "@/utils/dqpImprovements";
import { usePasteImages } from "@/utils/usePasteImages";

/**
 * How far back an alarm has to have been raised for its region/cause to be
 * offered as an improvement target. An improvement is a response to something
 * that just happened, so a region whose last alarm was two days ago would only
 * ever be picked by mistake.
 */
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

/** One improvement row per region+cause, so the key has to carry both. */
const selectionKey = (regionId, cause) => `${regionId}::${cause ?? ''}`;

/**
 * The one subject that is raised against a REGION rather than against an alarm.
 *
 * "Alarm Configuration Issue" is noticed BEFORE the alarm it would have
 * produced — a region whose configuration is wrong is usually a region that has
 * not alarmed and should have. Requiring an alarm_records row first therefore
 * either blocked the analyst or pushed them into logging a fictitious alarm to
 * get past the form, so for this subject every region on the wall folder is
 * offered and the improvement row carries no alarm_record at all.
 *
 * Every OTHER subject still answers a specific alarm, and still picks from the
 * region+cause pairs that actually fired in the last 12 hours: an "Alarm Since
 * Time Adjustment" or a mask recommendation is a response to alarms that
 * happened, and pinning it to the record whose cause the analyst read is the
 * whole point of that flow.
 */
const REGION_ONLY_SUBJECT = 'Alarm Configuration';

export const ActionRequiredModal = ({ isOpen, onClose, onSubmit, item, targetStatus, alarmRegions = [], defaultSubject }) => {
    const [formData, setFormData] = useState({
        subject: "",
        issue: "",
        action: "",
        alarmRegions: [], // Array of IDs
        notes: "",
        tempnotes: "",
        alarmMask: "",
        appendix: ""
    });

    const isAlarmItem = item?.parameter?.id === 20 || item?.parameter?.id === 21;
    const isMaskItem = item?.parameter?.id === 21;
    const [isDragging, setIsDragging] = useState(false);
    const [needImage, setNeedImage] = useState(false);
    const [needAppendix, setNeedAppendix] = useState(false);
    const [files, setFiles] = useState([]);
    const filesRef = useRef([]);

    /**
     * Figures the row already carries, as `{ id, caption, image_url, url, signed }`.
     *
     * A follow-up improvement is usually the same incident one step better or
     * worse, so it opens holding the previous figures rather than an empty
     * dropzone — the analyst keeps what still applies, re-captions it, and adds
     * to it. Removing one here only detaches it from the row; the client_images
     * record and the stored file are left alone.
     */
    const [existingImages, setExistingImages] = useState([]);

    // Recent alarm region+cause pairs (last 12 h) and what the analyst ticked.
    const [alarmOptions, setAlarmOptions] = useState([]);
    const [alarmOptionsLoading, setAlarmOptionsLoading] = useState(false);
    const [selections, setSelections] = useState({});

    /**
     * An improvement answers an alarm, so with nothing to answer there is
     * nothing to raise: no alarm_records row in the window means no options,
     * and submission is blocked rather than falling back to a bare region pick.
     * A region-only row would have to be pinned to whatever alarm happened to be
     * newest, which is how improvements ended up attached to alarms nobody was
     * responding to. The alarm gets logged in the Alarm tab first.
     */
    /**
     * Raised against a region, with no alarm to answer — see
     * REGION_ONLY_SUBJECT. Only ever true on an alarm row.
     */
    const isRegionOnlySubject = isAlarmItem && formData.subject === REGION_ONLY_SUBJECT;

    /**
     * Nothing to answer, so nothing to raise — the alarm gets logged in the
     * Alarm tab first. This gate belongs ONLY to the subjects that answer a
     * recorded alarm; the region-only subject has no such precondition, and
     * is blocked solely by a wall folder with no regions at all.
     */
    const alarmTargetsUnavailable =
        isAlarmItem && !isRegionOnlySubject && !alarmOptionsLoading && alarmOptions.length === 0;
    const noRegionsConfigured = isRegionOnlySubject && alarmRegions.length === 0;

    /**
     * Recommendations already awaiting feedback, answerable in the same submit.
     *
     * A status change to another non-optimal value is often exactly the moment
     * one of them lands: the site actioned one of three raised alarms, so the
     * radar moves Critical → Sub-Optimal but is not Optimal and the other two are
     * still open. Before this, the only instrument that could close a
     * recommendation was the "→ Optimal" gate, which closes ALL of them — so an
     * analyst either overstated the radar or left the answered one hanging.
     *
     * Every row defaults to "leave open", so this raises a new improvement
     * exactly as it always did unless the analyst says otherwise.
     */
    const {
        improvements: openImprovements,
        loading: openImprovementsLoading,
        resolutions: improvementResolutions,
        setResolution: setImprovementResolution,
    } = useOpenImprovements(isOpen && isAlarmItem, alarmRegions);
    const resolvingCount = Object.values(improvementResolutions).filter(isResolved).length;

    // Keep ref in sync for cleanup
    useEffect(() => {
        filesRef.current = files;
    }, [files]);

    // Cleanup previews on unmount
    useEffect(() => {
        return () => {
            filesRef.current.forEach(entry => URL.revokeObjectURL(entry.preview));
        };
    }, []);

    const subjectOptions = useMemo(() => {
        return getSubjectOptions(item?.parameter);
    }, [item]);

    const handleSubjectChange = (selectedValue) => {
        // Find the full object from the config
        const selectedOption = subjectOptions.find(opt => opt.value === selectedValue);

        setFormData(prev => ({
            ...prev,
            subject: selectedValue,
            // If the config has an issue/action, use it. Otherwise, keep existing or clear it.
            issue: selectedOption?.issue || "",
            action: selectedOption?.action || "",
            // Most subjects ship an empty `notes`. Falling back to what is
            // already typed keeps the carried-over notes from being wiped the
            // moment the analyst picks the subject for the follow-up.
            notes: selectedOption?.notes || prev.notes || "",
            tempnotes: selectedOption?.tempnotes || "",
            appendix: selectedOption?.notes || prev.appendix || "",
        }));
    };

    // Reset form when modal opens
    useEffect(() => {
        if (!isOpen) return;

        // Priority 1: caller-specified default subject (e.g. from Rainfall flow)
        const subjectToApply = defaultSubject
            ? subjectOptions.find(opt => opt.value === defaultSubject)
            : subjectOptions.length === 1
            ? subjectOptions[0]
            : null;

        if (subjectToApply) {
            setFormData(prev => ({
                ...prev,
                subject: subjectToApply.value,
                label: subjectToApply.label,
                issue: subjectToApply.issue || "",
                action: subjectToApply.action || "",
                notes: subjectToApply.notes || "",
                tempnotes: subjectToApply.tempnotes || "",
                appendix: subjectToApply.notes || "",
            }));
        }
    }, [isOpen, subjectOptions, defaultSubject]);

    /**
     * Seed the form from the row being edited.
     *
     * Declared after the subject effect so that on an open where both run, the
     * row's own notes/appendix win over the subject template's blanks.
     */
    useEffect(() => {
        if (!isOpen) return;

        const priorImages = Array.isArray(item?.images) ? item.images : [];
        setExistingImages(priorImages.map(img => ({
            id: img.id,
            caption: img.caption ?? '',
            image_url: img.image_url,
            url: null,
            signed: false,
        })));

        setFiles(prev => {
            prev.forEach(entry => URL.revokeObjectURL(entry.preview));
            return [];
        });
        setSelections({});
        setNeedImage(priorImages.length > 0);
        setNeedAppendix(Boolean(item?.appendix));
        setFormData(prev => ({
            ...prev,
            notes: item?.notes ?? '',
            appendix: item?.appendix ?? '',
            alarmRegions: [],
            alarmMask: '',
        }));
    }, [isOpen, item?.parameter_id, item?.notes, item?.appendix]);

    // Sign the carried-over figures so they can be previewed as thumbnails.
    // `signed` is set even when signing fails, otherwise a broken image would
    // keep re-qualifying for this effect and loop.
    useEffect(() => {
        if (!isOpen) return;
        const pending = existingImages.filter(img => img.image_url && !img.signed);
        if (!pending.length) return;

        let cancelled = false;
        (async () => {
            const resolved = await Promise.all(pending.map(async (img) => {
                const { data, error } = await supabase.storage
                    .from('Radar')
                    .createSignedUrl(img.image_url, 3600);
                if (error) console.error('Error signing DQP figure:', error);
                return { id: img.id, url: error ? null : data?.signedUrl ?? null };
            }));
            if (cancelled) return;
            const urlById = new Map(resolved.map(r => [r.id, r.url]));
            setExistingImages(prev => prev.map(img => (
                urlById.has(img.id) ? { ...img, url: urlById.get(img.id), signed: true } : img
            )));
        })();

        return () => { cancelled = true; };
    }, [isOpen, existingImages]);

    // The regions this modal can offer, as a stable dependency.
    const regionIdKey = useMemo(
        () => alarmRegions.map(r => r.id).join(','),
        [alarmRegions]
    );

    /**
     * The selectable targets: every distinct region+cause that actually alarmed
     * in the last 12 hours, newest record per pair.
     *
     * The record id is captured here rather than looked up at submit time, so
     * the alarm_improvement row lands on the exact alarm_records row whose cause
     * the analyst read — a "latest record for this region" lookup would drift to
     * a different cause as soon as the region alarms again mid-form.
     */
    useEffect(() => {
        if (!isOpen || !isAlarmItem) return;

        const regionIds = alarmRegions.map(r => r.id).filter(id => id != null);
        if (!regionIds.length) {
            setAlarmOptions([]);
            return;
        }

        let cancelled = false;
        (async () => {
            setAlarmOptionsLoading(true);
            try {
                const since = new Date(Date.now() - TWELVE_HOURS_MS).toISOString();
                const { data, error } = await supabase
                    .from('alarm_records')
                    .select('id, alarm_region, cause, triggered_at')
                    .in('alarm_region', regionIds)
                    .gte('triggered_at', since)
                    .order('triggered_at', { ascending: false });

                if (error) throw error;
                if (cancelled) return;

                const nameById = new Map(alarmRegions.map(r => [String(r.id), r.name]));
                const grouped = new Map();

                (data || []).forEach((record) => {
                    const cause = (record.cause || '').trim();
                    // No cause recorded yet means nothing to improve against.
                    if (!cause) return;

                    const key = selectionKey(record.alarm_region, cause);
                    const seen = grouped.get(key);
                    if (seen) {
                        seen.count += 1; // rows arrive newest-first, so the first wins
                        return;
                    }
                    grouped.set(key, {
                        key,
                        recordId: record.id,
                        regionId: record.alarm_region,
                        regionName: nameById.get(String(record.alarm_region)) || `Region ${record.alarm_region}`,
                        cause,
                        count: 1,
                    });
                });

                setAlarmOptions([...grouped.values()].sort((a, b) => (
                    a.regionName.localeCompare(b.regionName) || a.cause.localeCompare(b.cause)
                )));
            } catch (err) {
                console.error('Error loading recent alarm causes:', err);
                if (!cancelled) setAlarmOptions([]);
            } finally {
                if (!cancelled) setAlarmOptionsLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [isOpen, isAlarmItem, regionIdKey]); // eslint-disable-line react-hooks/exhaustive-deps

    /**
     * Every alarm region on the wall folder, for the region-only subject.
     *
     * `alarmRegions` is already that list — SensorDetail loads it on sensor
     * change, independently of the Alarm tab being mounted — so there is
     * nothing to fetch. `recordId: null` is what distinguishes these from the
     * record-backed options above, and is carried all the way into the insert.
     */
    const regionOnlyOptions = useMemo(() => (
        (alarmRegions ?? [])
            .filter((r) => r?.id != null)
            .map((r) => ({
                key: selectionKey(r.id, null),
                recordId: null,
                regionId: r.id,
                regionName: r.name || `Region ${r.id}`,
                cause: null,
            }))
            .sort((a, b) => a.regionName.localeCompare(b.regionName))
    ), [alarmRegions]);

    const optionsByRegion = useMemo(() => {
        const byRegion = new Map();
        alarmOptions.forEach((opt) => {
            if (!byRegion.has(opt.regionId)) {
                byRegion.set(opt.regionId, { regionId: opt.regionId, regionName: opt.regionName, options: [] });
            }
            byRegion.get(opt.regionId).options.push(opt);
        });
        return [...byRegion.values()];
    }, [alarmOptions]);

    const selectedList = useMemo(() => Object.values(selections), [selections]);

    /**
     * Switching subject switches which list is on screen, so what was ticked in
     * the other one has to go. A region+cause key kept across the flip would
     * submit a row the analyst can no longer see, and the region-only keys
     * (`id::`) are not even valid entries in the record-backed list.
     */
    useEffect(() => {
        setSelections({});
    }, [isRegionOnlySubject]);

    const toggleSelection = (option) => {
        setSelections(prev => {
            if (prev[option.key]) {
                const next = { ...prev };
                delete next[option.key];
                return next;
            }
            return {
                ...prev,
                [option.key]: {
                    key: option.key,
                    recordId: option.recordId,
                    regionId: option.regionId,
                    regionName: option.regionName,
                    cause: option.cause,
                    mask: '',
                },
            };
        });
    };

    // One mask per selected region+cause: two regions produce two improvement
    // rows, and a single shared mask value would be wrong for at least one.
    const setSelectionMask = (key, mask) => {
        setSelections(prev => (prev[key] ? { ...prev, [key]: { ...prev[key], mask } } : prev));
    };

    /**
     * Each entry is `{ file, preview, caption }` rather than a File decorated in
     * place: every image now carries its own figure caption into the report, and
     * a controlled <input> cannot be backed by a mutated File object without the
     * keystroke and the re-render disagreeing.
     */
    const addFiles = (newFiles) => {
        const entries = newFiles.map(file => ({
            file,
            preview: URL.createObjectURL(file),
            caption: '',
        }));
        setFiles(prev => [...prev, ...entries]);
    };

    const removeFile = (index) => {
        setFiles(prev => {
            const newFiles = [...prev];
            const removed = newFiles.splice(index, 1)[0];
            URL.revokeObjectURL(removed.preview);
            return newFiles;
        });
    };

    const setCaption = (index, caption) => {
        setFiles(prev => prev.map((entry, i) => (i === index ? { ...entry, caption } : entry)));
    };

    const removeExistingImage = (id) => {
        setExistingImages(prev => prev.filter(img => img.id !== id));
    };

    const setExistingCaption = (id, caption) => {
        setExistingImages(prev => prev.map(img => (img.id === id ? { ...img, caption } : img)));
    };

    const handleSubmit = () => {
        // Basic validation
        if (!formData.subject || !formData.issue || !formData.action|| !formData.notes) {
            toast.error("Please fill in all general fields.");
            return;
        }
        if (alarmTargetsUnavailable) {
            toast.error("Log the alarm and its cause in the Alarm tab first — an improvement has to answer a recorded alarm.");
            return;
        }
        if (noRegionsConfigured) {
            toast.error("This wall folder has no alarm regions. Add them in the Alarm tab first.");
            return;
        }
        if (isAlarmItem && selectedList.length === 0) {
            toast.error(isRegionOnlySubject
                ? "Please select at least one alarm region."
                : "Please select at least one alarm region and cause.");
            return;
        }
        if (isMaskItem && selectedList.some(sel => !sel.mask?.trim())) {
            toast.error("Please enter an Alarm Mask for every selected region.");
            return;
        }

        const keptImages = needImage
            ? existingImages.map(({ id, caption }) => ({ id, caption }))
            : [];
        const outgoingFiles = needImage ? files : [];

        // The email prints one ALARM MASK line, so multiple masks are labelled
        // by the region they belong to instead of being silently collapsed.
        const alarmMaskSummary = isMaskItem
            ? selectedList
                .map(sel => (selectedList.length > 1
                    ? `${sel.regionName}${sel.cause ? ` (${sel.cause})` : ''}: ${sel.mask.trim()}`
                    : sel.mask.trim()))
                .join(' | ')
            : '';

        onSubmit({
            ...formData,
            // Kept for the email body and any caller still reading region ids.
            alarmRegions: [...new Set(selectedList.map(sel => sel.regionId))],
            alarmSelections: selectedList.map(sel => ({
                // null for the region-only subject: there is no alarm to answer.
                recordId: sel.recordId ?? null,
                regionId: sel.regionId,
                regionName: sel.regionName,
                cause: sel.cause,
                alarmMask: sel.mask?.trim() || null,
            })),
            alarmMask: alarmMaskSummary || formData.alarmMask,
            // Recommendations the analyst answered on the way past. Raising the
            // new improvement and closing old ones are independent writes — see
            // handleModalSubmit, which does not let one fail the other.
            improvementResolutions,
            // `imagesManaged` tells the caller this submission describes the row's
            // complete figure list — kept plus new — rather than only additions.
            imagesManaged: true,
            existingImages: keptImages,
            files: outgoingFiles,
        }, item, targetStatus);
    };

    const handleFileChange = (e) => {
        const selectedFiles = Array.from(e.target.files);
        addFiles(selectedFiles);
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragging(false);
        const droppedFiles = Array.from(e.dataTransfer.files);
        addFiles(droppedFiles);
    };

    /**
     * Ctrl+V anywhere in the modal appends the clipboard's images, which is how
     * a DQP figure is actually produced: the analyst snips the radar view and
     * would otherwise have to save it to disk purely to pick it back out of a
     * file dialog.
     *
     * Armed only while the figure section is actually showing. `isOpen` alone
     * would leave it live on a row with figures switched off; `needImage` alone
     * would leave it live behind a CLOSED modal, swallowing the user's
     * clipboard image from anywhere else in the app.
     */
    usePasteImages(addFiles, { enabled: isOpen && needImage });

    return (
        <Dialog open={isOpen} onOpenChange={onClose}> <Toaster position="top-center" reverseOrder={false} />
            <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto bg-[var(--dtg-bg-card)] text-[var(--dtg-text-primary)] border-[var(--dtg-border-medium)]">
                <DialogHeader>
                    <DialogTitle>Action Required: {item?.parameter?.name}</DialogTitle>
                    <p className="text-sm text-gray-500">
                        Changing status to <span className="font-bold text-red-500">{targetStatus}</span> requires an action plan.
                    </p>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    {/* --- GENERAL FIELDS --- */}
                    {/* SUBJECT: The Trigger */}
                    <div className="space-y-2">
                        <label>Subject</label>
                        <Select
                            value={formData.subject}
                            onValueChange={handleSubjectChange} // Call our smart handler
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select Subject" />
                            </SelectTrigger>
                            <SelectContent className="py-1.5 text-sm text-[var(--dtg-text-primary)] bg-[var(--dtg-bg-card)] outline-none border border-[var(--dtg-border-medium)] rounded">
                                {subjectOptions.map(opt => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* ISSUE: Auto-filled but editable if empty */}
                    <div className="space-y-2">
                        <label>Issue</label>
                        <div className="p-2 text-sm border border-[var(--dtg-border-medium)] rounded bg-[var(--dtg-bg-card)] min-h-[40px]">
                            {formData.issue || <span className="text-gray-400 italic">Select a subject...</span>}
                        </div>
                    </div>

                    {/* ACTION: Auto-filled, using Textarea for long text */}
                    <div className="space-y-2">
                        <label>Action</label>
                        <Textarea
                            value={formData.action}
                            onChange={(e) => setFormData({ ...formData, action: e.target.value })}
                            className="bg-[var(--dtg-bg-card)] text-[var(--dtg-text-primary)]"
                            placeholder="Action plan will appear here..."
                        />
                    </div>

                    {/* --- SPECIAL LOGIC: ALARMS (ID 20 & 21) --- */}
                    {isAlarmItem && (
                        <div className="border-t border-[var(--dtg-border-medium)] pt-4 mt-2 space-y-4">
                            <h4 className="font-semibold text-sm">Alarm Specifics</h4>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label>
                                        {isRegionOnlySubject
                                            ? 'Alarm Region'
                                            : 'Alarm Region & Cause (last 12 hours)'}
                                    </label>
                                    {selectedList.length > 0 && (
                                        <span className="text-xs text-[var(--dtg-text-secondary)]">
                                            {selectedList.length} improvement row{selectedList.length > 1 ? 's' : ''}
                                        </span>
                                    )}
                                </div>

                                {isRegionOnlySubject ? (
                                    noRegionsConfigured ? (
                                        <div className="border border-amber-500/40 bg-amber-500/5 rounded p-3 space-y-1.5">
                                            <p className="text-sm text-amber-500 flex items-start gap-2 font-medium">
                                                <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                                                No alarm region is configured on this wall folder.
                                            </p>
                                            <p className="text-xs text-[var(--dtg-text-secondary)]">
                                                A configuration recommendation is raised against a region, so
                                                add the wall folder&apos;s regions in the <strong>Alarm</strong>{' '}
                                                tab first, then set this status again.
                                            </p>
                                        </div>
                                    ) : (
                                        <>
                                            {/* Flat list, not grouped by region: each region IS one option
                                                here, so a region header above its own single checkbox would
                                                print the same name twice. */}
                                            <div className="border border-[var(--dtg-border-light)] p-2 rounded max-h-[220px] overflow-y-auto space-y-1.5">
                                                {regionOnlyOptions.map((opt) => (
                                                    <div key={opt.key} className="flex items-center space-x-2">
                                                        <Checkbox
                                                            id={`region-${opt.key}`}
                                                            checked={Boolean(selections[opt.key])}
                                                            onCheckedChange={() => toggleSelection(opt)}
                                                        />
                                                        <label htmlFor={`region-${opt.key}`} className="text-sm cursor-pointer select-none">
                                                            {opt.regionName}
                                                        </label>
                                                    </div>
                                                ))}
                                            </div>
                                            <p className="text-xs text-[var(--dtg-gray-500)]">
                                                A configuration issue does not have to have alarmed yet, so
                                                every region on the wall folder is offered and no alarm record
                                                is attached.
                                            </p>
                                        </>
                                    )
                                ) : alarmOptionsLoading ? (
                                    <div className="flex items-center gap-2 text-sm text-[var(--dtg-text-secondary)] p-2">
                                        <Loader size={14} className="animate-spin" /> Loading recent alarms...
                                    </div>
                                ) : alarmTargetsUnavailable ? (
                                    <div className="border border-amber-500/40 bg-amber-500/5 rounded p-3 space-y-1.5">
                                        <p className="text-sm text-amber-500 flex items-start gap-2 font-medium">
                                            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                                            No alarm with a recorded cause in the last 12 hours.
                                        </p>
                                        <p className="text-xs text-[var(--dtg-text-secondary)]">
                                            An alarm improvement has to answer an alarm that actually fired.
                                            Log the alarm and its cause in the <strong>Alarm</strong> tab first,
                                            then set this status again.
                                        </p>
                                    </div>
                                ) : (
                                    <>
                                        <div className="border border-[var(--dtg-border-light)] p-2 rounded max-h-[220px] overflow-y-auto space-y-3">
                                            {optionsByRegion.map((group) => (
                                                <div key={group.regionId} className="space-y-1.5">
                                                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--dtg-text-secondary)]">
                                                        {group.regionName}
                                                    </p>
                                                    {group.options.map((opt) => {
                                                        const selection = selections[opt.key];
                                                        return (
                                                            <div key={opt.key} className="pl-2 space-y-1.5">
                                                                <div className="flex items-center space-x-2">
                                                                    <Checkbox
                                                                        id={`cause-${opt.key}`}
                                                                        checked={Boolean(selection)}
                                                                        onCheckedChange={() => toggleSelection(opt)}
                                                                    />
                                                                    <label htmlFor={`cause-${opt.key}`} className="text-sm cursor-pointer select-none">
                                                                        {opt.cause}
                                                                        <span className="ml-1.5 text-xs text-[var(--dtg-gray-500)]">
                                                                            ×{opt.count}
                                                                        </span>
                                                                    </label>
                                                                </div>

                                                                {/* --- SPECIAL LOGIC: MASK (ID 21 Only) --- */}
                                                                {isMaskItem && selection && (
                                                                    <Input
                                                                        placeholder={`Alarm mask for ${group.regionName} (${opt.cause})`}
                                                                        value={selection.mask}
                                                                        onChange={(e) => setSelectionMask(opt.key, e.target.value)}
                                                                    />
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            ))}
                                        </div>
                                        <p className="text-xs text-[var(--dtg-gray-500)]">
                                            Region or cause missing? Record it in the Alarm tab — this list is
                                            built from alarm_records.
                                        </p>
                                    </>
                                )}
                            </div>

                            {(openImprovementsLoading || openImprovements.length > 0) && (
                                <div className="space-y-2 border-t border-[var(--dtg-border-medium)] pt-4">
                                    <label>Close open recommendations (optional)</label>
                                    <p className="text-xs text-[var(--dtg-gray-500)]">
                                        Answer any the site has come back on. Anything left open stays awaiting
                                        feedback — this does not have to be all of them.
                                    </p>
                                    <ImprovementResolution
                                        improvements={openImprovements}
                                        regions={alarmRegions}
                                        value={improvementResolutions}
                                        onChange={setImprovementResolution}
                                        loading={openImprovementsLoading}
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    <div className="space-y-2">
                        <label>Notes</label>
                        <Input
                            placeholder="Describe the details..."
                            required
                            value={formData.notes}
                            onChange={(e) => setFormData({ ...formData, notes: e.target.value, appendix:e.target.value })}
                        />
                    </div>

                    {/* File Upload Area */}
                    <div className="mb-5">
                        <div className="flex gap-2">
                            <Checkbox
                                checked={needImage}
                                onCheckedChange={() => setNeedImage(!needImage)}
                                className={`w-5 h-5 ${needImage
                                    ? 'border-green-600 hover:border-green-500'
                                    : 'border-gray-600 hover:border-gray-500'
                                    }`}
                            />
                            <label>Image</label>
                            {existingImages.length > 0 && (
                                <span className="text-xs text-[var(--dtg-text-secondary)] self-center">
                                    ({existingImages.length} carried over)
                                </span>
                            )}
                        </div>
                        {!needImage && existingImages.length > 0 && (
                            <p className="text-xs text-amber-500 mt-1">
                                Leaving this unticked removes the {existingImages.length} existing figure{existingImages.length > 1 ? 's' : ''} from this row.
                            </p>
                        )}
                        {needImage &&
                            <div>
                                <div className="space-y-3">
                                    <div
                                        className={`
                                    relative border-2 border-dashed rounded-[5px] p-5 text-center bg-[var(--dtg-bg-secondary)] cursor-pointer transition-colors duration-300
                                    ${isDragging ? 'border-teal-500' : 'border-[var(--dtg-border-medium)]'}
                                `}
                                        onDragOver={handleDragOver}
                                        onDragLeave={handleDragLeave}
                                        onDrop={handleDrop}
                                    >
                                        <input
                                            type="file"
                                            multiple
                                            onChange={handleFileChange}
                                            className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
                                        />
                                        <Upload size={32} className="text-[var(--dtg-gray-400)] mb-2.5 mx-auto" />
                                        <p className="text-[var(--dtg-gray-400)] m-0 text-sm">
                                            Click or drag files here
                                        </p>
                                        <p className="text-[var(--dtg-gray-500)] text-xs mt-1">
                                            Supports all image types • Multiple files allowed
                                        </p>
                                        <p className="text-[var(--dtg-gray-500)] text-xs mt-1">
                                            …or just press <strong>Ctrl+V</strong> to paste a screenshot
                                        </p>
                                    </div>

                                    {/* Carried-over figures keep the low figure numbers; anything
                                        added below continues the same sequence. */}
                                    {(existingImages.length > 0 || files.length > 0) && (
                                        <div className="space-y-2">
                                            {existingImages.map((img, index) => (
                                                <div key={`existing-${img.id}`} className="p-2 bg-[var(--dtg-bg-secondary)] rounded border border-[var(--dtg-border-medium)] space-y-2">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-3 overflow-hidden">
                                                            <div className="w-10 h-10 rounded overflow-hidden bg-gray-800 flex-shrink-0 border border-[var(--dtg-border-medium)] flex items-center justify-center">
                                                                {img.url ? (
                                                                    <img
                                                                        src={img.url}
                                                                        alt={img.caption || `Figure ${index + 1}`}
                                                                        className="w-full h-full object-cover"
                                                                    />
                                                                ) : (
                                                                    <ImageIcon size={16} className="text-[var(--dtg-gray-500)]" />
                                                                )}
                                                            </div>
                                                            <div className="flex flex-col min-w-0">
                                                                <span className="text-sm truncate text-[var(--dtg-text-primary)]">
                                                                    Existing figure
                                                                </span>
                                                                <span className="text-xs text-[var(--dtg-gray-500)]">
                                                                    Figure {index + 1} • already attached
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <button
                                                            onClick={() => removeExistingImage(img.id)}
                                                            className="text-[var(--dtg-gray-400)] hover:text-red-500 transition-colors"
                                                            title="Remove this figure from the row"
                                                        >
                                                            <X size={16} />
                                                        </button>
                                                    </div>
                                                    <Input
                                                        placeholder={`Caption for figure ${index + 1}`}
                                                        value={img.caption}
                                                        onChange={(e) => setExistingCaption(img.id, e.target.value)}
                                                    />
                                                </div>
                                            ))}

                                            {files.map((entry, index) => {
                                                const figureNumber = existingImages.length + index + 1;
                                                return (
                                                    <div key={index} className="p-2 bg-[var(--dtg-bg-secondary)] rounded border border-[var(--dtg-border-medium)] space-y-2">
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex items-center gap-3 overflow-hidden">
                                                                <div className="w-10 h-10 rounded overflow-hidden bg-gray-800 flex-shrink-0 border border-[var(--dtg-border-medium)]">
                                                                    <img
                                                                        src={entry.preview}
                                                                        alt={entry.file.name}
                                                                        className="w-full h-full object-cover"
                                                                    />
                                                                </div>
                                                                <div className="flex flex-col min-w-0">
                                                                    <span className="text-sm truncate text-[var(--dtg-text-primary)]">{entry.file.name}</span>
                                                                    <span className="text-xs text-[var(--dtg-gray-500)]">
                                                                        Figure {figureNumber} • {(entry.file.size / 1024).toFixed(0)} KB
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            <button
                                                                onClick={() => removeFile(index)}
                                                                className="text-[var(--dtg-gray-400)] hover:text-red-500 transition-colors"
                                                            >
                                                                <X size={16} />
                                                            </button>
                                                        </div>
                                                        {/* One caption per figure — blank falls back to the parameter name. */}
                                                        <Input
                                                            placeholder={`Caption for figure ${figureNumber}`}
                                                            value={entry.caption}
                                                            onChange={(e) => setCaption(index, e.target.value)}
                                                        />
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>
                        }
                    </div>
                    <div className="mb-5">
                        <div className="flex gap-2">
                            <Checkbox
                                checked={needAppendix}
                                onCheckedChange={() => setNeedAppendix(!needAppendix)}
                                className={`w-5 h-5 ${needAppendix
                                    ? 'border-green-600 hover:border-green-500'
                                    : 'border-gray-600 hover:border-gray-500'
                                    }`}
                            />
                            <label>Appendix</label>
                        </div>
                        {needAppendix &&
                            <div className="space-y-3">
                                <Input
                                    placeholder="Describe the details..."
                                    value={formData.appendix}
                                    onChange={(e) => setFormData({ ...formData, appendix: e.target.value })}
                                />
                            </div>
                        }
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={alarmTargetsUnavailable || noRegionsConfigured}
                        title={
                            alarmTargetsUnavailable
                                ? 'Record the alarm and its cause in the Alarm tab first'
                                : noRegionsConfigured
                                ? "Add this wall folder's alarm regions in the Alarm tab first"
                                : undefined
                        }
                    >
                        Submit &amp; Update{resolvingCount > 0 ? ` (closing ${resolvingCount})` : ''}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};