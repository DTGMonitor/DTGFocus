'use client';

/**
 * Alarm Improvement — the recommendations raised or resolved this period.
 *
 * An alarm improvement is DTG asking the site to change something about an alarm
 * region (apply a mask, retune a threshold) and the site's answer. The section
 * exists because that exchange is the only part of the alarm story the client
 * owns: the cause pie says what fired, this says what was asked for and whether
 * anyone acted.
 *
 * It renders ONLY when the period has something to say: a recommendation raised
 * in it, one resolved in it, or one still unanswered at its end. A period with
 * none of the three gets no section and no header, exactly as Procedural Updates
 * does. The rows arrive pre-filtered, pre-sorted and pre-formatted from
 * selectImprovementsInWindow; this block only lays them out.
 *
 * That third case is why an open recommendation keeps appearing: it is an
 * obligation, not an event, and it stays on the report until the site answers it.
 *
 * A period can carry more rows than one page holds, and the paginator never
 * splits a block, so the template feeds this one chunk at a time (see
 * chunkImprovements). `withHeader` distinguishes the first chunk from a
 * continuation; `withLegend` puts the status key under the last one only.
 */

import { INK, MUTED, LINE, ZEBRA, DARK } from '../constants';
import { SectionBar } from '../pageFrame';
import { improvementStatusColor, alarmToneColor, alarmCauseColor } from '../severity';
import { IMPROVEMENT_STATUSES, IMPROVEMENT_STATUS_MEANING } from '@/utils/reportAlarmImprovements';

const th = {
  fontSize: 8,
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: '#fff',
  background: DARK,
  padding: '4px 6px',
  textAlign: 'left',
  verticalAlign: 'top',
};

const td = {
  fontSize: 9,
  color: INK,
  padding: '4px 6px',
  verticalAlign: 'top',
  borderBottom: `1px solid ${LINE}`,
  wordBreak: 'break-word',
};

const sub = { fontSize: 8, color: MUTED, marginTop: 1 };

/** The status, as a filled pill in the report's own severity ink. */
function StatusPill({ status }) {
  const { color, onColor } = improvementStatusColor(status);
  return (
    <span
      style={{
        display: 'inline-block',
        background: color,
        color: onColor,
        fontSize: 8,
        fontWeight: 700,
        letterSpacing: '0.03em',
        textTransform: 'uppercase',
        padding: '2px 5px',
        whiteSpace: 'nowrap',
      }}
    >
      {status}
    </span>
  );
}

/**
 * The region, dotted with ITS OWN alarm severity, over the location and cause.
 *
 * Two marks, deliberately different shapes:
 *
 *   ● round  the REGION's `alarmtype` — a recommendation against a red region
 *            matters more than the same one against a blue region, and that
 *            ranking is invisible from the improvement's status alone.
 *   ■ square the alarm's CAUSE, in the same ink and the same shape the cause
 *            pie's legend uses. A reader can carry a colour straight from the
 *            System Performance pie to the row that asked the site to fix it.
 *
 * Same shapes as their sources, so neither mark invites being read as the other.
 */
function RegionCell({ row }) {
  return (
    <>
      <div style={{ display: 'flex', gap: 5, alignItems: 'baseline' }}>
        {row.alarmType ? (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: alarmToneColor(row.alarmType).color,
              flexShrink: 0,
            }}
          />
        ) : null}
        <span style={{ fontWeight: 600 }}>{row.regionName ?? 'Unknown region'}</span>
      </div>
      {row.location ? <div style={sub}>{row.location}</div> : null}
      {row.cause ? (
        <div style={{ ...sub, display: 'flex', gap: 4, alignItems: 'baseline' }}>
          <span
            style={{
              width: 6,
              height: 6,
              background: alarmCauseColor(row.cause),
              flexShrink: 0,
            }}
          />
          <span>{row.cause}</span>
        </div>
      ) : null}
    </>
  );
}

/**
 * The status key, printed once under the table.
 *
 * Wording is shared with the live summary pages (IMPROVEMENT_STATUS_MEANING), so
 * a client reading "Not Implemented" in the PDF and on the dashboard is told the
 * same thing. Only the statuses actually present are keyed — a legend line for a
 * status that never appears sends the reader hunting for a row that is not there.
 */
