// Rainfall TARP alarm — the rule, pinned.
//
// The numbers here are Sorowako's: >20 mm/jam and >100 mm/hari, set by
// .kiro/specs/scalable-tarp/migrations/019_rain_rate_threshold.sql from the
// site's own TARP row. If the migration's numbers move, these move with them.
//
// THE RULE THIS FILE EXISTS TO HOLD IN PLACE: the rate alarm is EDGE-TRIGGERED.
// It fires when the rate crosses the threshold from below, stays silent while the
// rate remains above however high it climbs, and can only fire again after the
// rate has been SEEN at or below the threshold and rises past it once more. The
// canonical sequence is in `the specified sequence` below and is worth reading
// first — everything else here is a corner of it.
//
// The station is ASBSAR1, on Asia/Singapore (UTC+8) — which is the station's own
// zone and neither UTC nor the jest TZ (Asia/Jakarta, UTC+7). That mismatch is
// deliberately kept in the fixtures: it is the one that produces off-by-an-hour
// bugs in real life.

import {
  ALARM_WINDOW_HOURS,
  breachKey,
  composeRainfallWorkLog,
  describeDuration,
  evaluateRainfallTarp,
  isDayShift,
  rateEpisodes,
  responseForShift,
  type RainfallTarpTrigger,
} from '@/utils/rainfallTarp';
import type { DailyBucket, RainSeriesPoint } from '@/components/admin/Fog/types';

/** Sorowako's row, as migration 019 leaves it. */
const SOROWAKO: RainfallTarpTrigger = {
  siteId: 7,
  siteName: 'Sorowako',
  rateMmh: 20,
  dailyMm: 100,
  tarpLevel: 2,
  bandLabel: 'TARP Trigger 2 (Yellow)',
  description:
    '1. Intensitas hujan per jam (hourly) >20 mm/jam, atau 2. Intensitas hujan harian (daily) >100 mm/hari.',
  dayShift: '1. WhatsApp\n2. Email semua kontak',
  nightShift: '1. WhatsApp\n2. Email semua kontak',
  comments: [
    '1. Pantau sesuai prosedur TARP Trigger 2',
    '2. Hujan: harus dilaporkan dan dipantau sesuai prosedur.',
  ],
};

const NOW = new Date('2026-09-30T10:00:00Z'); // 18:00 +08

/** Readings at the 5-minute poll cadence, starting 09:00 UTC = 17:00 +08. */
const T0 = '2026-09-30T09:00:00.000Z';

function series(
  rates: readonly (number | null)[],
  startUtc = T0
): RainSeriesPoint[] {
  const t0 = new Date(startUtc).getTime();
  return rates.map((r, i) => ({
    observedAt: new Date(t0 + i * 5 * 60_000).toISOString(),
    rainDailyMm: null,
    rainRateMmh: r,
  }));
}

/** The instant of the nth reading in a `series()` built from the same start. */
function at(index: number, startUtc = T0): string {
  return new Date(new Date(startUtc).getTime() + index * 5 * 60_000).toISOString();
}

function day(
  startUtc: string,
  rainMm: number | null,
  hoursObserved = 24
): DailyBucket {
  return {
    dayStart: startUtc,
    rainMm,
    sampleCount: 288,
    hoursObserved,
    complete: hoursObserved >= 24,
  };
}

/** Local midnight +08 on 30 September is 16:00 UTC on the 29th. */
const DAY_30_SEP = '2026-09-29T16:00:00.000Z';
const DAY_29_SEP = '2026-09-28T16:00:00.000Z';

const evaluate = (
  rates: readonly (number | null)[],
  acknowledged?: Set<string>
) =>
  evaluateRainfallTarp({
    trigger: SOROWAKO,
    series: series(rates),
    daily: [],
    now: NOW,
    acknowledged,
  });

