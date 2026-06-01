'use client';

/**
 * VCPConfigRow
 *
 * Renders the per-file configuration row inside the Pattern Recognition Popup's
 * FileUploadPanel. One VCPConfigRow is shown for each successfully uploaded file.
 *
 * Props:
 *   fileConfig  {VCPFileConfig}          - Current config for this file
 *   onChange    {(updatedConfig) => void} - Called whenever vcpNamePrefix or smoothingWindows change
 *   onRemove    {() => void}             - Called when the user clicks the × remove button
 *
 * VCPFileConfig shape:
 *   {
 *     file: File,
 *     vcpNamePrefix: string,
 *     smoothingWindows: number[],
 *     parseInfo: {
 *       dataStart: string,            // ISO 8601 local
 *       dataEnd: string,              // ISO 8601 local
 *       samplingIntervalMinutes: number,
 *       rowCount: number,
 *     } | null,
 *     parseError: string | null,
 *   }
 *
 * Requirements: 2.3, 2.4, 2.5, 2.6
 */

const MIN_WINDOW = 2;
const MAX_WINDOW = 1440;
const MAX_ROWS = 10;
const DEFAULT_WINDOW_VALUE = 60;

const VCPConfigRow = ({ fileConfig, onChange, onRemove }) => {
  const { file, vcpNamePrefix, smoothingWindows, parseInfo, parseError } = fileConfig;

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handlePrefixChange = (e) => {
    onChange({ ...fileConfig, vcpNamePrefix: e.target.value });
  };

  const handleWindowChange = (index, rawValue) => {
    // Allow empty string while typing; clamp on blur (see handleWindowBlur)
    const updated = smoothingWindows.map((w, i) =>
      i === index ? (rawValue === '' ? '' : Number(rawValue)) : w
    );
    onChange({ ...fileConfig, smoothingWindows: updated });
  };

  const handleWindowBlur = (index, rawValue) => {
    const parsed = parseInt(rawValue, 10);
    const clamped = isNaN(parsed)
      ? DEFAULT_WINDOW_VALUE
      : Math.min(MAX_WINDOW, Math.max(MIN_WINDOW, parsed));
    const updated = smoothingWindows.map((w, i) => (i === index ? clamped : w));
    onChange({ ...fileConfig, smoothingWindows: updated });
  };

  const handleAddWindow = () => {
    if (smoothingWindows.length >= MAX_ROWS) return;
    onChange({
      ...fileConfig,
      smoothingWindows: [...smoothingWindows, DEFAULT_WINDOW_VALUE],
    });
  };

  const handleRemoveWindow = (index) => {
    const updated = smoothingWindows.filter((_, i) => i !== index);
    onChange({ ...fileConfig, smoothingWindows: updated });
  };

  // ── Derived values ─────────────────────────────────────────────────────────

  const vcpCount = smoothingWindows.length;
  const canAddMore = vcpCount < MAX_ROWS;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        border: '1px solid var(--dtg-border-medium)',
        borderRadius: '8px',
        background: 'var(--dtg-bg-card)',
        padding: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      {/* ── Header: filename + remove button ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
        }}
      >
        <h3
          title={file.name}
          style={{
            fontSize: '0.875rem',
            fontWeight: 600,
            color: 'var(--dtg-text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            margin: 0,
          }}
        >
          {file.name}
        </h3>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove file ${file.name}`}
          style={{
            flexShrink: 0,
            width: '24px',
            height: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '50%',
            border: 'none',
            background: 'transparent',
            color: 'var(--dtg-text-secondary)',
            fontSize: '1rem',
            lineHeight: 1,
            cursor: 'pointer',
            padding: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
            e.currentTarget.style.color = 'var(--dtg-text-primary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--dtg-text-secondary)';
          }}
        >
          ×
        </button>
      </div>

      {/* ── Parse error (shown when file is unusable) ── */}
      {parseError && (
        <p
          role="alert"
          style={{
            fontSize: '0.75rem',
            color: '#ef4444',
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: '6px',
            padding: '6px 12px',
            margin: 0,
          }}
        >
          {parseError}
        </p>
      )}

      {/* ── Parse info: data range + sampling interval ── */}
      {parseInfo && (
        <div
          style={{
            fontSize: '0.75rem',
            color: 'var(--dtg-text-secondary)',
            background: 'var(--dtg-bg-secondary)',
            borderRadius: '6px',
            padding: '6px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
          }}
        >
          <span>
            <span style={{ fontWeight: 500, color: 'var(--dtg-text-primary)' }}>
              Data range:{' '}
            </span>
            {parseInfo.dataStart} → {parseInfo.dataEnd}
          </span>
          <span>
            <span style={{ fontWeight: 500, color: 'var(--dtg-text-primary)' }}>
              Sampling interval:{' '}
            </span>
            {parseInfo.samplingIntervalMinutes} min
            {parseInfo.rowCount != null && (
              <span style={{ marginLeft: '8px', color: 'var(--dtg-text-secondary)' }}>
                ({parseInfo.rowCount} readings)
              </span>
            )}
          </span>
        </div>
      )}

      {/* ── VCP name prefix input ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <label
          htmlFor={`vcp-prefix-${file.name}`}
          style={{
            fontSize: '0.75rem',
            fontWeight: 500,
            color: 'var(--dtg-text-secondary)',
            userSelect: 'none',
          }}
        >
          VCP Name Prefix
        </label>
        <input
          id={`vcp-prefix-${file.name}`}
          type="text"
          value={vcpNamePrefix}
          onChange={handlePrefixChange}
          placeholder="e.g. VCP-01"
          style={{
            padding: '6px 10px',
            borderRadius: '6px',
            border: '1px solid var(--dtg-border-medium)',
            background: 'var(--dtg-bg-secondary)',
            color: 'var(--dtg-text-primary)',
            fontSize: '0.875rem',
            outline: 'none',
            width: '100%',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* ── Smoothing window table ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {/* Header row: label + count */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <label
            style={{
              fontSize: '0.75rem',
              fontWeight: 500,
              color: 'var(--dtg-text-secondary)',
              userSelect: 'none',
            }}
          >
            Calculation Period (minutes)
          </label>
          <span
            style={{
              fontSize: '0.75rem',
              color: 'var(--dtg-text-secondary)',
            }}
          >
            {vcpCount} VCP {vcpCount === 1 ? 'analysis' : 'analyses'}
          </span>
        </div>

        {/* Window rows */}
        {smoothingWindows.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {smoothingWindows.map((windowVal, index) => (
              <div
                key={index}
                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <input
                  type="number"
                  min={MIN_WINDOW}
                  max={MAX_WINDOW}
                  step={1}
                  value={windowVal}
                  onChange={(e) => handleWindowChange(index, e.target.value)}
                  onBlur={(e) => handleWindowBlur(index, e.target.value)}
                  aria-label={`Smoothing window ${index + 1} in minutes`}
                  style={{
                    width: '90px',
                    padding: '6px 8px',
                    borderRadius: '6px',
                    border: '1px solid var(--dtg-border-medium)',
                    background: 'var(--dtg-bg-secondary)',
                    color: 'var(--dtg-text-primary)',
                    fontSize: '0.875rem',
                    outline: 'none',
                    boxSizing: 'border-box',
                    // Hide number spinners
                    MozAppearance: 'textfield',
                  }}
                />
                <span
                  style={{
                    fontSize: '0.75rem',
                    color: 'var(--dtg-text-secondary)',
                  }}
                >
                  min
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveWindow(index)}
                  aria-label={`Remove window ${index + 1}`}
                  style={{
                    marginLeft: 'auto',
                    fontSize: '0.75rem',
                    color: 'var(--dtg-text-secondary)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '4px 8px',
                    borderRadius: '4px',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = '#ef4444';
                    e.currentTarget.style.background = 'rgba(239,68,68,0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'var(--dtg-text-secondary)';
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {smoothingWindows.length === 0 && (
          <p
            style={{
              fontSize: '0.75rem',
              color: 'var(--dtg-text-secondary)',
              fontStyle: 'italic',
              margin: 0,
            }}
          >
            No smoothing windows configured. Add at least one to include this file in the analysis.
          </p>
        )}

        {/* Add Window button */}
        <button
          type="button"
          onClick={handleAddWindow}
          disabled={!canAddMore}
          aria-label="Add smoothing window"
          style={{
            alignSelf: 'flex-start',
            fontSize: '0.75rem',
            fontWeight: 500,
            padding: '6px 12px',
            borderRadius: '6px',
            border: '1px solid var(--dtg-border-medium)',
            color: 'var(--dtg-text-primary)',
            background: 'transparent',
            cursor: canAddMore ? 'pointer' : 'not-allowed',
            opacity: canAddMore ? 1 : 0.4,
          }}
        >
          + Add Window
          {!canAddMore && (
            <span style={{ marginLeft: '4px', color: 'var(--dtg-text-secondary)' }}>
              (max {MAX_ROWS})
            </span>
          )}
        </button>
      </div>
    </div>
  );
};

export default VCPConfigRow;
