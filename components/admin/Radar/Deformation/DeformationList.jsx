import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { getBandCardColor, getBandBorderColor, getBandDotColor } from "@/config/statusConfig";
import { recordColour } from "@/config/riskDisplay";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Calendar, Search, Trash2, Pencil, RefreshCw, Archive, ChevronDown, ChevronUp
} from 'lucide-react';
import AddDeformationForm from "./AddDeformationForm";
import TimelineView from "./TimelineView";
import { normalizePrecursorss } from "@/utils/tabHelpers";
import toast from "react-hot-toast";

const DeformationList = ({
    sensor,
    alarmRegion=[],
    rawList,
    filtered,
    search,
    onSearchChange,
    userSite,
    crosscheckers,
    onNewRecordClick,
    isExpanded,
    onClose,
    onSuccess,
    // --- New callback props (logic lives in DeformationTab) ---
    onEdit,
    onHardDelete,
    onUpdate,
    onTimelineExpand,
    onTimelineCollapse,
    // --- New display props ---
    timelineRecord,
    timelineChain = [],
    timelineLoading = false,
    timelineError = null,
    timezone,
    onRainfallSaved,
}) => {
    const [viewMode, setViewMode] = useState('list');
    const userID = userSite?.user_id;
    const userName = userSite?.displayname;
    const getDisplayName = (userid) =>
        crosscheckers.find(c => String(c.id) === String(userid))?.full_name
        ;

    const handleArchiveDeformation = async (item) => {
        try {
            // 1. Archive the record
            const { error } = await supabase
                .from('def_records')
                .update({ isactive: 'No' })
                .eq('id', item.id);

            if (error) {
                throw error;
            }

            // 2. Create work log entry
            const workLogPayload = {
                created_at: new Date().toISOString(),
                subject: 7, 
                wallfolder: sensor.wallfolder_id,
                location: sensor.area,
                category: 'deformation',
                action: 'No action required',
                notes: `${item.def_type} record has been archived`,
                submitted_by: userID
            };

            const { error: logError } = await supabase.from('work_log').insert([workLogPayload]);
            if (logError) {
                console.error("Work Log Insert Failed:", logError);
                toast.error('Record archived, but failed to create log entry.');
            } else {
                toast.success('Deformation record archived.');
            }

            // 3. Refresh UI
            if (onSuccess) {
                onSuccess();
            }
        } catch (error) {
            console.error('Error archiving deformation:', error);
            toast.error('Could not archive the record.');
        }
    };

    const renderList = () => {
        if (rawList.length === 0) return <div className="text-sm text-gray-500 mt-4">No deformation observed on this radar.</div>;

        // Only Rain/Blast *events* get the multi-card treatment: a plain
        // "individual" card (edit/update/archive/delete actions) plus ONE dedicated
        // "timeline" card per selected precursor. Each timeline card expands that
        // precursor's own continuous chain (root→precursor) with the event appended
        // as the tail node. Every other record (deformations) renders as a single
        // "full" card with actions + an inline timeline toggle, as before.
        const EVENT_TYPES = new Set(['Rainfall Event', 'Blast Event']);
        const cards = filtered.flatMap((item) => {
            if (!EVENT_TYPES.has(item.def_type)) {
                return [{ item, variant: 'full' }];
            }
            const entries = [{ item, variant: 'individual' }];
            // One timeline card per precursor, titled by the precursor record.
            // Precursors are hidden from top-level cards (referenced-precursor
            // filter) but remain in rawList, so we resolve their display data there.
            normalizePrecursorss(item.precursors).forEach((pid) => {
                const precursorRecord = rawList.find((r) => String(r.id) === String(pid));
                if (precursorRecord) {
                    entries.push({ item: precursorRecord, variant: 'timeline', parentEvent: item });
                }
            });
            return entries;
        });

        return (
            <>
                <div className="w-full relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[var(--dtg-gray-500)]" />
                    <Input
                        value={search}
                        onChange={onSearchChange}
                        placeholder="Search deformations..."
                        className="pl-10 bg-[var(--dtg-bg-card)] border-[var(--dtg-border-medium)] text-[var(--dtg-text-primary)]"
                    />
                </div>
                <div className="w-full max-h-[30vh] overflow-y-auto flex flex-col gap-2">
                    {cards.map(({ item, variant, parentEvent }) => {
                        const isTimelineCard = variant === 'timeline';
                        const showToggle = variant === 'full' || variant === 'timeline';
                        const showActions = variant === 'full' || variant === 'individual';
                        // Cards that own a timeline toggle track the open state by id.
                        const isTimelineOpen = showToggle && timelineRecord?.id === item.id;
                        // One band colour per record, from its deformation type — a
                        // record whose site assigns no TARP level still has one.
                        const band = recordColour(item);
                        const cardColor = isTimelineOpen ? getBandBorderColor(band) : getBandCardColor(band);
                        return (
                            <div
                                key={`${item.id}-${variant}`}
                                className={`flex flex-col gap-2 border rounded-lg p-3 ${cardColor} ${isTimelineCard ? 'border-dashed' : ''}`}
                            >
                                <div className="flex justify-between items-center">
                                    <div className="flex flex-col gap-1">
                                        <div className="flex gap-3 items-center text-sm">
                                            <span className={`w-4 h-4 rounded-xl ${getBandDotColor(band)}`}></span>
                                            {/* The TARP level stays the record's own — shown where
                                                its site assigns one, dropped where it does not,
                                                rather than printing an empty "| ". */}
                                            <p>{item.tarp_level ? <><strong>{item.tarp_level}</strong> | </> : null}{item.def_type} - {item.location}</p>
                                            {isTimelineCard && (
                                                <span className="rounded-full bg-[var(--dtg-border-medium)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--dtg-text-secondary)]">
                                                    Timeline
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-5 font-light text-xs text-[var(--dtg-text-secondary)]">
                                            <div className="flex items-center gap-1">
                                                <Calendar size={12} />
                                                <span>{new Date(item.created_at).toLocaleString()}</span>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <span>Reported by: {getDisplayName(item.detected_by)}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Action buttons. The timeline card toggles the chain
                                        AND can Update (continue the timeline); individual/full
                                        cards own the full record actions. */}
                                    <div className="flex items-center gap-1">
                                        {showToggle && (
                                            <button
                                                onClick={() => isTimelineOpen ? onTimelineCollapse?.() : onTimelineExpand?.(item, parentEvent)}
                                                title={isTimelineOpen ? "Hide timeline" : "View timeline"}
                                                aria-label="Toggle timeline"
                                                className="p-1 hover:text-[var(--dtg-brand-orange)] rounded text-gray-400"
                                            >
                                                {isTimelineOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                            </button>
                                        )}
                                        {isTimelineCard && (
                                            <button
                                                onClick={() => onUpdate?.(item)}
                                                title="Update (archive head + continue timeline)"
                                                aria-label="Update timeline"
                                                className="p-1 hover:text-blue-400 rounded text-gray-400"
                                            >
                                                <RefreshCw size={14} />
                                            </button>
                                        )}
                                        {showActions && (
                                            <>
                                                <button
                                                    onClick={() => onEdit?.(item)}
                                                    title="Edit record"
                                                    aria-label="Edit deformation record"
                                                    className="p-1 hover:text-[var(--dtg-brand-orange)] rounded text-gray-400"
                                                >
                                                    <Pencil size={14} />
                                                </button>
                                                <button
                                                    onClick={() => onUpdate?.(item)}
                                                    title="Update (archive + new precursors record)"
                                                    aria-label="Update deformation record"
                                                    className="p-1 hover:text-blue-400 rounded text-gray-400"
                                                >
                                                    <RefreshCw size={14} />
                                                </button>
                                                <button
                                                    onClick={() => handleArchiveDeformation(item)}
                                                    title="Archive record"
                                                    aria-label="Archive deformation record"
                                                    className="p-1 hover:text-yellow-400 rounded text-gray-400"
                                                >
                                                    <Archive size={14} />
                                                </button>
                                                <button
                                                    onClick={() => onHardDelete?.(item)}
                                                    title="Permanently delete record"
                                                    aria-label="Permanently delete deformation record"
                                                    className="p-1 hover:text-red-500 rounded text-red-400"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* Event timeline (cards with a toggle, when expanded) */}
                                {isTimelineOpen && (
                                    <TimelineView
                                        chain={timelineChain}
                                        isLoading={timelineLoading}
                                        error={timelineError}
                                        timezone={timezone}
                                        crosscheckers={crosscheckers}
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>
            </>
        );
    };

    const renderContent = () => {
        if (viewMode === 'form')
            return (
                <AddDeformationForm
                    sensor={sensor}
                    alarmRegion={alarmRegion}
                    crosscheckers={crosscheckers}
                    userID={userID}
                    userName={userName}
                    clientTimezone={timezone}
                    onSuccess={() => { onSuccess?.(); setViewMode('list'); }}
                    onClose={() => { onClose?.(); setViewMode('list'); }}
                    onRainfallSaved={onRainfallSaved}
                />
            )
        return renderList();
    };

    return (
        <div className="flex flex-col w-full gap-2 text-[var(--dtg-text-primary)]">
            <div className="flex w-full justify-between border-b border-[var(--dtg-border-medium)] mb-4 pb-2">
                <h2 className="text-xl">Deformation/Event</h2>
                {viewMode !== 'form' ? (
                    <Button
                        className='text-sm'
                        variant='orange'
                        onClick={() => { onNewRecordClick?.(); setViewMode('form'); }}
                    >+ New Record
                    </Button>) : (
                    <Button
                        className='text-sm'
                        variant='orange'
                        onClick={() => { onClose?.(); setViewMode('list'); }}
                    >
                        ← Back to List
                    </Button>
                )}
            </div>
            {renderContent()}
        </div>)
};

export default DeformationList;