'use client';

/**
 * VCPSummaryTable
 *
 * Renders a summary table with one row per VCP, showing onset of failure,
 * Fukuzono predicted time, SLO predicted time, and IV R².
 *
 * The Longest VCP row is highlighted with a distinct background colour
 * (--dtg-brand-orange at 15% opacity).
 *
 * When no VCP has a Progressive Failure stage, an informational message is
 * displayed instead of the table.
 *
 * Props:
 *   vcpResults        {VCPResult[]}  - Array of VCP result objects from the analysis API
 *   longestVcpName    {string|null}  - Name of the Longest VCP (highlighted row)
 *   forecastingEnabled {boolean}     - When false, Fukuzono and SLO columns are hidden
 *
 * VCPResult shape (relevant fields):
 *   {
 *     vcpName: string,
 *     onsetOfFailure: string | null,          // ISO 8601 string
 *     fukuzono: {
 *       predictedFailureTime: string | null,
 *       r2: number | null,
 *     } | null,
 *     slo: { predictedFailureTime: string | null } | null,
 *     windows: [{ phase: string, ... }],
 *   }
 *
 * Requirements: 10.3, 10.4, 10.5
 */

/** Returns true if the VCP has at least one Progressive Failure window. */
function hasProgressiveFailure(vcpResult) {
  return (
    Array.isArray(vcpResult.windows) &&
    vcpResult.windows.some((w) => w.phase === 'Progressive Failure')
  );
}

/** Formats a nullable value with a fallback of "N/A". */
function fmt(value, formatter) {
  if (value == null) return 'N/A';
  return formatter ? formatter(value) : String(value);
}

/** Formats a number to 2 decimal places. */
function fmtR2(value) {
  if (value == null) return 'N/A';
  return Number(value).toFixed(2);
}

/**
 * Forecast error in hours: predicted − actual. Positive = predicted later than
 * actual. Both are parsed locally (consistent), so the difference is correct.
 */
function fmtErrorHours(predictedIso, actualLocal) {
  if (!predictedIso || !actualLocal) return 'N/A';
  const p = new Date(predictedIso).getTime();
  const a = new Date(actualLocal).getTime();
  if (Number.isNaN(p) || Number.isNaN(a)) return 'N/A';
  const hours = (p - a) / 3_600_000;
  return `${hours >= 0 ? '+' : ''}${hours.toFixed(2)}`;
}

// ── Shared cell style ─────────────────────────────────────────────────────────

const cellStyle = {
  padding: '8px 12px',
  borderBottom: '1px solid var(--dtg-border-medium)',
  fontSize: '0.8125rem',
  color: 'var(--dtg-text-primary)',
  whiteSpace: 'nowrap',
};

const headerCellStyle = {
  ...cellStyle,
  fontWeight: 600,
  fontSize: '0.75rem',
  color: 'var(--dtg-text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  background: 'var(--dtg-bg-card)',
  borderBottom: '2px solid var(--dtg-border-medium)',
};

// ── Main component ────────────────────────────────────────────────────────────

/**
 * VCPSummaryTable
 *
 * Requirements: 10.3, 10.4, 10.5
 */
