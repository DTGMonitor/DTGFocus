import { getBandCardColor, getBandBorderColor, getBandDotColor } from "@/config/statusConfig";
import { recordColour, recordBadgeLabel } from "@/config/riskDisplay";
import { Input } from "@/components/ui/input";
import { Calendar, Search, RotateCcw, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { Spinner } from "@/components/Reusable/Spinner";
import TimelineView from "./TimelineView";

/**
 * ArchivedDeformationList
 *
 * The chains that have LEFT the board — one card per closed chain, not per
 * archived row. `resolveArchivedChainTips` decides which rows those are: a node
 * the Update flow archived on its way to writing a successor is already printed
 * inside that successor's timeline, and listing it again here would show the same
 * trend several times over and offer to restore a chain that already has a
 * current record.
 *
 * Every card opens its full history, and carries the two ways back:
 *
 *   Restore   the record returns to the board exactly as it was. For a chain
 *             archived by mistake, or one the slope has started moving on again
 *             with nothing new to state about it.
 *   Update    the chain carries on from a NEW record that points back at this
 *             one. The archived record stays archived — it is history, and this
 *             is the next line of it. That is the honest shape when the movement
 *             has changed: the old statement stands as what was true then.
 *
 * Deleting is deliberately absent. A destructive action on history is the one
 * thing this view must not make casual; the active board still carries it for
 * records that are actually current.
 *
 * Props mirror DeformationList where they overlap, so the two read the same way.
 */
const ArchivedDeformationList = ({
    records = [],
    search,
    onSearchChange,
    crosscheckers = [],
    riskMode = 'tarp',
    isLoading = false,
    error = null,
    onRestore,
    onUpdate,
    onTimelineExpand,
    onTimelineCollapse,
    timelineKey,
    timelineChain = [],
    timelineLoading = false,
    timelineError = null,
    timezone,
    viewSwitch = null,
}) => {
    const getDisplayName = (userid) =>
        crosscheckers.find((c) => String(c.id) === String(userid))?.full_name ?? '—';

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

    const renderCard = (record) => {
        // Keyed the same way the active board keys a branchless tip, so a record
        // that is expanded here and then restored stays the same timeline key.
        const key = String(record.id);
        const isOpen = timelineKey === key;
        const band = recordColour(record);
        const badge = recordBadgeLabel(record, riskMode);

        return (
            <div
                key={key}
                className={`flex flex-col gap-2 border rounded-lg p-3 opacity-90 ${isOpen ? getBandBorderColor(band) : getBandCardColor(band)}`}
            >
                <div className="flex justify-between items-center gap-2">
                    <div className="flex flex-col gap-1 min-w-0">
                        <div className="flex gap-3 items-center text-sm">
                            <span className={`w-4 h-4 rounded-xl shrink-0 ${getBandDotColor(band)}`} />
                            <p>
                                {badge ? <><strong>{badge}</strong> | </> : null}
                                {record.def_type} - {record.location}
                            </p>
                            <span className="rounded-full bg-[var(--dtg-border-medium)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--dtg-text-secondary)]">
                                Archived
                            </span>
                        </div>
                        <div className="flex items-center gap-5 font-light text-xs text-[var(--dtg-text-secondary)]">
                            <div className="flex items-center gap-1">
                                <Calendar size={12} />
                                <span>{new Date(record.created_at).toLocaleString()}</span>
                            </div>
                            <span>Reported by: {getDisplayName(record.detected_by)}</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                        <button
                            onClick={() => (isOpen ? onTimelineCollapse?.() : onTimelineExpand?.({ record, branchId: null, key }))}
                            title={isOpen ? "Hide timeline" : "View timeline"}
                            aria-label="Toggle archived timeline"
                            className="p-1 hover:text-[var(--dtg-brand-orange)] rounded text-gray-400"
                        >
                            {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                        <button
                            onClick={() => onRestore?.(record)}
                            title="Restore to the board"
                            aria-label="Restore deformation record"
                            className="p-1 hover:text-green-400 rounded text-gray-400"
                        >
                            <RotateCcw size={14} />
                        </button>
                        <button
                            onClick={() => onUpdate?.(record)}
                            title="Continue this chain with a new record"
                            aria-label="Update archived deformation record"
                            className="p-1 hover:text-blue-400 rounded text-gray-400"
                        >
                            <RefreshCw size={14} />
                        </button>
                    </div>
                </div>
                {isOpen && timelinePanel}
            </div>
        );
    };

    // The header rides along on every state: a slow or failed read must not strand
    // the engineer on the archived board with no control to switch back.
    const header = (
        <div className="flex w-full justify-between items-center border-b border-[var(--dtg-border-medium)] mb-4 pb-2">
            <h2 className="text-xl">Deformation/Event</h2>
            {viewSwitch}
        </div>
    );

    if (isLoading) {
        return (
            <div className="flex flex-col w-full gap-2 text-[var(--dtg-text-primary)]">
                {header}
                <div className="flex items-center justify-center py-12">
                    <Spinner size={32} />
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col w-full gap-2 text-[var(--dtg-text-primary)]">
                {header}
                <p className="py-8 text-center text-sm text-red-500">{error}</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col w-full gap-2 text-[var(--dtg-text-primary)]">
            {header}

            <p className="text-xs text-[var(--dtg-text-secondary)]">
                Chains that have left the board. Expand one for its full history, restore it to
                report it again, or continue it with a new record.
            </p>

            <div className="w-full relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[var(--dtg-gray-500)]" />
                <Input
                    value={search}
                    onChange={onSearchChange}
                    placeholder="Search archived deformations..."
                    className="pl-10 bg-[var(--dtg-bg-card)] border-[var(--dtg-border-medium)] text-[var(--dtg-text-primary)]"
                />
            </div>

            <div className="w-full max-h-[30vh] overflow-y-auto flex flex-col gap-2">
                {records.length === 0 ? (
                    <div className="text-sm text-gray-500 mt-2">
                        {search?.trim()
                            ? 'No archived chains match this search.'
                            : 'Nothing has been archived on this wall folder yet.'}
                    </div>
                ) : (
                    records.map(renderCard)
                )}
            </div>
        </div>
    );
};

export default ArchivedDeformationList;
