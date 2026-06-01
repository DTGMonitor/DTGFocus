'use client';

import { useState, useEffect } from 'react';
import { displayPhase } from '@/utils/stageBoundaries';

/**
 * Stage label options — exactly in this order (Requirement 6.2).
 */
const STAGE_OPTIONS = [
  'No Significant Movement',
  'Linear',
  'Progressive Failure',
  'Regressive',
  'Unclassified',
];

/**
 * Format an ISO 8601 string as a readable local datetime string.
 * Returns "—" if the value is falsy.
 */
function formatLocalDatetime(isoString) {
  if (!isoString) return '—';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return isoString;
  }
}

/**
 * Derive onset_of_failure from the current windows array (Requirement 6.5).
 * Returns the start of the first "Progressive Failure" window, or null.
 */
export function deriveOnsetOfFailure(windows) {
  if (!Array.isArray(windows)) return null;
  const pfWindow = windows.find((w) => w.phase === 'Progressive Failure');
  return pfWindow ? pfWindow.start : null;
}

/**
 * StageEditor
 *
 * Renders an editable stage table for the active VCP's detected phase windows.
 * Allows the user to relabel stages and apply or reset the classification.
 *
 * Props:
 *   windows           {WindowResult[]}  - Current phase windows (from auto or manual classification)
 *   autoWindows       {WindowResult[]}  - Original auto-detected windows (used by Reset to Auto)
 *   isApplyingStages  {boolean}         - True while the apply API call is in-flight
 *   isResettingStages {boolean}         - True while the reset operation is in-flight
 *   onApply           {(updatedWindows: WindowResult[]) => void} - Called when Apply is clicked
 *   onReset           {() => void}      - Called when Reset to Auto is clicked
 *
 * WindowResult shape:
 *   { phase: string, start: string, end: string, duration: string }
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */
export default function StageEditor({
  windows,
  autoWindows,
  isApplyingStages,
  isResettingStages,
  onApply,
  onReset,
  pfConfirmed = false,
}) {
  // Local editable copy of windows (Requirement: component manages local editedWindows state)
  const [editedWindows, setEditedWindows] = useState(() =>
    Array.isArray(windows) ? windows.map((w) => ({ ...w })) : []
  );

  // Re-initialise when the windows prop changes (Requirement: re-initializes when windows prop changes)
  useEffect(() => {
    setEditedWindows(
      Array.isArray(windows) ? windows.map((w) => ({ ...w })) : []
    );
  }, [windows]);

  // ── Derived values ─────────────────────────────────────────────────────────

  // onset_of_failure derived from the current editedWindows (Requirement 6.5)
  const onsetRaw = deriveOnsetOfFailure(editedWindows);
  const onsetDisplay = onsetRaw ? formatLocalDatetime(onsetRaw) : '—';

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handlePhaseChange = (index, newPhase) => {
    setEditedWindows((prev) =>
      prev.map((w, i) => (i === index ? { ...w, phase: newPhase } : w))
    );
  };

  const handleApply = () => {
    if (isApplyingStages || isResettingStages) return;
    onApply?.(editedWindows);
  };

  const handleReset = () => {
    if (isApplyingStages || isResettingStages) return;
    onReset?.();
  };

  // ── Styles ─────────────────────────────────────────────────────────────────

  const cellStyle = {
    padding: '8px 12px',
    fontSize: '0.8125rem',
    color: 'var(--dtg-text-primary)',
    borderBottom: '1px solid var(--dtg-border-medium)',
    verticalAlign: 'middle',
    whiteSpace: 'nowrap',
  };

  const headerCellStyle = {
    ...cellStyle,
    fontSize: '0.75rem',
    fontWeight: 600,
    color: 'var(--dtg-text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    background: 'var(--dtg-bg-secondary)',
    borderBottom: '2px solid var(--dtg-border-medium)',
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      {/* ── Section title ── */}
      <h4
        style={{
          margin: 0,
          fontSize: '0.875rem',
          fontWeight: 600,
          color: 'var(--dtg-text-primary)',
        }}
      >
        Stage Editor
      </h4>

      {/* ── Onset of Failure display (Requirement 6.5) ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          borderRadius: '6px',
          background: 'var(--dtg-bg-secondary)',
          border: '1px solid var(--dtg-border-medium)',
          fontSize: '0.8125rem',
        }}
      >
        <span
          style={{
            fontWeight: 600,
            color: 'var(--dtg-text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            fontSize: '0.75rem',
          }}
        >
          Onset of Failure:
        </span>
        <span
          style={{
            color: onsetRaw
              ? 'var(--dtg-brand-orange, #e67e22)'
              : 'var(--dtg-text-secondary)',
            fontWeight: onsetRaw ? 600 : 400,
          }}
        >
          {onsetDisplay}
        </span>
      </div>

      {/* ── Editable stage table (Requirement 6.1) ── */}
      {editedWindows.length === 0 ? (
        <p
          style={{
            fontSize: '0.8125rem',
            color: 'var(--dtg-text-secondary)',
            fontStyle: 'italic',
            margin: 0,
          }}
        >
          No phase windows available.
        </p>
      ) : (
        <div
          style={{
            overflowX: 'auto',
            borderRadius: '8px',
            border: '1px solid var(--dtg-border-medium)',
          }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              background: 'var(--dtg-bg-card)',
              fontSize: '0.8125rem',
            }}
          >
            <thead>
              <tr>
                <th style={{ ...headerCellStyle, textAlign: 'left' }}>Stage</th>
                <th style={{ ...headerCellStyle, textAlign: 'left' }}>Start</th>
                <th style={{ ...headerCellStyle, textAlign: 'left' }}>End</th>
                <th style={{ ...headerCellStyle, textAlign: 'left' }}>Duration</th>
              </tr>
            </thead>
            <tbody>
              {editedWindows.map((window, index) => (
                <tr
                  key={index}
                  style={{
                    background:
                      index % 2 === 0
                        ? 'var(--dtg-bg-card)'
                        : 'var(--dtg-bg-secondary)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background =
                      index % 2 === 0
                        ? 'var(--dtg-bg-card)'
                        : 'var(--dtg-bg-secondary)';
                  }}
                >
                  {/* Stage label dropdown (editable) */}
                  <td style={{ ...cellStyle, minWidth: '200px' }}>
                    <select
                      value={window.phase}
                      onChange={(e) => handlePhaseChange(index, e.target.value)}
                      aria-label={`Stage label for row ${index + 1}`}
                      style={{
                        padding: '5px 8px',
                        borderRadius: '6px',
                        border: '1px solid var(--dtg-border-medium)',
                        background: 'var(--dtg-bg-secondary)',
                        color: 'var(--dtg-text-primary)',
                        fontSize: '0.8125rem',
                        cursor: 'pointer',
                        outline: 'none',
                        width: '100%',
                        maxWidth: '220px',
                      }}
                    >
                      {STAGE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {displayPhase(option, pfConfirmed)}
                        </option>
                      ))}
                    </select>
                  </td>

                  {/* Start time (read-only, ISO 8601 local) */}
                  <td style={cellStyle}>
                    <span style={{ color: 'var(--dtg-text-secondary)' }}>
                      {window.start || '—'}
                    </span>
                  </td>

                  {/* End time (read-only, ISO 8601 local) */}
                  <td style={cellStyle}>
                    <span style={{ color: 'var(--dtg-text-secondary)' }}>
                      {window.end || '—'}
                    </span>
                  </td>

                  {/* Duration (read-only, "Xd Yh Zm") */}
                  <td style={cellStyle}>
                    <span style={{ color: 'var(--dtg-text-secondary)' }}>
                      {window.duration || '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Action buttons (Requirements 6.3, 6.4) ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          flexWrap: 'wrap',
        }}
      >
        {/* Apply Stage Labels — orange/primary style, disabled while isApplyingStages */}
        <button
          type="button"
          onClick={handleApply}
          disabled={isApplyingStages || isResettingStages}
          aria-busy={isApplyingStages}
          style={{
            padding: '8px 18px',
            borderRadius: '6px',
            border: 'none',
            background:
              isApplyingStages || isResettingStages
                ? 'rgba(230, 126, 34, 0.4)'
                : 'var(--dtg-brand-orange, #e67e22)',
            color: '#fff',
            fontSize: '0.875rem',
            fontWeight: 600,
            cursor:
              isApplyingStages || isResettingStages ? 'not-allowed' : 'pointer',
            opacity: isApplyingStages || isResettingStages ? 0.6 : 1,
            transition: 'opacity 0.15s, background 0.15s',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
          onMouseEnter={(e) => {
            if (!isApplyingStages && !isResettingStages) {
              e.currentTarget.style.opacity = '0.85';
            }
          }}
          onMouseLeave={(e) => {
            if (!isApplyingStages && !isResettingStages) {
              e.currentTarget.style.opacity = '1';
            }
          }}
        >
          {isApplyingStages && (
            <span
              aria-hidden="true"
              style={{
                display: 'inline-block',
                width: '12px',
                height: '12px',
                border: '2px solid rgba(255,255,255,0.4)',
                borderTopColor: '#fff',
                borderRadius: '50%',
                animation: 'spin 0.7s linear infinite',
              }}
            />
          )}
          Apply Stage Labels
        </button>

        {/* Reset to Auto — secondary style, disabled while isResettingStages */}
        <button
          type="button"
          onClick={handleReset}
          disabled={isApplyingStages || isResettingStages}
          aria-busy={isResettingStages}
          style={{
            padding: '8px 18px',
            borderRadius: '6px',
            border: '1px solid var(--dtg-border-medium)',
            background: 'transparent',
            color: 'var(--dtg-text-primary)',
            fontSize: '0.875rem',
            fontWeight: 500,
            cursor:
              isApplyingStages || isResettingStages ? 'not-allowed' : 'pointer',
            opacity: isApplyingStages || isResettingStages ? 0.5 : 1,
            transition: 'opacity 0.15s, background 0.15s',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
          onMouseEnter={(e) => {
            if (!isApplyingStages && !isResettingStages) {
              e.currentTarget.style.background = 'var(--dtg-bg-secondary)';
            }
          }}
          onMouseLeave={(e) => {
            if (!isApplyingStages && !isResettingStages) {
              e.currentTarget.style.background = 'transparent';
            }
          }}
        >
          {isResettingStages && (
            <span
              aria-hidden="true"
              style={{
                display: 'inline-block',
                width: '12px',
                height: '12px',
                border: '2px solid rgba(255,255,255,0.2)',
                borderTopColor: 'var(--dtg-text-primary)',
                borderRadius: '50%',
                animation: 'spin 0.7s linear infinite',
              }}
            />
          )}
          Reset to Auto
        </button>
      </div>

      {/* ── Spinner keyframe (injected once via a style tag) ── */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