// ---------------------------------------------------------------------------
// The sequence that specified the behaviour
// ---------------------------------------------------------------------------
describe('the specified sequence', () => {
  //   0   10   20   21   22   24   19   21   30   40   0
  //   ·   ·    ·    ↑A   A    A    ·    ↑B   B    B    ·
  //
  // Two alarms, not nine. 20 does not cross — the TARP says ">20".
  const SEQUENCE = [0, 10, 20, 21, 22, 24, 19, 21, 30, 40, 0];

  test('raises exactly two events, at the two crossings', () => {
    const out = evaluate(SEQUENCE);

    expect(out).toHaveLength(2);
    // Newest first: episode B leads.
    expect(out.map((b) => b.bucketStart)).toEqual([at(7), at(3)]);
    expect(out.map((b) => b.onsetValue)).toEqual([21, 21]);
    expect(out.map((b) => b.measuredValue)).toEqual([40, 24]);
  });

  test('20 itself does not cross: the threshold is exclusive', () => {
    expect(evaluate([0, 10, 20])).toHaveLength(0);
    expect(evaluate([0, 10, 20.1])).toHaveLength(1);
  });

  // The heart of it. Acknowledge the first crossing and the readings that follow
  // it — 22 and 24 — must not ask again.
  test('signing episode A silences 22 and 24, and leaves B to ask', () => {
    const signed = new Set([breachKey(7, 'rate', at(3))]);
    const out = evaluate(SEQUENCE, signed);

    expect(out).toHaveLength(1);
    expect(out[0].bucketStart).toBe(at(7)); // only episode B remains
  });

  // And once B is signed too, 30 and 40 are silent — the climb is covered by the
  // signature on the crossing.
  test('signing both crossings leaves nothing, though the rate reached 40', () => {
    const signed = new Set([
      breachKey(7, 'rate', at(3)),
      breachKey(7, 'rate', at(7)),
    ]);
    expect(evaluate(SEQUENCE, signed)).toHaveLength(0);
  });

  // Acknowledging mid-episode is the normal case: the operator signs at 22, and
  // 24 arriving five minutes later must not raise a second alarm.
  test('a rate still climbing after acknowledgement does not reopen the episode', () => {
    const signed = new Set([breachKey(7, 'rate', at(3))]);

    // The episode as it stood when signed, then the same episode grown by 24.
    expect(evaluate([0, 10, 20, 21, 22], signed)).toHaveLength(0);
    expect(evaluate([0, 10, 20, 21, 22, 24], signed)).toHaveLength(0);
  });

  // The event identity must not drift as the episode grows, or the signature
  // would stop matching and the alarm would return on the next refresh.
  test('the episode key is fixed at the crossing and never moves', () => {
    const early = evaluate([0, 10, 20, 21]);
    const later = evaluate([0, 10, 20, 21, 22, 24]);

    expect(early[0].key).toBe(later[0].key);
    expect(later[0].measuredValue).toBe(24); // the peak grew
    expect(later[0].bucketStart).toBe(at(3)); // the identity did not
  });
});

