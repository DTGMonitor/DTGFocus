// DqpGuidanceModal.jsx
import { useMemo, useState } from 'react';
import { X, Search, BookOpen } from 'lucide-react';
import { getRiskColorSolid, getStatusDefinition } from '@/config/statusConfig';
import { getDqpGuidance, docVariantFor, DOC_LABEL } from '@/config/dqpGuidance';

const STATUS_ORDER = ['Optimal', 'Acceptable', 'Sub-Optimal', 'Critical', 'N/A'];

const LEGEND_STATUSES = ['Optimal', 'Acceptable', 'Sub-Optimal', 'Critical'];

/**
 * The Data Quality Parameter document, rendered against the rows this wall
 * folder actually has.
 *
 * It walks the same `groups` the table renders rather than the document's own
 * running order, so a parameter the sensor does not carry (levelling, SRP, the
 * SSR-XT scan mode rules on an FX) never appears, and every row the operator
 * can see has an entry directly opposite it.
 *
 * Props:
 *   isOpen       {boolean}
 *   onClose      {function}
 *   groups       {Array}   - QualityTable's processedGroups
 *   radarNumber  {string}  - picks which of the three documents to quote
 */
export default function DqpGuidanceModal({ isOpen, onClose, groups = [], radarNumber = '' }) {
    const [query, setQuery] = useState('');

    const docLabel = DOC_LABEL[docVariantFor(radarNumber)];

    // Resolve every row against the document once, then apply the filter on the
    // resolved text so a search can match a status description, not just a name.
    const sections = useMemo(() => {
        const needle = query.trim().toLowerCase();

        return groups
            .map((group) => ({
                ...group,
                rows: group.items
                    .map((item) => ({
                        parameter: item.parameter,
                        current: item.value,
                        guidance: getDqpGuidance(
                            {
                                id: item.parameter?.id,
                                name: item.parameter?.name,
                                parent_id: item.parameter?.parent_id,
                            },
                            radarNumber
                        ),
                    }))
                    .filter((row) => {
                        if (!needle) return true;
                        const haystack = [
                            row.parameter?.name,
                            row.guidance?.title,
                            row.guidance?.evidence,
                            row.guidance?.applicability,
                            ...(row.guidance?.entries ?? []).flatMap((e) => [e.description, e.response]),
                        ]
                            .filter(Boolean)
                            .join(' ')
                            .toLowerCase();
                        return haystack.includes(needle);
                    }),
            }))
            .filter((group) => group.rows.length > 0);
    }, [groups, radarNumber, query]);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-5"
        >
            <div
                className="w-full max-w-5xl bg-[var(--dtg-bg-card)] rounded-lg overflow-hidden flex flex-col relative border border-[var(--dtg-border-medium)] max-h-[90vh]"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-5 py-3 border-b border-[var(--dtg-border-medium)] flex justify-between items-start gap-4 flex-shrink-0">
                    <div>
                        <h3 className="m-0 text-[var(--dtg-text-primary)] text-base flex items-center gap-2">
                            <BookOpen size={16} />
                            Data Quality Guidance
                        </h3>
                        <p className="mt-1 text-xs text-[var(--dtg-text-secondary)]">
                            {docLabel}
                            {radarNumber ? ` — ${radarNumber}` : ''}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="bg-transparent border-none text-[var(--dtg-gray-400)] cursor-pointer p-1 flex items-center hover:text-[var(--dtg-text-primary)]"
                        title="Close"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Legend + search */}
                <div className="px-5 py-3 border-b border-[var(--dtg-border-medium)] flex-shrink-0 space-y-3">
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        {LEGEND_STATUSES.map((status) => {
                            const definition = getStatusDefinition(status);
                            return (
                                <div
                                    key={status}
                                    className={`${getRiskColorSolid(status)} border rounded-md px-2 py-1.5`}
                                >
                                    <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--dtg-text-primary)]">
                                        {status}
                                    </div>
                                    <div className="text-[11px] leading-snug text-[var(--dtg-text-secondary)]">
                                        {definition?.action}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div className="relative">
                        <Search
                            size={14}
                            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--dtg-gray-400)]"
                        />
                        <input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search a parameter or a description…"
                            className="w-full bg-[var(--dtg-bg-primary)] border border-[var(--dtg-border-medium)] rounded-md pl-8 pr-3 py-1.5 text-sm text-[var(--dtg-text-primary)] placeholder:text-[var(--dtg-gray-400)] focus:outline-none focus:ring-1 focus:ring-[var(--dtg-primary)]"
                        />
                    </div>
                </div>

                {/* Body */}
                <div className="p-5 overflow-y-auto space-y-6">
                    {sections.length === 0 && (
                        <p className="text-sm text-[var(--dtg-text-secondary)] text-center py-8">
                            No parameter matches “{query}”.
                        </p>
                    )}

                    {sections.map((group) => (
                        <section key={group.id}>
                            <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--dtg-text-secondary)] border-b border-[var(--dtg-border-light)] pb-1 mb-3">
                                {group.name}
                            </h4>

                            <div className="space-y-4">
                                {group.rows.map((row) => (
                                    <article
                                        key={row.parameter?.id}
                                        className="border border-[var(--dtg-border-light)] rounded-md overflow-hidden"
                                    >
                                        <header className="px-3 py-2 bg-[var(--dtg-bg-primary)] border-b border-[var(--dtg-border-light)]">
                                            <div className="flex items-baseline justify-between gap-3 flex-wrap">
                                                <span className="text-sm font-semibold text-[var(--dtg-text-primary)]">
                                                    {row.parameter?.name}
                                                </span>
                                                <span className="text-[11px] text-[var(--dtg-text-secondary)]">
                                                    {row.parameter?.weight
                                                        ? `Weight ${Math.round(Number(row.parameter.weight) * 100)}%`
                                                        : ''}
                                                    {row.current ? ` · Currently ${row.current}` : ''}
                                                </span>
                                            </div>
                                            {/* The document's own heading, shown only when it differs from
                                                the row name — "Refractivity" is filed in the sheet as
                                                "Atmospheric Correction graph (at least one day of data)". */}
                                            {row.guidance && row.guidance.title !== row.parameter?.name && (
                                                <p className="text-[11px] text-[var(--dtg-gray-400)] italic mt-0.5">
                                                    {row.guidance.title}
                                                </p>
                                            )}
                                            {row.guidance?.evidence && (
                                                <p className="text-[11px] text-[var(--dtg-text-secondary)] mt-1">
                                                    <span className="font-semibold">Evidence: </span>
                                                    {row.guidance.evidence}
                                                </p>
                                            )}
                                            {row.guidance?.applicability && (
                                                <p className="text-[11px] text-[var(--dtg-text-secondary)] italic mt-1">
                                                    {row.guidance.applicability}
                                                </p>
                                            )}
                                        </header>

                                        {row.guidance ? (
                                            <ul className="divide-y divide-[var(--dtg-border-light)]">
                                                {[...row.guidance.entries]
                                                    .sort(
                                                        (a, b) =>
                                                            STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
                                                    )
                                                    .map((entry, i) => (
                                                        <li key={i} className="px-3 py-2 flex gap-3">
                                                            <span
                                                                className={`${getRiskColorSolid(
                                                                    entry.status
                                                                )} border rounded px-2 py-0.5 h-fit text-[10px] font-semibold uppercase tracking-wide text-[var(--dtg-text-primary)] whitespace-nowrap w-[92px] text-center flex-shrink-0`}
                                                            >
                                                                {entry.status}
                                                            </span>
                                                            <div className="text-xs leading-relaxed">
                                                                <p className="text-[var(--dtg-text-primary)]">
                                                                    {entry.description}
                                                                </p>
                                                                {entry.response && (
                                                                    <p className="text-[var(--dtg-text-secondary)] italic mt-1">
                                                                        Response: {entry.response}
                                                                    </p>
                                                                )}
                                                            </div>
                                                        </li>
                                                    ))}
                                            </ul>
                                        ) : (
                                            <p className="px-3 py-2 text-xs italic text-[var(--dtg-text-secondary)]">
                                                Not described in the {docLabel} document.
                                            </p>
                                        )}
                                    </article>
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
            </div>
        </div>
    );
}
