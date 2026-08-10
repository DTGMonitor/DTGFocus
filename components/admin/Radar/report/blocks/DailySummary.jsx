'use client';

/**
 * Daily Radar Report — the Information Summary panel, the Movement Status
 * table, and the Legend box.
 *
 * The summary's first two lines are NOT written here. "Deformasi Terkini" and
 * "Kualitas Data Terkini" are the Comprehensive report's own verdict sentences
 * (`riskSentence` in config/riskDisplay.ts and `getStatusDefinition().summary`
 * in config/statusConfig.ts), resolved by the caller and passed in. Two DTG
 * documents describing the same day must not describe it differently, and the
 * only way to guarantee that is to share the sentence rather than re-derive it.
 *
 * The remaining three — weather, fog, rainfall — have no source in the system
 * at all. They are observations from site, typed by the analyst.
 */

import { INK, MUTED, LINE, DARK, ZEBRA } from '../constants';
import { SectionBar } from '../pageFrame';
import { bandColor, severityColor, severityTextColor } from '../severity';
import {
  DAILY_QUALITY_TIERS,
  DAILY_TARP_LEVELS,
  qualityActionText,
} from '@/config/dailyReportLocale';

const rowLabel = {
  width: 132,
  flexShrink: 0,
  fontSize: 9,
  fontWeight: 700,
  color: INK,
};

/** One "Label: value" line of the summary panel. */
function SummaryRow({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '3px 0', alignItems: 'flex-start' }}>
      <div style={rowLabel}>{label}:</div>
      <div style={{ flex: 1, minWidth: 0, fontSize: 9, color: INK }}>{children}</div>
    </div>
  );
}

/**
 * An observation the analyst types straight onto the page.
 *
 * Weather, fog and rainfall exist nowhere in the system — they are reported by
 * site — so the report itself is the form. The input is styled to print as the
 * text it will become: same size, same colour, no chrome beyond a dotted rule
 * that says "this is still empty".
 *
 * When `editable` is false (the export render and the hidden measurement layer)
 * it collapses to plain text, so the PDF carries no form controls and the two
 * passes measure the same height.
 */
function EditableValue({ editable, value, placeholder, onChange, ariaLabel }) {
  if (!editable) return <>{value || placeholder}</>;

  const filled = Boolean(String(value ?? '').trim());
  return (
    <input
      type="text"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      style={{
        width: '100%',
        fontSize: 9,
        fontFamily: 'inherit',
        lineHeight: 'inherit',
        color: INK,
        background: filled ? 'transparent' : '#fffbe6',
        border: 'none',
        // Amber while empty, hairline once filled — the analyst can see at a
        // glance which observations are still outstanding without leaving the
        // page, and the printed report carries neither.
        borderBottom: filled ? `1px solid ${LINE}` : '1px dashed #d97706',
        padding: '0 2px',
        outline: 'none',
      }}
    />
  );
}

/**
 * @param {object} strings   dailyStrings(locale)
 * @param {string} deformation  The risk verdict sentence.
 * @param {string} quality      The data-quality label, e.g. 'Acceptable'.
 * @param {string} qualitySummary  The classification's standing sentence.
 * @param {string} qualityNote  The non-optimal parameters behind the label, in
 *   parentheses after it — "Acceptable (Latency issue)". Empty for an Optimal
 *   period, which needs no explanation.
 * @param {object} manual    { weather, fog, rainfall } — analyst free text.
 * @param {boolean} editable  Type the observations straight onto the page.
 *   False on the export render and the measurement layer.
 * @param {Function} onManualChange  (field, value) => void
 */
