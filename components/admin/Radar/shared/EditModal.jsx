import { useState, useEffect } from 'react';

/**
 * Reusable generic form modal for editing records.
 *
 * Props:
 *   isOpen         {boolean}        - Controls visibility; parent owns open/close state
 *   title          {string}         - Modal heading
 *   fields         {FieldConfig[]}  - Array of field descriptors (see FieldConfig shape below)
 *   initialValues  {object}         - Initial form values keyed by field.key
 *   onSave         {function}       - Called with merged form values when validation passes
 *   onCancel       {function}       - Called when Cancel button or Escape key is activated
 *   isSaving       {boolean}        - When true, disables Save button (in-flight save)
 *
 * FieldConfig shape:
 *   {
 *     key:      string,
 *     label:    string,
 *     type:     'text' | 'textarea' | 'datetime-local' | 'number' | 'select' | 'readonly',
 *     options?: { value: string, label: string }[],   // static options for type='select'
 *     computeOptions?: (values) => { value, label }[], // dynamic options derived from current values
 *     clearWhen?: string[],   // when any of these field keys change, clear this field's value
 *     required?: boolean
 *   }
 */
const EditModal = ({
  isOpen,
  title,
  fields = [],
  initialValues = {},
  onSave,
  onCancel,
  isSaving = false,
}) => {
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});

  // Sync form values whenever the modal opens or initialValues change
  useEffect(() => {
    if (isOpen) {
      setValues({ ...initialValues });
      setErrors({});
    }
  }, [isOpen, initialValues]);

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

  const handleChange = (key, value) => {
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      // Clear any field that declares a dependency on the changed key
      // (e.g. Cause clears when Reason changes — Requirement 6.3).
      fields.forEach((field) => {
        if (
          field.key !== key &&
          Array.isArray(field.clearWhen) &&
          field.clearWhen.includes(key)
        ) {
          next[field.key] = '';
        }
      });
      return next;
    });
    // Clear error for this field as soon as the user starts typing
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const handleSave = () => {
    // Validate required fields
    const newErrors = {};
    fields.forEach((field) => {
      if (field.required && field.type !== 'readonly') {
        const val = values[field.key];
        if (val === undefined || val === null || String(val).trim() === '') {
          newErrors[field.key] = `${field.label} is required.`;
        }
      }
    });

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return; // Do NOT call onSave
    }

    // Merge with initialValues so any keys not in fields are preserved
    const mergedValues = { ...initialValues, ...values };
    onSave(mergedValues);
  };

  const renderField = (field) => {
    const value = values[field.key] ?? '';
    const hasError = Boolean(errors[field.key]);

    const baseInputClass = `w-full px-3 py-2 text-sm rounded-md border bg-[var(--dtg-bg-card)] text-[var(--dtg-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--dtg-brand-orange)] transition-colors ${
      hasError
        ? 'border-red-500 focus:ring-red-500'
        : 'border-[var(--dtg-border-medium)]'
    }`;

    switch (field.type) {
      case 'readonly':
        return (
          <div
            className="w-full px-3 py-2 text-sm rounded-md border border-[var(--dtg-border-medium)] bg-[var(--dtg-bg-secondary)] text-[var(--dtg-text-secondary)] cursor-not-allowed"
          >
            {value || <span className="italic text-[var(--dtg-text-secondary)] opacity-60">—</span>}
          </div>
        );

      case 'textarea':
        return (
          <textarea
            id={`edit-field-${field.key}`}
            value={value}
            onChange={(e) => handleChange(field.key, e.target.value)}
            rows={3}
            className={`${baseInputClass} resize-y`}
            aria-invalid={hasError}
            aria-describedby={hasError ? `error-${field.key}` : undefined}
          />
        );

      case 'select': {
        const selectOptions =
          typeof field.computeOptions === 'function'
            ? field.computeOptions(values)
            : field.options || [];
        return (
          <select
            id={`edit-field-${field.key}`}
            value={value}
            onChange={(e) => handleChange(field.key, e.target.value)}
            className={baseInputClass}
            aria-invalid={hasError}
            aria-describedby={hasError ? `error-${field.key}` : undefined}
          >
            <option value="">— Select —</option>
            {selectOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        );
      }

      case 'number':
        return (
          <input
            id={`edit-field-${field.key}`}
            type="number"
            value={value}
            onChange={(e) => handleChange(field.key, e.target.value)}
            className={baseInputClass}
            aria-invalid={hasError}
            aria-describedby={hasError ? `error-${field.key}` : undefined}
          />
        );

      case 'datetime-local':
        return (
          <input
            id={`edit-field-${field.key}`}
            type="datetime-local"
            value={value}
            onChange={(e) => handleChange(field.key, e.target.value)}
            className={baseInputClass}
            aria-invalid={hasError}
            aria-describedby={hasError ? `error-${field.key}` : undefined}
          />
        );

      case 'text':
      default:
        return (
          <input
            id={`edit-field-${field.key}`}
            type="text"
            value={value}
            onChange={(e) => handleChange(field.key, e.target.value)}
            className={baseInputClass}
            aria-invalid={hasError}
            aria-describedby={hasError ? `error-${field.key}` : undefined}
          />
        );
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
      aria-modal="true"
      role="dialog"
      aria-labelledby="edit-modal-title"
    >
      {/* Modal panel — stop propagation so backdrop click doesn't fire from inside */}
      <div
        className="bg-[var(--dtg-bg-card)] text-[var(--dtg-text-primary)] border border-[var(--dtg-border-medium)] rounded-lg shadow-xl w-full max-w-lg mx-4 flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-[var(--dtg-border-medium)]">
          <h2
            id="edit-modal-title"
            className="text-lg font-semibold"
          >
            {title}
          </h2>
        </div>

        {/* Scrollable body */}
        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-4">
          {fields.map((field) => (
            <div key={field.key}>
              <label
                htmlFor={field.type !== 'readonly' ? `edit-field-${field.key}` : undefined}
                className="block text-sm font-medium text-[var(--dtg-text-primary)] mb-1"
              >
                {field.label}
                {field.required && field.type !== 'readonly' && (
                  <span className="text-red-500 ml-1" aria-hidden="true">*</span>
                )}
              </label>

              {renderField(field)}

              {errors[field.key] && (
                <p
                  id={`error-${field.key}`}
                  className="mt-1 text-xs text-red-500"
                  role="alert"
                >
                  {errors[field.key]}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--dtg-border-medium)] flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="px-4 py-2 text-sm font-medium rounded-md border border-[var(--dtg-border-medium)] bg-transparent text-[var(--dtg-text-primary)] hover:bg-[var(--dtg-bg-secondary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 text-sm font-medium rounded-md bg-[var(--dtg-brand-orange)] hover:opacity-90 text-white transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EditModal;
