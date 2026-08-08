import { useState, useEffect, useRef } from 'react';
import { supabase } from "@/lib/supabaseClient";
import { Loader2, Save, AlertTriangle, ArrowDownRight, FileQuestion } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from '@/components/ui/checkbox';
import { toUTC } from "@/utils/timezoneUtils";
import { FIELD_DEFINITIONS, getConfigForType, TYPE_MATRIX, generateEmailBody } from '../../../../config/formConfig';
import { resolveEmailLocale } from '../../../../config/emailLocale';
import { getTarpPolicyForSensor } from '../../../../config/tarpPolicy';
import { composeDeformationSubject } from '../../../../config/emailSubject';
import { useTarpDocument } from '../Tarp/useTarpDocument';
import { responseRequirementForType, resolveDraftAudience, resolveTarpTransition } from '../../../../config/tarpDocument';
import { performDeformationUpdateFlow } from '@/utils/tabHelpers';
import { mergeSummaryIntoProperties } from '@/utils/patternRecognitionMapper';
import toast, { Toaster } from 'react-hot-toast';

interface UserProfile {
    id: string;
    full_name: string;
}

interface AlarmRegion {
    id: number;
    name: string;
}

// Pattern Recognition Summary type (Requirement 9.1, 9.2)
type PRSummary = {
    vcps: any[];
    fukuzono: any[];
    slo: any[];
    stage_summary: any[];
};

interface AddDeformationFormProps {
    sensor: any;
    userID: string;
    userName: string;
    clientTimezone: string;
    wallfolder: number;
    alarmRegion?: AlarmRegion[];
    crosscheckers: UserProfile[];
    onClose: () => void;
    onSuccess?: () => void;
    // --- Update (archive + precursors) flow support (Requirement 11) ---
    // When `precursors` is provided, the original record is archived (isactive='No')
    // and the new record is inserted with precursors set to it, compensating on failure.
    precursors?: string | number | null;
    initialValues?: Partial<FormDataState>;
    // --- Pattern Recognition auto-fill support (Requirements 9.1–9.5) ---
    patternRecognitionSummary?: PRSummary | null;
    // --- Rainfall → Refractivity flow ---
    // Called after a Rainfall Event record is saved successfully, instead of the normal email draft.
    // Parent uses this to open the ActionRequiredModal on the Refractivity DQP item.
    onRainfallSaved?: () => void;
}

const openOutlookDraft = (
    subject: string,
    body: string,
    toGroup: string,   // e.g. "Site A Team"
    ccGroup: string    // e.g. "DTG-Engineers"
) => {
    const safeSubject = encodeURIComponent(subject);
    const safeBody = encodeURIComponent(body);

    // We don't encode the group names because they might contain spaces 
    // that Outlook handles better as raw text, but encoding is safer for URLs.
    // If "DTG-Engineers" has no spaces, encodeURIComponent is fine.
    const safeTo = encodeURIComponent(toGroup);
    const safeCc = encodeURIComponent(ccGroup);

    // Construct Link
    let mailtoLink = `mailto:${safeTo}?subject=${safeSubject}&body=${safeBody}`;

    if (safeCc) {
        mailtoLink += `&cc=${safeCc}`;
    }

    window.location.href = mailtoLink;
};

interface FormDataState {
    Type: string;
    WallFolderID: number;
    alarmRegions: number[];
    Location: string;
    Start: string;
    Notes: string;
    DetectedBy: string;
    CrosscheckedBy: string;
    SiteEngineer: string;
    NotificationTime: string;
    NotificationBy: string;
    SurfaceArea: string;
    Vmax1: string;
    Vmax2: string;
    InverseVelocity1?: string;
    InverseVelocity2?: string;
    // Previous record(s) selected as this record's precursors(s). Stored to the
    // `precursors` INT[] column. In the Update flow the archived original is added
    // automatically as the primary precursors (see performDeformationUpdateFlow).
    Precursorss: (number | string)[];
    [key: string]: any;
    triggeredTimes: { [key: number]: string };
}

// Minimal shape of a selectable precursors record (existing active def_record).
interface PrecursorsOption {
    id: number | string;
    def_type: string | null;
    location: string | null;
    created_at: string | null;
    tarp_level: string | null;
}

