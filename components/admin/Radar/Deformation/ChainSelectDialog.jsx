import { useEffect, useState } from 'react';
import { getBandDotColor } from '@/config/statusConfig';
import { recordColour, recordBadgeLabel } from '@/config/riskDisplay';
import { formatTimestamp } from '@/utils/tabHelpers';
import { Spinner } from '@/components/Reusable/Spinner';

/**
 * ChainSelectDialog
 *
 * A Rainfall or Blast event is one thing that happened to the whole wall, so
 * every trend that was running at the time is listed on it as a precursor —
 * several chains arrive at one record. Continuing the event therefore has an
 * answer the record itself cannot give: WHICH of those trends the new record
 * carries forward.
 *
 * This asks. The chosen id is written to the new record's
 * `properties.chain_branch_id`, which is what lets its timeline walk back out of
 * the event along its own trend instead of whichever one happened to be listed
 * first. The trends that are not chosen are not lost: the update flow re-states
 * each of them as its own record (see performDeformationUpdateFlow).
 *
 * Props:
 *   isOpen      {boolean}
 *   eventRecord {object}    - the Rainfall/Blast event being continued
 *   options     {Array}     - full precursor rows, in the order the event lists them
 *   isLoading   {boolean}   - options still being fetched
 *   timezone    {string}
 *   riskMode    {string}    - how this site states severity (config/riskDisplay)
 *   onSelect    {function}  - called with the chosen precursor id
 *   onCancel    {function}  - backdrop / Escape / Cancel
 */
const ChainSelectDialog = ({
  isOpen,
  eventRecord,
  options = [],
  isLoading = false,
  timezone,
  riskMode = 'tarp',
  onSelect,
  onCancel,
}) => {
  const [chosenId, setChosenId] = useState(null);

  // The engineer's pick, or — before they have made one, and whenever the dialog
  // reopens on a different event whose chains no longer contain the last pick —
  // the event's first chain, which is the one the timeline already walks today.
  const isChosenOffered = options.some((o) => String(o.id) === String(chosenId));
  const selectedId = isChosenOffered ? chosenId : options[0]?.id ?? null;

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onCancel?.();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
      aria-modal="true"
      role="dialog"
      aria-labelledby="chain-select-title"
    >
      <div
        className="bg-[var(--dtg-bg-card)] text-[var(--dtg-text-primary)] border border-[var(--dtg-border-medium)] rounded-lg shadow-xl w-full max-w-md mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="chain-select-title" className="text-lg font-semibold mb-2">
          Which chain does this continue?
        </h2>
        <p className="text-sm text-[var(--dtg-text-secondary)] mb-4">
          This {eventRecord?.def_type || 'event'} carries {options.length} trends. Pick the one the
          new record continues — the rest are carried forward as their own records.
        </p>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Spinner />
          </div>
        ) : options.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--dtg-text-secondary)]">
            No chains could be loaded for this record.
          </p>
        ) : (
          <div className="flex flex-col gap-2 max-h-[40vh] overflow-y-auto mb-6">
            {options.map((option) => {
              const isSelected = String(option.id) === String(selectedId);
              const badge = recordBadgeLabel(option, riskMode);
              return (
                <label
                  key={option.id}
                  htmlFor={`chain-option-${option.id}`}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                    isSelected
                      ? 'border-[var(--dtg-brand-orange)] bg-[var(--dtg-bg-secondary)]'
                      : 'border-[var(--dtg-border-medium)] hover:bg-[var(--dtg-bg-secondary)]'
                  }`}
                >
                  <input
                    id={`chain-option-${option.id}`}
                    type="radio"
                    name="chain-option"
                    className="mt-1 accent-[#e67e22]"
                    checked={isSelected}
                    onChange={() => setChosenId(option.id)}
                  />
                  <span className="flex flex-col gap-1 text-sm">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${getBandDotColor(recordColour(option))}`} />
                      {badge && <strong>{badge}</strong>}
                      <span>{option.def_type}</span>
                      {option.location && (
                        <span className="text-[var(--dtg-text-secondary)]">· {option.location}</span>
                      )}
                    </span>
                    <span className="text-xs text-[var(--dtg-text-secondary)]">
                      {formatTimestamp(option.created_at, timezone)}
                      {option.isactive === 'No' ? ' · archived' : ''}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium rounded-md border border-[var(--dtg-border-medium)] bg-transparent text-[var(--dtg-text-primary)] hover:bg-[var(--dtg-bg-secondary)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSelect?.(selectedId)}
            disabled={isLoading || selectedId === null || selectedId === undefined}
            className="px-4 py-2 text-sm font-medium rounded-md bg-[#e67e22] hover:opacity-90 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChainSelectDialog;
