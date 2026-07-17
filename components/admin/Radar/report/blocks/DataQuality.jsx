'use client';

/**
 * Data Quality — the radar/spider chart plus the per-group verdict table.
 *
 * Chart: RadarMetricsChart at a FIXED pixel size. It must not use its default
 * ResponsiveContainer path here — that measures the parent, and the measurement
 * layer / export container give it no resolved height, so the chart would
 * rasterize blank into the PDF.
 *
 * The axis count is 5–7, not fixed: Visual Data is dropped for XT radars and
 * Photograph for non-GroundProbe brands. Nothing here may assume a pentagon.
 *
 * EVERY group is listed, not just the failing ones. The chart plots one axis per
 * group, so a table of failures alone left the reader to reconstruct the passing
 * axes from a 220px chart they could not read — and the dead space that cost was
 * the section's most visible flaw. Optimal groups collapse to a single line, so
 * the completeness is nearly free.
 */

import { INK, MUTED, LINE } from '../constants';
import { severityColor, severityTextColor, wash, SEVERITY_LEGEND } from '../severity';
import { SectionBar } from '../pageFrame';
import { polarGeometry, ringPoints, SEVERITY_BANDS, BAND_WASH } from '../radarGeometry';
import RadarMetricsChart from '@/components/Radars/Live/RadarMetricChart';
import { buildRadarData } from '@/components/Radars/Live/radarChart';

// Axis labels are drawn OUTSIDE the polygon, so the box has to be wider than the
// polygon needs. With outerRadius at the default 80% and no margin, long labels
// ("Atm. Correction", "Scan Area") get clipped at the left/right edges.
// The margin reserves that room and the reduced radius keeps the polygon legible.
const CHART_W = 300;
const CHART_H = 220;
const CHART_MARGIN = { top: 14, right: 54, bottom: 14, left: 54 };
const CHART_OUTER_RADIUS = '72%';
const CHART_TICK_SIZE = 8;
const CAPTION_H = 12;

/** The chart's own SVG width — the column, less its padding. */
const CHART_SVG_W = CHART_W - 8;

/**
 * The severity key, printed in the section bar.
 *
 * Exported so a future block that also prints severity colours can reuse it
 * rather than growing a second, drifting key.
 */
export function SeverityLegend() {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {SEVERITY_LEGEND.map((t) => (
        <span key={t.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 8 }}>
          <span style={{ width: 7, height: 7, background: t.color, flexShrink: 0 }} />
          {t.label}
        </span>
      ))}
    </span>
  );
}

/**
 * The severity bands, drawn behind the chart.
 *
 * A separate absolutely-positioned SVG rather than children of the RadarChart:
 * recharts gives custom children no access to the polar geometry it computed
 * (the context is internal), so the bands would need the same maths either way —
 * and this keeps the shared live chart component free of report-only concerns.
 * radarGeometry.js recomputes that geometry and its test pins it to what
 * recharts really renders.
 *
 * Painted outermost-first: each band is a solid filled polygon over the last, so
 * `wash` must return solid colour — an alpha fill would composite the tiers
 * together and the inner ones would print wrong.
 */
function SeverityBands({ axisCount, geometry }) {
  const { cx, cy, outerRadius } = geometry;
  return (
    <svg
      width={CHART_SVG_W}
      height={CHART_H}
      style={{ position: 'absolute', left: 0, top: 0 }}
      aria-hidden="true"
    >
      {SEVERITY_BANDS.map((b) => (
        <polygon
          key={b.label}
          points={ringPoints({ cx, cy, radius: outerRadius * b.fraction, count: axisCount })}
          fill={wash(b.color, BAND_WASH)}
        />
      ))}
    </svg>
  );
}

/** One sub-parameter verdict. The word carries the status; the colour reinforces it. */
const Chip = ({ name, value }) => {
  const c = severityColor(value).color;
  const text = severityTextColor(c);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 8,
        padding: '1px 5px 1px 4px',
        border: `1px solid ${c}`,
        color: text,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 5, height: 5, background: c, flexShrink: 0 }} />
      {name}
    </span>
  );
};

const GroupName = ({ name, color, style }) => (
  <div style={{ width: 78, flexShrink: 0, fontSize: 9, fontWeight: 800, color, textTransform: 'uppercase', ...style }}>
    {name}
  </div>
);

