'use client';

import { useRef, useCallback } from 'react';
import VCPConfigRow from './VCPConfigRow';

/**
 * FileUploadPanel
 *
 * Renders a styled file upload zone that accepts .xlsx and .xls files.
 * For each selected file, attempts client-side parsing to extract parse info.
 * Since the `xlsx` (SheetJS) package is not installed, parsing is best-effort:
 * - Files with a valid .xlsx/.xls extension get a placeholder parseInfo
 * - Files with an invalid extension get a parseError
 * - Actual deformation column parsing happens server-side
 *
 * One VCPConfigRow is rendered per successfully parsed file (no parseError).
 *
 * Props:
 *   uploadedFiles    {VCPFileConfig[]}                  - Current list of file configs
 *   onFilesChange    {(updatedFiles: VCPFileConfig[]) => void} - Called on any change
 *
 * VCPFileConfig shape:
 *   {
 *     file: File,
 *     vcpNamePrefix: string,       // filename without extension
 *     smoothingWindows: number[],  // default [7]
 *     parseInfo: {
 *       dataStart: string,         // ISO 8601 local (empty when not parsed client-side)
 *       dataEnd: string,           // ISO 8601 local (empty when not parsed client-side)
 *       samplingIntervalMinutes: number,
 *       rowCount: number,
 *     } | null,
 *     parseError: string | null,
 *   }
 *
 * Requirements: 2.2, 2.3, 2.5, 2.6
 */

const ACCEPTED_EXTENSIONS = ['.xlsx', '.xls'];
const DEFAULT_SMOOTHING_WINDOWS = [60];

/**
 * Derive the filename without extension.
 * e.g. "VCP-01_data.xlsx" → "VCP-01_data"
 */
function stripExtension(filename) {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) return filename;
  return filename.slice(0, lastDot);
}

/**
 * Check whether a file has an accepted Excel extension.
 */
