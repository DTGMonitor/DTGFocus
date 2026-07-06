// Pure time / cadence / acknowledgement helpers for the report reminder system.
//
// A report obligation has a cadence (daily, weekly, monthly). The reminder fires
// on the obligation's "due day" once the reminder time is reached, unless the
// report has already been produced this period or the popup was acknowledged for
// the current acknowledgement bucket (day for daily, hour for weekly/monthly).

/** How often a report is expected. */
export type Cadence = 'daily' | 'weekly' | 'monthly';

export interface SiteSchedule {
  /** Time the report is due, "HH:MM" 24h local. */
  deadline: string;
  /** Time the reminder fires if the report is still missing, "HH:MM" 24h local. */
  reminder: string;
  /** When false the obligation is skipped by the reminder checker. */
  enabled: boolean;
  /** Weekly cadence only: due weekday, 0 (Sun) .. 6 (Sat). Null otherwise. */
  weekday?: number | null;
}

const ACKS_KEY = 'reportReminderAcks';

export const DEFAULT_DEADLINE = '06:00';
export const DEFAULT_REMINDER_OFFSET_MIN = 30;

const isBrowser = () => typeof window !== 'undefined';

/** "06:00" -> 360 (minutes since midnight). Returns null on bad input. */
export function timeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** 360 -> "06:00". Wraps within a single day. */
export function minutesToTime(total: number): string {
  const wrapped = ((total % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const min = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Default reminder = deadline minus the default offset. */
export function defaultReminderFor(deadline: string): string {
  const mins = timeToMinutes(deadline);
  if (mins == null) return '05:30';
  return minutesToTime(mins - DEFAULT_REMINDER_OFFSET_MIN);
}

export function defaultSchedule(): SiteSchedule {
  return {
    deadline: DEFAULT_DEADLINE,
    reminder: defaultReminderFor(DEFAULT_DEADLINE),
    enabled: true,
  };
}

/** Local date as "YYYY-MM-DD" (today by default). */
export function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Local hour bucket as "YYYY-MM-DD-HH" (now by default). */
export function localHourKey(d: Date = new Date()): string {
  return `${localDateKey(d)}-${String(d.getHours()).padStart(2, '0')}`;
}

/** True when `now` falls on the last calendar day of its month. */
export function isLastDayOfMonth(now: Date = new Date()): boolean {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getMonth() !== now.getMonth();
}

/** Local midnight at the start of today. */
export function startOfToday(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Local midnight at the start of the current week (Monday-based). */
export function startOfWeek(now: Date = new Date()): Date {
  const d = startOfToday(now);
  const daysSinceMonday = (d.getDay() + 6) % 7; // Sun(0)->6, Mon(1)->0, ...
  d.setDate(d.getDate() - daysSinceMonday);
  return d;
}

/** Local midnight at the start of the current month. */
export function startOfMonth(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** Start of the reporting period for a cadence (used for "generated this period"). */
export function periodStart(cadence: Cadence, now: Date = new Date()): Date {
  if (cadence === 'weekly') return startOfWeek(now);
  if (cadence === 'monthly') return startOfMonth(now);
  return startOfToday(now);
}

/**
 * Is today a day on which this cadence's reminder can fire?
 * - daily: every day
 * - weekly: only on the configured `weekday`
 * - monthly: only on the last day of the month
 */
export function isDueDay(
  cadence: Cadence,
  weekday: number | null | undefined,
  now: Date = new Date()
): boolean {
  if (cadence === 'daily') return true;
  if (cadence === 'weekly') return weekday != null && now.getDay() === weekday;
  return isLastDayOfMonth(now);
}

/**
 * The acknowledgement bucket token for a cadence. Daily reminders are dismissed
 * for the rest of the day; weekly and monthly reminders nag hourly on the due
 * day, so they are dismissed only for the current hour.
 */
export function ackToken(cadence: Cadence, now: Date = new Date()): string {
  return cadence === 'daily' ? localDateKey(now) : localHourKey(now);
}

export function loadAcks(): Record<string, string> {
  if (!isBrowser()) return {};
  try {
    const raw = window.localStorage.getItem(ACKS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Persist a single acknowledgement token under `key`. */
function writeAck(key: string, token: string): void {
  if (!isBrowser()) return;
  const acks = loadAcks();
  acks[key] = token;
  try {
    window.localStorage.setItem(ACKS_KEY, JSON.stringify(acks));
  } catch {
    /* ignore */
  }
}

/**
 * Has the reminder for `reportType` at `siteId` been acknowledged for the
 * current bucket (day for daily, hour for weekly/monthly)?
 */
export function isAckedFor(
  reportType: string,
  siteId: string,
  cadence: Cadence,
  now: Date = new Date()
): boolean {
  return loadAcks()[`${reportType}:${siteId}`] === ackToken(cadence, now);
}

/** Acknowledge the reminder for `reportType` at `siteId` for the current bucket. */
export function acknowledgeFor(
  reportType: string,
  siteId: string,
  cadence: Cadence,
  now: Date = new Date()
): void {
  writeAck(`${reportType}:${siteId}`, ackToken(cadence, now));
}

/**
 * Should the reminder be firing for this obligation right now?
 * True when the schedule is enabled, the report is still missing this period, it
 * has not been acknowledged for the current bucket, today is a due day for the
 * cadence, and the current local time is at or past the reminder time. `now` is
 * injected for testability.
 */
export function shouldRemindFor(
  schedule: SiteSchedule,
  cadence: Cadence,
  generatedInPeriod: boolean,
  acked: boolean,
  now: Date = new Date()
): boolean {
  if (!schedule.enabled || generatedInPeriod || acked) return false;
  if (!isDueDay(cadence, schedule.weekday, now)) return false;
  const reminderMin = timeToMinutes(schedule.reminder);
  if (reminderMin == null) return false;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return nowMin >= reminderMin;
}
