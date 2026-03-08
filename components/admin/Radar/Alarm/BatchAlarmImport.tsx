import { useState, useCallback, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import Papa from 'papaparse';
import { supabase } from "@/lib/supabaseClient";
import { X, Upload, AlertTriangle, Trash2, Copy } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toUTC } from "@/utils/timezoneUtils";

// --- 1. STRICT TYPES ---
type ReasonType = 'False' | 'Valid';

interface BatchRow {
    id: string;
    rawTime: string;
    regionName: string;
    regionId: number | null;
    isNewRegion: boolean;
    location: string;
    reason: ReasonType;
    cause: string;
    priority: number;
}

interface ExistingRegion {
    alarm_region_id: number;
    name: string;
}

interface BatchImportProps {
    wallFolderId: number;
    existingRegions: ExistingRegion[];
    clientTimezone: string;
    userSiteId: string;
    crosscheckerId?: string;
    onClose: () => void;
    onSuccess: () => void;
}

// --- 2. CONSTANTS (Typed) ---
const CAUSE_OPTIONS: Record<ReasonType, string[]> = {
    False: ["Machinery Activity", "Rapid Atmospheric Changes", "Rainfall Event",
        "Riling Material", "Vegetation", "Pushed Material", "Water Refraction",
        "Sandstorm Event", "Blasting Event", "Diurnal Pattern", "Wire Mesh",
        "Mine Facility", "Step After Link Down"],
    Valid: ["Failure Pattern Indication", "Slip Pattern Indication",
        "Material Detachment Indication", "Rock Fall", "Rapid Movement",
        "Progressive Deformation Trend", "Linear Accelerating Trend", "Linear Deformation Trend",
        "Regressive Deformation Trend"]
};

const getReasonForCause = (cause: string): ReasonType | null => {
    if (CAUSE_OPTIONS.False.includes(cause)) return 'False';
    if (CAUSE_OPTIONS.Valid.includes(cause)) return 'Valid';
    return null;
};