function isExcelFile(file) {
  const lower = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Build a VCPFileConfig for a single File object.
 *
 * Because the `xlsx` (SheetJS) package is not installed, client-side parsing
 * is not available. We use a best-effort fallback:
 *   - Valid extension → placeholder parseInfo (actual parsing happens server-side)
 *   - Invalid extension → parseError
 *
 * If SheetJS were available, this function would:
 *   1. Read the file as ArrayBuffer
 *   2. Call XLSX.read(buffer, { type: 'array', cellDates: true })
 *   3. Find the first column with ≥4 non-null numeric values
 *   4. Extract dataStart/dataEnd from the DatetimeIndex column
 *   5. Compute samplingIntervalMinutes as the median time delta
 *
 * @param {File} file
 * @returns {VCPFileConfig}
 */
function buildFileConfig(file) {
  const vcpNamePrefix = stripExtension(file.name);

  if (!isExcelFile(file)) {
    return {
      file,
      vcpNamePrefix,
      smoothingWindows: DEFAULT_SMOOTHING_WINDOWS,
      parseInfo: null,
      parseError: 'Failed to parse file as Excel workbook',
    };
  }

  // Placeholder parseInfo — server-side parsing will populate real values.
  // rowCount: 0 signals to the UI that the count is not yet known.
  return {
    file,
    vcpNamePrefix,
    smoothingWindows: DEFAULT_SMOOTHING_WINDOWS,
    parseInfo: {
      dataStart: '',
      dataEnd: '',
      samplingIntervalMinutes: 0,
      rowCount: 0,
    },
    parseError: null,
  };
}

/**
 * Deduplicate incoming files against already-uploaded files by filename.
 * Returns only the new files that are not already present.
 */
function deduplicateFiles(newFiles, existingConfigs) {
  const existingNames = new Set(existingConfigs.map((c) => c.file.name));
  return newFiles.filter((f) => !existingNames.has(f.name));
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FileUploadPanel({ uploadedFiles, onFilesChange }) {
  const fileInputRef = useRef(null);

  // ── File processing ────────────────────────────────────────────────────────

  const processFiles = useCallback(
    (fileList) => {
      const files = Array.from(fileList);
      const unique = deduplicateFiles(files, uploadedFiles);
      if (unique.length === 0) return;

      const newConfigs = unique.map(buildFileConfig);
      onFilesChange([...uploadedFiles, ...newConfigs]);
    },
    [uploadedFiles, onFilesChange]
  );

  // ── Input / drag-and-drop handlers ────────────────────────────────────────

  const handleInputChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
      // Reset input so the same file can be re-selected after removal
      e.target.value = '';
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  const handleZoneClick = () => {
    fileInputRef.current?.click();
  };

  const handleZoneKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInputRef.current?.click();
    }
  };

  // ── Per-file update / remove ───────────────────────────────────────────────

  const handleFileConfigChange = useCallback(
    (index, updatedConfig) => {
      const updated = uploadedFiles.map((cfg, i) => (i === index ? updatedConfig : cfg));
      onFilesChange(updated);
    },
    [uploadedFiles, onFilesChange]
  );

  const handleFileRemove = useCallback(
    (index) => {
      const updated = uploadedFiles.filter((_, i) => i !== index);
      onFilesChange(updated);
    },
    [uploadedFiles, onFilesChange]
  );

  // ── Derived ────────────────────────────────────────────────────────────────

  // Only show VCPConfigRow for files without a parseError (Req 2.3, 2.6)
  const validConfigs = uploadedFiles.filter((cfg) => !cfg.parseError);
  const errorConfigs = uploadedFiles.filter((cfg) => cfg.parseError);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* ── Hidden file input ── */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        multiple
        onChange={handleInputChange}
        aria-label="Upload Excel files"
        style={{ display: 'none' }}
      />

      {/* ── Drop zone / upload button ── */}
      <div
        role="button"
        tabIndex={0}
        onClick={handleZoneClick}
        onKeyDown={handleZoneKeyDown}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        aria-label="Upload Excel files (.xlsx, .xls). Click or drag and drop files here."
        style={{
          border: '2px dashed var(--dtg-border-medium)',
          borderRadius: '10px',
          background: 'var(--dtg-bg-secondary)',
          padding: '28px 20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px',
          cursor: 'pointer',
          transition: 'border-color 0.15s, background 0.15s',
          outline: 'none',
          userSelect: 'none',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--dtg-text-secondary)';
          e.currentTarget.style.background = 'var(--dtg-bg-card)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--dtg-border-medium)';
          e.currentTarget.style.background = 'var(--dtg-bg-secondary)';
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'var(--dtg-text-secondary)';
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = 'var(--dtg-border-medium)';
        }}
      >
        {/* Upload icon */}
        <svg
          aria-hidden="true"
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--dtg-text-secondary)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>

        {/* Primary label */}
        <span
          style={{
            fontSize: '0.9rem',
            fontWeight: 600,
            color: 'var(--dtg-text-primary)',
          }}
        >
          Upload Excel files (.xlsx, .xls)
        </span>

        {/* Secondary hint */}
        <span
          style={{
            fontSize: '0.75rem',
            color: 'var(--dtg-text-secondary)',
          }}
        >
          Drag &amp; drop files here, or click to browse
        </span>

        {/* Styled browse button (visual only — click is on the zone) */}
        <span
          style={{
            marginTop: '4px',
            padding: '6px 16px',
            borderRadius: '6px',
            border: '1px solid var(--dtg-border-medium)',
            background: 'transparent',
            color: 'var(--dtg-text-primary)',
            fontSize: '0.8rem',
            fontWeight: 500,
            pointerEvents: 'none', // zone handles the click
          }}
        >
          Browse files
        </span>
      </div>

      {/* ── Files with parse errors (shown but excluded from analysis) ── */}
      {errorConfigs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <p
            style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              color: 'var(--dtg-text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              margin: 0,
            }}
          >
            Unsupported files
          </p>
          {errorConfigs.map((cfg) => {
            const index = uploadedFiles.indexOf(cfg);
            return (
              <div
                key={`${cfg.file.name}-${index}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid rgba(239,68,68,0.3)',
                  background: 'rgba(239,68,68,0.05)',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                  <span
                    title={cfg.file.name}
                    style={{
                      fontSize: '0.875rem',
                      fontWeight: 500,
                      color: 'var(--dtg-text-primary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {cfg.file.name}
                  </span>
                  <span
                    role="alert"
                    style={{ fontSize: '0.75rem', color: '#ef4444' }}
                  >
                    {cfg.parseError}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleFileRemove(index)}
                  aria-label={`Remove file ${cfg.file.name}`}
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
            );
          })}
        </div>
      )}

      {/* ── Valid file configs (one VCPConfigRow each) ── */}
      {validConfigs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <p
            style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              color: 'var(--dtg-text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              margin: 0,
            }}
          >
            Configured files ({validConfigs.length})
          </p>
          {uploadedFiles.map((cfg, index) => {
            if (cfg.parseError) return null;
            return (
              <VCPConfigRow
                key={`${cfg.file.name}-${index}`}
                fileConfig={cfg}
                onChange={(updatedConfig) => handleFileConfigChange(index, updatedConfig)}
                onRemove={() => handleFileRemove(index)}
              />
            );
          })}
        </div>
      )}

      {/* ── Empty state hint ── */}
      {uploadedFiles.length === 0 && (
        <p
          style={{
            fontSize: '0.8rem',
            color: 'var(--dtg-text-secondary)',
            textAlign: 'center',
            margin: 0,
            fontStyle: 'italic',
          }}
        >
          No files uploaded yet. Each .xlsx or .xls file represents one physical VCP.
        </p>
      )}
    </div>
  );
}
