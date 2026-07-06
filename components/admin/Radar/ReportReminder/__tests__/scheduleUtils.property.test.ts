import fc from 'fast-check';
import {
  shouldRemindFor,
  isAckedFor,
  acknowledgeFor,
  isDueDay,
  isLastDayOfMonth,
  ackToken,
  defaultReminderFor,
  timeToMinutes,
  minutesToTime,
  Cadence,
  SiteSchedule,
} from '../scheduleUtils';

const RUNS = 100;
const ACKS_KEY = 'reportReminderAcks';

const hhmm = (h: number, m: number) =>
  `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

const timeArb = fc
  .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
  .map(([h, m]) => hhmm(h, m));

const cadenceArb = fc.constantFrom<Cadence>('daily', 'weekly', 'monthly');
const dateArb = fc.date({
  min: new Date(2000, 0, 1),
  max: new Date(2100, 0, 1),
  noInvalidDate: true,
});

// Oracle for "is today a due day", computed independently of isDueDay's branch
// structure (monthly reuses isLastDayOfMonth, which is trivially correct).
function dueDayOracle(cadence: Cadence, weekday: number, now: Date): boolean {
  if (cadence === 'daily') return true;
  if (cadence === 'weekly') return now.getDay() === weekday;
  return isLastDayOfMonth(now);
}

beforeEach(() => {
  window.localStorage.clear();
});

// Feature: scalable-report-scheduler, Property 9: shouldRemindFor is true exactly when all conditions are met
describe('Property 9: shouldRemindFor conditions across cadences', () => {
  it('true iff enabled && !generated && !acked && due day && reminder reached', () => {
    fc.assert(
      fc.property(
        fc.record({
          enabled: fc.boolean(),
          reminder: fc.oneof(timeArb, fc.string()),
          deadline: timeArb,
          weekday: fc.integer({ min: 0, max: 6 }),
        }),
        cadenceArb,
        fc.boolean(),
        fc.boolean(),
        dateArb,
        (rec, cadence, generated, acked, now) => {
          const schedule: SiteSchedule = {
            enabled: rec.enabled,
            reminder: rec.reminder,
            deadline: rec.deadline,
            weekday: rec.weekday,
          };
          const reminderMin = timeToMinutes(schedule.reminder);
          const nowMin = now.getHours() * 60 + now.getMinutes();
          const expected =
            rec.enabled &&
            !generated &&
            !acked &&
            dueDayOracle(cadence, rec.weekday, now) &&
            reminderMin !== null &&
            nowMin >= reminderMin;

          expect(shouldRemindFor(schedule, cadence, generated, acked, now)).toBe(expected);
        }
      ),
      { numRuns: RUNS }
    );
  });
});

// Feature: scalable-report-scheduler, Property 10: acknowledge–then–check round trip (same bucket)
describe('Property 10: acknowledgeFor then isAckedFor', () => {
  it('isAckedFor is true immediately after acknowledgeFor for the same bucket', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        cadenceArb,
        dateArb,
        (reportType, siteId, cadence, now) => {
          window.localStorage.clear();
          acknowledgeFor(reportType, siteId, cadence, now);
          expect(isAckedFor(reportType, siteId, cadence, now)).toBe(true);
        }
      ),
      { numRuns: RUNS }
    );
  });
});

// Feature: scalable-report-scheduler, Property 11: acknowledgement expiry — a stale bucket does not suppress
describe('Property 11: acknowledgement expiry across buckets', () => {
  it('an ack token from a different bucket does not count as acked now', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        cadenceArb,
        dateArb,
        dateArb,
        (reportType, siteId, cadence, now, other) => {
          const stale = ackToken(cadence, other);
          fc.pre(stale !== ackToken(cadence, now));
          window.localStorage.setItem(
            ACKS_KEY,
            JSON.stringify({ [`${reportType}:${siteId}`]: stale })
          );
          expect(isAckedFor(reportType, siteId, cadence, now)).toBe(false);
        }
      ),
      { numRuns: RUNS }
    );
  });
});

// Feature: scalable-report-scheduler, Property 12: defaultReminderFor is always 30 minutes before the deadline
describe('Property 12: defaultReminderFor is 30 minutes before deadline', () => {
  it('reminder equals (deadline - 30) mod 1440, wrapping midnight', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        (h, m) => {
          const deadline = hhmm(h, m);
          const reminder = defaultReminderFor(deadline);
          const expected = (timeToMinutes(deadline)! - 30 + 1440) % 1440;
          expect(timeToMinutes(reminder)).toBe(expected);
        }
      ),
      { numRuns: RUNS }
    );
  });
});

// Feature: scalable-report-scheduler, Property 14: timeToMinutes / minutesToTime round trip
describe('Property 14: time round trip', () => {
  it('minutesToTime(timeToMinutes(t)) === t for valid HH:MM', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        (h, m) => {
          const t = hhmm(h, m);
          expect(minutesToTime(timeToMinutes(t)!)).toBe(t);
        }
      ),
      { numRuns: RUNS }
    );
  });
});

// Feature: scalable-report-scheduler, Property 19: weekly due day matches the configured weekday
describe('Property 19: isDueDay for weekly cadence', () => {
  it('weekly is a due day exactly on the configured weekday', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 6 }), dateArb, (weekday, now) => {
        expect(isDueDay('weekly', weekday, now)).toBe(now.getDay() === weekday);
      }),
      { numRuns: RUNS }
    );
  });
});
