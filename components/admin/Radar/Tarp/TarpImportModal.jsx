import { useCallback, useMemo, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  AlertTriangle, FileSpreadsheet, Loader2, Table2, Upload, X,
} from 'lucide-react';
import { readTarpFile } from '@/utils/tarpImport';
import { TYPE_MATRIX } from '@/config/formConfig';

/**
 * TarpImportModal
 *
 * Reads a client's own TARP workbook and hands the parsed trigger rows back to
 * the caller. Two layouts are understood — one row per trigger, and the newer
 * parameter × risk-band matrix — see utils/tarpImport.js.
 *
 * Nothing is written to the database from here. The rows go into the TARP tab's
 * draft, which publishes through the same versioned path a hand edit takes, so
 * an import leaves the same audit trail and never overwrites the version in
 * force.
 *
 * The review step exists because a spreadsheet cannot say which rows drive an
 * email. The importer's guess at the deformation type is offered per row and the
 * engineer confirms it — a wrong guess left unchecked would change what a
 * client's inbox receives.
 *
 * Props:
 *   isOpen   {boolean}
 *   mode     {'create'|'replace'} - whether the site already has a document
 *   siteName {string}
 *   onCancel {function}
 *   onApply  {function} - (triggers, meta) => void | Promise
 *   isSaving {boolean}
 */

const DEF_TYPE_OPTIONS = [
  { value: '', label: '— None (descriptive row) —' },
  ...Object.keys(TYPE_MATRIX).map((type) => ({ value: type, label: type })),
];

const LAYOUT_LABEL = {
  matrix: 'Parameter × risk-band matrix',
  row: 'One row per trigger',
};

const ACCEPT = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.ms-excel': ['.xls'],
};