// ---------------------------------------------------------------------------
// Episode detection on its own
// ---------------------------------------------------------------------------
describe('crossing episodes', () => {
  test('a dip to exactly the threshold closes the episode', () => {
    // 20 is not above, so it closes A — and the next 21 is a new crossing.
    const episodes = rateEpisodes(series([21, 20, 21]), 20);
    expect(episodes).toHaveLength(2);
  });

  test('an episode still above at the end of the series is ongoing', () => {
    const [open] = rateEpisodes(series([21, 30]), 20);
    expect(open.ongoing).toBe(true);

    const [closed] = rateEpisodes(series([21, 30, 5]), 20);
    expect(closed.ongoing).toBe(false);
  });

  test('the peak and its instant are tracked separately from the onset', () => {
    const [ep] = rateEpisodes(series([22, 48.6, 30]), 20);

    expect(ep.onsetValue).toBe(22);
    expect(ep.onsetAt).toBe(at(0));
    expect(ep.peakValue).toBe(48.6);
    expect(ep.peakAt).toBe(at(1));
    expect(ep.latestAt).toBe(at(2));
    expect(ep.readingCount).toBe(3);
  });

  // An unmeasured reading is not a low one. Reading a null as 0 mm/h would close
  // an episode that never ended and re-alarm on the next measurement.
  test('a null rate neither opens nor closes an episode', () => {
    const episodes = rateEpisodes(series([21, null, 22]), 20);

    expect(episodes).toHaveLength(1);
    expect(episodes[0].readingCount).toBe(3); // counted as watched
    expect(episodes[0].peakValue).toBe(22);
  });

  test('a series of nothing but nulls yields no episode', () => {
    expect(rateEpisodes(series([null, null]), 20)).toHaveLength(0);
  });

  // The rule reads the series as a sequence in time; one row out of order would
  // otherwise split one episode into two events and ask for two signatures.
  test('readings are ordered before the walk, not trusted', () => {
    const inOrder = series([21, 30, 25]);
    // The same three readings, handed over backwards. Walked as given, the 25
    // would open an episode, the 30 continue it and the 21 continue it again —
    // or worse, a dip in the middle would split one episode into two events and
    // ask for two signatures.
    const episodes = rateEpisodes([...inOrder].reverse(), 20);

    expect(episodes).toHaveLength(1);
    expect(episodes[0].onsetAt).toBe(at(0));
    expect(episodes[0].peakValue).toBe(30);
  });

  test('two dips make three episodes', () => {
    expect(rateEpisodes(series([25, 0, 25, 0, 25]), 20)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// The daily threshold, which needs none of the above
// ---------------------------------------------------------------------------
describe('daily threshold', () => {
  const daily = (buckets: DailyBucket[], acknowledged?: Set<string>) =>
    evaluateRainfallTarp({
      trigger: SOROWAKO,
      series: [],
      daily: buckets,
      now: NOW,
      acknowledged,
    });

  test('a day above the threshold breaches, in mm', () => {
    const out = daily([day(DAY_30_SEP, 118.6, 18)]);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: 'daily',
      measuredValue: 118.6,
      thresholdValue: 100,
      unitLabel: 'mm/hari',
      onsetValue: null,
      minutesAbove: null,
      ongoing: null,
    });
  });

  // The accumulator only climbs and resets at local midnight, so a day crosses
  // once and cannot fall back through — the day IS the episode.
  test('a day signed once stays signed as its total climbs', () => {
    const signed = new Set([breachKey(7, 'daily', DAY_30_SEP)]);
    expect(daily([day(DAY_30_SEP, 101, 12)], signed)).toHaveLength(0);
    expect(daily([day(DAY_30_SEP, 180, 20)], signed)).toHaveLength(0);
  });

  // The total for a part-watched day is a floor. A floor already past 100 mm is
  // past 100 mm, and waiting for midnight would be waiting until the rain no
  // longer matters.
  test('an incomplete day fires on its floor, flagged as incomplete', () => {
    const out = daily([day(DAY_30_SEP, 101, 12)]);
    expect(out).toHaveLength(1);
    expect(out[0].dayComplete).toBe(false);
  });

  test('a day still below the threshold is quiet', () => {
    expect(daily([day(DAY_30_SEP, 99.9, 20)])).toHaveLength(0);
  });
});

describe('sites with no rainfall threshold', () => {
  // Telfer and Hidden Valley both carry a 'Rainfall Event' row — theirs is about
  // slope displacement following rain, with no gauge behind it. Null thresholds
  // must never be read as zero, which would make every dry reading a crossing.
  test('null thresholds alarm on nothing', () => {
    const out = evaluateRainfallTarp({
      trigger: { ...SOROWAKO, siteId: 1, siteName: 'Telfer', rateMmh: null, dailyMm: null },
      series: series([80, 0, 60]),
      daily: [day(DAY_30_SEP, 300)],
      now: NOW,
    });
    expect(out).toHaveLength(0);
  });

  test('one threshold set alarms only on that one', () => {
    const out = evaluateRainfallTarp({
      trigger: { ...SOROWAKO, dailyMm: null },
      series: series([25]),
      daily: [day(DAY_30_SEP, 300)],
      now: NOW,
    });

    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('rate');
  });
});

describe('the alarm window', () => {
  test('an episode that ended before the window stops asking', () => {
    const old = new Date(
      NOW.getTime() - (ALARM_WINDOW_HOURS + 2) * 3_600_000
    ).toISOString();

    const out = evaluateRainfallTarp({
      trigger: SOROWAKO,
      series: series([45, 0], old),
      daily: [],
      now: NOW,
    });
    expect(out).toHaveLength(0);
  });

  // Aged on the episode's LAST reading, not its first: a crossing that began 25
  // hours ago and is still above is happening now.
  test('an episode that began before the window but is still running asks', () => {
    const start = new Date(NOW.getTime() - 25 * 3_600_000).toISOString();
    const rates = Array.from({ length: 24 * 12 + 24 }, () => 45);

    const out = evaluateRainfallTarp({
      trigger: SOROWAKO,
      series: series(rates, start),
      daily: [],
      now: NOW,
    });

    expect(out).toHaveLength(1);
    expect(out[0].ongoing).toBe(true);
  });

  test('yesterday’s local day is still in the window', () => {
    const out = evaluateRainfallTarp({
      trigger: SOROWAKO,
      series: [],
      daily: [day(DAY_29_SEP, 140)],
      now: NOW,
    });
    expect(out).toHaveLength(1);
  });
});

describe('acknowledgement keys', () => {
  // The ack table stores bucket_start as timestamptz; PostgREST hands it back in
  // its own spelling ("+00:00" rather than "Z"). The key has to survive that or
  // every acknowledgement would appear unsigned on the next load.
  test('the key is stable across timestamp spellings', () => {
    expect(breachKey(7, 'daily', '2026-09-29T16:00:00+00:00')).toBe(
      breachKey(7, 'daily', '2026-09-29T16:00:00.000Z')
    );
  });

  test('a rate and a daily event on the same instant are separate', () => {
    expect(breachKey(7, 'rate', DAY_30_SEP)).not.toBe(
      breachKey(7, 'daily', DAY_30_SEP)
    );
  });

  test('the same crossing at two sites is two events', () => {
    expect(breachKey(7, 'rate', T0)).not.toBe(breachKey(1, 'rate', T0));
  });
});

describe('ordering', () => {
  test('newest first — the crossing that just happened leads', () => {
    const out = evaluateRainfallTarp({
      trigger: SOROWAKO,
      series: series([25, 0, 30]),
      daily: [day(DAY_30_SEP, 150)],
      now: NOW,
    });

    expect(out.map((b) => b.bucketStart)).toEqual([at(2), at(0), DAY_30_SEP]);
  });
});

describe('describeDuration', () => {
  test('a lone reading is not "0 minutes"', () => {
    expect(describeDuration(0)).toBe('a single reading');
  });

  test('reads in minutes, then hours', () => {
    expect(describeDuration(25)).toBe('25 minutes');
    expect(describeDuration(60)).toBe('1 hour');
    expect(describeDuration(120)).toBe('2 hours');
    expect(describeDuration(95)).toBe('1 h 35 min');
  });
});

describe('the work log entry', () => {
  // A CLOSED episode: crossed at 21, peaked 34.4, last above at 30, then 5 ends it.
  const breach = evaluate([0, 21, 34.4, 30, 5])[0];

  const draftFor = (b = breach) =>
    composeRainfallWorkLog({
      breach: b,
      trigger: SOROWAKO,
      stationName: 'ASBSAR1',
      bucketLabel: '30 Sep 17:05 +08',
      peakLabel: '30 Sep 17:10 +08',
      localHour: 17,
    });

  test('records the crossing, the peak and how long it held', () => {
    const notes = draftFor().notes;

    expect(notes).toContain('TARP Trigger 2 (Yellow)');
    expect(notes).toContain('crossed the site TARP threshold of >20 mm/jam');
    expect(notes).toContain('at 30 Sep 17:05 +08');
    expect(notes).toContain('reading 21 mm/h');
    expect(notes).toContain('peaking at 34.4 mm/h at 30 Sep 17:10 +08');
    expect(notes).toContain('Stayed above for 10 minutes');
    expect(notes).toContain('ASBSAR1');
    expect(draftFor().location).toBe('Sorowako');
  });

  // Readings are pruned at 90 days, so an entry that does not say whether the
  // rate was still up cannot be asked later.
  test('says when the rate was still above at the moment of signing', () => {
    const ongoing = evaluate([0, 21, 34.4])[0];
    expect(ongoing.ongoing).toBe(true);
    expect(draftFor(ongoing).notes).toContain('still above when acknowledged');

    expect(draftFor().notes).not.toContain('still above when acknowledged');
  });

  test('a single-reading burst says so rather than claiming zero minutes', () => {
    const burst = evaluate([0, 45, 3])[0];
    expect(draftFor(burst).notes).toContain('Stayed above for a single reading');
  });

  // A crossing that IS the peak should not read "peaking at 21 mm/h at <the same
  // moment>" — that is noise dressed as detail.
  test('no redundant peak clause when the crossing was the peak', () => {
    const flat = evaluate([0, 21, 5])[0];
    expect(draftFor(flat).notes).not.toContain('peaking at');
  });

  // TARP 2 maps to NOTIFICATION ONLY (subject id 1) through the same
  // getWorkLogDetails every deformation record goes through — not through a
  // second mapping that could drift from it.
  test('takes its subject from the shared work-log mapping', () => {
    expect(draftFor().subjectId).toBe(1);
    // A site that rated rainfall TARP 3 would log MODERATE RISK, with nothing in
    // rainfallTarp.ts knowing that.
    expect(draftFor({ ...breach, tarpLevel: 3 }).subjectId).toBe(5);
  });

  test('carries the TARP response for the shift, flattened onto one line', () => {
    expect(draftFor().action).toBe('1. WhatsApp; 2. Email semua kontak');
  });

  test('a daily entry reads in mm over the day, and flags a floor', () => {
    const partial = evaluateRainfallTarp({
      trigger: SOROWAKO,
      series: [],
      daily: [day(DAY_30_SEP, 101, 12)],
      now: NOW,
    })[0];

    const draft = composeRainfallWorkLog({
      breach: partial,
      trigger: SOROWAKO,
      stationName: 'ASBSAR1',
      bucketLabel: '30 Sep 2026',
      peakLabel: null,
      localHour: 12,
    });

    expect(draft.notes).toContain('101 mm over the local day');
    expect(draft.notes).toContain('>100 mm/hari');
    expect(draft.notes).toContain('floor');
    // A daily total is not a rate, and the entry must not imply one. Asserted on
    // the wording rather than on the unit: "mm/hari" contains "mm/h", so a naive
    // check on the unit passes for the wrong reason and fails for a right one.
    expect(draft.notes).not.toContain('rain rate');
    expect(draft.notes).not.toContain('crossed');
    expect(draft.notes).not.toContain('Stayed above');
  });

  test('a site with no response cell still logs an action', () => {
    expect(responseForShift({ ...SOROWAKO, dayShift: null, nightShift: null }, true))
      .toBe('Respond per site TARP');
  });

  test('the shift split is the station clock, not the reader’s', () => {
    expect(isDayShift(6)).toBe(true);
    expect(isDayShift(17)).toBe(true);
    expect(isDayShift(18)).toBe(false);
    expect(isDayShift(3)).toBe(false);
  });
});
