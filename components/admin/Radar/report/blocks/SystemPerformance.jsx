'use client';

/**
 * System Performance — availability donut + alarm cause pie.
 *
 * The section title answers "how well did the monitoring system itself perform,
 * and why did it underperform?". It is deliberately NOT "Performance Matrix":
 * "matrix" implies a grid, and this is two charts. The title lives in constants
 * so renaming it never touches layout.
 *
 * The donut is a print-styled sibling of GaugeLive rather than GaugeLive itself:
 * the live gauge is built for a dark dashboard (#262626 ring track, white text)
 * and would print as a black box. The ring maths is identical.
 *
 * Two layout decisions worth keeping:
 *
 *   1. Uptime is printed in the donut's hole. It is the section's headline
 *      number and used to be its smallest type, in a footer under a wall of
 *      zeros. The hole was already empty.
 *   2. Reasons with no downtime do not get a row. Five lines of "0.00 h / 0%"
 *      were the largest block of text here and carried nothing; they collapse to
 *      one line naming the reasons that were clear. On a bad day the remaining
 *      rows are the only rows, so they are findable.
 */

import { INK, MUTED, LINE, SECTION_TITLE_SYSTEM_PERFORMANCE } from '../constants';
import { severityColor, uptimeSeverityLabel } from '../severity';
import { SectionBar } from '../pageFrame';
import { AlarmCausePie } from './AlarmCausePie';
import { folderDisplayLabel } from '@/utils/reportWallFolders';

const MA_COLOR = '#3B7D23';
const UA_COLOR = '#156082';
const TRACK = '#e5e7eb';

const SIZE = 130;
const STROKE = 13;
const R_OUTER = (SIZE - STROKE) / 2;
const R_INNER = R_OUTER - STROKE * 1.5;

const Ring = ({ radius, pct, color }) => {
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.max(0, Math.min(100, pct)) / 100) * circumference;
  return (
    <>
      <circle cx={SIZE / 2} cy={SIZE / 2} r={radius} fill="none" stroke={TRACK} strokeWidth={STROKE} />
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={STROKE}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="butt"
        transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
      />
    </>
  );
};

/**
 * The two rings, with uptime in the hole.
 *
 * The number is coloured by uptimeSeverityLabel — the same helper the Executive
 * Summary tile and the Key Findings dot use — so the three cannot disagree about
 * whether a given uptime is good.
 */
function AvailabilityDonut({ availability }) {
  const a = availability;
  const label = uptimeSeverityLabel(a.uptimePercentage);
  const color = label ? severityColor(label).color : INK;

  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ flexShrink: 0 }}>
      <Ring radius={R_OUTER} pct={a.mechanicalAvailability} color={MA_COLOR} />
      <Ring radius={R_INNER} pct={a.useOfAvailability} color={UA_COLOR} />
      <text
        x={SIZE / 2}
        y={SIZE / 2 - 3}
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize={17}
        fontWeight="bold"
        fill={color}
      >
        {a.uptimePercentage.toFixed(1)}%
      </text>
      <text
        x={SIZE / 2}
        y={SIZE / 2 + 8}
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize={7}
        letterSpacing="0.06em"
        fill={MUTED}
      >
        UPTIME
      </text>
      <text
        x={SIZE / 2}
        y={SIZE / 2 + 18}
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize={6.5}
        fill={MUTED}
      >
        {a.windowHours.toFixed(0)} h window
      </text>
    </svg>
  );
}

/** A ring's headline percentage, its bar, and only the reasons that cost time. */
const Breakdown = ({ heading, pct, color, buckets }) => {
  const entries = Object.entries(buckets);
  const charged = entries.filter(([, b]) => b.hours > 0);
  const clear = entries.filter(([, b]) => !(b.hours > 0)).map(([reason]) => reason);

  return (
    <div style={{ marginBottom: 7 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, fontSize: 8, padding: '2px 0' }}>
        <span style={{ fontWeight: 700, color }}>{heading}</span>
        <span style={{ fontWeight: 700, color: INK }}>{pct.toFixed(2)}%</span>
      </div>

      {/* The bar replaces a solid header block that was carrying the percentage
          as text inside it — same information, read without being parsed. */}
      <div style={{ height: 5, background: TRACK, position: 'relative', overflow: 'hidden' }}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${Math.max(0, Math.min(100, pct))}%`,
            background: color,
          }}
        />
      </div>

      {charged.map(([reason, b]) => (
        <div key={reason} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: INK, padding: '2px 0 0' }}>
          <span>{reason}</span>
          <span>{b.hours.toFixed(2)} h / {b.percentage.toFixed(0)}%</span>
        </div>
      ))}

      {clear.length > 0 ? (
        <div style={{ fontSize: 8, color: MUTED, fontStyle: 'italic', padding: '2px 0 0' }}>
          {charged.length === 0
            ? `No downtime recorded — ${clear.join(', ')}.`
            : `${clear.join(', ')} — none.`}
        </div>
      ) : null}
    </div>
  );
};

/**
 * @param {object} availability  A computeAvailability() result.
 * @param {{cause: string, count: number, percentage: number}[]} alarmCauses
 *   The combined breakdown across every folder — the KPI-level view.
 * @param {{folder: object, causes: array, total: number}[]} alarmFolders
 *   Per-folder breakdowns. When more than one folder raised alarms in the window
 *   (a wall-folder change within the last 24h), each is shown labelled with its
 *   folder rather than fused into one pie — different folders can be different
 *   locations. Otherwise the single combined pie renders as before.
 */
export function SystemPerformance({ availability, alarmCauses = [], alarmFolders = [] }) {
  const a = availability;
  const foldersWithAlarms = (alarmFolders ?? []).filter((f) => (f.total ?? 0) > 0);
  const perFolderAlarms = foldersWithAlarms.length > 1;

  return (
    <div>
      <SectionBar
        title={SECTION_TITLE_SYSTEM_PERFORMANCE}
        right={
          a ? (
            <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.06em' }}>
              Last {a.windowHours.toFixed(0)} h
            </span>
          ) : null
        }
      />
      {/* One frame with a hairline divider, matching Data Quality's card. The two
          sections used to be framed differently — a bordered card here, two
          floating boxes there — and read as two different templates. */}
      <div style={{ border: `1px solid ${LINE}`, borderTop: 'none', display: 'flex' }}>
        <div style={{ flex: 1, minWidth: 0, padding: 6 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: INK, marginBottom: 4 }}>Daily Availability</div>
          {!a ? (
            <div style={{ height: SIZE, display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED, fontSize: 9 }}>
              Availability data unavailable.
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <AvailabilityDonut availability={a} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Breakdown heading="Mechanical Availability" pct={a.mechanicalAvailability} color={MA_COLOR} buckets={a.mechanical} />
                <Breakdown heading="Use of Availability" pct={a.useOfAvailability} color={UA_COLOR} buckets={a.useOf} />
              </div>
            </div>
          )}
        </div>

        <div style={{ width: 1, background: LINE, flexShrink: 0 }} />

        {perFolderAlarms ? (
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            {foldersWithAlarms.map((f, i) => (
              <div
                key={f.folder?.id ?? i}
                style={{ borderTop: i > 0 ? `1px solid ${LINE}` : 'none' }}
              >
                <AlarmCausePie slices={f.causes} title={folderDisplayLabel(f.folder)} />
              </div>
            ))}
          </div>
        ) : (
          <AlarmCausePie slices={alarmCauses} />
        )}
      </div>
    </div>
  );
}

export default SystemPerformance;
