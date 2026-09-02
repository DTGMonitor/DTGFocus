import { useState } from "react";
import { getBandCardColor, getBandBorderColor, getBandDotColor } from "@/config/statusConfig";
import { recordColour, recordBadgeLabel, getRiskDisplayMode } from "@/config/riskDisplay";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Calendar, Search, Trash2, Pencil, RefreshCw, Archive, ChevronDown, ChevronUp
} from 'lucide-react';
import AddDeformationForm from "./AddDeformationForm";
import TimelineView from "./TimelineView";
import { isMergeEventRecord } from "@/utils/tabHelpers";

const DeformationList = ({
    sensor,
    alarmRegion=[],
    rawList,
    filtered,
    // Map<recordId, branchIds> — which chains a Rain/Blast is still the current
    // record for. Only merge events appear in it. See resolveChainHeads.
    openBranchesById,
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
    onArchive,
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
    // How this sensor's site states a record's severity — a TARP level, or the
    // band name at a site whose chart carries no TARP numbers.
    const riskMode = getRiskDisplayMode(sensor);
    const userID = userSite?.user_id;
    const userName = userSite?.displayname;
    const getDisplayName = (userid) =>
        crosscheckers.find(c => String(c.id) === String(userid))?.full_name
        ;

    const renderList = () => {
        if (rawList.length === 0) return <div className="text-sm text-gray-500 mt-4">No deformation observed on this radar.</div>;

        // A Rain/Blast event that several chains ran into gets the multi-card
        // treatment: a plain "individual" card (edit/update/archive/delete
        // actions) plus ONE "timeline" card per chain still sitting on it. Each
        // timeline card expands that chain's own continuous history
        // (root→precursor) with the event appended as the tail — the event IS
        // that chain's current record until it is continued past.
        //
        // A chain that HAS moved on is not listed here: its continuation is a
        // head in its own right and carries its own card. So is a Rain/Blast that
        // started a chain of its own rather than joining any — with no branches
        // to split out, it is an ordinary "full" card.
        const cards = filtered.flatMap((item) => {
            const openBranches = openBranchesById?.get?.(String(item.id)) || [];
            if (!isMergeEventRecord(item) || openBranches.length === 0) {
                return [{ item, variant: 'full' }];
            }
            const entries = [{ item, variant: 'individual' }];
            // One timeline card per open chain, titled by that chain's record.
            // Those records are hidden from top-level cards (they are precursors
            // of the event) but remain in rawList, so their display data is here.
            openBranches.forEach((pid) => {
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
                        const badge = recordBadgeLabel(item, riskMode);
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
                                            {/* The record's severity as its SITE states it: a TARP
                                                level, or the band name where the site quotes no
                                                levels. Dropped entirely when there is neither,
                                                rather than printing an empty "| ". */}
                                            <p>{badge ? <><strong>{badge}</strong> | </> : null}{item.def_type} - {item.location}</p>
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
                                                /* This card IS one of the event's chains, so the
                                                   branch needs no picking — it is handed straight
                                                   to the update flow. */
                                                onClick={() => onUpdate?.(item, parentEvent)}
                                                title="Update (archive event + continue this chain)"
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
                                                    onClick={() => onArchive?.(item)}
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
                                        riskMode={riskMode}
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