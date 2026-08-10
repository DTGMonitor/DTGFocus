'use client';

/**
 * Daily Radar Report — title band and the four status cards beneath it.
 *
 * Not `HeaderBlock`: that header is a logo, a title and a pipe-separated meta
 * row on white, and this one is a dark band carrying the client's own logo with
 * four tinted status tiles under it. Same page frame, different masthead.
 *
 * Both are block index 0 of their report, so they print on page 1 only.
 *
 * Colours are inline hex throughout — html2canvas 1.x resolves neither CSS
 * custom properties nor Tailwind classes and rasterizes them as transparent.
 */

import { HEADER_GRADIENT, INK, MUTED, LINE, FALLBACK_LOGO } from '../constants';
import { bandColor, severityColor, severityTextColor } from '../severity';

/**
 * The Data Update card's editor.
 *
 * A `datetime-local` sitting where the value will print, so the analyst fills
 * the card in on the page rather than in a panel above it. The value is the
 * SITE's wall clock — every consumer (`isDataUpdateLate`, `formatDataUpdate`)
 * reads it component-wise for that reason, so it must NOT be converted to an
 * instant on the way in.
 *
 * `colorScheme: light` is explicit: the browser paints the native picker's icon
 * from it, and an unset scheme renders a black-on-black glyph for an analyst
 * whose OS is in dark mode — on a card that is always white paper.
 */
function DataUpdateInput({ value, onChange, late, ariaLabel }) {
  const filled = Boolean(String(value ?? '').trim());
  return (
    <input
      type="datetime-local"
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
      aria-label={ariaLabel}
      style={{
        width: '100%',
        fontSize: 12,
        fontWeight: 800,
        fontFamily: 'inherit',
        color: late ? severityColor('critical').color : INK,
        background: filled ? 'transparent' : '#fffbe6',
        border: 'none',
        borderBottom: filled ? `1px solid ${LINE}` : '1px dashed #d97706',
        padding: 0,
        outline: 'none',
        colorScheme: 'light',
      }}
    />
  );
}

/** One of the four cards. `tone` tints the border and the value. */
function StatusCard({ label, value, sub, tone, valueColor }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        border: `1px solid ${tone ?? LINE}`,
        borderLeft: `5px solid ${tone ?? LINE}`,
        background: '#fff',
        padding: '6px 9px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        minHeight: 46,
      }}
    >
      <div
        style={{
          fontSize: 8,
          color: MUTED,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 13, fontWeight: 800, color: valueColor ?? INK, lineHeight: 1.15, minWidth: 0 }}>
        {value}
      </div>
      {sub ? <div style={{ fontSize: 8, color: MUTED, fontWeight: 600 }}>{sub}</div> : null}
    </div>
  );
}

/**
 * @param {string} title       "LAPORAN HARIAN - RADAR" — the localised stem.
 * @param {string} radarNumber Appended to the title, as the printed report does.
 * @param {string} company     Printed under the title.
 * @param {string} logoSrc     The CLIENT's full logo (see resolveCompanyLogo).
 *   A data URL on the export path — html2canvas cannot fetch mid-capture.
 * @param {Function} onLogoError  Swaps to the LogoOnly variant when the client
 *   has no FullLogo asset. Passed in rather than handled here so the same
 *   fallback applies to the export render, which resolves the URL up front.
 * @param {object} strings     dailyStrings(locale).
 * @param {object} cards       { date, dataUpdate, dataUpdateLate, quality, risk }
 *   `risk` is a RiskPresentation; `quality` is the DQP label.
 * @param {Function} onImageLoad  bumpMeasure — the header mis-measures without it.
 * @param {boolean} editable   Type the Data Update stamp onto the card itself.
 *   False on the export render and the measurement layer.
 * @param {string} dataUpdateValue  The raw datetime-local value, for the editor.
 *   `cards.dataUpdate` is the FORMATTED string and cannot be fed back to an
 *   input — the two are deliberately separate.
 * @param {Function} onDataUpdateChange
 */
export function DailyHeader({
  title,
  radarNumber,
  company,
  logoSrc = FALLBACK_LOGO,
  onLogoError,
  strings,
  cards,
  onImageLoad,
  editable = false,
  dataUpdateValue,
  onDataUpdateChange,
}) {
  const risk = cards?.risk ?? null;
  const riskTone = risk ? bandColor(risk.colour).color : MUTED;
  const qualityTone = severityColor(cards?.quality).color;

  return (
    <div>
      <div
        style={{
          background: HEADER_GRADIENT,
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 19,
              fontWeight: 800,
              color: '#fff',
              letterSpacing: '0.01em',
              textTransform: 'uppercase',
            }}
          >
            {title} {radarNumber || ''}
          </div>
          {/* Both lines are white. The company used to be the pale teal that now
              ENDS the gradient, which would have left it near-invisible on its
              own background at the light end of a short band. */}
          <div style={{ fontSize: 10, color: '#e2f1f0', fontWeight: 600, marginTop: 2 }}>
            {company || '—'}
          </div>
        </div>
        <img
          src={logoSrc}
          alt="Client"
          crossOrigin="anonymous"
          onLoad={onImageLoad}
          onError={onLogoError}
          style={{ height: 40, maxWidth: 150, objectFit: 'contain', flexShrink: 0 }}
        />
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <StatusCard label={strings.cardDate} value={cards?.date ?? '—'} tone={MUTED} />
        <StatusCard
          label={strings.cardDataUpdate}
          value={
            editable ? (
              <DataUpdateInput
                value={dataUpdateValue}
                onChange={onDataUpdateChange}
                late={cards?.dataUpdateLate}
                ariaLabel={strings.cardDataUpdate}
              />
            ) : (
              cards?.dataUpdate || '—'
            )
          }
          // Red states one thing only: the data behind this report is older than
          // the site's deadline allows. Black is not "on time" so much as "no
          // reason to flag" — see isDataUpdateLate, which refuses to judge what
          // it cannot establish.
          tone={cards?.dataUpdateLate ? severityColor('critical').color : MUTED}
          valueColor={cards?.dataUpdateLate ? severityColor('critical').color : INK}
        />
        <StatusCard
          label={strings.cardDataQuality}
          value={cards?.quality || '—'}
          tone={qualityTone}
          valueColor={severityTextColor(qualityTone)}
        />
        <StatusCard
          label={strings.cardRisk}
          value={risk?.label || '—'}
          sub={risk?.subtitle || ''}
          tone={riskTone}
          valueColor={severityTextColor(riskTone)}
        />
      </div>
    </div>
  );
}

export default DailyHeader;