export function DailySummary({
  strings,
  deformation,
  quality,
  qualitySummary,
  qualityNote,
  manual,
  editable = false,
  onManualChange,
}) {
  const qualityTone = severityColor(quality).color;
  const observation = (fieldName, label) => (
    <EditableValue
      editable={editable}
      value={manual?.[fieldName]}
      placeholder={strings.notProvided}
      ariaLabel={label}
      onChange={(v) => onManualChange?.(fieldName, v)}
    />
  );

  return (
    <div>
      <SectionBar title={strings.summaryHeading} />
      <div style={{ border: `1px solid ${LINE}`, borderTop: 'none', padding: '6px 10px' }}>
        <SummaryRow label={strings.summaryDeformation}>
          {deformation || strings.notProvided}
        </SummaryRow>
        <SummaryRow label={strings.summaryDataQuality}>
          <span style={{ fontWeight: 700, color: severityTextColor(qualityTone) }}>
            {quality || strings.notProvided}
          </span>
          {qualityNote ? <span style={{ color: MUTED }}> ({qualityNote})</span> : null}
          {qualitySummary ? <span style={{ color: MUTED }}> — {qualitySummary}</span> : null}
        </SummaryRow>
        <SummaryRow label={strings.summaryWeather}>
          {observation('weather', strings.summaryWeather)}
        </SummaryRow>
        <SummaryRow label={strings.summaryFog}>{observation('fog', strings.summaryFog)}</SummaryRow>
        <SummaryRow label={strings.summaryRainfall}>
          {observation('rainfall', strings.summaryRainfall)}
        </SummaryRow>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Movement status
// ---------------------------------------------------------------------------

const th = {
  background: DARK,
  color: '#fff',
  fontSize: 8,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  padding: '4px 6px',
  textAlign: 'left',
  border: `1px solid ${DARK}`,
};

const td = {
  fontSize: 8.5,
  color: INK,
  padding: '3px 6px',
  border: `1px solid ${LINE}`,
  verticalAlign: 'top',
};

/**
 * Column widths. A single-column table has the full sheet to spend, so the
 * Keterangan sentence gets nearly half of it and stops wrapping; the two-up
 * table splits the same four columns twice.
 */
const MOVEMENT_COL_KEYS = ['colArea', 'colTarp', 'colPattern', 'colRemarks'];
const COL_WIDTHS_SINGLE = ['20%', '14%', '18%', '48%'];
const COL_WIDTHS_TWO_UP = ['15%', '10%', '11%', '14%'];

/**
 * One row's four cells. `row` is null only for the odd slot of a two-up table.
 *
 * The TARP and Pattern columns take DIFFERENT inks, each stating its own fact:
 * `tarpColour` is the LEVEL's band and `patternColour` is the TREND SHAPE's.
 * They agree at most sites, because the level is derived from the shape — but
 * where a site's levels are alarm thresholds a Linear trend can sit on a TARP 4,
 * and neither column may borrow the other's colour. Inking both from the band
 * printed the trigger orange and understated the response being asked for;
 * inking both from the row's overall band printed "Linear" in red and claimed a
 * shape the trend does not have.
 *
 * `colour` — the more severe of the two — is the row's RANK and is deliberately
 * not printed anywhere. It remains the fallback for rows built before
 * `patternColour` existed.
 *
 * Both are pushed through `severityTextColor`: the yellow and orange band
 * fills sit near 1.8:1 against white and print as haze at this size.
 */
function movementCells(row, keyPrefix) {
  const ink = (band) => (band ? severityTextColor(bandColor(band).color) : INK);
  return [
    <td key={`${keyPrefix}-a`} style={{ ...td, fontWeight: 600 }}>{row?.area ?? ''}</td>,
    <td key={`${keyPrefix}-t`} style={{ ...td, fontWeight: 800, color: ink(row?.tarpColour) }}>
      {row?.tarp ?? ''}
    </td>,
    <td
      key={`${keyPrefix}-p`}
      style={{ ...td, fontWeight: 700, color: ink(row?.patternColour ?? row?.colour) }}
    >
      {row?.pattern ?? ''}
    </td>,
    <td key={`${keyPrefix}-k`} style={td}>{row?.remark ?? ''}</td>,
  ];
}

/**
 * The movement status table, sized to the data.
 *
 * Three shapes, decided by `splitStatusRows`:
 *   - nothing to monitor  → one message row; the four column headers would be
 *     a table promising columns it has no rows for
 *   - up to five chains   → one full-width column group
 *   - more                → two groups side by side, left filled first
 *
 * No padding rows in any of them. An empty row in a status table reads as an
 * area that was checked and found blank, which is a claim the report cannot
 * make about an area that does not exist.
 */
export function DailyMovementTable({ strings, split, withHeader = true, joinPrev = false }) {
  const left = split?.left ?? [];
  const right = split?.right ?? [];
  const twoUp = Boolean(split?.twoUp);
  const widths = twoUp ? COL_WIDTHS_TWO_UP : COL_WIDTHS_SINGLE;
  const sides = twoUp ? [0, 1] : [0];

  return (
    <div>
      {withHeader ? <SectionBar title={strings.movementHeading} /> : null}
      {left.length === 0 ? (
        <div
          style={{
            border: `1px solid ${LINE}`,
            // The section bar or the figure above already closes this edge.
            borderTop: withHeader || joinPrev ? 'none' : `1px solid ${LINE}`,
            padding: '10px 8px',
            textAlign: 'center',
            fontSize: 9,
            color: MUTED,
            fontStyle: 'italic',
          }}
        >
          {strings.noMonitoringPoints}
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              {sides.flatMap((side) =>
                MOVEMENT_COL_KEYS.map((key, i) => (
                  <th key={`${side}-${key}`} style={{ ...th, width: widths[i] }}>
                    {strings[key]}
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {left.map((row, i) => (
              <tr key={i} style={{ background: i % 2 ? ZEBRA : '#fff' }}>
                {movementCells(row, 'l')}
                {twoUp ? movementCells(right[i] ?? null, 'r') : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

/**
 * The two explanation tables at the foot of page 1.
 *
 * The "Terkini" column is a tick against the row the report actually reached —
 * data quality on the left, risk on the right — so a reader can see which tier
 * this edition sits in without cross-referencing the cards at the top.
 *
 * @param {string} currentQuality  Normalised tier ('SubOptimal', not 'Sub-Optimal').
 * @param {string} currentRisk     The printed risk label, e.g. 'TARP 2'.
 * @param {string} qualityNote     The non-optimal parameters, printed against
 *   the ticked quality row. This is the only place the report says WHY the
 *   period was not Optimal, so it is not dropped when it is long.
 */
export function DailyLegend({ strings, currentQuality, currentRisk, qualityNote, locale }) {
  const tick = (isCurrent) =>
    isCurrent ? <span style={{ fontWeight: 800, color: INK }}>x</span> : null;

  return (
    <div>
      <SectionBar title={strings.legendHeading} />
      <div style={{ display: 'flex', gap: 6, border: `1px solid ${LINE}`, borderTop: 'none', padding: 6 }}>
        {/* Data quality */}
        <div style={{ flex: 1.6, minWidth: 0 }}>
          <div
            style={{
              background: '#e8eef0',
              color: INK,
              fontSize: 8,
              fontWeight: 700,
              textAlign: 'center',
              padding: '3px 4px',
              textTransform: 'uppercase',
            }}
          >
            {strings.legendQualityHeading}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th style={{ ...th, width: '20%' }}>{strings.legendStatus}</th>
                <th style={{ ...th, width: '32%' }}>{strings.legendAction}</th>
                <th style={{ ...th, width: '12%', textAlign: 'center' }}>{strings.legendCurrent}</th>
                <th style={{ ...th, width: '36%' }}>{strings.colRemarks}</th>
              </tr>
            </thead>
            <tbody>
              {DAILY_QUALITY_TIERS.map((tier) => {
                const isCurrent = tier === currentQuality;
                const tone = severityColor(tier).color;
                return (
                  <tr key={tier} style={{ background: isCurrent ? ZEBRA : '#fff' }}>
                    <td style={{ ...td, fontWeight: 800, color: severityTextColor(tone) }}>{tier}</td>
                    <td style={{ ...td, fontWeight: isCurrent ? 700 : 400 }}>
                      {qualityActionText(tier, locale)}
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>{tick(isCurrent)}</td>
                    <td style={td}>{isCurrent ? qualityNote || '' : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Risk */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              background: '#e8eef0',
              color: INK,
              fontSize: 8,
              fontWeight: 700,
              textAlign: 'center',
              padding: '3px 4px',
              textTransform: 'uppercase',
            }}
          >
            {strings.legendRiskHeading}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th style={{ ...th, width: '60%', textAlign: 'center' }}>{strings.legendRiskLevel}</th>
                <th style={{ ...th, width: '40%', textAlign: 'center' }}>{strings.legendCurrent}</th>
              </tr>
            </thead>
            <tbody>
              {DAILY_TARP_LEVELS.map((level) => {
                const isCurrent = level === currentRisk;
                const tone = severityColor(level).color;
                return (
                  <tr key={level} style={{ background: isCurrent ? ZEBRA : '#fff' }}>
                    <td
                      style={{
                        ...td,
                        textAlign: 'center',
                        fontWeight: 800,
                        color: severityTextColor(tone),
                      }}
                    >
                      {level}
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>{tick(isCurrent)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {/* A site that words its risk as a band or a deformation type reaches
              no row above. Saying so is better than printing four empty ticks
              and letting the reader conclude the report found nothing. */}
          {currentRisk && !DAILY_TARP_LEVELS.includes(currentRisk) ? (
            <div style={{ fontSize: 8, color: MUTED, padding: '3px 4px' }}>
              {strings.legendCurrent}: <strong style={{ color: INK }}>{currentRisk}</strong>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default DailySummary;
