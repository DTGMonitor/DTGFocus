import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from "@/lib/supabaseClient";
import { X, Check, Search, ChevronDown, Plus, Loader2 } from 'lucide-react';
import { Button } from "@/components/LandingPage/ui/button";
import { Input } from "@/components/LandingPage/ui/input";
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
    const [isCauseOpen, setIsCauseOpen] = useState(false);

    // Fix: "ref object is null" error. We tell it this is a Div element.
    const causeWrapperRef = useRef<HTMLDivElement>(null);

    // --- CLICK OUTSIDE LISTENER (FOR COMBOBOX) ---
    useEffect(() => {
        // Fix #3: Typed Event
        function handleClickOutside(event: MouseEvent) {
            // Fix #3: Type Assertion (as Node)
            if (causeWrapperRef.current && !causeWrapperRef.current.contains(event.target as Node)) {
                setIsCauseOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [causeWrapperRef]);


    // --- FILTER CAUSES ---
    const currentCauseList = CAUSE_OPTIONS[reason] || [];

    const filteredCauses = useMemo(() => {
        if (!causeInput) return currentCauseList;
        return currentCauseList.filter(c =>
            c.toLowerCase().includes(causeInput.toLowerCase())
        );
    }, [causeInput, currentCauseList]);

    const isCustomCause = causeInput && !currentCauseList.includes(causeInput);


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
            <div className="h-[15vh] overflow-y-auto grid grid-cols-2 items-start justify-start gap-2 p-2">

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
                                    setCauseInput('');
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
                            <ChevronDown className="absolute right-3 top-2.5 text-[var(--dtg-gray-500)] pointer-events-none" size={14} />
                        </div>
                    </div>
                </div>

                {/* 4. Cause (Smart Combobox) */}
                <div className="grid grid-cols-1 gap-1 relative" ref={causeWrapperRef}>
                    <label className="text-xs font-semibold text-[var(--dtg-gray-500)]">Cause <span className="text-red-400">*</span></label>

                    <div className="relative">
                        <Search className="absolute left-3 top-2.5 text-[var(--dtg-gray-500)]" size={16} />
                        <input
                            type="text"
                            placeholder={`Search or type new ${reason.toLowerCase()} cause...`}
                            value={causeInput}
                            onChange={(e) => { setCauseInput(e.target.value); setIsCauseOpen(true); }}
                            onFocus={() => setIsCauseOpen(true)}
                            className="w-full pl-10 pr-4 py-2 bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-md text-sm text-[var(--dtg-text-primary)] outline-none focus:border-[var(--dtg-brand-orange)]"
                        />
                        {/* Dropdown Menu */}
                        {isCauseOpen && (
                            <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-md shadow-xl z-20 max-h-48 overflow-y-auto">
                                {filteredCauses.map((c, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => { setCauseInput(c); setIsCauseOpen(false); }}
                                        className="w-full text-left px-4 py-2 text-sm text-[var(--dtg-text-primary)] hover:bg-[var(--dtg-bg-primary)] flex items-center justify-between group"
                                    >
                                        {c}
                                        {causeInput === c && <Check size={14} className="text-[var(--dtg-brand-orange)]" />}
                                    </button>
                                ))}

                                {/* Add New Option */}
                                {isCustomCause && (
                                    <button
                                        onClick={() => setIsCauseOpen(false)} // Just closes, input value stays as typed
                                        className="w-full text-left px-4 py-2 text-sm text-[var(--dtg-brand-orange)] bg-[var(--dtg-brand-orange)]/10 hover:bg-[var(--dtg-brand-orange)]/20 flex items-center gap-2 border-t border-[var(--dtg-border-medium)]"
                                    >
                                        <Plus size={14} />
                                        <span>Use "{causeInput}"</span>
                                    </button>
                                )}

                                {filteredCauses.length === 0 && !isCustomCause && (
                                    <div className="px-4 py-3 text-xs text-[var(--dtg-gray-500)] text-center">
                                        Start typing to create a new cause...
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
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