import { useState } from "react";
import { getBandCardColor, getBandBorderColor, getBandDotColor } from "@/config/statusConfig";
import { recordColour, recordBadgeLabel, getRiskDisplayMode } from "@/config/riskDisplay";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Calendar, Search, Trash2, Pencil, RefreshCw, Archive, ChevronDown, ChevronUp, GitBranch
} from 'lucide-react';
import AddDeformationForm from "./AddDeformationForm";
import TimelineView from "./TimelineView";

/**
 * Group the chain tips into what the board actually draws.
 *
 * A tip is (current record, which chain of it) — see resolveChainTips. Most
 * records carry exactly one chain and are drawn as one card, unchanged. A
 * Rainfall/Blast several trends ran into carries several, and those are drawn
 * TOGETHER: one framed group headed by the event, with a row per chain inside
 * it. Two chains standing on one rainfall used to be two loose dashed cards with
 * an unrelated card between them, and nothing on screen said they were the same
 * event's — the frame is what says it.
 *
 * @param {{record: object, branchId: any, branchRecord: object|null, key: string}[]} tips
 * @returns {({kind: 'single', key: string, tip: object}
 *          | {kind: 'event', key: string, record: object, tips: object[]})[]}
 */
export function groupChainTips(tips = []) {
    const groups = [];
    const byRecord = new Map();

    (tips ?? []).filter(Boolean).forEach((tip) => {
        if (tip.branchId === null || tip.branchId === undefined) {
            groups.push({ kind: 'single', key: tip.key, tip });
            return;
        }
        const id = String(tip.record?.id);
        let group = byRecord.get(id);
        if (!group) {
            group = { kind: 'event', key: `event-${id}`, record: tip.record, tips: [] };
            byRecord.set(id, group);
            groups.push(group);
        }
        group.tips.push(tip);
    });

    return groups;
}

/** The dot + badge + "Type - Location" line every card and chain row shares. */
const RecordHeadline = ({ record, riskMode, dotSize = 'w-4 h-4' }) => {
    const band = recordColour(record);
    const badge = recordBadgeLabel(record, riskMode);
    return (
        <div className="flex gap-3 items-center text-sm">
            <span className={`${dotSize} rounded-xl shrink-0 ${getBandDotColor(band)}`}></span>
            {/* The record's severity as its SITE states it: a TARP level, or the
                band name where the site quotes no levels. Dropped entirely when
                there is neither, rather than printing an empty "| ". */}
            <p>{badge ? <><strong>{badge}</strong> | </> : null}{record.def_type} - {record.location}</p>
        </div>
    );
};