export default function VCPSummaryTable({
  vcpResults,
  longestVcpName,
  forecastingEnabled,
  actualFailureTime = '',
  pfConfirmed = false,
}) {
  const pfTerm = pfConfirmed ? 'Progressive Failure' : 'Progressive';
  // Guard: no results
  if (!Array.isArray(vcpResults) || vcpResults.length === 0) {
    return null;
  }

  // Requirement 10.5: check if any VCP has a Progressive Failure stage
  const anyProgressiveFailure = vcpResults.some(hasProgressiveFailure);

  if (!anyProgressiveFailure) {
    return (
      <div
        style={{
          padding: '16px',
          borderRadius: '8px',
          border: '1px solid var(--dtg-border-medium)',
          background: 'var(--dtg-bg-card)',
          color: 'var(--dtg-text-secondary)',
          fontSize: '0.875rem',
          textAlign: 'center',
        }}
        role="status"
        aria-live="polite"
      >
        No {pfTerm} detected across all VCPs
      </div>
    );
  }

  return (
    <div
      style={{
        border: '1px solid var(--dtg-border-medium)',
        borderRadius: '8px',
        background: 'var(--dtg-bg-card)',
        overflow: 'hidden',
      }}
    >
      {/* Section heading */}
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--dtg-border-medium)',
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: '0.875rem',
            fontWeight: 600,
            color: 'var(--dtg-text-primary)',
          }}
        >
          VCP Summary
        </h3>
      </div>

      {/* Scrollable table wrapper */}
      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            tableLayout: 'auto',
          }}
          aria-label="VCP summary table"
        >
          <thead>
            <tr>
              <th scope="col" style={headerCellStyle}>
                VCP Name
              </th>
              <th scope="col" style={headerCellStyle}>
                Onset of Failure
              </th>
              {/* Requirement 10.3: hide forecasting columns when disabled */}
              {forecastingEnabled && (
                <th scope="col" style={headerCellStyle}>
                  Fukuzono Predicted
                </th>
              )}
              {forecastingEnabled && (
                <th scope="col" style={{ ...headerCellStyle, textAlign: 'right' }}>
                  IV Error (h)
                </th>
              )}
              {forecastingEnabled && (
                <th scope="col" style={headerCellStyle}>
                  SLO Predicted
                </th>
              )}
              {forecastingEnabled && (
                <th scope="col" style={{ ...headerCellStyle, textAlign: 'right' }}>
                  SLO Error (h)
                </th>
              )}
              <th scope="col" style={{ ...headerCellStyle, textAlign: 'right' }}>
                IV R²
              </th>
            </tr>
          </thead>
          <tbody>
            {vcpResults.map((vcp) => {
              // Requirement 10.4: highlight the Longest VCP row
              const isLongest = vcp.vcpName === longestVcpName;
              const rowStyle = {
                background: isLongest
                  ? 'rgba(230, 126, 34, 0.15)'
                  : 'transparent',
              };

              return (
                <tr key={vcp.vcpName} style={rowStyle}>
                  {/* VCP Name */}
                  <td style={cellStyle}>
                    <span
                      style={{
                        fontWeight: isLongest ? 600 : 400,
                        color: isLongest
                          ? 'var(--dtg-text-primary)'
                          : 'var(--dtg-text-primary)',
                      }}
                    >
                      {vcp.vcpName}
                    </span>
                    {isLongest && (
                      <span
                        style={{
                          marginLeft: '6px',
                          fontSize: '0.7rem',
                          color: 'rgba(230, 126, 34, 0.9)',
                          fontWeight: 500,
                        }}
                        title="VCP used to fill the form"
                        aria-label="Selected VCP"
                      >
                        ★
                      </span>
                    )}
                  </td>

                  {/* Onset of Failure */}
                  <td style={cellStyle}>
                    {fmt(vcp.onsetOfFailure)}
                  </td>

                  {/* Fukuzono Predicted (hidden when forecasting disabled) */}
                  {forecastingEnabled && (
                    <td style={cellStyle}>
                      {fmt(vcp.fukuzono?.predictedFailureTime)}
                    </td>
                  )}

                  {/* IV forecast error (h) vs actual failure time */}
                  {forecastingEnabled && (
                    <td style={{ ...cellStyle, textAlign: 'right' }}>
                      {fmtErrorHours(vcp.fukuzono?.predictedFailureTime, actualFailureTime)}
                    </td>
                  )}

                  {/* SLO Predicted (hidden when forecasting disabled) */}
                  {forecastingEnabled && (
                    <td style={cellStyle}>
                      {fmt(vcp.slo?.predictedFailureTime)}
                    </td>
                  )}

                  {/* SLO forecast error (h) vs actual failure time */}
                  {forecastingEnabled && (
                    <td style={{ ...cellStyle, textAlign: 'right' }}>
                      {fmtErrorHours(vcp.slo?.predictedFailureTime, actualFailureTime)}
                    </td>
                  )}

                  {/* IV R² */}
                  <td style={{ ...cellStyle, textAlign: 'right' }}>
                    {fmtR2(vcp.fukuzono?.r2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
