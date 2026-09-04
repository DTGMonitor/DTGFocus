
/**
 * Reusable confirmation dialog component.
 *
 * Props:
 *   isOpen           {boolean}   - Controls visibility; parent owns open/close state
 *   title            {string}    - Dialog heading
 *   message          {string}    - Body text / question
 *   details          {ReactNode} - Optional consequences block under the message.
 *                                  A destructive action on a deformation record
 *                                  reaches further than the record — it can take
 *                                  a whole chain off the board — and a dialog
 *                                  that only asks "are you sure?" is not telling
 *                                  the engineer what they are about to lose. It
 *                                  renders OUTSIDE the message paragraph so it
 *                                  can carry a list.
 *   onConfirm        {function}  - Called when Confirm button is clicked
 *   onCancel         {function}  - Called when the Cancel button is clicked. The dialog is
 *                                  deliberately NOT dismissed by the backdrop or Escape.
 *   isDestructive    {boolean}   - When true, Confirm button renders with red styling (default: false)
 *   confirmLabel     {string}    - Label for the Confirm button (default: "Confirm")
 *   cancelLabel      {string}    - Label for the Cancel button (default: "Cancel")
 *   isConfirmDisabled {boolean}  - Disables the Confirm button (e.g. during in-flight operations)
 */
const ConfirmDialog = ({
  isOpen,
  title,
  message,
  details = null,
  onConfirm,
  onCancel,
  isDestructive = false,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isConfirmDisabled = false,
}) => {
  // No Escape / backdrop dismissal: this dialog closes from its own buttons
  // only, so a stray click or keypress outside it cannot discard the decision.

  if (!isOpen) return null;

  const confirmButtonClass = isDestructive
    ? 'bg-red-600 hover:bg-red-700 text-white'
    : 'bg-[#e67e22] hover:opacity-90 text-white';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      aria-modal="true"
      role="dialog"
      aria-labelledby="confirm-dialog-title"
    >
      {/* Dialog panel — clicks stay inside; the backdrop is inert. */}
      <div
        className="bg-[var(--dtg-bg-card)] text-[var(--dtg-text-primary)] border border-[var(--dtg-border-medium)] rounded-lg shadow-xl w-full max-w-md mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title */}
        <h2
          id="confirm-dialog-title"
          className="text-lg font-semibold mb-2"
        >
          {title}
        </h2>

        {/* Message */}
        <p className={`text-sm text-[var(--dtg-text-secondary)] ${details ? 'mb-3' : 'mb-6'}`}>
          {message}
        </p>

        {/* What it costs, when the caller can say */}
        {details ? (
          <div className="mb-6 rounded-md border border-[var(--dtg-border-medium)] bg-[var(--dtg-bg-secondary)] p-3 text-sm text-[var(--dtg-text-secondary)]">
            {details}
          </div>
        ) : null}

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium rounded-md border border-[var(--dtg-border-medium)] bg-transparent text-[var(--dtg-text-primary)] hover:bg-[var(--dtg-bg-secondary)] transition-colors"
          >
            {cancelLabel}
          </button>

          <button
            type="button"
            onClick={onConfirm}
            disabled={isConfirmDisabled}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${confirmButtonClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
