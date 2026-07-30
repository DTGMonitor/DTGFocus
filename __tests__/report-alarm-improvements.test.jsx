/**
 * Alarm Improvement section of the Comprehensive Radar Report.
 *
 * Covers the window rule — which recommendations count as "within the selected
 * dates" — and the block's two states: a table with its status key, and nothing
 * at all when the period saw no exchange with the site.
 *
 * The window rule is the load-bearing part. A recommendation is in scope when it
 * was RAISED in the period or RESOLVED in it, and the second half is easy to
 * lose: a 'Not Implemented' item submitted months ago and declined this week is
 * exactly the row a client reads the section for.
 */

import { render, screen } from '@testing-library/react';

import {
  selectImprovementsInWindow,
  summarizeImprovements,
  chunkImprovements,
  formatImprovementDay,
} from '@/utils/reportAlarmImprovements';
import { AlarmImprovements } from '@/components/admin/Radar/report/blocks/AlarmImprovements';
import { improvementStatusColor, alarmCauseColor } from '@/components/admin/Radar/report/severity';

/** jsdom normalises inline hex to rgb(); compare like with like. */
const hexToRgb = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

// A one-week window ending 2026-07-17.
const WINDOW_START = new Date('2026-07-10T05:00:00Z');
const WINDOW_END = new Date('2026-07-17T12:00:00Z');

const REGIONS = [
  { id: 188, name: 'Stage_8_West_red_Inv', alarmtype: 'Red', wallfolder: 31 },
  { id: 200, name: 'HMQ_Upper_blue', alarmtype: 'blue', wallfolder: 31 },
];

/** A joined alarm_improvement row, shaped as the hook's select returns it. */
const imp = (over = {}) => ({
  id: over.id ?? 1,
  recommendation_submission: over.submitted ?? '2026-07-12T02:00:00Z',
  improvement_status: over.status ?? 'Awaiting Feedback',
  site_action: over.actioned ?? null,
  site_engineer: over.engineer ?? null,
  type: over.type ?? 'Additional Alarm Mask Recommendation',
  issue: over.issue ?? 'Excessive Unwanted Alarms',
  action: over.action ?? 'As per the alarm mask recommendation.',
  alarm_mask: over.mask ?? null,
  alarm_records: {
    id: 1,
    alarm_region: over.region ?? 188,
    location: over.location ?? 'High threat #7',
    // `in`, not `??` — an explicit `cause: null` is the case being tested, and
    // a nullish default would swallow it back into the fixture's stand-in.
    cause: 'cause' in over ? over.cause : 'Machinery Activity',
  },
});

const select = (rows, shift) =>
  selectImprovementsInWindow(rows, WINDOW_START, WINDOW_END, REGIONS, shift);

