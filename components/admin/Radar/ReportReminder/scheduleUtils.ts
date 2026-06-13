// Helpers for the daily report-generation reminder.
//
// Schedule config (deadline + reminder time per site) is persisted in
// localStorage so it is editable ("manageable") without a DB round-trip.
// Acknowledgements are stored per-day so an acknowledged popup does not
// re-appear for the rest of the day.

export interface SiteSchedule {
  /** Time the report is due, "HH:MM" 24h local. */
  deadline: string;
  /** Time the reminder fires if the report is still missing, "HH:MM" 24h local. */
  reminder: string;
  /** When false the site is skipped by the reminder checker. */
  enabled: boolean;
}

const SCHEDULES_KEY = 'reportSchedules';
const ACKS_KEY = 'reportReminderAcks';
export const SCHEDULES_UPDATED_EVENT = 'report-schedules-updated';

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

export function loadSchedules(): Record<string, SiteSchedule> {
  if (!isBrowser()) return {};
  try {
    const raw = window.localStorage.getItem(SCHEDULES_KEY);
    return raw ? (JSON.parse(raw) as Record<string, SiteSchedule>) : {};
  } catch {
    return {};
  }
}

export function getSchedule(
  all: Record<string, SiteSchedule>,
  siteId: string
): SiteSchedule {
  return all[siteId] ?? defaultSchedule();
}

/** Merge a partial update into a site's schedule and persist all of them. */
export function saveSchedule(siteId: string, patch: Partial<SiteSchedule>): void {
  if (!isBrowser()) return;
  const all = loadSchedules();
  const current = getSchedule(all, siteId);
  all[siteId] = { ...current, ...patch };
  try {
    window.localStorage.setItem(SCHEDULES_KEY, JSON.stringify(all));
    window.dispatchEvent(new CustomEvent(SCHEDULES_UPDATED_EVENT));
  } catch {
    /* storage full / unavailable — ignore */
  }
}

/** Local date as "YYYY-MM-DD" (today by default). */
export function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

export function isAckedToday(siteId: string): boolean {
  return loadAcks()[siteId] === localDateKey();
}

export function acknowledge(siteId: string): void {
  if (!isBrowser()) return;
  const acks = loadAcks();
  acks[siteId] = localDateKey();
  try {
    window.localStorage.setItem(ACKS_KEY, JSON.stringify(acks));
  } catch {
    /* ignore */
  }
}

/**
 * Should the reminder be firing for this site right now?
 * True when enabled, the report is still missing, the current local time is at
 * or past the reminder time, and it has not been acknowledged today.
 * `now` is injected for testability.
 */
export function shouldRemind(
  schedule: SiteSchedule,
  generatedToday: boolean,
  acked: boolean,
  now: Date = new Date()
): boolean {
  if (!schedule.enabled || generatedToday || acked) return false;
  const reminderMin = timeToMinutes(schedule.reminder);
  if (reminderMin == null) return false;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return nowMin >= reminderMin;
}