function StatusLegend({ statuses }) {
  const present = IMPROVEMENT_STATUSES.filter((s) => statuses.has(s));
  if (present.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 14px', padding: '5px 6px' }}>
      {present.map((s) => (
        <div key={s} style={{ display: 'flex', gap: 4, alignItems: 'baseline', fontSize: 8, color: MUTED }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: improvementStatusColor(s).color,
              flexShrink: 0,
            }}
          />
          <span>
            <strong style={{ color: INK }}>{s}</strong> — {IMPROVEMENT_STATUS_MEANING[s]}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * @param {object[]} rows      one chunk of selectImprovementsInWindow output.
 * @param {object} summary     summarizeImprovements over the WHOLE period, so the
 *   header count states the period's total and not this chunk's length.
 * @param {boolean} withHeader First chunk — carry the section bar.
 * @param {boolean} withLegend Last chunk — carry the status key.
 */
export function AlarmImprovements({ rows = [], summary, withHeader = true, withLegend = true }) {
  // Nothing raised and nothing resolved → no section at all. The template gates
  // this too; the guard keeps the block honest if it is ever rendered directly.
  if (rows.length === 0) return null;

  const total = summary?.total ?? rows.length;
  // The whole period's statuses, not this chunk's — the key sits under the last
  // chunk and must still explain a status that only occurred on an earlier page.
  const statuses = new Set(summary?.statuses ?? rows.map((r) => r.status));

  return (
    <div>
      {withHeader ? (
        <SectionBar
          title="Alarm Improvement"
          right={
            <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.06em' }}>
              {`${total} recommendation${total === 1 ? '' : 's'}`}
              {summary?.outstanding ? ` · ${summary.outstanding} outstanding` : ''}
            </span>
          }
        />
      ) : (
        <SectionBar title="Alarm Improvement (continued)" />
      )}

      <div style={{ border: `1px solid ${LINE}`, borderTop: 'none' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th style={{ ...th, width: '11%' }}>Submitted</th>
              <th style={{ ...th, width: '18%' }}>Alarm Region</th>
              <th style={{ ...th, width: '38%' }}>Issue &amp; Recommendation</th>
              <th style={{ ...th, width: '15%' }}>Status</th>
              <th style={{ ...th, width: '18%' }}>Site Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id ?? i} style={{ background: i % 2 ? ZEBRA : '#fff' }}>
                <td style={td}>
                  {r.submittedDay ?? '—'}
                  {/* Raised before this period and still unanswered. Without the
                      tag the row reads as new activity, and a client comparing
                      two consecutive reports would count the same recommendation
                      twice. */}
                  {r.activity === 'outstanding' ? <div style={sub}>Carried over</div> : null}
                </td>
                <td style={td}>
                  <RegionCell row={r} />
                </td>
                <td style={td}>
                  {r.issue ? <div style={{ fontWeight: 600 }}>{r.issue}</div> : null}
                  {r.type ? <div style={sub}>{r.type}</div> : null}
                  {r.action ? <div style={{ marginTop: 2 }}>{r.action}</div> : null}
                  {r.alarmMask ? <div style={{ ...sub, fontStyle: 'italic' }}>Mask: {r.alarmMask}</div> : null}
                  {!r.issue && !r.type && !r.action && !r.alarmMask ? '—' : null}
                </td>
                <td style={td}>
                  <StatusPill status={r.status} />
                </td>
                <td style={td}>
                  {/* An open recommendation has no action date, and saying so is
                      the point of the row — it is what the client still owes.
                      The age is stated with it: "awaiting response" reads the
                      same after one day and after two months, and the whole
                      reason these rows carry forward is that the difference
                      matters. */}
                  {r.actionedDay ?? 'Awaiting site response'}
                  {r.actionedDay == null && r.daysOpen != null ? (
                    <div style={sub}>{`Open ${r.daysOpen} day${r.daysOpen === 1 ? '' : 's'}`}</div>
                  ) : null}
                  {r.siteEngineer ? <div style={sub}>{r.siteEngineer}</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {withLegend ? <StatusLegend statuses={statuses} /> : null}
      </div>
    </div>
  );
}

export default AlarmImprovements;
