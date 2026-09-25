'use client';

/**
 * Daily Radar Report — rainfall from the site's bound weather station.
 *
 * Two plots stacked: the report day's last 24 hours, and the seven days behind
 * it. Both are the STATION's own series, drawn by the same component the fog
 * monitor draws (components/admin/Fog/RainfallChart) so the paper and the
 * screen cannot describe the same storm differently.
 *
 * WHAT THIS DOES NOT REPLACE. The summary panel's "Rekaman Curah Hujan" line
 * stays exactly where it was. That is the analyst's observation FROM SITE, and
 * a gauge two kilometres away is a different claim, not a better one — the
 * report carries both and lets the reader see when they disagree.
 *
 * THE WINDOW IS THE REPORT DAY'S, not now's. The charts are anchored through
 * windowForFrequency, the same helper the rest of the report uses, so reissuing
 * last Tuesday's report reprints last Tuesday's rainfall instead of today's
 * under last Tuesday's masthead.
 *
 * Every constraint below is a rasterization rule, not a style choice; the
 * reasoning is in RainfallChart's header and in DataQuality.jsx, which learned
 * them first:
 *
 *   * FIXED pixel width and height — the hidden measurement layer resolves no
 *     height, and a ResponsiveContainer would rasterize blank into the PDF.
 *   * Inline hex only (PRINT_PALETTE and ../constants). html2canvas 1.x paints
 *     CSS custom properties transparent.
 *   * No tooltip, no animation. The measured pass and the printed pass have to
 *     render identically, and paper has no hover.
 *   * A FIXED total height, declared here and checked against DAILY_USABLE_H,
 *     because the paginator never splits a block: one pixel too tall is
 *     content silently clipped off the page.
 */

import { INK, MUTED, LINE, CONTENT_W } from '../constants';
import { SectionBar } from '../pageFrame';
import { RainfallChart, PRINT_PALETTE } from '@/components/admin/Fog/RainfallChart';

/** The plot area, inside the card's 1px border and 8px padding. */
const CHART_W = CONTENT_W - 18;
const CHART_H = 150;
const CAPTION_H = 14;

/** One plot with its caption. */
function Plot({ title, series, hourly, timezone, range, strings }) {
  return (
    <div style={{ padding: '6px 8px' }}>
      <div
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: INK,
          lineHeight: '14px',
          height: CAPTION_H,
        }}
      >
        {title}
      </div>

      {series.length === 0 ? (
        // A window with no readings prints the reason. Printing an empty pair
        // of axes would look like a week with no rain, which is the one thing
        // this section must never imply.
        <div
          style={{
            height: CHART_H,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 9,
            lineHeight: '13px',
            color: MUTED,
          }}
        >
          {strings.rainChartNoData}
        </div>
      ) : (
        <RainfallChart
          series={series}
          hourly={hourly}
          timezone={timezone}
          range={range}
          width={CHART_W}
          height={CHART_H}
          palette={PRINT_PALETTE}
        />
      )}
    </div>
  );
}

/** A legend key, drawn as a swatch and a word — never colour alone. */
function Key({ color, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 8 }}>
      <span style={{ width: 8, height: 2, background: color, flexShrink: 0 }} />
      {label}
    </span>
  );
}

/**
 * @param {object} strings    dailyReportLocale strings for the report's locale.
 * @param {object|null} day   { series, hourly } for the 24-hour window.
 * @param {object|null} week  { series, hourly } for the 7-day window.
 * @param {string} timezone   The STATION's zone — the clock its data is on.
 */
export function RainfallCharts({ strings, day, week, timezone }) {
  const dayData = day ?? { series: [], hourly: [] };
  const weekData = week ?? { series: [], hourly: [] };

  // Printed only when there is something to explain. A footnote about gaps on
  // a fully-polled week is noise that trains the reader to skip footnotes.
  const hasGaps = [...dayData.hourly, ...weekData.hourly].some(
    (h) => h.missing || h.rainMm === null
  );

  return (
    <div style={{ border: `1px solid ${LINE}` }}>
      <SectionBar
        title={strings.rainChartHeading}
        right={
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Key color={PRINT_PALETTE.daily} label={strings.rainChartDaily} />
            <Key color={PRINT_PALETTE.rate} label={strings.rainChartRate} />
          </span>
        }
      />

      <Plot
        title={`${strings.rainChart24h} · mm / mm/hr`}
        series={dayData.series}
        hourly={dayData.hourly}
        timezone={timezone}
        range="24h"
        strings={strings}
      />

      <div style={{ borderTop: `1px solid ${LINE}` }}>
        <Plot
          title={`${strings.rainChart7d} · mm / mm/hr`}
          series={weekData.series}
          hourly={weekData.hourly}
          timezone={timezone}
          range="7d"
          strings={strings}
        />
      </div>

      {hasGaps ? (
        <div
          style={{
            borderTop: `1px solid ${LINE}`,
            padding: '4px 8px',
            fontSize: 8,
            lineHeight: '11px',
            color: MUTED,
          }}
        >
          {strings.rainChartGaps}
        </div>
      ) : null}
    </div>
  );
}

export default RainfallCharts;