export const BatchAlarmImport = ({
    wallFolderId,
    existingRegions,
    clientTimezone,
    userSiteId,
    crosscheckerId,
    onClose,
    onSuccess
}: BatchImportProps) => {

    const [step, setStep] = useState<'upload' | 'review'>('upload');

    // FIX: Typed State
    const [rows, setRows] = useState<BatchRow[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Global Controls
    const [globalLocation, setGlobalLocation] = useState('');
    const [globalReason, setGlobalReason] = useState<ReasonType>('False');
    const [globalCause, setGlobalCause] = useState('');

    // --- DRAG TO COPY STATE ---
    const [dragState, setDragState] = useState<{
        active: boolean;
        startIdx: number | null;
        endIdx: number | null;
        col: keyof BatchRow | null;
        value: any;
    }>({ active: false, startIdx: null, endIdx: null, col: null, value: null });

    // --- DRAG HANDLERS ---
    useEffect(() => {
        const handleMouseUp = () => {
            if (dragState.active && dragState.startIdx !== null && dragState.endIdx !== null && dragState.col) {
                const start = Math.min(dragState.startIdx, dragState.endIdx);
                const end = Math.max(dragState.startIdx, dragState.endIdx);
                const sourceValue = dragState.value;

                setRows(prev => prev.map((row, idx) => {
                    if (idx >= start && idx <= end) {
                        const updates: Partial<BatchRow> = { [dragState.col!]: sourceValue };

                        // Auto-update Reason if dragging Cause
                        if (dragState.col === 'cause') {
                            const inferredReason = getReasonForCause(sourceValue);
                            if (inferredReason) {
                                updates.reason = inferredReason;
                            }
                        }

                        return { ...row, ...updates };
                    }
                    return row;
                }));
            }
            setDragState({ active: false, startIdx: null, endIdx: null, col: null, value: null });
        };

        if (dragState.active) {
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => window.removeEventListener('mouseup', handleMouseUp);
    }, [dragState]);

    const handleDragStart = (e: React.MouseEvent, idx: number, col: keyof BatchRow, value: any) => {
        e.preventDefault();
        e.stopPropagation();
        setDragState({ active: true, startIdx: idx, endIdx: idx, col, value });
    };

    const handleDragEnter = (idx: number, col: keyof BatchRow) => {
        if (dragState.active && dragState.col === col) {
            setDragState(prev => ({ ...prev, endIdx: idx }));
        }
    };

    const getCellClass = (idx: number, col: keyof BatchRow) => {
        const base = "p-2 relative group";
        if (!dragState.active || dragState.col !== col || dragState.startIdx === null || dragState.endIdx === null) return base;
        const start = Math.min(dragState.startIdx, dragState.endIdx);
        const end = Math.max(dragState.startIdx, dragState.endIdx);
        return (idx >= start && idx <= end) ? `${base} bg-blue-500/20` : base;
    };

    // --- 3. PARSING ---
    const onDrop = useCallback((acceptedFiles: File[]) => {
        const file = acceptedFiles[0];
        if (!file) return;

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const parsedRows: BatchRow[] = results.data.map((row: any, index: number) => {
                    const message = row['Event Message'] || "";
                    const priorityMatch = message.match(/Primary Priority\s+(\d+)\s+Alarm/i);
                    const priority = priorityMatch ? parseInt(priorityMatch[1], 10) : 0;

                    // FIX 2: Extract region name from "Alarm: REGION_NAME -"
                    const regionMatch = message.match(/Alarm:\s*(.*?)\s*-/);
                    const extractedRegionName = regionMatch ? regionMatch[1].trim() : "Unknown";

                    const existing = existingRegions.find(
                        r => r.name.toLowerCase() === extractedRegionName.toLowerCase()
                    );

                    return {
                        id: `row-${index}-${Date.now()}`,
                        rawTime: row['Date & Time'],
                        regionName: extractedRegionName,
                        regionId: existing ? existing.alarm_region_id : null,
                        isNewRegion: !existing,
                        location: "",
                        reason: "False",
                        cause: "",
                        priority: priority
                    };
                });
                setRows(parsedRows);
                setStep('review');
            }
        });
    }, [existingRegions]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: { 'text/csv': ['.csv'] }
    });

    const applyGlobalToEmpty = () => {
        setRows(prev => prev.map(row => ({
            ...row,
            location: row.location || globalLocation,
            reason: globalReason,
            cause: row.cause || globalCause
        })));
    };

    // --- 4. SUBMIT LOGIC (Fixed Date Parser) ---
    const handleSubmit = async () => {
        setIsSubmitting(true);
        try {
            // A. Create New Regions
            const newRegionsMap = new Map<string, number>();
            rows.filter(r => r.isNewRegion).forEach(r => {
                if (!newRegionsMap.has(r.regionName)) {
                    newRegionsMap.set(r.regionName, r.priority);
                }
            });

            const regionMap = new Map<string, number>();
            existingRegions.forEach(r => regionMap.set(r.name.toLowerCase(), r.alarm_region_id));

            for (const [name, priority] of newRegionsMap) {
                // 1. RPC Call
                const { data: rpcData, error } = await supabase.rpc('add_alarm_regions', {
                    _wallfolder_id: wallFolderId,
                    _name: name,
                    _priority: priority
                });
                if (error) throw error;

                // 2. Try to get ID from RPC return value first
                let newId: number | null = null;

                if (typeof rpcData === 'number') {
                    newId = rpcData;
                } else if (Array.isArray(rpcData) && rpcData.length > 0) {
                    newId = rpcData[0]?.alarm_region_id || rpcData[0]?.id;
                } else if (rpcData && typeof rpcData === 'object') {
                    newId = (rpcData as any).alarm_region_id || (rpcData as any).id;
                }

                if (newId) {
                    regionMap.set(name.toLowerCase(), newId);
                } else {
                    // 3. Fallback: fetch it manually — use the correct column name!
                    const { data: fetchNew, error: fetchError } = await supabase
                        .from('alarm_regions')
                        .select('alarm_region_id')   // ← match your actual PK column
                        .eq('name', name)
                        .eq('wallfolder', wallFolderId)  // ← scope to this wallfolder to avoid name collisions
                        .single();

                    if (fetchError) throw new Error(`Failed to fetch new region ID for "${name}"`);
                    if (fetchNew) regionMap.set(name.toLowerCase(), fetchNew.alarm_region_id);
                }
            }

            // B. Prepare Payloads
            const payloads = rows.map((row, index) => {
                try {
                    if (!row.rawTime) throw new Error("Time is empty");

                    // --- DATE PARSING FIX START ---
                    // Handles "28/01/2026 6:58:45 PM" or "2026-01-28 18:58:45"
                    const parts = row.rawTime.trim().split(/\s+/);
                    const datePart = parts[0];
                    const timePart = parts[1] || "00:00:00";
                    const modifier = parts[2]; // AM/PM

                    let day, month, year;
                    if (datePart.includes('/')) {
                        [day, month, year] = datePart.split('/');
                    } else if (datePart.includes('-')) {
                        const dParts = datePart.split('-');
                        if (dParts[0].length === 4) {
                            [year, month, day] = dParts;
                        } else {
                            [day, month, year] = dParts;
                        }
                    } else {
                        throw new Error("Unknown date format");
                    }

                    let [hours, minutes, seconds] = timePart.split(':');
                    if (!minutes) minutes = '00';
                    if (!seconds) seconds = '00';

                    if (modifier) {
                        if (modifier.toUpperCase() === 'PM' && hours !== '12') hours = String(Number(hours) + 12);
                        if (modifier.toUpperCase() === 'AM' && hours === '12') hours = '00';
                    }

                    // Pad to 2 digits to ensure ISO compliance (e.g. 2:04 -> 02:04)
                    const pad = (s: string | undefined) => (s || '00').length < 2 ? `0${s}` : s;

                    const isoLikeString = `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
                    // --- DATE PARSING FIX END ---

                    const utcTime = toUTC(isoLikeString, clientTimezone);

                    if (!utcTime) throw new Error("Failed to convert to UTC");

                    const alarmRegionId = row.regionId || regionMap.get(row.regionName.toLowerCase());

                    if (!alarmRegionId) {
                        throw new Error(`Could not resolve region ID for "${row.regionName}"`);
                    }

                    return {
                        created_at: new Date().toISOString(),
                        triggered_at: utcTime,
                        alarm_region: alarmRegionId,   // ← clean, no inline ||
                        location: row.location,
                        reason: row.reason,
                        detected_by: userSiteId,
                        crosschecked_by: crosscheckerId || null,
                        cause: row.cause
                    };
                } catch (err) {
                    console.error(`Row ${index + 1} error`, err);
                    throw new Error(`Row ${index + 1} has invalid time: "${row.rawTime}"`);
                }
            });

            // C. Bulk Insert
            const { error } = await supabase.from('alarm_records').insert(payloads);
            if (error) throw error;

            // --- D. INSERT WORK LOG (New) ---
            try {
                // 1. Calculate Summaries
                const uniqueReason = [...new Set(rows.map(r => r.reason).filter(Boolean))];
                const reasonDisplay = uniqueReason.length === 1 ? uniqueReason[0] : "valid and false"
                const uniqueCauses = [...new Set(rows.map(r => r.cause).filter(Boolean))];
                const causeDisplay = uniqueCauses.length === 1 ? uniqueCauses[0] : "Various Causes";

                // Get all unique locations, join them (e.g. "Ramp 1, Sector 2")
                const uniqueLocations = [...new Set(rows.map(r => r.location).filter(Boolean))];
                const locationDisplay = uniqueLocations.length > 0 ? uniqueLocations.join(', ').slice(0, 100) : "Batch Import"; // Slice to prevent huge strings

                // 2. Prepare Log Payload
                const workLogPayload = {
                    created_at: new Date().toISOString(),
                    subject: 1, // Fixed ID as requested
                    wallfolder: wallFolderId,
                    location: locationDisplay,
                    category: 'alarm',
                    action: 'No action required', // Added 'Batch Insert' as the action name
                    notes: `${rows.length} ${reasonDisplay.toLowerCase()} (${causeDisplay.toLowerCase()}) alarms have been submitted`,
                    submitted_by: userSiteId
                };

                // 3. Insert Log (Non-blocking: if log fails, we still consider the import a success)
                const { error: logError } = await supabase.from('work_log').insert([workLogPayload]);
                if (logError) console.error("Work Log Insert Failed:", logError);

            } catch (logErr) {
                console.warn("Failed to create work log, but alarms were saved.", logErr);
            }

            onSuccess();
            onClose();

        } catch (error) {
            // FIX: Cast Error type
            const err = error as Error;
            alert("Error: " + err.message);
        } finally {
            setIsSubmitting(false);
        }
    };
    // --- RENDER ---
    return (
        <div className="flex flex-col h-full">

            {/* Header */}
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-[var(--dtg-text-primary)]">
                    {step === 'upload' ? 'Import Alarm CSV' : `Review ${rows.length} Records`}
                </h3>
                <Button variant="ghost" size="sm" onClick={onClose}><X size={18} /></Button>
            </div>

            {step === 'upload' ? (
                <div {...getRootProps()} className={`flex-1 border-2 border-dashed rounded-xl flex flex-col items-center justify-center p-10 cursor-pointer transition-colors ${isDragActive ? 'border-[var(--dtg-brand-orange)] bg-[var(--dtg-brand-orange)]/10' : 'border-[var(--dtg-border-medium)] hover:border-[var(--dtg-text-secondary)]'}`}>
                    <input {...getInputProps()} />
                    <Upload size={40} className="text-[var(--dtg-gray-500)] mb-4" />
                    <p className="text-[var(--dtg-text-secondary)]">Drag & drop your CSV file here</p>
                    <p className="text-xs text-[var(--dtg-gray-500)] mt-2">Required Columns: Priority, Date & Time, Event Message</p>
                </div>
            ) : (
                <div className="flex-1 flex flex-col overflow-hidden">

                    {/* THE "EXCEL HEADER" - Bulk Controls */}
                    <div className="bg-[var(--dtg-bg-card)] p-3 rounded-lg border border-[var(--dtg-border-medium)] mb-3 flex gap-3 items-end">
                        <div className="flex-1">
                            <label className="text-xs text-[var(--dtg-gray-500)]">Set Location</label>
                            <Input className="h-8 text-xs" value={globalLocation} onChange={e => setGlobalLocation(e.target.value)} placeholder="e.g. Ramp 3" />
                        </div>
                        <div className="w-32">
                            <label className="text-xs text-[var(--dtg-gray-500)]">Set Reason</label>
                            <select className="w-full h-8 text-xs text-[var(--dtg-text-primary)] bg-[var(--dtg-bg-card)] outline-none border border-[var(--dtg-border-medium)] rounded border" value={globalReason} onChange={(e: any) => setGlobalReason(e.target.value)}>
                                <option value="False">False</option>
                                <option value="Valid">Valid</option>
                            </select>
                        </div>
                        <div className="flex-1">
                            <label className="text-xs text-[var(--dtg-gray-500)]">Set Cause</label>
                            <select className="w-full h-8 text-xs text-[var(--dtg-text-primary)] bg-[var(--dtg-bg-card)] outline-none border border-[var(--dtg-border-medium)] rounded border" value={globalCause} onChange={e => setGlobalCause(e.target.value)}>
                                <option value="">-- Select --</option>
                                {CAUSE_OPTIONS[globalReason].map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <Button size="sm" variant="orange" onClick={applyGlobalToEmpty} title="Apply to empty rows">
                            <Copy size={14} className="mr-2" /> Apply
                        </Button>
                    </div>

                    {/* THE GRID */}
                    <div className="flex-1 overflow-y-auto border border-[var(--dtg-border-medium)] rounded-lg">
                        <table className="w-full text-left text-sm text-[var(--dtg-text-primary)]">
                            <thead className="bg-[var(--dtg-bg-card)] sticky top-0 z-10">
                                <tr>
                                    <th className="p-2 font-medium">Time</th>
                                    <th className="p-2 font-medium">Region</th>
                                    <th className="p-2 font-medium">Location</th>
                                    <th className="p-2 font-medium">Reason</th>
                                    <th className="p-2 font-medium">Cause</th>
                                    <th className="p-2 w-10"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--dtg-border-medium)]">
                                {rows.map((row, idx) => (
                                    <tr key={row.id} className="hover:bg-[var(--dtg-bg-primary)]">
                                        <td className="p-2 text-xs font-mono">{row.rawTime}</td>

                                        {/* Region Cell: Shows Warning if New */}
                                        <td className="p-2">
                                            <div className="flex items-center gap-2">
                                                {row.isNewRegion && <div title="New Region - Will be created">
                                                    <AlertTriangle size={14} className="text-yellow-500" />
                                                </div>}
                                                <span>{row.regionName}</span>
                                            </div>
                                        </td>

                                        {/* Editable Location */}
                                        <td className={getCellClass(idx, 'location')} onMouseEnter={() => handleDragEnter(idx, 'location')}>
                                            <input
                                                className="w-full bg-[var(--dtg-bg-card)] border-b border-[var(--dtg-border-medium)] focus:border-[var(--dtg-brand-orange)] outline-none text-xs"
                                                value={row.location}
                                                onChange={(e) => {
                                                    const newRows = [...rows];
                                                    newRows[idx].location = e.target.value;
                                                    setRows(newRows);
                                                }}
                                                placeholder="..."
                                            />
                                            <div
                                                className="absolute bottom-0 right-0 w-3 h-3 bg-orange-500 cursor-crosshair opacity-0 group-hover:opacity-100 z-20"
                                                onMouseDown={(e) => handleDragStart(e, idx, 'location', row.location)}
                                                title="Drag to copy"
                                            />
                                        </td>

                                        {/* Editable Reason */}
                                        <td className={getCellClass(idx, 'reason')} onMouseEnter={() => handleDragEnter(idx, 'reason')}>
                                            <select
                                                className="text-[var(--dtg-text-primary)] bg-[var(--dtg-bg-card)] text-xs outline-none w-full"
                                                value={row.reason}
                                                onChange={(e: any) => {
                                                    const newRows = [...rows];
                                                    newRows[idx].reason = e.target.value;
                                                    newRows[idx].cause = ""; // Reset cause on change
                                                    setRows(newRows);
                                                }}
                                            >
                                                <option value="False">False</option>
                                                <option value="Valid">Valid</option>
                                            </select>
                                            <div
                                                className="absolute bottom-0 right-0 w-3 h-3 bg-orange-500 cursor-crosshair opacity-0 group-hover:opacity-100 z-20"
                                                onMouseDown={(e) => handleDragStart(e, idx, 'reason', row.reason)}
                                                title="Drag to copy"
                                            />
                                        </td>

                                        {/* Editable Cause */}
                                        <td className={getCellClass(idx, 'cause')} onMouseEnter={() => handleDragEnter(idx, 'cause')}>
                                            <select
                                                className="text-[var(--dtg-text-primary)] bg-[var(--dtg-bg-card)] text-xs outline-none w-full"
                                                value={row.cause}
                                                onChange={(e) => {
                                                    const newRows = [...rows];
                                                    newRows[idx].cause = e.target.value;
                                                    setRows(newRows);
                                                }}
                                            >
                                                <option value=""></option>
                                                {CAUSE_OPTIONS[row.reason].map(c => <option key={c} value={c}>{c}</option>)}
                                            </select>
                                            <div
                                                className="absolute bottom-0 right-0 w-3 h-3 bg-orange-500 cursor-crosshair opacity-0 group-hover:opacity-100 z-20"
                                                onMouseDown={(e) => handleDragStart(e, idx, 'cause', row.cause)}
                                                title="Drag to copy"
                                            />
                                        </td>

                                        <td className="p-2 text-center">
                                            <button onClick={() => setRows(rows.filter(r => r.id !== row.id))} className="text-gray-500 hover:text-red-400">
                                                <Trash2 size={14} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="mt-4 flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => setStep('upload')}>Back</Button>
                        <Button variant="brand" onClick={handleSubmit} disabled={isSubmitting}>
                            {isSubmitting ? "Processing..." : `Import ${rows.length} Records`}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
};