describe('selectImprovementsInWindow', () => {
  test('keeps a recommendation raised inside the window', () => {
    const kept = select([imp({ id: 1, submitted: '2026-07-12T02:00:00Z' })]);
    expect(kept).toHaveLength(1);
    expect(kept[0].activity).toBe('raised');
  });

  test('keeps one raised BEFORE the window but resolved inside it', () => {
    const kept = select([
      imp({
        id: 2,
        submitted: '2026-05-01T02:00:00Z',
        actioned: '2026-07-14T09:00:00Z',
        status: 'Not Implemented',
      }),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0].activity).toBe('resolved');
    expect(kept[0].status).toBe('Not Implemented');
  });

  test('drops one that was raised, resolved and closed before the period', () => {
    expect(
      select([
        // Raised and closed long before the period.
        imp({ id: 3, submitted: '2026-05-01T02:00:00Z', actioned: '2026-05-02T02:00:00Z', status: 'Modified' }),
        // Raised after the window closed — not asked for yet, as at this period.
        imp({ id: 5, submitted: '2026-08-01T02:00:00Z' }),
      ])
    ).toEqual([]);
  });

  // The SSR777 case: two recommendations raised 28/07 and still unanswered, which
  // a raised-or-resolved-only rule dropped from the daily report on the 30th.
  // An open item is an obligation, not an event — it carries until it is answered.
  test('carries an unanswered recommendation into a LATER period', () => {
    const kept = select([
      imp({ id: 40, submitted: '2026-04-01T02:00:00Z', actioned: null, status: 'Awaiting Feedback' }),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0].activity).toBe('outstanding');
  });

  test('does NOT carry it into a period that closed before it was raised', () => {
    // Raised after this window ended: nothing was owed during it.
    expect(
      select([imp({ id: 41, submitted: '2026-09-01T02:00:00Z', actioned: null, status: 'Awaiting Feedback' })])
    ).toEqual([]);
  });

  test('stops carrying it the moment the site answers', () => {
    // Same row as id 40, now resolved — and resolved before the window, so it
    // has no further claim on this period.
    expect(
      select([
        imp({ id: 42, submitted: '2026-04-01T02:00:00Z', actioned: '2026-04-05T02:00:00Z', status: 'Modified' }),
      ])
    ).toEqual([]);
  });

  test('does not carry forward a terminal row that merely lacks an action date', () => {
    // A data anomaly (see migration 001), not an open item. Carrying it would
    // resurrect a closed recommendation in every report from now on.
    expect(
      select([imp({ id: 43, submitted: '2026-04-01T02:00:00Z', actioned: null, status: 'Not Implemented' })])
    ).toEqual([]);
  });

  test('ages an open item against the WINDOW END, not the wall clock', () => {
    // 10/07 → 17/07 window end is 7 days after a 10/07 submission, regardless of
    // when the report is re-opened and re-read.
    const [row] = select([
      imp({ id: 44, submitted: '2026-07-10T12:00:00Z', actioned: null, status: 'Awaiting Feedback' }),
    ]);
    expect(row.daysOpen).toBe(7);
  });

  test('sorts carried-over items below the period\'s actual activity', () => {
    const kept = select([
      imp({ id: 45, submitted: '2026-04-01T02:00:00Z', actioned: null, status: 'Awaiting Feedback' }),
      imp({ id: 46, submitted: '2026-07-11T02:00:00Z' }),
    ]);
    expect(kept.map((r) => r.id)).toEqual([46, 45]);
  });

  test('is inclusive of both window bounds', () => {
    const byId = new Map(
      select([
        imp({ id: 6, submitted: WINDOW_START.toISOString() }),
        imp({ id: 7, submitted: WINDOW_END.toISOString() }),
        imp({ id: 8, submitted: new Date(WINDOW_START.getTime() - 1).toISOString() }),
        imp({ id: 9, submitted: new Date(WINDOW_END.getTime() + 1).toISOString() }),
      ]).map((r) => [r.id, r])
    );

    // Both bounds count as raised IN the period.
    expect(byId.get(6).activity).toBe('raised');
    expect(byId.get(7).activity).toBe('raised');
    // A millisecond early is not raised this period — but it is still open, so
    // it carries in as a backlog item rather than vanishing.
    expect(byId.get(8).activity).toBe('outstanding');
    // A millisecond late had not been asked for yet.
    expect(byId.has(9)).toBe(false);
  });

  test('flags a recommendation raised AND resolved inside the same period', () => {
    const kept = select([
      imp({ id: 10, submitted: '2026-07-11T02:00:00Z', actioned: '2026-07-15T02:00:00Z', status: 'Modified' }),
    ]);
    expect(kept[0].activity).toBe('raised-and-resolved');
  });

  test('orders by the most recent in-window activity, newest first', () => {
    const kept = select([
      imp({ id: 11, submitted: '2026-07-11T02:00:00Z' }),
      imp({ id: 12, submitted: '2026-05-01T02:00:00Z', actioned: '2026-07-16T02:00:00Z', status: 'Modified' }),
      imp({ id: 13, submitted: '2026-07-13T02:00:00Z' }),
    ]);
    expect(kept.map((r) => r.id)).toEqual([12, 13, 11]);
  });

  test('a resolution OUTSIDE the window does not pull an in-window submission to the top', () => {
    // id 15 was raised first but closed after the period; ordering must use the
    // in-window instant (its submission), not the later out-of-window action.
    const kept = select([
      imp({ id: 14, submitted: '2026-07-16T02:00:00Z' }),
      imp({ id: 15, submitted: '2026-07-11T02:00:00Z', actioned: '2026-07-20T02:00:00Z', status: 'Modified' }),
    ]);
    expect(kept.map((r) => r.id)).toEqual([14, 15]);
  });

  test('joins the region name and severity, and survives an unknown region', () => {
    const [known, unknown] = select([
      imp({ id: 16, region: 188 }),
      imp({ id: 17, region: 999 }),
    ]).sort((a, b) => a.id - b.id);

    expect(known.regionName).toBe('Stage_8_West_red_Inv');
    expect(known.alarmType).toBe('red'); // lowercased from 'Red'
    expect(unknown.regionName).toBeNull();
    expect(unknown.alarmType).toBeNull();
  });

  test('carries the alarm cause through verbatim, and tolerates it being absent', () => {
    const [withCause, without] = select([
      imp({ id: 18, cause: 'Progressive Deformation Trend' }),
      imp({ id: 19, cause: null }),
    ]).sort((a, b) => a.id - b.id);

    // Verbatim: alarmCauseColor keys on the exact name, so no tidying.
    expect(withCause.cause).toBe('Progressive Deformation Trend');
    expect(without.cause).toBeNull();
  });

  test('formats dates on the site wall clock, not the runtime one', () => {
    // 23:30 UTC is already the next day in Perth (+08:00).
    const shift = (iso) => formatShiftPerth(iso);
    const [row] = select([imp({ id: 18, submitted: '2026-07-12T23:30:00Z' })], shift);
    expect(row.submittedDay).toBe('13/07/2026');
  });

  test('is empty for no rows or an unusable window', () => {
    expect(select([])).toEqual([]);
    expect(selectImprovementsInWindow([imp()], null, WINDOW_END, REGIONS)).toEqual([]);
  });
});

