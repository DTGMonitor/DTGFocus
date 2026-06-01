import { useState, useEffect, useCallback } from 'react';

/**
 * Default analysis parameter values.
 * Exported so parent components (e.g. PatternRecognitionPopup) can initialise
 * their `params` state without duplicating the defaults.
 */
export const DEFAULT_PARAMS = {
  smoothingWindow: 7,
  r2WarningThreshold: 0.80,
  fukuzonoTailFraction: 0.20,
  ivR2Threshold: 0.75,
  longSmoothWindow: 24,
  vLowFrac: 0.03,
  aMultiplier: 2.5,
  minSegmentPts: 12,
  enableForecasting: true,
  enableFukuzono: true,
  enableSloGradient: false,
  sloRollingWindow: 5,
  sloCriticalThreshold: 50.0,
  sloTailFraction: 0.30,
  sloR2WarningThreshold: 0.70,
};

// ── Validation rules ──────────────────────────────────────────────────────────

/**
 * Returns an error string if the value is out of range, or null if valid.
 * `vLowFrac` is stored as a decimal (0.01–0.30) but displayed as a percentage.
 */
function validateParam(key, value) {
  const n = Number(value);

  if (value === '' || value === null || value === undefined || Number.isNaN(n)) {
    return 'Required';
  }

  switch (key) {
    case 'smoothingWindow':
      if (!Number.isInteger(n) || n < 1) return 'Must be an integer ≥ 1';
      break;
    case 'r2WarningThreshold':
      if (n < 0.0 || n > 1.0) return 'Must be between 0.0 and 1.0';
      break;
    case 'fukuzonoTailFraction':
      if (n < 0.01 || n > 0.50) return 'Must be between 0.01 and 0.50';
      break;
    case 'ivR2Threshold':
      if (n < 0.50 || n > 0.99) return 'Must be between 0.50 and 0.99';
      break;
    case 'longSmoothWindow':
      if (!Number.isInteger(n) || n < 3 || n > 200) return 'Must be an integer between 3 and 200';
      break;
    case 'vLowFrac':
      // Stored as decimal; display input is in percent (1–30%)
      if (n < 0.01 || n > 0.30) return 'Must be between 1% and 30%';
      break;
    case 'aMultiplier':
      if (n < 1.0 || n > 10.0) return 'Must be between 1.0 and 10.0';
      break;
    case 'minSegmentPts':
      if (!Number.isInteger(n) || n < 2 || n > 100) return 'Must be an integer between 2 and 100';
      break;
    case 'sloRollingWindow':
      if (!Number.isInteger(n) || n < 3 || n > 50) return 'Must be an integer between 3 and 50';
      break;
    case 'sloCriticalThreshold':
      if (n < 0.1 || n > 10000.0) return 'Must be between 0.1 and 10000.0';
      break;
    case 'sloTailFraction':
      if (n < 0.01 || n > 1.0) return 'Must be between 0.01 and 1.0';
      break;
    case 'sloR2WarningThreshold':
      if (n < 0.0 || n > 1.0) return 'Must be between 0.0 and 1.0';
      break;
    default:
      break;
  }

  return null;
}

// ── Shared styles ─────────────────────────────────────────────────────────────

/** Section subtitle (method grouping header). */
const sectionTitleStyle = {
  fontSize: '0.75rem',
  fontWeight: 700,
  color: 'var(--dtg-text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  margin: '0 0 8px',
};

// ── Sub-components ────────────────────────────────────────────────────────────

/**
 * A single numeric parameter row: label + input + optional inline error.
 */
