import { useState, useEffect } from 'react';
import { supabase } from "@/lib/supabaseClient";
import { X, Loader2 } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toUTC } from "@/utils/timezoneUtils";
import { CAUSE_OPTIONS } from "@/config/formConfig";

// Define what the 'selectedRegion' object looks like
interface RegionData {
    id: number;
    name: string;
}

// Define what the 'userSite' object looks like
interface UserProfile {
    id: string,
    full_name: string;
}

// Define the props for the Main Component
interface AddAlarmFormProps {
    selectedRegion: RegionData | null;
    wallFolderId: number;// It might be null initially
    userSite?: UserProfile;
    crosscheckers: UserProfile[];
    clientTimezone?: string;           // Optional string
    onClose: () => void;               // A function that returns nothing
    onSuccess?: () => void;            // Optional function
}

// --- CONSTANTS ---
type ReasonType = 'False' | 'Valid';

const AddAlarmForm = ({
    selectedRegion,
    wallFolderId,
    userSite,
    crosscheckers,
    clientTimezone = 'Asia/Jakarta', // Default if not provided
    onClose,
    onSuccess
}: AddAlarmFormProps) => {
    // --- STATE FIXES ---
    const [isLoading, setIsLoading] = useState(false);

    // Fix: "never[]" error. We tell it this is an array of UserProfiles

    const [triggeredAt, setTriggeredAt] = useState('');
    const [location, setLocation] = useState('');

    // Fix: Reason state must match the Keys of CAUSE_OPTIONS
    const [reason, setReason] = useState<ReasonType>('False');

    const [detectedBy] = useState(userSite);
    const [selectedCrosschecker, setSelectedCrosschecker] = useState('');

    const [causeInput, setCauseInput] = useState('');
    const [isCustomCauseMode, setIsCustomCauseMode] = useState(false);

    // --- FILTER CAUSES ---
    const currentCauseList = CAUSE_OPTIONS[reason] || [];

    // Reset custom mode when reason changes
    useEffect(() => {
        setIsCustomCauseMode(false);
        setCauseInput('');
    }, [reason]);

    // --- SUBMIT HANDLER ---
    const handleSubmit = async () => {
        if (!triggeredAt || !location || !causeInput) {
            alert("Please fill in all required fields.");
            return;
        }

        setIsLoading(true);

        try {
            const utcTime = toUTC(triggeredAt, clientTimezone);

            if (!utcTime) throw new Error("Invalid date time format");

            const payload = {
                created_at: new Date().toISOString(),
                triggered_at: utcTime,
                alarm_region: selectedRegion?.id, // This is safe now because of RegionData interface
                location: location,
                reason: reason,
                detected_by: detectedBy,
                crosschecked_by: selectedCrosschecker || null,
                cause: causeInput
            };

            const { error } = await supabase
                .from('alarm_records')
                .insert([payload]);

            if (error) throw error;

            // --- D. INSERT WORK LOG (New) ---
            try {
                // 2. Prepare Log Payload
                const workLogPayload = {
                    created_at: new Date().toISOString(),
                    subject: 1, // Fixed ID as requested
                    wallfolder: wallFolderId,
                    location: location,
                    category: 'alarm',
                    action: 'No action required', // Added 'Batch Insert' as the action name
                    notes: `1 ${reason.toLowerCase()} (${causeInput.toLowerCase()}) alarm has been submitted`,
                    submitted_by: userSite
                };

                // 3. Insert Log (Non-blocking: if log fails, we still consider the import a success)
                const { error: logError } = await supabase.from('work_log').insert([workLogPayload]);
                if (logError) console.error("Work Log Insert Failed:", logError);

            } catch (logErr) {
                console.warn("Failed to create work log, but alarms were saved.", logErr);
            }

            alert("Alarm record saved successfully!");
            if (onSuccess) onSuccess();

        } catch (error) {
            // Fix #5: Error Type Assertion
            const err = error as Error;
            console.error("Error saving alarm:", err);
            alert("Failed to save record. " + err.message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="max-h-[50vh] overflow-y-auto flex flex-col gap-2">
            {/* HEADER */}
            <div className="sticky top-0 z-10  flex items-center gap-4 justify-between p-2 text-sm text-gray-400 border-b border-[var(--dtg-border-medium)]">
                <div>
                    <h2 className="text-lg font-bold text-[var(--dtg-text-primary)]">New Alarm Record</h2>
                    <p className="text-xs text-[var(--dtg-gray-500)]">Region: {selectedRegion?.name || 'Unknown'}</p>
                </div>
                <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors text-[var(--dtg-text-secondary)]">
                    <X size={20} />
                </button>
            </div>

            {/* BODY */}
            <div className="grid grid-cols-2 items-start justify-start gap-2 p-2">

                {/* 1. Date & Time */}
                <div className="grid grid-cols-1 gap-1">
                    <label className="text-xs font-semibold text-[var(--dtg-gray-500)]">
                        Triggered At ({clientTimezone}) <span className="text-red-400">*</span>
                    </label>
                    <Input
                        type="datetime-local"
                        value={triggeredAt}
                        onChange={(e) => setTriggeredAt(e.target.value)}
                        className="bg-[var(--dtg-bg-card)] border-[var(--dtg-border-medium)] text-[var(--dtg-text-primary)]"
                    />
                </div>

                {/* 2. Reason (Toggle) */}
                <div className="grid grid-cols-1 gap-1">
                    <label className="text-xs font-semibold text-[var(--dtg-gray-500)]">Reason <span className="text-red-400">*</span></label>
                    <div className="flex">
                        {(['False', 'Valid'] as const).map((opt) => (
                            <button
                                key={opt}
                                onClick={() => {
                                    setReason(opt);
                                }}
                                className={`flex-1 py-1... ${reason === opt
                                    ? (opt === 'Valid' ? 'bg-red-500/20 text-red-400 border border-red-500/50' : 'bg-[var(--dtg-brand-orange)]/20 text-[var(--dtg-brand-orange)] border border-[var(--dtg-brand-orange)]/50')
                                    : 'text-[var(--dtg-text-secondary)] hover:bg-white/5'
                                    }`}
                            >
                                {opt} Alarm
                            </button>
                        ))}
                    </div>
                </div>

                {/* 3. Location & Crosschecker */}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="text-xs font-semibold text-[var(--dtg-gray-500)] mb-1 block">Location <span className="text-red-400">*</span></label>
                        <Input
                            placeholder="e.g. (213, 46)"
                            value={location}
                            onChange={(e) => setLocation(e.target.value)}
                            className="bg-[var(--dtg-bg-card)] border-[var(--dtg-border-medium)] text-[var(--dtg-text-primary)]"
                        />
                    </div>
                    <div>
                        <label className="text-xs font-semibold text-[var(--dtg-gray-500)] mb-1 block">Crosschecked By</label>
                        <div className="relative">
                            <select
                                value={selectedCrosschecker}
                                onChange={(e) => setSelectedCrosschecker(e.target.value)}
                                className="w-full bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-md py-2 px-3 text-sm text-[var(--dtg-text-primary)] appearance-none outline-none focus:border-[var(--dtg-brand-orange)]"
                            >
                                <option value="">-- Select User --</option>
                                {crosscheckers.map((user: any) => (
                                    <option key={user.id} value={user.id}>{user.full_name}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                {/* 4. Cause */}
                <div className="grid grid-cols-1 gap-1">
                    <label className="text-xs font-semibold text-[var(--dtg-gray-500)]">Cause <span className="text-red-400">*</span></label>

                    {isCustomCauseMode ? (
                        <div className="flex gap-2">
                            <Input
                                value={causeInput}
                                onChange={(e) => setCauseInput(e.target.value)}
                                placeholder="Type custom cause..."
                                className="bg-[var(--dtg-bg-card)] border-[var(--dtg-border-medium)] text-[var(--dtg-text-primary)]"
                                autoFocus
                            />
                            <button
                                onClick={() => { setIsCustomCauseMode(false); setCauseInput(''); }}
                                className="p-2 hover:bg-white/10 rounded text-gray-400"
                                title="Back to list"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    ) : (
                        <div className="relative">
                            <select
                                value={causeInput}
                                onChange={(e) => {
                                    if (e.target.value === 'custom_option') {
                                        setIsCustomCauseMode(true);
                                        setCauseInput('');
                                    } else {
                                        setCauseInput(e.target.value);
                                    }
                                }}
                                className="w-full bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-md py-2 px-3 text-sm text-[var(--dtg-text-primary)] appearance-none outline-none focus:border-[var(--dtg-brand-orange)]"
                            >
                                <option value="">-- Select Cause --</option>
                                {currentCauseList.map(c => (
                                    <option key={c} value={c}>{c}</option>
                                ))}
                                <option value="custom_option" className="font-semibold text-[var(--dtg-brand-orange)]">+ Add Custom Cause</option>
                            </select>
                        </div>
                    )}
                </div>

            </div>

            {/* FOOTER */}
            <div className="p-2 border-t border-[var(--dtg-border-medium)] flex justify-end gap-3">
                <Button variant="ghost" onClick={onClose} disabled={isLoading}>
                    Cancel
                </Button>
                <Button variant="brand" onClick={handleSubmit} disabled={isLoading}>
                    {isLoading ? <><Loader2 className="animate-spin mr-2" size={16} /> Saving...</> : "Submit Record"}
                </Button>
            </div>

        </div>

    );
};

export default AddAlarmForm;