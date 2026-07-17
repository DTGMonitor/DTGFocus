'use client';

/**
 * Alarm cause distribution — hand-rolled SVG pie.
 *
 * SVG by hand rather than a chart library, for the same reason GaugeLive is:
 * zero dependencies and completely predictable rasterization. Recharts' Pie
 * would need the same fixed-size workaround and buys nothing here.
 *
 * Labels show "cause: count (pct%)". The source mockup labelled raw counts with
 * a "%" suffix ("Machinery Activity: 3500", "Vegetation: 1500%") which summed
 * far past 100 — that is not reproduced. Counts and percentages here agree by
 * construction because both come from aggregateAlarmCauses over one record set.
 *
 * Frameless: SystemPerformance owns the border, so both halves sit inside one
 * card split by a hairline instead of floating as two separate boxes.
 */

import { INK, MUTED, LINE } from '../constants';

/** Categorical palette — distinguishable in print and colour-blind-safe-ish. */
const SLICE_COLORS = [
  '#F78E1E', '#2563eb', '#008000', '#C00000', '#7c3aed',
  '#0891b2', '#FFC000', '#db2777', '#4b5563', '#65a30d',
];

const R = 62;
const CX = 70;
const CY = 70;

/** Arc path for a slice spanning [startFrac, endFrac) of the circle. */
function arcPath(startFrac, endFrac) {
  // A single slice covering the whole circle can't be drawn as an arc (start and
  // end coincide) — the caller renders a plain <circle> instead.
  const a0 = startFrac * 2 * Math.PI - Math.PI / 2;
  const a1 = endFrac * 2 * Math.PI - Math.PI / 2;
  const x0 = CX + R * Math.cos(a0);
  const y0 = CY + R * Math.sin(a0);
  const x1 = CX + R * Math.cos(a1);
  const y1 = CY + R * Math.sin(a1);
  const large = endFrac - startFrac > 0.5 ? 1 : 0;
  return `M ${CX} ${CY} L ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} Z`;
}

/**
 * @param {{cause: string, count: number, percentage: number}[]} slices
 * @param {string} title
 */
export function AlarmCausePie({ slices = [], title = 'Alarm Causes' }) {
  const total = slices.reduce((t, s) => t + s.count, 0);

  return (
    <div style={{ flex: 1, minWidth: 0, padding: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: INK }}>{title}</span>
        {total > 0 ? (
          <span style={{ fontSize: 8, color: MUTED }}>{total} alarm{total === 1 ? '' : 's'}</span>
        ) : null}
      </div>

      {total === 0 ? (
        // "0 alarms raised" is a finding. The old empty state was a 140px void
        // with a sentence floating in it, which reads as a missing chart.
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 130,
              height: 130,
              flexShrink: 0,
              border: `1px dashed ${LINE}`,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div style={{ fontSize: 26, fontWeight: 800, color: INK, lineHeight: 1.05 }}>0</div>
            <div style={{ fontSize: 8, color: MUTED, letterSpacing: '0.06em', marginTop: 2 }}>ALARMS RAISED</div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 9, color: INK, marginBottom: 4 }}>
              No alarm events in the reporting window.
            </div>
            <div style={{ fontSize: 8, color: MUTED }}>
              The radar raised no alarms of any type. A cause breakdown appears here when
              events are present.
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width={140} height={140} viewBox="0 0 140 140" style={{ flexShrink: 0 }}>
            {slices.length === 1 ? (
              <circle cx={CX} cy={CY} r={R} fill={SLICE_COLORS[0]} />
            ) : (
              slices.reduce(
                (acc, s, i) => {
                  const frac = s.count / total;
                  acc.nodes.push(
                    <path
                      key={s.cause}
                      d={arcPath(acc.cursor, acc.cursor + frac)}
                      fill={SLICE_COLORS[i % SLICE_COLORS.length]}
                      stroke="#fff"
                      strokeWidth={1}
                    />
                  );
                  acc.cursor += frac;
                  return acc;
                },
                { cursor: 0, nodes: [] }
              ).nodes
            )}
          </svg>

          {/* Legend carries the labels — the pie itself stays unlabelled, so long
              cause names can't overflow the slice or get clipped. */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {slices.map((s, i) => (
              <div key={s.cause} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    background: SLICE_COLORS[i % SLICE_COLORS.length],
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 8, color: INK, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.cause}
                </span>
                <span style={{ fontSize: 8, color: MUTED, fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {s.count} ({s.percentage.toFixed(1)}%)
                </span>
              </div>
            ))}
            {/* No total line: the panel heading already carries the count, and the
                window is stated once in the section bar. */}
          </div>
        </div>
      )}
    </div>
  );
}

export default AlarmCausePie;
