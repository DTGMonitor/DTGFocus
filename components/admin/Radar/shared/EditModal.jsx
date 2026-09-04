import { useState, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

/**
 * Reusable generic form modal for editing records.
 *
 * Props:
 *   isOpen         {boolean}        - Controls visibility; parent owns open/close state
 *   title          {string}         - Modal heading
 *   fields         {FieldConfig[]}  - Array of field descriptors (see FieldConfig shape below)
 *   initialValues  {object}         - Initial form values keyed by field.key
 *   onSave         {function}       - Called with merged form values when validation passes
 *   onCancel       {function}       - Called when the Cancel button is clicked. The modal is
 *                                    deliberately NOT dismissed by the backdrop or Escape,
 *                                    so a stray click cannot discard a half-filled form.
 *   isSaving       {boolean}        - When true, disables Save button (in-flight save)
 *
 * FieldConfig shape:
 *   {
 *     key:      string,
 *     label:    string,
 *     type:     'text' | 'textarea' | 'datetime-local' | 'number' | 'select' | 'readonly'
 *               | 'heading' | 'preview',
 *     options?: { value: string, label: string }[],   // static options for type='select'
 *     computeOptions?: (values) => { value, label }[], // dynamic options derived from current values
 *     clearWhen?: string[],   // when any of these field keys change, clear this field's value
 *     required?: boolean,
 *     help?:     string | ((values) => string),  // muted guidance under the input
 *     showWhen?: (values) => boolean,  // hidden fields render nothing and skip validation
 *     derive?:   (values) => string,   // fills the field while it is still empty
 *     collapsible?: boolean,    // 'heading' only — the fields under it fold away
 *     defaultCollapsed?: boolean,
 *     rows?: (values) => { label, value }[],  // 'preview' only — what the form
 *                                             // is about to produce, live
 *     emptyText?: string        // 'preview' only — shown when rows is empty
 *   }
 *
 * A 'heading' field owns every field after it until the next heading, which is
 * what lets one long form read as three short ones. `help` exists so a label can
 * stay two words: a form whose labels are paragraphs is a form nobody reads.
 */

const isHeading = (field) => field.type === 'heading';

/** Field types that render no focusable control, so their label points at nothing. */
const NO_INPUT = new Set(['readonly', 'preview']);

/** Fields the current values have hidden — they neither render nor validate. */
const isVisible = (field, values) =>
  typeof field.showWhen === 'function' ? Boolean(field.showWhen(values)) : true;

const helpText = (field, values) =>
  typeof field.help === 'function' ? field.help(values) : field.help;

/**
 * Splits a flat field list into sections.
 *
 * A list with no headings yields one anonymous section, so every existing caller
 * renders exactly as it did.
 */
const toSections = (fields) => {
  const sections = [{ heading: null, fields: [] }];
  fields.forEach((field) => {
    if (isHeading(field)) sections.push({ heading: field, fields: [] });
    else sections[sections.length - 1].fields.push(field);
  });
  return sections.filter((section) => section.heading || section.fields.length);
};
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
  const [collapsed, setCollapsed] = useState({});

  const sections = useMemo(() => toSections(fields), [fields]);

  // Sync form values whenever the modal opens or the record being edited
  // changes. Compared by CONTENT, not identity: callers build initialValues
  // inline, so a parent re-render used to hand back an equal-but-new object and
  // wipe whatever the engineer had typed.
  const initialKey = JSON.stringify(initialValues ?? {});
  useEffect(() => {
    if (isOpen) {
      setValues(JSON.parse(initialKey));
      setErrors({});
      setCollapsed(
        Object.fromEntries(
          fields
            .filter((f) => isHeading(f) && f.collapsible)
            .map((f) => [f.key, f.defaultCollapsed !== false])
        )
      );
    }
    // `fields` is a module constant in every caller; `initialKey` is the record.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialKey]);

  // No Escape / backdrop dismissal: this dialog closes from its own buttons
  // only, so a stray click or keypress outside it cannot discard the decision.

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
      // Fill any field that can answer itself but has not been answered yet —
      // the trigger's wording from its deformation type, its TARP level from
      // the band label. Only ever writes into a blank, so a value an engineer
      // typed (or a client's own wording) is never overwritten.
      fields.forEach((field) => {
        if (field.key === key || typeof field.derive !== 'function') return;
        const current = next[field.key];
        if (current !== undefined && current !== null && String(current).trim() !== '') return;
        const derived = field.derive(next);
        if (derived !== undefined && derived !== null && derived !== '') {
          next[field.key] = derived;
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
      // A field the current answers have hidden is not a field the engineer
      // can fill, so it cannot block the save.
      if (isHeading(field) || !isVisible(field, values)) return;
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

      // Not an input at all: what the form is ABOUT to produce, recomputed on
      // every keystroke from the values on screen. A field's own help can only
      // describe the rule it obeys; this shows the result of every field at once,
      // which is the thing an engineer is actually agreeing to when they save.
      case 'preview': {
        const rows = typeof field.rows === 'function' ? field.rows(values) : [];
        return (
          <div className="w-full rounded-md border border-[var(--dtg-border-medium)] bg-[var(--dtg-bg-secondary)] px-3 py-2 space-y-2">
            {rows.length === 0 ? (
              <p className="text-xs italic text-[var(--dtg-text-muted)]">
                {field.emptyText || 'Nothing to preview yet.'}
              </p>
            ) : rows.map((row) => (
              <div key={row.label}>
                <p className="text-[11px] uppercase tracking-wide text-[var(--dtg-text-muted)]">
                  {row.label}
                </p>
                <p className="text-xs font-mono break-words text-[var(--dtg-text-primary)]">
                  {row.value}
                </p>
              </div>
            ))}
          </div>
        );
      }

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
        // Two empty choices on one dropdown reads as a bug, and on a required
        // field the placeholder is an answer that always fails validation. So
        // it is offered only when the field neither demands a value nor
        // already states what blank means.
        const suppliesOwnBlank = selectOptions.some((opt) => opt.value === '');
        return (
          <select
            id={`edit-field-${field.key}`}
            value={value}
            onChange={(e) => handleChange(field.key, e.target.value)}
            className={baseInputClass}
            aria-invalid={hasError}
            aria-describedby={hasError ? `error-${field.key}` : undefined}
          >
            {!field.required && !suppliesOwnBlank && <option value="">— Select —</option>}
            {/* A required field with nothing chosen yet still needs somewhere
                for that empty value to show, or the box would display the first
                option while saving as blank. It cannot be chosen again. */}
            {field.required && !suppliesOwnBlank && !value && (
              <option value="" disabled>— Select —</option>
            )}
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
      aria-modal="true"
      role="dialog"
      aria-labelledby="edit-modal-title"
    >
      {/* Modal panel — clicks stay inside; the backdrop is inert. */}
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
        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-5">
          {sections.map((section, index) => {
            const heading = section.heading;
            const isFolded = heading?.collapsible && collapsed[heading.key];
            const visible = section.fields.filter((field) => isVisible(field, values));

            // A section whose every field is hidden takes its heading with it.
            if (heading && !visible.length && !heading.collapsible) return null;

            return (
              <div key={heading?.key ?? `section-${index}`} className="space-y-4">
                {heading && (
                  heading.collapsible ? (
                    <button
                      type="button"
                      onClick={() => setCollapsed((prev) => ({
                        ...prev, [heading.key]: !prev[heading.key],
                      }))}
                      aria-expanded={!isFolded}
                      className="w-full flex items-center gap-1.5 pb-1 border-b border-[var(--dtg-border-light)] text-xs font-semibold uppercase tracking-wide text-[var(--dtg-text-muted)] hover:text-[var(--dtg-text-primary)] transition-colors"
                    >
                      {isFolded ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                      {heading.label}
                    </button>
                  ) : (
                    <p className="pb-1 border-b border-[var(--dtg-border-light)] text-xs font-semibold uppercase tracking-wide text-[var(--dtg-text-muted)]">
                      {heading.label}
                    </p>
                  )
                )}

                {heading?.help && !isFolded && (
                  <p className="-mt-2 text-xs text-[var(--dtg-text-muted)]">
                    {helpText(heading, values)}
                  </p>
                )}

                {!isFolded && visible.map((field) => {
                  const help = helpText(field, values);
                  return (
                    <div key={field.key}>
                      <label
                        htmlFor={NO_INPUT.has(field.type) ? undefined : `edit-field-${field.key}`}
                        className="block text-sm font-medium text-[var(--dtg-text-primary)] mb-1"
                      >
                        {field.label}
                        {field.required && !NO_INPUT.has(field.type) && (
                          <span className="text-red-500 ml-1" aria-hidden="true">*</span>
                        )}
                      </label>

                      {renderField(field)}

                      {help && (
                        <p className="mt-1 text-xs text-[var(--dtg-text-muted)]">{help}</p>
                      )}

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
                  );
                })}
              </div>
            );
          })}
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
