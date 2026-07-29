import { AlertTriangle } from "lucide-react";
import { getBandDotColor, getBandColor } from "@/config/statusConfig";
import { recordColour, recordBadgeLabel } from "@/config/riskDisplay";
import { fromUTC } from "@/utils/timezoneUtils";
import { Spinner } from "@/components/Reusable/Spinner";

/**
 * Resolves a UUID to a full_name from the crosscheckers list.
 * Falls back to the raw UUID string if no match is found.
 */
const resolveDetectedBy = (uuid, crosscheckers = []) => {
  if (!uuid) return "—";
  const match = crosscheckers.find((c) => String(c.id) === String(uuid));
  return match?.full_name ?? uuid;
};

/**
 * TimelineView
 *
 * Renders a vertical precursors chain timeline for a deformation record.
 * Root node (earliest precursors) is at the top; current (latest) node is at the bottom.
 *
 * Each node may also carry `related` – the non-primary entries of its
 * precursors[] array (e.g. linked Blast/Rainfall events), rendered as chips.
 *
 * Props:
 *   chain         – DefRecord[] ordered root → current (each may have `related`)
 *   isLoading     – boolean
 *   error         – string | null
 *   timezone      – string (IANA timezone, e.g. "Australia/Perth")
 *   crosscheckers – UserProfile[] used to resolve detected_by UUID → full_name
 *   riskMode      – the site's risk wording (config/riskDisplay.ts): decides
 *                   whether a card's badge quotes a TARP level or names the band
 */
const TimelineView = ({ chain = [], isLoading, error, timezone, crosscheckers = [], riskMode = 'tarp' }) => {
  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Spinner />
      </div>
    );
  }

  // Empty state (no chain data and no error)
  if (!isLoading && chain.length === 0 && !error) {
    return (
      <div className="text-sm text-[var(--dtg-text-secondary)] py-4 text-center">
        No timeline data available.
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-0">
      {/* Incomplete timeline warning */}
      {error && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-md bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-xs">
          <AlertTriangle size={14} className="shrink-0" />
          <span>Timeline may be incomplete.</span>
        </div>
      )}

      {/* Timeline nodes */}
      <div className="relative flex flex-col">
        {chain.map((record, index) => {
          const isCurrent = index === chain.length - 1;
          const isRoot = index === 0;
          const isOnlyNode = chain.length === 1;

          const formattedDate = record.created_at
            ? (() => {
                try {
                  const converted = fromUTC(record.created_at, timezone);
                  return converted
                    ? new Date(converted).toLocaleString("en-AU", {
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                        // converted holds site wall-clock components in a
                        // tz-naive ISO; read them back in UTC, never the runtime tz.
                        timeZone: "UTC",
                      })
                    : "—";
                } catch {
                  return "—";
                }
              })()
            : "—";

          const detectedByName = resolveDetectedBy(record.detected_by, crosscheckers);
          // Band colour from the deformation type; the badge follows the site —
          // a TARP level, or the band name where the site quotes no levels —
          // and hides when there is neither.
          const tarpDotClass = getBandDotColor(recordColour(record));
          const tarpCardClass = getBandColor(recordColour(record));
          const badge = recordBadgeLabel(record, riskMode);

          return (
            <div key={record.id ?? index} className="flex gap-3">
              {/* Connector column: dot + vertical line */}
              <div className="flex flex-col items-center">
                {/* Node dot */}
                <div
                  className={`w-3 h-3 rounded-full shrink-0 mt-1 ${
                    isCurrent
                      ? `${tarpDotClass}] ring-2`
                      : "bg-[var(--dtg-border-medium)]"
                  }`}
                />
                {/* Vertical connecting line (not rendered after the last node) */}
                {!isCurrent && (
                  <div className="w-px flex-1 bg-[var(--dtg-border-medium)] min-h-[24px]" />
                )}
              </div>

              {/* Node card */}
              <div
                className={`mb-3 flex-1 rounded-lg border p-3 text-sm transition-colors ${
                  isCurrent
                    ? `${tarpCardClass}`
                    : "border-[var(--dtg-border-medium)] bg-[var(--dtg-bg-card)] opacity-70"
                }`}
              >
                {/* Header row: def_type + tarp badge + Current badge */}
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span
                    className={`font-semibold ${
                      isCurrent
                        ? "text-[var(--dtg-text-primary)]"
                        : "text-[var(--dtg-text-secondary)]"
                    }`}
                  >
                    {record.def_type ?? "—"}
                  </span>

                  {/* Severity badge — TARP level, or band name */}
                  {badge && (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border ${
                        isCurrent
                          ? "border-[var(--dtg-border-medium)] text-[var(--dtg-text-primary)]"
                          : "border-[var(--dtg-border-medium)] text-[var(--dtg-text-secondary)]"
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${tarpDotClass}`} />
                      {badge}
                    </span>
                  )}

                  {/* "Current" badge for the latest node */}
                  {isCurrent && !isOnlyNode && (
                    <span className={`ml-auto rounded-full ${tarpDotClass} px-2 py-0.5 text-xs font-semibold text-white`}>
                      Current
                    </span>
                  )}

                  {/* "Root" label for the earliest node in a multi-node chain */}
                  {isRoot && !isOnlyNode && (
                    <span className="rounded-full bg-[var(--dtg-border-medium)] px-2 py-0.5 text-xs text-[var(--dtg-text-secondary)]">
                      Root
                    </span>
                  )}
                </div>

                {/* Detail rows */}
                <div className="flex flex-col gap-0.5 text-xs text-[var(--dtg-text-secondary)]">
                  {record.location && (
                    <span>
                      <span className="font-medium text-[var(--dtg-text-primary)]">Location:</span>{" "}
                      {record.location}
                    </span>
                  )}
                  <span>
                    <span className="font-medium text-[var(--dtg-text-primary)]">Detected:</span>{" "}
                    {formattedDate}
                  </span>
                  <span>
                    <span className="font-medium text-[var(--dtg-text-primary)]">By:</span>{" "}
                    {detectedByName}
                  </span>
                </div>

                {/* Related precursorss: non-primary entries of the precursors[] array
                    (e.g. Blast / Rainfall events linked to this record). */}
                {Array.isArray(record.related) && record.related.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-[var(--dtg-border-medium)]">
                    <span className="text-xs font-medium text-[var(--dtg-text-primary)]">
                      Related precursors{record.related.length > 1 ? "s" : ""}:
                    </span>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {record.related.map((rel, relIndex) => (
                        <span
                          key={rel.id ?? relIndex}
                          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--dtg-border-medium)] bg-[var(--dtg-bg-card)] px-2 py-0.5 text-xs text-[var(--dtg-text-secondary)]"
                          title={rel.location || undefined}
                        >
                          <span className={`w-2 h-2 rounded-full ${getBandDotColor(recordColour(rel))}`} />
                          <span className="font-medium text-[var(--dtg-text-primary)]">
                            {rel.def_type ?? "—"}
                          </span>
                          {rel.location && <span>· {rel.location}</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TimelineView;