/** A group with something to say: its notes, then every sub-parameter's verdict. */
function FailingRow({ group, appendixByParamId }) {
  const sev = severityColor(group.status);
  const withNotes = group.items.filter((i) => i.notes && String(i.notes).trim() !== '');

  return (
    <div style={{ display: 'flex', borderBottom: `1px solid ${LINE}` }}>
      <div style={{ width: 5, background: sev.color, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0, padding: '5px 8px' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <GroupName name={group.name} color={sev.color} />
          <div style={{ flex: 1, minWidth: 0 }}>
            {withNotes.length > 0 ? (
              withNotes.map((i) => {
                const letter = appendixByParamId?.get(i.id);
                return (
                  <div key={i.id} style={{ fontSize: 9, color: INK, marginBottom: 2 }}>
                    {i.notes}
                    {letter ? <strong> (Appendix {letter})</strong> : null}
                  </div>
                );
              })
            ) : (
              // Non-optimal but unexplained: say so rather than printing nothing,
              // so a missing note reads as a gap in the assessment, not a bug.
              <div style={{ fontSize: 9, color: MUTED }}>No analyst note recorded.</div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
          {group.items.map((i) => (
            <Chip key={i.id} name={i.name} value={i.value} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** A group with nothing to report — one line, so it costs the page almost nothing. */
function OptimalRow({ group }) {
  const c = severityColor('optimal').color;
  return (
    <div style={{ display: 'flex', borderBottom: `1px solid ${LINE}` }}>
      <div style={{ width: 5, background: c, flexShrink: 0 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', flex: 1, minWidth: 0 }}>
        <GroupName name={group.name} color={c} />
        <span style={{ fontSize: 9, color: MUTED }}>
          {group.items.length === 1
            ? 'Sub-parameter optimal.'
            : `All ${group.items.length} sub-parameters optimal.`}
        </span>
      </div>
    </div>
  );
}

/**
 * @param {object} radarRecord   For the chart; must carry radar/brand/parameters.
 * @param {object[]} groups      From buildStatusGroups — ALL groups, failures first,
 *                               each flagged `isOptimal`.
 * @param {Map<number,string>} appendixByParamId  parameter id → appendix letter.
 */
export function DataQuality({ radarRecord, groups = [], appendixByParamId }) {
  const hasChart = radarRecord && Object.keys(radarRecord.parameters ?? {}).length > 0;

  // The axis count drives the band polygons, and only buildRadarData knows it:
  // it is what drops Visual Data for XT and Photograph for non-GroundProbe.
  const axisCount = hasChart ? buildRadarData(radarRecord).length : 0;
  const geometry = polarGeometry({
    width: CHART_SVG_W,
    height: CHART_H,
    margin: CHART_MARGIN,
    outerRadius: CHART_OUTER_RADIUS,
  });
  const gridRadii = SEVERITY_BANDS.map((b) => geometry.outerRadius * b.fraction);

  const optimalCount = groups.filter((g) => g.isOptimal).length;

  return (
    <div>
      <SectionBar title="Data Quality" right={<SeverityLegend />} />
      <div style={{ border: `1px solid ${LINE}`, borderTop: 'none', display: 'flex', gap: 8, padding: 6 }}>
        {/* Chart */}
        <div style={{ width: CHART_W, flexShrink: 0, padding: 4 }}>
          {hasChart ? (
            <>
              <div style={{ position: 'relative', width: CHART_SVG_W, height: CHART_H }}>
                <SeverityBands axisCount={axisCount} geometry={geometry} />
                {/* Sits above the bands. The chart's SVG has no background of its
                    own, so the bands show through. */}
                <div style={{ position: 'relative' }}>
                  <RadarMetricsChart
                    record={radarRecord}
                    width={CHART_SVG_W}
                    height={CHART_H}
                    margin={CHART_MARGIN}
                    outerRadius={CHART_OUTER_RADIUS}
                    tickFontSize={CHART_TICK_SIZE}
                    tickColor={INK}
                    gridStroke={LINE}
                    gridRadii={gridRadii}
                  />
                </div>
              </div>
              <div style={{ height: CAPTION_H, fontSize: 8, color: MUTED, fontStyle: 'italic', textAlign: 'center' }}>
                Outer band = optimal · {optimalCount} of {groups.length} parameters optimal
              </div>
            </>
          ) : (
            <div style={{ height: CHART_H + CAPTION_H, display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED, fontSize: 9 }}>
              Assessment unavailable.
            </div>
          )}
        </div>

        {/* Every group, failures first */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {groups.length === 0 ? (
            <div style={{ fontSize: 10, color: MUTED, padding: 8 }}>
              No data-quality parameters were assessed for this period.
            </div>
          ) : (
            groups.map((g) =>
              g.isOptimal ? (
                <OptimalRow key={g.id} group={g} />
              ) : (
                <FailingRow key={g.id} group={g} appendixByParamId={appendixByParamId} />
              )
            )
          )}
        </div>
      </div>
    </div>
  );
}

export default DataQuality;
