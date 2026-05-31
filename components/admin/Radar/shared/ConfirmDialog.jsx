import { useEffect } from 'react';

/**
 * Reusable confirmation dialog component.
 *
 * Props:
 *   isOpen           {boolean}   - Controls visibility; parent owns open/close state
 *   title            {string}    - Dialog heading
 *   message          {string}    - Body text / question
 *   onConfirm        {function}  - Called when Confirm button is clicked
 *   onCancel         {function}  - Called when Cancel button, backdrop, or Escape key is activated
 *   isDestructive    {boolean}   - When true, Confirm button renders with red styling (default: false)
 *   confirmLabel     {string}    - Label for the Confirm button (default: "Confirm")
 *   cancelLabel      {string}    - Label for the Cancel button (default: "Cancel")
 *   isConfirmDisabled {boolean}  - Disables the Confirm button (e.g. during in-flight operations)
 */
const ConfirmDialog = ({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  isDestructive = false,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isConfirmDisabled = false,
}) => {
  // Handle Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const confirmButtonClass = isDestructive
    ? 'bg-red-600 hover:bg-red-700 text-white'
    : 'bg-[#e67e22] hover:opacity-90 text-white';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
      aria-modal="true"
      role="dialog"
      aria-labelledby="confirm-dialog-title"
    >
      {/* Dialog panel — stop click propagation so backdrop click doesn't fire from inside */}
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
        <p className="text-sm text-[var(--dtg-text-secondary)] mb-6">
          {message}
        </p>

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
