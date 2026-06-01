'use client';

import { displayPhase } from '@/utils/stageBoundaries';

/**
 * StageSummaryTable
 *
 * Renders the per-stage statistics table for pattern recognition results.
 * Displays one row per stage window across all VCPs, with min/max/Δ statistics
 * for deformation, velocity, and inverse velocity.
 *
 * Props:
 *   stageSummaryRows  {StageSummaryRow[]} - Array of stage summary row objects.
 *                                           Pass an empty array or null/undefined
 *                                           to show the empty state message.
 *
 * StageSummaryRow shape:
 *   {
 *     VCP: string,
 *     Stage: string,
 *     Start: string,
 *     End: string,
 *     Duration: string,
 *     "Deformation min (mm)": number | null,
 *     "Deformation max (mm)": number | null,
 *     "Deformation Δ (mm)": number | null,
 *     "Velocity min (mm/day)": number | null,
 *     "Velocity max (mm/day)": number | null,
 *     "Velocity Δ (mm/day)": number | null,
 *     "Inv. Velocity min (day/mm)": number | null,
 *     "Inv. Velocity max (day/mm)": number | null,
 *     "Inv. Velocity Δ (day/mm)": number | null,
 *   }
 *
 * Requirements: 5.2
 */

/**
 * Column definitions — order matches the StageSummaryRow keys exactly.
 *
 * `key` always references the canonical mm/day / day-per-mm field (the data is
 * stored in those units so the auto-fill mapper keeps working). Columns with a
 * `kind` are re-labelled and value-converted for display when the active VCP's
 * window is sub-daily (velocity → mm/h, inverse velocity → h/mm).
 */
const COLUMNS = [
  { key: 'VCP',                           label: 'VCP',                  numeric: false },
  { key: 'Stage',                         label: 'Stage',                numeric: false },
  { key: 'Start',                         label: 'Start',                numeric: false },
  { key: 'End',                           label: 'End',                  numeric: false },
  { key: 'Duration',                      label: 'Duration',             numeric: false },
  { key: 'Deformation min (mm)',          label: 'Deformation min (mm)', numeric: true  },
  { key: 'Deformation max (mm)',          label: 'Deformation max (mm)', numeric: true  },
  { key: 'Deformation Δ (mm)',            label: 'Deformation Δ (mm)',   numeric: true  },
  { key: 'Velocity min (mm/day)',         base: 'Velocity min',          kind: 'velocity', numeric: true },
  { key: 'Velocity max (mm/day)',         base: 'Velocity max',          kind: 'velocity', numeric: true },
  { key: 'Velocity Δ (mm/day)',           base: 'Velocity Δ',            kind: 'velocity', numeric: true },
  { key: 'Inv. Velocity min (day/mm)',    base: 'Inv. Velocity min',     kind: 'inverse',  numeric: true },
  { key: 'Inv. Velocity max (day/mm)',    base: 'Inv. Velocity max',     kind: 'inverse',  numeric: true },
  { key: 'Inv. Velocity Δ (day/mm)',      base: 'Inv. Velocity Δ',       kind: 'inverse',  numeric: true },
];

/** Display unit + value multiplier for a convertible column, given the mode. */
function unitInfo(kind, isMmH) {
  if (kind === 'velocity') return { unit: isMmH ? 'mm/h' : 'mm/day', factor: isMmH ? 1 / 24 : 1 };
  if (kind === 'inverse') return { unit: isMmH ? 'h/mm' : 'day/mm', factor: isMmH ? 24 : 1 };
  return { unit: '', factor: 1 };
}

/** Header label — base name for convertible columns (unit shown per cell). */
function columnLabel(col) {
  return col.kind ? col.base : col.label;
}

/**
 * Format a cell value for display. Convertible columns are converted to the
 * row's VCP unit and suffixed with that unit (different VCPs may differ).
 * - null / undefined / NaN → "N/A"
 * - numeric values → 3 decimal places
 */
function formatCell(col, row, pfConfirmed) {
  const raw = row[col.key];
  if (raw === null || raw === undefined) return 'N/A';
  // Stage label respects the "Progressive" → "Progressive Failure" gate (issue 3).
  if (col.key === 'Stage') return displayPhase(String(raw), pfConfirmed);
  if (!col.numeric) return String(raw);
  const n = Number(raw);
  if (Number.isNaN(n)) return 'N/A';
  if (col.kind) {
    const info = unitInfo(col.kind, row.__velocityUnit === 'mm/h');
    return `${(n * info.factor).toFixed(3)} ${info.unit}`;
  }
  return n.toFixed(3);
}

// ── Styles (inline, using CSS variables) ─────────────────────────────────────

const headerCellStyle = {
  padding: '8px 12px',
  textAlign: 'left',
  fontSize: '0.75rem',
  fontWeight: 600,
  color: 'var(--dtg-text-secondary)',
  whiteSpace: 'nowrap',
  borderBottom: '1px solid var(--dtg-border-medium)',
  background: 'var(--dtg-bg-card)',
  position: 'sticky',
  top: 0,
  zIndex: 1,
};

const cellStyle = {
  padding: '7px 12px',
  fontSize: '0.8rem',
  color: 'var(--dtg-text-primary)',
  whiteSpace: 'nowrap',
  borderBottom: '1px solid var(--dtg-border-medium)',
};

// ── Component ─────────────────────────────────────────────────────────────────

const StageSummaryTable = ({ stageSummaryRows, pfConfirmed = false }) => {
  const rows = Array.isArray(stageSummaryRows) ? stageSummaryRows : [];

  // ── Empty state ────────────────────────────────────────────────────────────
  if (rows.length === 0) {
    return (
      <div
        style={{
          padding: '16px',
          borderRadius: '8px',
          border: '1px solid var(--dtg-border-medium)',
          background: 'var(--dtg-bg-card)',
          textAlign: 'center',
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: '0.875rem',
            color: 'var(--dtg-text-secondary)',
            fontStyle: 'italic',
          }}
        >
          No stage data available
        </p>
      </div>
    );
  }

  // ── Table ──────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        overflowX: 'auto',
        borderRadius: '8px',
        border: '1px solid var(--dtg-border-medium)',
        background: 'var(--dtg-bg-card)',
      }}
    >
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          tableLayout: 'auto',
        }}
        aria-label="Stage summary statistics"
      >
        {/* ── Column headers ── */}
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th key={col.key} scope="col" style={headerCellStyle}>
                {columnLabel(col)}
              </th>
            ))}
          </tr>
        </thead>

        {/* ── Data rows ── */}
        <tbody>
          {rows.map((row, rowIndex) => {
            // Alternating row background for readability
            const rowBackground =
              rowIndex % 2 === 0
                ? 'transparent'
                : 'rgba(255, 255, 255, 0.03)';

            return (
              <tr
                key={rowIndex}
                style={{ background: rowBackground }}
              >
                {COLUMNS.map((col) => (
                  <td key={col.key} style={cellStyle}>
                    {formatCell(col, row, pfConfirmed)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default StageSummaryTable;