/** Stand-in for fromUTC bound to Australia/Perth (+08:00, no DST). */
function formatShiftPerth(iso) {
  return new Date(new Date(iso).getTime() + 8 * 3600 * 1000).toISOString();
}

describe('formatImprovementDay', () => {
  test('renders DD/MM/YYYY and tolerates a missing or unusable value', () => {
    expect(formatImprovementDay('2026-07-14T09:00:00Z')).toBe('14/07/2026');
    expect(formatImprovementDay(null)).toBeNull();
    expect(formatImprovementDay('not a date')).toBeNull();
  });
});

describe('summarizeImprovements', () => {
  test('counts raised and resolved as overlapping, and outstanding separately', () => {
    const rows = select([
      imp({ id: 20, submitted: '2026-07-11T02:00:00Z' }), // raised, still open
      imp({ id: 21, submitted: '2026-07-11T02:00:00Z', actioned: '2026-07-15T02:00:00Z', status: 'Modified' }),
      imp({ id: 22, submitted: '2026-05-01T02:00:00Z', actioned: '2026-07-16T02:00:00Z', status: 'Not Implemented' }),
      imp({ id: 23, submitted: '2026-04-01T02:00:00Z' }), // carried over, still open
    ]);
    expect(summarizeImprovements(rows)).toMatchObject({
      total: 4,
      raised: 2, // 20 and 21 — a carried-over item was NOT raised this period
      resolved: 2, // 21 and 22
      carriedOver: 1, // 23
      outstanding: 2, // 20 and 23 — everything the site still owes an answer on
    });
    expect(summarizeImprovements(rows).statuses.sort()).toEqual([
      'Awaiting Feedback',
      'Modified',
      'Not Implemented',
    ]);
  });
});

describe('chunkImprovements', () => {
  test('splits into page-sized blocks so the paginator never has to', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: i }));
    expect(chunkImprovements(rows, 9).map((c) => c.length)).toEqual([9, 9, 2]);
    expect(chunkImprovements([], 9)).toEqual([]);
  });
});

describe('improvementStatusColor', () => {
  test('gives the three statuses three distinct inks', () => {
    const seen = ['Modified', 'Awaiting Feedback', 'Not Implemented'].map(
      (s) => improvementStatusColor(s).color
    );
    expect(new Set(seen).size).toBe(3);
    // An unrecognised status must not silently borrow one of them.
    expect(improvementStatusColor('Something Else').color).not.toEqual(expect.stringMatching(seen.join('|')));
  });
});