function NumericField({ label, fieldKey, value, onChange, error, step, min, max, hint }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <label
        htmlFor={`param-${fieldKey}`}
        style={{
          fontSize: '0.75rem',
          fontWeight: 500,
          color: 'var(--dtg-text-secondary)',
          userSelect: 'none',
        }}
      >
        {label}
        {hint && (
          <span style={{ marginLeft: '4px', fontWeight: 400, opacity: 0.75 }}>({hint})</span>
        )}
      </label>
      <input
        id={`param-${fieldKey}`}
        type="number"
        value={value}
        step={step ?? 'any'}
        min={min}
        max={max}
        onChange={(e) => onChange(fieldKey, e.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `param-${fieldKey}-error` : undefined}
        style={{
          padding: '6px 8px',
          borderRadius: '6px',
          border: `1px solid ${error ? '#ef4444' : 'var(--dtg-border-medium)'}`,
          background: 'var(--dtg-bg-secondary)',
          color: 'var(--dtg-text-primary)',
          fontSize: '0.875rem',
          outline: 'none',
          width: '100%',
          boxSizing: 'border-box',
        }}
      />
      {error && (
        <span
          id={`param-${fieldKey}-error`}
          role="alert"
          style={{ fontSize: '0.7rem', color: '#ef4444', marginTop: '2px' }}
        >
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * A toggle (checkbox) row: label + checkbox.
 */
function ToggleField({ label, fieldKey, checked, onChange }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '6px 0',
      }}
    >
      <input
        id={`param-${fieldKey}`}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(fieldKey, e.target.checked)}
        style={{
          width: '16px',
          height: '16px',
          accentColor: 'var(--dtg-brand-orange, #e67e22)',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      />
      <label
        htmlFor={`param-${fieldKey}`}
        style={{
          fontSize: '0.875rem',
          color: 'var(--dtg-text-primary)',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        {label}
      </label>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * AnalysisParametersPanel
 *
 * Collapsible panel that renders all analysis parameters with validation.
 *
 * Props:
 *   params              {object}   - Current parameter values (use DEFAULT_PARAMS as initial state)
 *   onParamsChange      {function} - Called with the full updated params object on any change
 *   onValidationChange  {function} - Called with a boolean `hasErrors` whenever validation state changes
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
 */
export default function AnalysisParametersPanel({ params, onParamsChange, onValidationChange }) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Raw display values for numeric fields (strings while user is typing)
  // vLowFrac is stored as decimal but displayed as percent
  const [displayValues, setDisplayValues] = useState(() => ({
    smoothingWindow: String(params.smoothingWindow ?? DEFAULT_PARAMS.smoothingWindow),
    r2WarningThreshold: String(params.r2WarningThreshold ?? DEFAULT_PARAMS.r2WarningThreshold),
    fukuzonoTailFraction: String(params.fukuzonoTailFraction ?? DEFAULT_PARAMS.fukuzonoTailFraction),
    ivR2Threshold: String(params.ivR2Threshold ?? DEFAULT_PARAMS.ivR2Threshold),
    longSmoothWindow: String(params.longSmoothWindow ?? DEFAULT_PARAMS.longSmoothWindow),
    vLowFrac: String(
      Math.round((params.vLowFrac ?? DEFAULT_PARAMS.vLowFrac) * 100 * 1e9) / 1e9
    ), // decimal → percent for display
    aMultiplier: String(params.aMultiplier ?? DEFAULT_PARAMS.aMultiplier),
    minSegmentPts: String(params.minSegmentPts ?? DEFAULT_PARAMS.minSegmentPts),
    sloRollingWindow: String(params.sloRollingWindow ?? DEFAULT_PARAMS.sloRollingWindow),
    sloCriticalThreshold: String(params.sloCriticalThreshold ?? DEFAULT_PARAMS.sloCriticalThreshold),
    sloTailFraction: String(params.sloTailFraction ?? DEFAULT_PARAMS.sloTailFraction),
    sloR2WarningThreshold: String(params.sloR2WarningThreshold ?? DEFAULT_PARAMS.sloR2WarningThreshold),
  }));

  const [errors, setErrors] = useState({});

  // Sync displayValues when params prop changes externally (e.g. reset to defaults)
  useEffect(() => {
    setDisplayValues({
      smoothingWindow: String(params.smoothingWindow ?? DEFAULT_PARAMS.smoothingWindow),
      r2WarningThreshold: String(params.r2WarningThreshold ?? DEFAULT_PARAMS.r2WarningThreshold),
      fukuzonoTailFraction: String(params.fukuzonoTailFraction ?? DEFAULT_PARAMS.fukuzonoTailFraction),
      ivR2Threshold: String(params.ivR2Threshold ?? DEFAULT_PARAMS.ivR2Threshold),
      longSmoothWindow: String(params.longSmoothWindow ?? DEFAULT_PARAMS.longSmoothWindow),
      vLowFrac: String(
        Math.round((params.vLowFrac ?? DEFAULT_PARAMS.vLowFrac) * 100 * 1e9) / 1e9
      ),
      aMultiplier: String(params.aMultiplier ?? DEFAULT_PARAMS.aMultiplier),
      minSegmentPts: String(params.minSegmentPts ?? DEFAULT_PARAMS.minSegmentPts),
      sloRollingWindow: String(params.sloRollingWindow ?? DEFAULT_PARAMS.sloRollingWindow),
      sloCriticalThreshold: String(params.sloCriticalThreshold ?? DEFAULT_PARAMS.sloCriticalThreshold),
      sloTailFraction: String(params.sloTailFraction ?? DEFAULT_PARAMS.sloTailFraction),
      sloR2WarningThreshold: String(params.sloR2WarningThreshold ?? DEFAULT_PARAMS.sloR2WarningThreshold),
    });
  }, [params]);

  // Notify parent whenever errors change
  useEffect(() => {
    const hasErrors = Object.values(errors).some(Boolean);
    onValidationChange?.(hasErrors);
  }, [errors, onValidationChange]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleNumericChange = useCallback(
    (key, rawValue) => {
      // Update display value immediately (allows free typing)
      setDisplayValues((prev) => ({ ...prev, [key]: rawValue }));

      // For vLowFrac the user types a percentage; convert to decimal for storage/validation
      let storedValue = rawValue;
      if (key === 'vLowFrac') {
        const pct = parseFloat(rawValue);
        storedValue = Number.isNaN(pct) ? rawValue : String(pct / 100);
      }

      // Validate
      const error = validateParam(key, key === 'vLowFrac' ? storedValue : rawValue);
      setErrors((prev) => ({ ...prev, [key]: error }));

      // Propagate to parent only when valid
      if (!error) {
        const numericKeys = [
          'smoothingWindow', 'longSmoothWindow', 'minSegmentPts', 'sloRollingWindow',
        ];
        const parsedValue = numericKeys.includes(key)
          ? parseInt(key === 'vLowFrac' ? storedValue : rawValue, 10)
          : parseFloat(key === 'vLowFrac' ? storedValue : rawValue);

        onParamsChange?.({ ...params, [key]: parsedValue });
      }
    },
    [params, onParamsChange]
  );

  const handleToggleChange = useCallback(
    (key, checked) => {
      onParamsChange?.({ ...params, [key]: checked });
    },
    [params, onParamsChange]
  );

  // ── Render ───────────────────────────────────────────────────────────────────

  const showForecasting = params.enableForecasting ?? DEFAULT_PARAMS.enableForecasting;

  return (
    <div
      style={{
        border: '1px solid var(--dtg-border-medium)',
        borderRadius: '8px',
        background: 'var(--dtg-bg-card)',
        overflow: 'hidden',
      }}
    >
      {/* ── Header / toggle button ─────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        aria-expanded={isExpanded}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: '10px 14px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--dtg-text-primary)',
          fontSize: '0.9rem',
          fontWeight: 600,
          textAlign: 'left',
        }}
      >
        <span>Analysis Parameters</span>
        <span aria-hidden="true" style={{ fontSize: '0.75rem', opacity: 0.7 }}>
          {isExpanded ? '▲' : '▼'}
        </span>
      </button>

      {/* ── Collapsible body ──────────────────────────────────────────────── */}
      {isExpanded && (
        <div
          style={{
            padding: '12px 14px 16px',
            borderTop: '1px solid var(--dtg-border-medium)',
          }}
        >
          {/* ── Classification parameters (2-column grid) ───────────────── */}
          <p style={sectionTitleStyle}>Classification</p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '12px 16px',
              marginBottom: '12px',
            }}
          >
            <NumericField
              label="Smoothing Window"
              fieldKey="smoothingWindow"
              value={displayValues.smoothingWindow}
              onChange={handleNumericChange}
              error={errors.smoothingWindow}
              step={1}
              min={1}
              hint="minutes"
            />
            <NumericField
              label="Long Smoothing Window"
              fieldKey="longSmoothWindow"
              value={displayValues.longSmoothWindow}
              onChange={handleNumericChange}
              error={errors.longSmoothWindow}
              step={1}
              min={3}
              max={200}
              hint="readings"
            />
            <NumericField
              label="IV Onset R² Threshold"
              fieldKey="ivR2Threshold"
              value={displayValues.ivR2Threshold}
              onChange={handleNumericChange}
              error={errors.ivR2Threshold}
              step={0.01}
              min={0.5}
              max={0.99}
            />
            <NumericField
              label="Velocity Threshold"
              fieldKey="vLowFrac"
              value={displayValues.vLowFrac}
              onChange={handleNumericChange}
              error={errors.vLowFrac}
              step={0.1}
              min={1}
              max={30}
              hint="% of peak"
            />
            <NumericField
              label="Acceleration Multiplier"
              fieldKey="aMultiplier"
              value={displayValues.aMultiplier}
              onChange={handleNumericChange}
              error={errors.aMultiplier}
              step={0.1}
              min={1}
              max={10}
            />
            <NumericField
              label="Minimum Segment Readings"
              fieldKey="minSegmentPts"
              value={displayValues.minSegmentPts}
              onChange={handleNumericChange}
              error={errors.minSegmentPts}
              step={1}
              min={2}
              max={100}
            />
          </div>

          {/* ── Forecasting toggle (full-width row) ──────────────────────── */}
          <div
            style={{
              borderTop: '1px solid var(--dtg-border-medium)',
              paddingTop: '10px',
            }}
          >
            <ToggleField
              label="Enable Forecasting"
              fieldKey="enableForecasting"
              checked={showForecasting}
              onChange={handleToggleChange}
            />
          </div>

          {/* ── Fukuzono (Inverse Velocity) — its own params (Req 3.2) ──── */}
          {showForecasting && (
            <div style={{ paddingTop: '10px' }}>
              <p style={sectionTitleStyle}>Fukuzono (Inverse Velocity)</p>
              <ToggleField
                label="Enable Fukuzono"
                fieldKey="enableFukuzono"
                checked={params.enableFukuzono ?? DEFAULT_PARAMS.enableFukuzono}
                onChange={handleToggleChange}
              />
              {(params.enableFukuzono ?? DEFAULT_PARAMS.enableFukuzono) && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: '12px 16px',
                    marginTop: '8px',
                  }}
                >
                  <NumericField
                    label="IV Tail Fraction"
                    fieldKey="fukuzonoTailFraction"
                    value={displayValues.fukuzonoTailFraction}
                    onChange={handleNumericChange}
                    error={errors.fukuzonoTailFraction}
                    step={0.01}
                    min={0.01}
                    max={0.5}
                  />
                  <NumericField
                    label="IV R² Warning Threshold"
                    fieldKey="r2WarningThreshold"
                    value={displayValues.r2WarningThreshold}
                    onChange={handleNumericChange}
                    error={errors.r2WarningThreshold}
                    step={0.01}
                    min={0}
                    max={1}
                  />
                </div>
              )}
            </div>
          )}

          {/* ── SLO Gradient — its own params (Req 3.2) ──────────────────── */}
          {showForecasting && (
            <div
              style={{
                borderTop: '1px solid var(--dtg-border-medium)',
                paddingTop: '10px',
                marginTop: '10px',
              }}
            >
              <p style={sectionTitleStyle}>SLO Gradient</p>
              <ToggleField
                label="Enable SLO Gradient"
                fieldKey="enableSloGradient"
                checked={params.enableSloGradient ?? DEFAULT_PARAMS.enableSloGradient}
                onChange={handleToggleChange}
              />
              {(params.enableSloGradient ?? DEFAULT_PARAMS.enableSloGradient) && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: '12px 16px',
                    marginTop: '8px',
                  }}
                >
                  <NumericField
                    label="SLO Rolling Window"
                    fieldKey="sloRollingWindow"
                    value={displayValues.sloRollingWindow}
                    onChange={handleNumericChange}
                    error={errors.sloRollingWindow}
                    step={1}
                    min={3}
                    max={50}
                    hint="readings"
                  />
                  <NumericField
                    label="SLO Critical Threshold"
                    fieldKey="sloCriticalThreshold"
                    value={displayValues.sloCriticalThreshold}
                    onChange={handleNumericChange}
                    error={errors.sloCriticalThreshold}
                    step={0.1}
                    min={0.1}
                    max={10000}
                    hint="mm/day²"
                  />
                  <NumericField
                    label="SLO Tail Fraction"
                    fieldKey="sloTailFraction"
                    value={displayValues.sloTailFraction}
                    onChange={handleNumericChange}
                    error={errors.sloTailFraction}
                    step={0.01}
                    min={0.01}
                    max={1}
                  />
                  <NumericField
                    label="SLO R² Warning Threshold"
                    fieldKey="sloR2WarningThreshold"
                    value={displayValues.sloR2WarningThreshold}
                    onChange={handleNumericChange}
                    error={errors.sloR2WarningThreshold}
                    step={0.01}
                    min={0}
                    max={1}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