const DeformationList = ({
    sensor,
    alarmRegion = [],
    rawList,
    // One entry per LIVE chain, already filtered by the search box. See
    // resolveChainTips — a merge event contributes one tip per chain still
    // standing on it, which is what lets those chains be listed separately.
    tips = [],
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
    // onUpdate(record) asks which chain; onUpdate(record, branchId) continues
    // the named one without asking.
    onUpdate,
    onArchive,
    // onTimelineExpand(tip) — the CHAIN to draw, not just its current record.
    onTimelineExpand,
    onTimelineCollapse,
    // --- New display props ---
    // Which chain is expanded, by tip key. Not a record id: two chains on one
    // rainfall share a record and would open and close together.
    timelineKey,
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
        crosscheckers.find(c => String(c.id) === String(userid))?.full_name;

    const timelinePanel = (
        <TimelineView
            chain={timelineChain}
            isLoading={timelineLoading}
            error={timelineError}
            timezone={timezone}
            crosscheckers={crosscheckers}
            riskMode={riskMode}
        />
    );

    const metaLine = (record) => (
        <div className="flex items-center gap-5 font-light text-xs text-[var(--dtg-text-secondary)]">
            <div className="flex items-center gap-1">
                <Calendar size={12} />
                <span>{new Date(record.created_at).toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-1">
                <span>Reported by: {getDisplayName(record.detected_by)}</span>
            </div>
        </div>
    );

    /** Edit / Update / Archive / Delete — the actions that act on a RECORD. */
    const recordActions = (record) => (
        <>
            <button
                onClick={() => onEdit?.(record)}
                title="Edit record"
                aria-label="Edit deformation record"
                className="p-1 hover:text-[var(--dtg-brand-orange)] rounded text-gray-400"
            >
                <Pencil size={14} />
            </button>
            <button
                onClick={() => onUpdate?.(record)}
                title="Update (archive + new precursors record)"
                aria-label="Update deformation record"
                className="p-1 hover:text-blue-400 rounded text-gray-400"
            >
                <RefreshCw size={14} />
            </button>
            <button
                onClick={() => onArchive?.(record)}
                title="Archive record"
                aria-label="Archive deformation record"
                className="p-1 hover:text-yellow-400 rounded text-gray-400"
            >
                <Archive size={14} />
            </button>
            <button
                onClick={() => onHardDelete?.(record)}
                title="Permanently delete record"
                aria-label="Permanently delete deformation record"
                className="p-1 hover:text-red-500 rounded text-red-400"
            >
                <Trash2 size={14} />
            </button>
        </>
    );

    /** A record that carries exactly one chain: the card this list always drew. */
    const renderSingle = ({ tip }) => {
        const { record } = tip;
        const isOpen = timelineKey === tip.key;
        const band = recordColour(record);
        return (
            <div
                key={tip.key}
                className={`flex flex-col gap-2 border rounded-lg p-3 ${isOpen ? getBandBorderColor(band) : getBandCardColor(band)}`}
            >
                <div className="flex justify-between items-center">
                    <div className="flex flex-col gap-1">
                        <RecordHeadline record={record} riskMode={riskMode} />
                        {metaLine(record)}
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => (isOpen ? onTimelineCollapse?.() : onTimelineExpand?.(tip))}
                            title={isOpen ? "Hide timeline" : "View timeline"}
                            aria-label="Toggle timeline"
                            className="p-1 hover:text-[var(--dtg-brand-orange)] rounded text-gray-400"
                        >
                            {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                        {recordActions(record)}
                    </div>
                </div>
                {isOpen && timelinePanel}
            </div>
        );
    };

    /**
     * A Rainfall/Blast several chains are still standing on.
     *
     * The event is the current record of every one of them, so it is drawn once
     * — with the record actions, because those act on the EVENT — and each chain
     * gets a row underneath it. A row's Continue button hands its own branch
     * straight to the update flow: the row IS the answer to "which chain", so
     * that route never has to ask. Continuing from the event's own button does
     * ask, because there the new record could equally be a chain of its own.
     */
    const renderEventGroup = (group) => {
        const { record, tips: chainTips } = group;
        const band = recordColour(record);
        return (
            <div
                key={group.key}
                className={`flex flex-col gap-2 border rounded-lg p-3 ${getBandCardColor(band)}`}
            >
                <div className="flex justify-between items-center">
                    <div className="flex flex-col gap-1">
                        <div className="flex flex-wrap gap-3 items-center">
                            <RecordHeadline record={record} riskMode={riskMode} />
                            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--dtg-border-medium)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--dtg-text-secondary)]">
                                <GitBranch size={10} />
                                {chainTips.length} chain{chainTips.length > 1 ? 's' : ''}
                            </span>
                        </div>
                        {metaLine(record)}
                    </div>
                    <div className="flex items-center gap-1">{recordActions(record)}</div>
                </div>

                <p className="text-xs text-[var(--dtg-text-secondary)]">
                    This {record.def_type?.toLowerCase() || 'event'} is the current record for the{' '}
                    {chainTips.length === 1 ? 'chain' : `${chainTips.length} chains`} below. Continue one
                    to move it past the event, or archive the event to carry them all forward.
                </p>

                {/* One row per chain, on a shared rail so they read as branches
                    of the event above rather than as loose records. */}
                <div className="flex flex-col gap-2 border-l-2 border-dashed border-[var(--dtg-border-medium)] pl-3 ml-1">
                    {chainTips.map((tip, index) => {
                        // The trend this chain is about. Null when its record is
                        // no longer in the active set (archived out from under
                        // the event, or logged under another wall folder) — the
                        // branch is still one of the event's and still has to be
                        // listed, but there is nothing to describe it with, so
                        // the row says so rather than restating the event.
                        const chainRecord = tip.branchRecord;
                        const isOpen = timelineKey === tip.key;
                        return (
                            <div
                                key={tip.key}
                                className={`flex flex-col gap-2 rounded-lg border border-dashed p-2 ${
                                    isOpen && chainRecord
                                        ? getBandBorderColor(recordColour(chainRecord))
                                        : 'border-[var(--dtg-border-medium)]'
                                }`}
                            >
                                <div className="flex justify-between items-center gap-2">
                                    <div className="flex flex-col gap-1 min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="rounded-full bg-[var(--dtg-border-medium)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--dtg-text-secondary)]">
                                                Chain {index + 1}
                                            </span>
                                            {chainRecord ? (
                                                <RecordHeadline
                                                    record={chainRecord}
                                                    riskMode={riskMode}
                                                    dotSize="w-3 h-3"
                                                />
                                            ) : (
                                                <p className="text-sm text-[var(--dtg-text-secondary)]">
                                                    Record #{String(tip.branchId)} — no longer on this board
                                                </p>
                                            )}
                                        </div>
                                        <span className="text-xs text-[var(--dtg-text-secondary)]">
                                            {chainRecord?.def_type ?? 'Earlier record'} → {record.def_type} (current)
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button
                                            onClick={() => (isOpen ? onTimelineCollapse?.() : onTimelineExpand?.(tip))}
                                            title={isOpen ? "Hide timeline" : "View this chain's timeline"}
                                            aria-label="Toggle timeline"
                                            className="p-1 hover:text-[var(--dtg-brand-orange)] rounded text-gray-400"
                                        >
                                            {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                        </button>
                                        <button
                                            onClick={() => onUpdate?.(tip.record, tip.branchId)}
                                            title="Continue this chain past the event"
                                            aria-label="Continue this chain"
                                            className="p-1 hover:text-blue-400 rounded text-gray-400"
                                        >
                                            <RefreshCw size={14} />
                                        </button>
                                    </div>
                                </div>
                                {isOpen && timelinePanel}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    const renderList = () => {
        if (rawList.length === 0) return <div className="text-sm text-gray-500 mt-4">No deformation observed on this radar.</div>;

        const groups = groupChainTips(tips);

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
                    {groups.length === 0 ? (
                        <div className="text-sm text-gray-500 mt-2">No chains match this search.</div>
                    ) : (
                        groups.map((group) =>
                            group.kind === 'single' ? renderSingle(group) : renderEventGroup(group)
                        )
                    )}
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