describe('AlarmImprovements block', () => {
  const rows = select([
    imp({
      id: 30,
      submitted: '2026-07-12T02:00:00Z',
      status: 'Awaiting Feedback',
      issue: 'Excessive Unwanted Alarms',
      mask: 'DTG_L_HMQ Upper_Mask Recommendation',
    }),
    imp({
      id: 31,
      submitted: '2026-05-01T02:00:00Z',
      actioned: '2026-07-14T09:00:00Z',
      status: 'Not Implemented',
      region: 200,
      issue: 'Alarm Threshold Too Sensitive',
      cause: 'Progressive Deformation Trend',
    }),
  ]);

  test('prints each recommendation with its region, status and site action', () => {
    render(<AlarmImprovements rows={rows} summary={summarizeImprovements(rows)} />);

    expect(screen.getByText('Alarm Improvement')).toBeInTheDocument();
    expect(screen.getByText('Stage_8_West_red_Inv')).toBeInTheDocument();
    expect(screen.getByText('HMQ_Upper_blue')).toBeInTheDocument();
    expect(screen.getByText('Excessive Unwanted Alarms')).toBeInTheDocument();
    expect(screen.getByText('Mask: DTG_L_HMQ Upper_Mask Recommendation')).toBeInTheDocument();
    expect(screen.getByText('14/07/2026')).toBeInTheDocument();
    expect(screen.getByText('12/07/2026')).toBeInTheDocument();
  });

  test('says so in full when the site has not answered, rather than printing a dash', () => {
    render(<AlarmImprovements rows={rows} summary={summarizeImprovements(rows)} />);
    expect(screen.getByText('Awaiting site response')).toBeInTheDocument();
    // 12/07 → 17/07 window end.
    expect(screen.getByText('Open 5 days')).toBeInTheDocument();
  });

  test('names the alarm cause alongside the region', () => {
    render(<AlarmImprovements rows={rows} summary={summarizeImprovements(rows)} />);
    expect(screen.getByText('Machinery Activity')).toBeInTheDocument();
    expect(screen.getByText('Progressive Deformation Trend')).toBeInTheDocument();
  });

  test('swatches the cause in the SAME ink the cause pie uses', () => {
    // The colour agreement is the point — a reader carries it from the pie in
    // System Performance to the row that asked the site to fix it.
    const { container } = render(
      <AlarmImprovements rows={rows} summary={summarizeImprovements(rows)} />
    );
    const swatch = [...container.querySelectorAll('span')].find(
      (el) => el.nextSibling?.textContent === 'Progressive Deformation Trend'
    );
    expect(swatch).toBeTruthy();
    expect(swatch.style.background).toBe(hexToRgb(alarmCauseColor('Progressive Deformation Trend')));
    // Square, so it cannot be misread as the round region-severity dot above it.
    expect(swatch.style.borderRadius).toBe('');
  });

  test('omits the cause line entirely when the record carries none', () => {
    const noCause = select([imp({ id: 33, cause: null })]);
    render(<AlarmImprovements rows={noCause} summary={summarizeImprovements(noCause)} />);
    expect(screen.queryByText('Machinery Activity')).not.toBeInTheDocument();
  });

  test('tags a carried-over row so it does not read as new activity', () => {
    const carried = select([
      imp({ id: 32, submitted: '2026-04-01T02:00:00Z', actioned: null, status: 'Awaiting Feedback' }),
    ]);
    render(<AlarmImprovements rows={carried} summary={summarizeImprovements(carried)} />);
    expect(screen.getByText('Carried over')).toBeInTheDocument();
    expect(screen.getByText('Open 107 days')).toBeInTheDocument();
  });

  test('heads the section with the period total and what is still outstanding', () => {
    render(<AlarmImprovements rows={rows} summary={summarizeImprovements(rows)} />);
    expect(screen.getByText(/2 recommendations/)).toBeInTheDocument();
    expect(screen.getByText(/1 outstanding/)).toBeInTheDocument();
  });

  test('keys only the statuses the period actually contains', () => {
    render(<AlarmImprovements rows={rows} summary={summarizeImprovements(rows)} />);
    expect(screen.getByText(/site decided not to implement/)).toBeInTheDocument();
    expect(screen.getByText(/site has not replied/)).toBeInTheDocument();
    expect(screen.queryByText(/already applied by site/)).not.toBeInTheDocument();
  });

  test('the key covers the whole period, not just the chunk it is printed under', () => {
    // Page 2 holds only the Modified row, but page 1 held a declined one — the
    // key under page 2 still has to explain 'Not Implemented'.
    const lastChunk = [rows[1]];
    render(
      <AlarmImprovements rows={lastChunk} summary={summarizeImprovements(rows)} withHeader={false} />
    );
    expect(screen.getByText('Alarm Improvement (continued)')).toBeInTheDocument();
    expect(screen.getByText(/site has not replied/)).toBeInTheDocument();
  });

  test('renders nothing at all when the period saw no recommendations', () => {
    const { container } = render(<AlarmImprovements rows={[]} summary={summarizeImprovements([])} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Alarm Improvement')).not.toBeInTheDocument();
  });
});
