import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader } from 'lucide-react';
import { LEAVE_OPEN, RESOLUTION_STATUSES, NAMES_ENGINEER, unresolved } from '@/utils/dqpImprovements';

/**
 * The open alarm recommendations, each independently answerable.
 *
 * One component behind all three DQP surfaces that can close a recommendation —
 * the "→ Optimal" gate (requireAll), the status change to another non-optimal
 * value, and Edit entry — so an analyst reads the same list and the same choices
 * whichever door they came through, and there is one place where what a
 * resolution means is decided.
 *
 * Props:
 *   improvements {Array}    open alarm_improvement rows, alarm_records embedded
 *   regions      {Array}    {id, name, type} — names and colours the badges
 *   value        {object}   id → { status, site_engineer }
 *   onChange     {function} (id, patch) => void
 *   requireAll   {boolean}  no "leave open" option (the → Optimal gate)
 *   loading      {boolean}
 */
export default function ImprovementResolution({
    improvements = [],
    regions = [],
    value = {},
    onChange,
    requireAll = false,
    loading = false,
}) {
    if (loading) {
        return (
            <div className="flex items-center gap-2 text-sm text-[var(--dtg-text-secondary)] p-2">
                <Loader size={14} className="animate-spin" /> Loading open recommendations…
            </div>
        );
    }

    if (!improvements.length) {
        return (
            <p className="text-xs italic text-[var(--dtg-text-secondary)]">
                No recommendation is awaiting site feedback on this radar&apos;s alarm regions.
            </p>
        );
    }

    const regionById = new Map((regions ?? []).map((r) => [String(r.id), r]));
    const regionFor = (row) => regionById.get(String(row?.alarm_records?.alarm_region));

    // The alarm's band colour, so a recommendation raised against a Red region
    // reads as one at a glance. Unknown bands stay neutral rather than guessing.
    const badgeClass = (row) => ({
        red: 'bg-red-100 text-red-800',
        orange: 'bg-orange-100 text-orange-800',
        yellow: 'bg-yellow-100 text-yellow-800',
        purple: 'bg-purple-100 text-purple-800',
        blue: 'bg-blue-100 text-blue-800',
    }[String(regionFor(row)?.type ?? '').toLowerCase()] || 'bg-gray-100 text-gray-800');

    const regionName = (row) =>
        regionFor(row)?.name
        || (row?.alarm_records?.alarm_region != null ? `Region ${row.alarm_records.alarm_region}` : 'Unknown Region');

    const openCount = unresolved(improvements, value).length;

    return (
        <div className="space-y-3">
            {!requireAll && (
                <p className="text-xs text-[var(--dtg-text-secondary)]">
                    {improvements.length - openCount} of {improvements.length} answered — the rest stay awaiting feedback.
                </p>
            )}

            <div className="space-y-3 max-h-[280px] overflow-y-auto">
                {improvements.map((row) => {
                    const choice = value[row.id] ?? {};
                    return (
                        <div
                            key={row.id}
                            className="p-3 border border-[var(--dtg-border-medium)] rounded bg-[var(--dtg-bg-secondary)] space-y-2"
                        >
                            <div className="flex justify-between items-start gap-3">
                                <div className="min-w-0">
                                    <p className="font-semibold text-sm text-[var(--dtg-text-primary)]">
                                        {row.issue || row.type || 'Unknown issue'}
                                    </p>
                                    {row.action && (
                                        <p className="text-xs text-[var(--dtg-text-secondary)] mt-0.5">{row.action}</p>
                                    )}
                                    {row.alarm_records?.cause && (
                                        <p className="text-xs text-[var(--dtg-gray-500)] mt-0.5 italic">
                                            raised against: {row.alarm_records.cause}
                                        </p>
                                    )}
                                </div>
                                <span
                                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${badgeClass(row)}`}
                                >
                                    {regionName(row)}
                                </span>
                            </div>

                            <div>
                                <label
                                    htmlFor={`resolution-${row.id}`}
                                    className="block text-xs font-medium text-[var(--dtg-text-secondary)] mb-1"
                                >
                                    Resolution
                                </label>
                                <Select
                                    value={choice.status || (requireAll ? NAMES_ENGINEER : LEAVE_OPEN)}
                                    onValueChange={(status) => onChange(row.id, { status })}
                                >
                                    <SelectTrigger id={`resolution-${row.id}`}>
                                        <SelectValue placeholder="Select status" />
                                    </SelectTrigger>
                                    <SelectContent className="py-1.5 text-sm text-[var(--dtg-text-primary)] bg-[var(--dtg-bg-card)] outline-none border border-[var(--dtg-border-medium)] rounded">
                                        {!requireAll && <SelectItem value={LEAVE_OPEN}>Leave open</SelectItem>}
                                        {RESOLUTION_STATUSES.map((status) => (
                                            <SelectItem key={status} value={status}>{status}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {choice.status === NAMES_ENGINEER && (
                                <div>
                                    <label
                                        htmlFor={`engineer-${row.id}`}
                                        className="block text-xs font-medium text-[var(--dtg-text-secondary)] mb-1"
                                    >
                                        Site Engineer
                                    </label>
                                    <Input
                                        id={`engineer-${row.id}`}
                                        type="text"
                                        placeholder="Who actioned it"
                                        value={choice.site_engineer || ''}
                                        onChange={(e) => onChange(row.id, { site_engineer: e.target.value })}
                                    />
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