export default function TarpImportModal({
  isOpen,
  mode = 'create',
  siteName,
  onCancel,
  onApply,
  isSaving = false,
}) {
  const [result, setResult] = useState(null); // { layout, triggers, warnings, sheetName }
  const [fileName, setFileName] = useState('');
  const [isReading, setIsReading] = useState(false);
  const [readError, setReadError] = useState('');

  const reset = useCallback(() => {
    setResult(null);
    setFileName('');
    setReadError('');
  }, []);

  const handleCancel = useCallback(() => {
    reset();
    onCancel?.();
  }, [reset, onCancel]);

  const onDrop = useCallback(async (files) => {
    const file = files?.[0];
    if (!file) return;

    setIsReading(true);
    setReadError('');
    setFileName(file.name);
    try {
      // A file the parser could make nothing of still lands here — its warnings
      // say what the importer looked for, which is more use than a bare failure.
      setResult(await readTarpFile(file));
    } catch (err) {
      console.error('[TarpImportModal] could not read the workbook', err);
      setReadError(
        'That file could not be read as a spreadsheet. Save it as .xlsx and try again.'
      );
      setResult(null);
    } finally {
      setIsReading(false);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPT,
    multiple: false,
    disabled: isReading || isSaving,
  });

  const patchTrigger = useCallback((id, patch) => {
    setResult((prev) => ({
      ...prev,
      triggers: prev.triggers.map((trigger) =>
        (trigger.id === id ? { ...trigger, ...patch } : trigger)
      ),
    }));
  }, []);

  // A row cannot both name a deformation type and be an alarm setting: an alarm
  // fires on top of whatever trend is being reported, which is why
  // findAlarmTrigger() only ever looks at rows with no type against them.
  const setDefType = useCallback((id, defType) => {
    patchTrigger(id, defType
      ? { defType, requiresAlarm: false }
      : { defType: null });
  }, [patchTrigger]);

  const setRequiresAlarm = useCallback((id, requiresAlarm) => {
    patchTrigger(id, requiresAlarm ? { requiresAlarm: true, defType: null } : { requiresAlarm: false });
  }, [patchTrigger]);

  // A deformation type may appear on one row only — the database enforces it,
  // and the email engine would read the first match regardless.
  const duplicateTypes = useMemo(() => {
    const counts = new Map();
    (result?.triggers ?? []).forEach((trigger) => {
      if (!trigger.defType) return;
      counts.set(trigger.defType, (counts.get(trigger.defType) ?? 0) + 1);
    });
    return new Set([...counts].filter(([, n]) => n > 1).map(([type]) => type));
  }, [result]);

  const hasParameter = useMemo(
    () => (result?.triggers ?? []).some((trigger) => trigger.parameter),
    [result]
  );

  if (!isOpen) return null;

  const canApply = Boolean(result?.triggers?.length) && duplicateTypes.size === 0 && !isSaving;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleCancel}
      aria-modal="true"
      role="dialog"
      aria-labelledby="tarp-import-title"
    >
      <div
        className="bg-[var(--dtg-bg-card)] text-[var(--dtg-text-primary)] border border-[var(--dtg-border-medium)] rounded-lg shadow-xl w-full max-w-5xl mx-4 flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-5 pb-4 border-b border-[var(--dtg-border-medium)] flex items-start justify-between gap-4">
          <div>
            <h2 id="tarp-import-title" className="text-lg font-semibold">
              Import a TARP file
            </h2>
            <p className="mt-0.5 text-xs text-[var(--dtg-text-muted)]">
              {mode === 'create'
                ? `Stands up the first TARP for ${siteName || 'this site'} from the client's own workbook.`
                : 'Loads the file into the draft. The version in force stays in force until you publish.'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="p-1.5 rounded hover:bg-[var(--dtg-bg-secondary)] text-[var(--dtg-text-muted)] transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-4">
          {/* ── Drop zone ─────────────────────────────────────────────────── */}
          <div
            {...getRootProps()}
            className={`rounded-lg border-2 border-dashed px-6 py-8 text-center cursor-pointer transition-colors ${
              isDragActive
                ? 'border-[var(--dtg-brand-orange)] bg-[var(--dtg-brand-orange)]/10'
                : 'border-[var(--dtg-border-medium)] hover:bg-[var(--dtg-bg-secondary)]'
            } ${isReading || isSaving ? 'opacity-60 cursor-wait' : ''}`}
          >
            <input {...getInputProps()} />
            {isReading ? (
              <Loader2 className="mx-auto mb-2 animate-spin text-[var(--dtg-brand-orange)]" size={22} />
            ) : (
              <Upload className="mx-auto mb-2 text-[var(--dtg-text-muted)]" size={22} />
            )}
            <p className="text-sm text-[var(--dtg-text-secondary)]">
              {isReading
                ? `Reading ${fileName}…`
                : 'Drop the TARP .xlsx here, or click to choose one'}
            </p>
            <p className="mt-1 text-xs text-[var(--dtg-text-muted)]">
              Both chart layouts are read: one row per trigger, or parameters down
              the side with the risk bands across the top.
            </p>
          </div>

          {readError && (
            <p className="text-sm text-red-400">{readError}</p>
          )}

          {/* ── What was read ─────────────────────────────────────────────── */}
          {result && (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--dtg-text-secondary)]">
                <span className="flex items-center gap-1.5">
                  <FileSpreadsheet size={13} className="text-[var(--dtg-text-muted)]" />
                  {fileName}
                  {result.sheetName && ` · sheet "${result.sheetName}"`}
                </span>
                {result.layout && (
                  <span className="flex items-center gap-1.5">
                    <Table2 size={13} className="text-[var(--dtg-text-muted)]" />
                    {LAYOUT_LABEL[result.layout]}
                  </span>
                )}
                <span className="font-medium text-[var(--dtg-text-primary)]">
                  {result.triggers.length} trigger row
                  {result.triggers.length === 1 ? '' : 's'}
                </span>
                {/* The appendices below the chart. Only offered on a create —
                    an amendment leaves the site's agreed lists alone. */}
                {mode === 'create' && result.contacts?.length > 0 && (
                  <span>{result.contacts.length} escalation contacts</span>
                )}
                {mode === 'create' && result.distributionRaw && (
                  <span>
                    {result.distributionRaw.split('\n').length} on the distribution list
                  </span>
                )}
              </div>

              {result.warnings.length > 0 && (
                <ul className="space-y-1.5 rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2">
                  {result.warnings.map((warning, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-amber-200">
                      <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                      <span>{warning}</span>
                    </li>
                  ))}
                </ul>
              )}

              {result.triggers.length > 0 && (
                <>
                  <p className="text-xs text-[var(--dtg-text-muted)]">
                    A spreadsheet cannot say which rows drive an email. Confirm the
                    deformation type on every row that should — a row left as{' '}
                    <em>None</em> prints on the chart and triggers nothing.{' '}
                    <strong>Alarm only</strong> marks a row that applies when an alarm
                    fires rather than to a trend, matched to the alarm by its band colour.
                  </p>

                  <div className="overflow-x-auto border border-[var(--dtg-border-medium)] rounded-md">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="text-left text-[var(--dtg-text-muted)] border-b border-[var(--dtg-border-medium)]">
                          {hasParameter && (
                            <th className="px-2 py-2 font-medium w-32">Parameter</th>
                          )}
                          <th className="px-2 py-2 font-medium w-24">Risk</th>
                          <th className="px-2 py-2 font-medium w-48">Trigger</th>
                          <th className="px-2 py-2 font-medium">Description</th>
                          <th className="px-2 py-2 font-medium w-44">Drives deformation type</th>
                          <th className="px-2 py-2 font-medium w-20">Alarm only</th>
                          <th className="px-2 py-2 font-medium w-16">TARP</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.triggers.map((trigger) => (
                          <tr
                            key={trigger.id}
                            className="border-b border-[var(--dtg-border-light)] align-top"
                          >
                            {hasParameter && (
                              <td className="px-2 py-2 text-[var(--dtg-text-muted)]">
                                {trigger.parameter || '—'}
                              </td>
                            )}
                            <td className="px-2 py-2 text-[var(--dtg-text-secondary)]">
                              {trigger.riskRating || '—'}
                            </td>
                            <td className="px-2 py-2 font-medium">{trigger.triggerLabel}</td>
                            <td className="px-2 py-2 text-[var(--dtg-text-secondary)]">
                              {trigger.description || '—'}
                            </td>
                            <td className="px-2 py-2">
                              <select
                                value={trigger.defType || ''}
                                onChange={(e) => setDefType(trigger.id, e.target.value)}
                                aria-label={`Deformation type for ${trigger.triggerLabel}`}
                                className={`w-full px-2 py-1 rounded border bg-[var(--dtg-bg-card)] text-[var(--dtg-text-primary)] ${
                                  trigger.defType && duplicateTypes.has(trigger.defType)
                                    ? 'border-red-500'
                                    : 'border-[var(--dtg-border-medium)]'
                                }`}
                              >
                                {DEF_TYPE_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-2 py-2 text-center">
                              <input
                                type="checkbox"
                                checked={Boolean(trigger.requiresAlarm)}
                                onChange={(e) => setRequiresAlarm(trigger.id, e.target.checked)}
                                aria-label={`${trigger.triggerLabel} applies only when an alarm fires`}
                                className="accent-[var(--dtg-brand-orange)]"
                              />
                            </td>
                            <td className="px-2 py-2 text-[var(--dtg-text-secondary)]">
                              {trigger.tarpLevel ?? '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {duplicateTypes.size > 0 && (
                    <p className="text-xs text-red-400">
                      {[...duplicateTypes].join(', ')} {duplicateTypes.size === 1 ? 'is' : 'are'} set
                      on more than one row. A deformation type may drive one row only —
                      clear it from the rows it does not belong to.
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[var(--dtg-border-medium)] flex items-center justify-between gap-3">
          <p className="text-xs text-[var(--dtg-text-muted)]">
            {mode === 'create'
              ? 'Creates a draft you then review with the site.'
              : `Replaces all ${result?.triggers?.length ?? 0} rows in the draft. Contacts and the distribution list are untouched.`}
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleCancel}
              disabled={isSaving}
              className="px-4 py-2 text-sm font-medium rounded-md border border-[var(--dtg-border-medium)] hover:bg-[var(--dtg-bg-secondary)] transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canApply}
              onClick={() => onApply?.(result.triggers, {
                fileName,
                sheetName: result.sheetName,
                layout: result.layout,
                contacts: result.contacts ?? [],
                distributionRaw: result.distributionRaw,
                heading: result.heading,
                title: result.title,
              })}
              className="px-4 py-2 text-sm font-medium rounded-md bg-[var(--dtg-brand-orange)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving
                ? 'Importing…'
                : mode === 'create' ? 'Create the TARP' : 'Load into the draft'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