const AddDeformationForm = ({
    sensor,
    alarmRegion = [],
    userID,
    userName,
    clientTimezone,
    crosscheckers,
    onClose,
    onSuccess,
    precursors = null,
    initialValues,
    patternRecognitionSummary = null,
    onRainfallSaved,
}: AddDeformationFormProps) => {
    const [isLoading, setIsLoading] = useState(false);
    const [withAlarm, setWithAlarm] = useState(
        Boolean(initialValues?.alarmRegions && initialValues.alarmRegions.length > 0)
    );

    // Tracks whether the user has manually edited any field after auto-fill (Requirement 9.4)
    // Resets to false whenever the form is opened fresh (initialValues changes / component mounts)
    const hasManualEdits = useRef(false);
    useEffect(() => {
        hasManualEdits.current = false;
    }, [initialValues]);

    // The site's own TARP document, when it has one, drives the TARP trigger.
    const {
        document: tarpDocument,
        policy: documentPolicy,
        loading: tarpDocumentLoading,
    } = useTarpDocument(sensor?.site_id);

    // 1. Unified Form State
    const [formData, setFormData] = useState<FormDataState>({
        Type: "", // This drives the dynamic fields
        WallFolderID: sensor.wallfolder_id,
        alarmRegions: [],
        Location: "",
        Start: "",
        Notes: "",
        DetectedBy: userID,
        CrosscheckedBy: "",
        SiteEngineer: "",
        NotificationTime: "",
        NotificationBy: "",
        SurfaceArea: "",
        Vmax1: "",
        Vmax2: "",
        Precursorss: [],
        triggeredTimes: {},
        // Pre-fill from the record being "updated" (Requirement 11.3)
        ...(initialValues || {})
    });

    // Existing active records for this radar that can be picked as precursors(s).
    const [precursorsOptions, setPrecursorsOptions] = useState<PrecursorsOption[]>([]);
    // Every active record, including the Update-flow original. Needed to work out
    // whether this record de-escalates the level the original was reported at.
    const [activeRecords, setActiveRecords] = useState<PrecursorsOption[]>([]);

    useEffect(() => {
        let cancelled = false;
        const loadPrecursorsOptions = async () => {
            if (!sensor?.wallfolder_id) return;
            const { data, error } = await supabase
                .from('def_records')
                .select('id, def_type, location, created_at, tarp_level')
                .eq('wallfolder_id', sensor.wallfolder_id)
                .eq('isactive', 'Yes')
                .order('created_at', { ascending: false });
            if (cancelled || error) return;
            setActiveRecords(data || []);
            // Exclude the Update-flow original — it is auto-linked as the primary
            // precursors, so offering it here would be redundant/confusing.
            setPrecursorsOptions(
                (data || []).filter((r: PrecursorsOption) => String(r.id) !== String(precursors))
            );
        };
        loadPrecursorsOptions();
        return () => {
            cancelled = true;
        };
    }, [sensor?.wallfolder_id, precursors]);

    const handlePrecursorsToggle = (id: number | string) => {
        setFormData(prev => {
            const current = prev.Precursorss || [];
            const isSelected = current.some(x => String(x) === String(id));
            return {
                ...prev,
                Precursorss: isSelected
                    ? current.filter(x => String(x) !== String(id))
                    : [...current, id],
            };
        });
    };

    // Helper to render the 3-column "Velocity Group" row
    // Place this outside or inside your component
    type FieldKey = keyof typeof FIELD_DEFINITIONS;

    const renderVelocityRow = (
        velKey: FieldKey,      // Primary velocity (Vmax or AverageVelocity)
        vcpKey: FieldKey,      // VCP
        unitKey: FieldKey,     // Unit
        vminKey?: FieldKey     // OPTIONAL: Vmin (only for Progressive/Linear Acc)
    ) => {
        const def = FIELD_DEFINITIONS[velKey];
        const vcpDef = FIELD_DEFINITIONS[vcpKey];
        const unitDef = FIELD_DEFINITIONS[unitKey];
        const vminDef = vminKey ? FIELD_DEFINITIONS[vminKey] : null;

        // Helper to safely access formData
        const getFormValue = (key: string) => (formData as any)[key];

        const rawVcpValue = getFormValue(vcpKey);
        const vcpValue = Number(rawVcpValue);

        // Logic: If VCP exists, check if < 1440 for mm/h, else mm/d
        const calculatedUnit = rawVcpValue ? (vcpValue < 1440 ? "mm/h" : "mm/d") : "-";

        // Determine grid columns: 4 if Vmin exists, otherwise 3
        const gridCols = vminKey ? "grid-cols-4" : "grid-cols-3";

        return (
            <div key={velKey} className="col-span-2 bg-[var(--dtg-bg-card)]/50">
                <div className={`grid ${gridCols} gap-4`}>

                    {/* 3. VCP Input */}
                    <div>
                        <label className="block text-xs font-semibold text-[var(--dtg-gray-500)] mb-1">
                            {vcpDef?.label || "VCP"}
                        </label>
                        <Input
                            type="number"
                            step="60"
                            value={rawVcpValue || ''}
                            onChange={(e) => handleChange(vcpKey, e.target.value)}
                            className='bg-[var(--dtg-bg-card)]'
                        />
                    </div>

                    {/* 1. Vmin Input (Only rendered if vminKey is provided) */}
                    {vminKey && (
                        <div>
                            <label className="block text-xs font-semibold text-[var(--dtg-gray-500)] mb-1">
                                {vminDef?.label || "Vmin"}
                            </label>
                            <Input
                                type="number"
                                step="0.1"
                                value={getFormValue(vminKey) || ''}
                                onChange={(e) => handleChange(vminKey, e.target.value)}
                                className='bg-[var(--dtg-bg-card)]'
                            />
                        </div>
                    )}

                    {/* 2. Velocity Input (Vmax or Average) */}
                    <div>
                        <label className="block text-xs font-semibold text-[var(--dtg-gray-500)] mb-1">
                            {def?.label || velKey}
                        </label>
                        <Input
                            type="number"
                            step="0.1"
                            value={getFormValue(velKey) || ''}
                            onChange={(e) => handleChange(velKey, e.target.value)}
                            className='bg-[var(--dtg-bg-card)]'
                        />
                    </div>

                    {/* 4. Unit Display */}
                    <div>
                        <label className="block text-xs font-semibold text-[var(--dtg-gray-500)] mb-1">
                            {unitDef?.label || "Unit"}
                        </label>
                        <div className="h-9 flex items-center px-3 rounded-md border border-[var(--dtg-border-medium)] bg-[var(--dtg-bg-card)] text-[var(--dtg-gray-300)] text-sm font-mono">
                            {calculatedUnit}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    useEffect(() => {
        // Helper to safely parse and calculate 1/v
        const calculateInverse = (val: string | number | undefined): string => {
            if (!val) return "";
            const num = Number(val);
            if (isNaN(num) || num === 0) return "";
            // Returns 4 decimal places (e.g. 0.0452)
            return (1 / num).toFixed(4);
        };

        setFormData((prev: any) => { // Using 'any' for prev to allow dynamic key access
            const updates: Record<string, string> = {};
            let hasChanges = false;

            // Check Vmax1 -> InverseVelocity1
            if (prev.Vmax1) {
                const newInv1 = calculateInverse(prev.Vmax1);
                if (prev.InverseVelocity1 !== newInv1) {
                    updates.InverseVelocity1 = newInv1;
                    hasChanges = true;
                }
            }

            // Check Vmax2 -> InverseVelocity2
            if (prev.Vmax2) {
                const newInv2 = calculateInverse(prev.Vmax2);
                if (prev.InverseVelocity2 !== newInv2) {
                    updates.InverseVelocity2 = newInv2;
                    hasChanges = true;
                }
            }

            return hasChanges ? { ...prev, ...updates } : prev;
        });
    }, [formData.Vmax1, formData.Vmax2]);

    const renderInverseRow = (invKey: FieldKey, vcpKey: FieldKey, unitKey: FieldKey, resultKey: FieldKey) => {
        const invDef = FIELD_DEFINITIONS[invKey];
        const vcpDef = FIELD_DEFINITIONS[vcpKey];
        const unitDef = FIELD_DEFINITIONS[unitKey];
        const resultDef = FIELD_DEFINITIONS[resultKey];

        // Helper to safely access formData with string keys
        const getFormValue = (key: string): string | number => (formData as any)[key];

        const rawVcpValue = getFormValue(vcpKey);
        const vcpValue = Number(rawVcpValue);
        const resultValue = getFormValue(resultKey);

        // INVERSE UNIT LOGIC:
        // If VCP < 1440 (daily minutes), unit is h/mm (hours per mm)
        // Otherwise, unit is d/mm (days per mm)
        const calculatedUnit = rawVcpValue
            ? (vcpValue < 1440 ? "h/mm" : "d/mm")
            : "-";

        return (
            <div key={invKey} className="col-span-2 ">
                <div className="grid grid-cols-4 gap-4">

                    {/* Inverse Velocity Input */}
                    <div>
                        <label className="block text-xs font-semibold text-[var(--dtg-gray-500)] mb-1">
                            {invDef?.label || "Inv. Velocity"}
                        </label>
                        <Input
                            type="number"
                            step="0.01"
                            // Value is derived, but allows manual override if needed (e.g. in Forecast mode)
                            value={getFormValue(invKey) || ''}
                            onChange={(e) => handleChange(invKey, e.target.value)}
                            className="bg-[var(--dtg-bg-card)] text-blue-300 border-blue-900/50 focus:border-blue-500"
                        />
                    </div>

                    {/* VCP Input (Shared) */}
                    <div>
                        <label className="block text-xs font-semibold text-[var(--dtg-gray-500)] mb-1">
                            {vcpDef?.label || "VCP"}
                        </label>
                        <Input
                            type="number"
                            step="60"
                            value={rawVcpValue || ''}
                            onChange={(e) => handleChange(vcpKey, e.target.value)}
                            className='bg-[var(--dtg-bg-card)]'
                        />
                    </div>

                    {/* Inverted Unit Display */}
                    <div>
                        <label className="block text-xs font-semibold text-[var(--dtg-gray-500)] mb-1">
                            {unitDef?.label || "Unit (Inv)"}
                        </label>
                        <div className="h-9 flex items-center px-3 rounded-md border border-[var(--dtg-border-medium)] bg-[var(--dtg-bg-card)] text-blue-300 text-sm font-mono">
                            {calculatedUnit}
                        </div>
                    </div>

                    {/* Forecast Input (Shared) */}
                    <div>
                        <label className="block text-xs font-semibold text-[var(--dtg-gray-500)] mb-1">
                            {resultDef?.label || "Forecast Result"}
                        </label>
                        <Input
                            type="datetime-local"
                            value={resultValue || ''}
                            onChange={(e) => handleChange(resultKey, e.target.value)}
                            className='bg-[var(--dtg-bg-card)]'
                        />
                    </div>
                </div>
            </div>
        );
    };

    // Add this helper function alongside your others
    const renderUnifiedVelocityRow = (
        velKey: FieldKey,
        invKey: FieldKey,
        vcpKey: FieldKey,
        unitKey: FieldKey
    ) => {
        // 1. Get Definitions
        const velDef = FIELD_DEFINITIONS[velKey];
        const invDef = FIELD_DEFINITIONS[invKey];
        const vcpDef = FIELD_DEFINITIONS[vcpKey];

        // 2. Get Values
        const getFormValue = (key: string): string | number => (formData as any)[key];
        const rawVcpValue = getFormValue(vcpKey);
        const vcpValue = Number(rawVcpValue);

        // 3. Calculate Units
        // Standard: < 1440 ? mm/h : mm/d
        const stdUnit = rawVcpValue ? (vcpValue < 1440 ? "mm/h" : "mm/d") : "-";
        // Inverse:  < 1440 ? h/mm : d/mm
        const invUnit = rawVcpValue ? (vcpValue < 1440 ? "h/mm" : "d/mm") : "-";

        return (
            <div key={velKey} className="col-span-1">
                {/* 4-Column Grid for Maximum Efficiency */}
                <div className="grid grid-cols-3 gap-4">

                    {/* 3. VCP Input */}
                    <div>
                        <label className="block text-xs font-semibold text-[var(--dtg-gray-500)] mb-1">
                            {vcpDef?.label || "VCP"}
                        </label>
                        <Input
                            type="number"
                            step="60"
                            value={rawVcpValue || ''}
                            onChange={(e) => handleChange(vcpKey, e.target.value)}
                            className='bg-[var(--dtg-bg-card)]'
                        />
                    </div>

                    {/* 1. Velocity Input */}
                    <div>
                        <label className="block text-xs font-semibold text-[var(--dtg-gray-500)] mb-1">
                            {velDef?.label || velKey} ({stdUnit})
                        </label>
                        <Input
                            type="number"
                            step="0.1"
                            value={getFormValue(velKey) || ''}
                            onChange={(e) => handleChange(velKey, e.target.value)}
                            className='bg-[var(--dtg-bg-card)]'
                        />
                    </div>

                    {/* 2. Inverse Velocity Input (Next to Referenced Velocity) */}
                    <div>
                        <label className="block text-xs font-semibold text-[var(--dtg-gray-500)] mb-1">
                            {invDef?.label || "Inv. Velocity"} ({invUnit})
                        </label>
                        <Input
                            disabled
                            type="number"
                            step="0.01"
                            value={getFormValue(invKey) || ''}
                            onChange={(e) => handleChange(invKey, e.target.value)}
                            className="bg-[var(--dtg-bg-card)] text-blue-300 border-blue-900/30"
                        />
                    </div>

                </div>
            </div>
        );
    };

    // --- Handle Input Change ---
    const handleChange = (key: string, value: any) => {
        // Mark that the user has manually edited a field after auto-fill (Requirement 9.4)
        if (initialValues) {
            hasManualEdits.current = true;
        }
        setFormData(prev => ({ ...prev, [key]: value }));
    };

    const handleRegionTimeChange = (regionId: number, value: string) => {
        setFormData(prev => ({
            ...prev,
            triggeredTimes: {
                ...prev.triggeredTimes,
                [regionId]: value
            }
        }));
    };

    const handleRegionToggle = (regionId: number) => {
        setFormData(prev => {
            const current = prev.alarmRegions;
            if (current.includes(regionId)) {
                return { ...prev, alarmRegions: current.filter(id => id !== regionId) };
            }
            return { ...prev, alarmRegions: [...current, regionId] };
        });
    };

    // --- Submit Handler ---
    const handleSubmit = async () => {
        setIsLoading(true);
        try {
            // 1. Separate Fixed Columns from JSONB Properties
            const fixedColumns = {
                def_type: formData.Type,
                created_at: new Date().toISOString(),
                wallfolder_id: formData.WallFolderID || null,
                location: formData.Location,
                isactive: "Yes",
                tarp_level: composed.tarpLevel,
                start: formData.Start ? toUTC(formData.Start, clientTimezone) : null,
                notes: formData.Notes,
                detected_by: formData.DetectedBy,
                crosschecked_by: formData.CrosscheckedBy || null,
                notification_time: formData.NotificationTime ? toUTC(formData.NotificationTime, clientTimezone) : null,
                site_engineer: formData.SiteEngineer
            };

            // 2. Gather Dynamic Properties into a JSON object
            // 2. Gather Dynamic Properties into a JSON object
            const conditionalFields = currentConfig.fields; // Get fields from your new config
            const properties: Record<string, any> = {};

            conditionalFields.forEach(fieldKey => {
                // Fix 1: Type Assertion. 
                // We tell TS: "Trust me, this key exists on formData"
                const rawValue = (formData as any)[fieldKey];
                const def = FIELD_DEFINITIONS[fieldKey];

                // Fix 2: Handle Empty Values cleanly
                // If it's empty, save as NULL, not as "" string.
                if (rawValue === "" || rawValue === undefined || rawValue === null) {
                    properties[fieldKey] = null;
                    return; // Skip the rest for this field
                }

                // Fix 3: Safer Number Conversion
                if (def.type === 'number') {
                    const numValue = parseFloat(rawValue);
                    // If the user typed "abc", numValue is NaN. We shouldn't save NaN.
                    properties[fieldKey] = isNaN(numValue) ? null : numValue;
                } else {
                    // Text, Dates, etc.
                    properties[fieldKey] = rawValue;
                }
            });

            // Merge pattern_recognition_summary only when auto-fill was used and no manual edits
            // were made (Requirements 9.4, 9.5). The key is completely absent when not applicable.
            // Shared helper is the single source of truth (covered by Property 6 + Task 15.3).
            mergeSummaryIntoProperties(properties, patternRecognitionSummary, hasManualEdits.current);

            // Precursors(s) manually selected in the form (existing records this new
            // record points back to). `precursors` is INT[]; empty selection → null.
            const selectedPrecursorss = formData.Precursorss || [];

            // 3. Send to Supabase (Option 1: JSONB approach)
            let insertedRecord: { id: any } | null = null;

            if (precursors !== null && precursors !== undefined) {
                // --- UPDATE FLOW: archive original + insert with precursors + compensate ---
                // The archived original is added as the primary precursors by the flow;
                // any extra ids selected here are merged in after it.
                const flow = await performDeformationUpdateFlow(supabase, precursors, {
                    ...fixedColumns,
                    properties,
                    precursors: selectedPrecursorss,
                });

                if (!flow.ok) {
                    if (flow.stage === 'insert') {
                        toast.error(
                            'Archive succeeded but new record could not be created. The original record has been restored.'
                        );
                    } else {
                        toast.error('Failed to archive the original record. No changes were made.');
                    }
                    setIsLoading(false);
                    return;
                }

                insertedRecord = flow.inserted;
                toast.success('Deformation record updated.');
            } else {
                // --- STANDARD FLOW: plain insert ---
                const { data, error } = await supabase
                    .from('def_records') // Your table name
                    .insert([{
                        ...fixedColumns,
                        precursors: selectedPrecursorss.length > 0 ? selectedPrecursorss : null,
                        properties: properties // All the conditional stuff goes here
                    }])
                    .select('id')
                    .single();

                if (error) throw error;
                insertedRecord = data;
            }

            // 4. Insert Linked Alarm Records
            if (formData.alarmRegions.length > 0 && insertedRecord) {
                const alarmPayloads = formData.alarmRegions.map(regionId => ({
                    triggered_at: formData.triggeredTimes[regionId] ? toUTC(formData.triggeredTimes[regionId], clientTimezone) : null,
                    alarm_region: regionId,
                    location: formData.Location,
                    reason: 'Valid',
                    cause: formData.Type,
                    deformation: insertedRecord.id,
                    detected_by: formData.DetectedBy,
                    crosschecked_by: formData.CrosscheckedBy || null
                }));

                const { error: alarmError } = await supabase
                    .from('alarm_records')
                    .insert(alarmPayloads);

                if (alarmError) console.error("Error inserting linked alarms:", alarmError);
            }

            // --- D. INSERT WORK LOG (New) ---
            try {

                // 2. Prepare Log Payload
                const workLogPayload = {
                    created_at: new Date().toISOString(),
                    subject: composed.workLogSubjectId,
                    wallfolder: sensor.wallfolder_id,
                    location: formData.Location,
                    category: 'deformation',
                    action: 'As per site TARP', // Added 'Batch Insert' as the action name
                    notes: `${formData.Type} have been submitted`,
                    submitted_by: userID
                };

                // 3. Insert Log (Non-blocking: if log fails, we still consider the import a success)
                const { error: logError } = await supabase.from('work_log').insert([workLogPayload]);
                if (logError) console.error("Work Log Insert Failed:", logError);

            } catch (logErr) {
                console.warn("Failed to create work log, but alarms were saved.", logErr);
            }

            if (onSuccess) onSuccess();

            // The TARP draft. Who it is addressed to is the matched row's own
            // answer — a row that says "Email DTG Internal" goes to DTG with no
            // CC, so the site is not told about a blast it fired itself.
            openOutlookDraft(emailSubject, emailBody, draftAudience.to, draftAudience.cc);

            // A rainfall event owes the site a SECOND draft, and a different one:
            // the TARP note above says what the slope did, while the DQP route
            // says the weather degraded the service. Both are true and neither
            // substitutes for the other, so the Refractivity modal still opens —
            // its draft is raised when the engineer submits it.
            if (formData.Type === 'Rainfall Event') {
                console.log('[Rainfall→Refractivity] Rainfall Event saved. onRainfallSaved present:', typeof onRainfallSaved === 'function');
                if (onRainfallSaved) {
                    onRainfallSaved();
                } else {
                    console.warn('[Rainfall→Refractivity] onRainfallSaved callback missing — check prop wiring.');
                    toast.error('Rainfall saved, but the DQP action could not be triggered (missing handler).');
                }
            }
        } catch (err: any) {
            console.error(err);
            toast.error("Error: " + err.message);
        } finally {
            setIsLoading(false);
        }
    };

    // Calculate which fields to show based on current Type
    const currentConfig = getConfigForType(formData.Type);
    const cleanSensor = `${sensor.radar_number} - ${sensor.site_name}`;
    const siteName = `"${sensor.site_name} [All]"` || "Unknown Site";
    const selectedCrosschecker = crosscheckers.find(u => u.id === formData.CrosscheckedBy);
    const crosscheckerName = selectedCrosschecker ? `& ${selectedCrosschecker.full_name}` : "";

    const selectedRegions = alarmRegion.filter((r: any) => formData.alarmRegions.includes(r.id));

    // TARP trigger is resolved per site: some clients only quote a trigger for a
    // progressive trend, or when a genuine alarm was raised. The site's own TARP
    // document wins; sites not yet migrated fall back to the hard-coded map.
    const tarpPolicy = documentPolicy || getTarpPolicyForSensor(sensor);

    // What this site's TARP asks the engineer to do for this record. An alarm is
    // a trigger in its own right, so the alarm row is weighed against the trend
    // row — without that, Leonora's email-only linear row printed EMAIL ONLY
    // over a red alarm the same chart says to phone in.
    const responseRequirement = responseRequirementForType(tarpDocument, formData.Type, {
        // The Alarm tick is the engineer's statement that one fired; the regions
        // may not be chosen yet, and erring towards the alarm row errs towards
        // a phone call.
        hasAlarm: withAlarm || selectedRegions.length > 0,
        alarmColours: selectedRegions.map((r: any) => r.type),
    });

    // Blast and rainfall rows are DTG watching its own back analysis, and the
    // charts that carry them say "Email DTG Internal". Reading the row the
    // response was resolved FROM keeps the alarm case honest: a blast that also
    // raised an alarm resolves to the alarm row, which is client-facing, so the
    // draft goes back to the site with DTG copied in.
    const draftAudience = resolveDraftAudience(responseRequirement?.trigger ?? null, siteName);

    // Is this record standing a TARP level DOWN? The prior state is the record
    // being updated plus any precursors the engineer ticked.
    const priorRecordIds = [
        ...(precursors !== null && precursors !== undefined ? [precursors] : []),
        ...(formData.Precursorss || []),
    ].map(String);

    const priorTypes = activeRecords
        .filter(record => priorRecordIds.includes(String(record.id)))
        .map(record => record.def_type);

    const transition = resolveTarpTransition(priorTypes, formData.Type, tarpDocument);

    // The language the client reads. Indonesian sites are emailed in Bahasa
    // Indonesia, with times on the SITE clock — see config/emailLocale.ts.
    const emailLocale = resolveEmailLocale(sensor, clientTimezone);
    const draftOptions = { locale: emailLocale, timeZone: clientTimezone };

    // Both the bracket and the trigger wording are the site's, not ours — see
    // config/emailSubject.ts.
    const composed = composeDeformationSubject({
        type: formData.Type,
        sensor: cleanSensor,
        alarmRegions: selectedRegions,
        policy: tarpPolicy,
        notificationTime: formData.NotificationTime,
        locale: emailLocale
    });
    const emailSubject = composed.subject;

    // `composed.bracket` is the English key in every locale; the body reads it to
    // pick its tone and translates on the way out.
    const emailFormData = { ...formData, alarmRegions: selectedRegions };
    const emailBody = generateEmailBody(
        emailFormData, cleanSensor, composed.bracket, userName, crosscheckerName, draftOptions
    );
    const visibleDynamicFields = currentConfig.fields;

    return (
        <div className="flex flex-col h-full">
            <Toaster position="top-center" reverseOrder={false} />
            {/* Header */}
            <div className="flex justify-between items-center p-4 border-b">
                <h2 className="text-lg font-bold">New Deformation Record</h2>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6">

                {/* A site with no TARP document falls back to the DTG standard
                    mapping. Say so rather than letting it pass unnoticed. */}
                {!tarpDocumentLoading && !tarpDocument && formData.Type && (
                    <div className="flex items-start gap-2 rounded-md border border-[var(--dtg-border-medium)] px-3 py-2">
                        <FileQuestion size={14} className="mt-0.5 shrink-0 text-[var(--dtg-text-muted)]" />
                        <p className="text-xs text-[var(--dtg-text-muted)]">
                            No TARP document for {sensor.site_name} — this subject line uses the
                            DTG standard mapping. Add one from the TARP tab.
                        </p>
                    </div>
                )}

                {/* Standing a TARP level down changes what the crew may do, so the
                    required action is spelled out before the engineer acts. */}
                {transition.direction === 'deescalation' && (
                    <div
                        role="alert"
                        className={`flex items-start gap-3 rounded-md border-2 px-4 py-3 ${transition.deviates
                            ? 'border-amber-400/70 bg-amber-400/15'
                            : 'border-sky-400/60 bg-sky-400/10'
                            }`}
                    >
                        <ArrowDownRight
                            size={18}
                            className={`mt-0.5 shrink-0 ${transition.deviates ? 'text-amber-300' : 'text-sky-300'}`}
                        />
                        <div>
                            <p className={`text-sm font-bold uppercase tracking-wide ${transition.deviates ? 'text-amber-200' : 'text-sky-200'}`}>
                                De-escalation — {transition.label}
                            </p>
                            <p className="mt-0.5 text-sm text-[var(--dtg-text-secondary)]">
                                {transition.notice}
                            </p>
                            <p className="mt-1 text-xs text-[var(--dtg-text-muted)]">
                                {transition.summary}
                                {tarpDocument && ` · per ${tarpDocument.heading || sensor.site_name} TARP v${tarpDocument.version}`}
                            </p>
                        </div>
                    </div>
                )}

                {/* The site's TARP may require something other than the usual phone
                    call for this trigger, or an alarm may have overridden what the
                    trend row alone would ask for. Surface it before the engineer acts. */}
                {(responseRequirement?.deviates || responseRequirement?.alarmOverride)
                    && transition.direction !== 'deescalation' && (
                    <div
                        role="alert"
                        className={`flex items-start gap-3 rounded-md border-2 px-4 py-3 ${responseRequirement.deviates
                            ? 'border-amber-400/70 bg-amber-400/15'
                            : 'border-sky-400/60 bg-sky-400/10'
                            }`}
                    >
                        <AlertTriangle
                            size={18}
                            className={`mt-0.5 shrink-0 ${responseRequirement.deviates ? 'text-amber-300' : 'text-sky-300'}`}
                        />
                        <div>
                            <p className={`text-sm font-bold uppercase tracking-wide ${responseRequirement.deviates ? 'text-amber-200' : 'text-sky-200'}`}>
                                {responseRequirement.label}
                                {responseRequirement.alarmOverride
                                    ? ' — the alarm sets the response'
                                    : ' — site TARP deviates from the default'}
                            </p>
                            <p className="mt-0.5 text-sm text-[var(--dtg-text-secondary)]">
                                {responseRequirement.notice}
                            </p>
                            {tarpDocument && (
                                <p className="mt-1 text-xs text-[var(--dtg-text-muted)]">
                                    Per {tarpDocument.heading || sensor.site_name} TARP v{tarpDocument.version}
                                    {' · '}{responseRequirement.trigger?.triggerLabel || formData.Type}
                                </p>
                            )}
                        </div>
                    </div>
                )}

                {/* The draft is about to open addressed somewhere other than the
                    site. Say so here rather than letting the engineer discover it
                    in the Outlook To: line — or fail to. */}
                {draftAudience.internal && (
                    <div className="flex items-start gap-2 rounded-md border border-[var(--dtg-border-medium)] px-3 py-2">
                        <FileQuestion size={14} className="mt-0.5 shrink-0 text-[var(--dtg-text-muted)]" />
                        <p className="text-xs text-[var(--dtg-text-muted)]">
                            Internal notice — the draft goes to {draftAudience.to} only, with no CC to
                            {' '}{sensor.site_name}. Per the{' '}
                            {responseRequirement?.trigger?.triggerLabel || formData.Type} row.
                        </p>
                    </div>
                )}

                {/* SECTION 1: MANDATORY (Yellow Columns) */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="flex gap-4">
                        <div className='flex flex-col gap-2 items-center'>
                            <label className="block text-xs font-semibold text-[var(--dtg-gray-500)] mb-1">Alarm(s)</label>
                            <Checkbox
                                checked={withAlarm}
                                onCheckedChange={() => setWithAlarm(!withAlarm)}
                                className={`w-5 h-5 ${withAlarm
                                    ? 'border-green-600 hover:border-green-500'
                                    : 'border-gray-600 hover:border-gray-500'
                                    }`}
                            />
                        </div>

                        <div className="flex-1 col-span-1">
                            <label className="block text-xs font-semibold text-[var(--dtg-gray-500)] mb-1">Type *</label>
                            <select
                                className="w-full bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-md py-2 px-3 text-sm text-[var(--dtg-text-primary)] appearance-none outline-none focus:border-[var(--dtg-brand-orange)]"
                                value={formData.Type}
                                onChange={(e) => handleChange("Type", e.target.value)}
                            >
                                <option value="">-- Select Type --</option>
                                {Object.keys(TYPE_MATRIX).map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* Common Fixed Fields */}
                    <SimpleField label="Time of Event/Trend Start Time" type="datetime-local" value={formData.Start} onChange={(v: any) => handleChange("Start", v)} />
                    <SimpleField label="Location" value={formData.Location} onChange={(v: any) => handleChange("Location", v)} />
                    <div>
                        <label className="block text-xs font-semibold text-[var(--dtg-gray-500)] mb-1">
                            Surface Area (m2)
                        </label>
                        <Input
                            type="number"
                            step="0.1"
                            value={formData.SurfaceArea}
                            onChange={(e) => handleChange("SurfaceArea", e.target.value)}
                            className='bg-[var(--dtg-bg-card)]'
                        />
                    </div>


                    <div className="col-span-2">
                        <label className="block text-xs font-semibold text-[var(--dtg-gray-500)] mb-1">Notes</label>
                        <textarea
                            className="w-full border rounded p-2 text-sm bg-transparent"
                            rows={2}
                            value={formData.Notes}
                            onChange={(e) => handleChange("Notes", e.target.value)}
                        />
                    </div>
                </div>
                {withAlarm &&
                    <div className="space-y-2">
                        <label>Alarm Region(s)</label>
                        <div className="grid grid-cols-2 gap-2 border border-[var(--dtg-border-light)] p-2 rounded max-h-[150px] overflow-y-auto">
                            {alarmRegion.map((region) => (
                                <div key={region.id}>
                                    <div className='space-x-2'>
                                        <Checkbox
                                            id={`region-${region.id}`}
                                            checked={formData.alarmRegions.includes(region.id)}
                                            onCheckedChange={() => handleRegionToggle(region.id)}
                                        />
                                        <label htmlFor={`region-${region.id}`} className="text-sm cursor-pointer select-none">
                                            {region.name}
                                        </label>
                                    </div>
                                    {formData.alarmRegions.includes(region.id) &&
                                        <div className='pb-1 border-b border-[var(--dtg-border-medium)] max-w-[170px]'>
                                            <SimpleField label="Triggered time" type="datetime-local" value={formData.triggeredTimes[region.id] || ''} onChange={(v: string) => handleRegionTimeChange(region.id, v)} />
                                        </div>
                                    }
                                </div>
                            ))}
                        </div>
                    </div>}

                {/* PRECURSORS(S): link this new record back to existing record(s) */}
                <div className="space-y-2">
                    <label className="block text-xs font-semibold text-[var(--dtg-gray-500)]">
                        Precursors(s){" "}
                        <span className="font-normal text-[var(--dtg-gray-600)]">
                            — earlier record(s) that led to this event
                        </span>
                    </label>
                    {precursorsOptions.length === 0 ? (
                        <p className="text-xs text-[var(--dtg-gray-600)] italic">
                            No earlier active records on this radar to link.
                        </p>
                    ) : (
                        <div className="grid grid-cols-1 gap-1 border border-[var(--dtg-border-light)] p-2 rounded max-h-[160px] overflow-y-auto">
                            {precursorsOptions.map((opt) => {
                                const checked = formData.Precursorss.some(
                                    (x) => String(x) === String(opt.id)
                                );
                                const when = opt.created_at
                                    ? new Date(opt.created_at).toLocaleDateString("en-AU", {
                                          year: "2-digit",
                                          month: "2-digit",
                                          day: "2-digit",
                                      })
                                    : "—";
                                return (
                                    <label
                                        key={opt.id}
                                        htmlFor={`precursors-${opt.id}`}
                                        className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer select-none text-sm ${
                                            checked ? "bg-[var(--dtg-brand-orange)]/10" : "hover:bg-[var(--dtg-bg-card)]"
                                        }`}
                                    >
                                        <Checkbox
                                            id={`precursors-${opt.id}`}
                                            checked={checked}
                                            onCheckedChange={() => handlePrecursorsToggle(opt.id)}
                                        />
                                        <span className="font-medium text-[var(--dtg-text-primary)]">
                                            {opt.def_type || "—"}
                                        </span>
                                        <span className="text-[var(--dtg-text-secondary)]">
                                            {opt.location || "—"}
                                        </span>
                                        {opt.tarp_level && (
                                            <span className="text-xs text-[var(--dtg-gray-500)]">
                                                {opt.tarp_level}
                                            </span>
                                        )}
                                        <span className="ml-auto text-xs text-[var(--dtg-gray-600)]">
                                            {when}
                                        </span>
                                    </label>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* SECTION 2: DYNAMIC FIELDS */}
                {formData.Type && visibleDynamicFields.length > 0 && (
                    <div className="border-t pt-4">
                        <h3 className="text-sm font-bold text-blue-500 mb-3 uppercase tracking-wider">
                            {formData.Type} Parameters
                        </h3>
                        <div className="grid grid-cols-2 gap-4">
                            {visibleDynamicFields.map((fieldKey) => {
                                // --- SKIP LIST ---
                                // 1. Skip secondary fields (VCP, Unit)
                                if (['VCP1', 'Unit1', 'VCP2', 'Unit2', 'VCP', 'Vmax'].includes(fieldKey)) {
                                    return null;
                                }

                                // 2. Skip Inverse fields IF they are already being handled by a Vmax group
                                //    (This prevents them from appearing twice in Failure mode)
                                const hasVmax1 = visibleDynamicFields.includes('Vmax1');
                                const hasVmax2 = visibleDynamicFields.includes('Vmax2');

                                if (fieldKey === 'InverseVelocity1' && hasVmax1) return null;
                                if (fieldKey === 'InverseVelocity2' && hasVmax2) return null;


                                // --- RENDER BLOCKS ---

                                // A. UNIFIED GROUPS (Failure Mode: Vmax + Inv + VCP)
                                if (fieldKey === 'Vmax1') {
                                    return renderUnifiedVelocityRow('Vmax1', 'InverseVelocity1', 'VCP1', 'Unit1');
                                }
                                if (fieldKey === 'Vmax2') {
                                    return renderUnifiedVelocityRow('Vmax2', 'InverseVelocity2', 'VCP2', 'Unit2');
                                }

                                // B. PROGRESSIVE / LINEAR (Vmin + Vmax + VCP)
                                if (fieldKey === 'Vmin') {
                                    return renderVelocityRow('Vmax', 'VCP', 'Unit1', 'Vmin');
                                }

                                // C. LINEAR (Average + VCP)
                                if (fieldKey === 'AverageVelocity') {
                                    return renderVelocityRow('AverageVelocity', 'VCP', 'Unit1');
                                }

                                // D. STANDALONE INVERSE (Forecast Mode: Inv + VCP only)
                                //    (This runs only if Vmax1/Vmax2 were NOT found, thanks to the skip list above)
                                if (fieldKey === 'InverseVelocity1') {
                                    return renderInverseRow('InverseVelocity1', 'VCP1', 'Unit1', 'ForecastResult1');
                                }
                                if (fieldKey === 'InverseVelocity2') {
                                    return renderInverseRow('InverseVelocity2', 'VCP2', 'Unit2', 'ForecastResult2');
                                }

                                // --- STANDARD FIELDS ---
                                const def = FIELD_DEFINITIONS[fieldKey as FieldKey];
                                return (
                                    <div key={fieldKey}>
                                        <label className="block text-xs font-semibold text-[var(--dtg-gray-500)] mb-1">
                                            {def?.label || fieldKey}
                                        </label>
                                        <Input
                                            type={def?.type || "text"}
                                            step={(def as any)?.step || "any"}
                                            value={formData[fieldKey as keyof typeof formData] || ''}
                                            onChange={(e) => handleChange(fieldKey, e.target.value)}
                                            className='bg-[var(--dtg-bg-card)]'
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* SECTION 3: PEOPLE (Fixed) */}
                <div className="border-t pt-4 grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-semibold text-[var(--dtg-gray-500)] mb-1">Crosschecked By</label>
                        <select
                            className="w-full bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-md py-2 px-3 text-sm text-[var(--dtg-text-primary)] appearance-none outline-none focus:border-[var(--dtg-brand-orange)]"
                            value={formData.CrosscheckedBy}
                            onChange={(e) => handleChange("CrosscheckedBy", e.target.value)}
                        >
                            <option value="">-- Select --</option>
                            {crosscheckers.map((u: any) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                        </select>
                    </div>
                    {/* NOTIFICATION SECTION (Conditional) */}
                    {(formData.Type === "Progressive" || formData.Type === "Linear Accelerating" || formData.Type === "Linear") && (
                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <label className="text-xs text-[var(--dtg-gray-600)] mb-1 block">Notification By</label>
                                <select
                                    value={formData.NotificationBy || ""}
                                    onChange={(e) => handleChange("NotificationBy", e.target.value)}
                                    className="w-full bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-md py-2 px-3 text-sm text-[var(--dtg-text-primary)] appearance-none outline-none focus:border-[var(--dtg-brand-orange)]"
                                >
                                    <option value="">-- Select --</option>
                                    <option value="Phone Call">Phone Call</option>
                                    <option value="TeamViewer">Team Viewer</option>
                                    <option value="WhatsApp">WhatsApp</option>
                                </select>

                            </div>
                            <SimpleField label="Notification Time" type="datetime-local" value={formData.NotificationTime} onChange={(v: any) => handleChange("NotificationTime", v)} />
                            <SimpleField label="Site Engineer" value={formData.SiteEngineer} onChange={(v: any) => handleChange("SiteEngineer", v)} />
                        </div>
                    )}
                </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose}>Cancel</Button>
                <Button onClick={handleSubmit} disabled={isLoading || !formData.Type}>
                    {isLoading ? <Loader2 className="animate-spin" /> : <><Save size={16} className="mr-2" /> Save Record</>}
                </Button>
            </div>
        </div>
    );
};

interface SimpleFieldProps {
    label: string;
    type?: string;
    value: string | number | undefined;
    onChange: (value: string) => void;
}

// Simple helper component to reduce clutter
const SimpleField = ({ label, type = "text", value, onChange }: SimpleFieldProps) => (
    <div>
        <label className="block text-xs font-semibold text-[var(--dtg-gray-500)] mb-1">{label}</label>
        <Input
            type={type}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="bg-[var(--dtg-bg-card)] w-full"
            // This allows clicking the text/input body to open the calendar
            onClick={(e) => {
                if (type === 'datetime-local' || type === 'date') {
                    // @ts-ignore
                    e.target.showPicker && e.target.showPicker();
                }
            }}
        />
    </div>
);

export default AddDeformationForm;