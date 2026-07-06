// Registry of report types tracked by the reminder system.
//
// There are two detection styles:
//   - 'sensor'   : every sensor at the site must have a report this period,
//                  matched by the sensor id appearing in a report filename.
//                  Radar is the only sensor-based type (sensors come from
//                  latest_radar_wall_folders).
//   - 'bulletin' : the site must have at least one report of `reportsType`
//                  (matched against reports.type, case-insensitive) within the
//                  period. InSAR, VWP, PRISM, Rainfall, etc. work this way.
//
// To add a new report type, append an entry here — no other code changes are
// needed. `cadence` drives the reminder timing (daily / weekly / monthly) and
// the "generated this period" window. For weekly cadence set `defaultWeekday`
// (0 = Sunday .. 6 = Saturday).

import { Cadence, SiteSchedule, defaultReminderFor } from './scheduleUtils';

export interface ReportTypeDef {
  /** Stored in site_report_schedules.report_type and (for bulletins) matched
   *  against reports.type. */
  key: string;
  /** Human label shown in the UI. */
  label: string;
  detection: 'sensor' | 'bulletin';
  cadence: Cadence;
  /** Default schedule applied when a site has no stored row for this type. */
  defaultDeadline: string;
  defaultReminder: string;
  defaultWeekday?: number;
  /** Whether the type is on by default (radar) or opt-in per site (bulletins). */
  defaultEnabled: boolean;
}

/** The sensor-based radar report — always the site's primary daily obligation. */
export const RADAR_TYPE: ReportTypeDef = {
  key: 'radar',
  label: 'Radar',
  detection: 'sensor',
  cadence: 'daily',
  defaultDeadline: '06:00',
  defaultReminder: defaultReminderFor('06:00'),
  defaultEnabled: true,
};

/**
 * Bulletin report types, detected by reports.type. All are opt-in per site.
 * Cadence defaults below are best guesses — change a type's `cadence` and
 * default times here to fit how that report is actually produced.
 */
export const BULLETIN_TYPES: ReportTypeDef[] = [
  {
    key: 'insar',
    label: 'InSAR',
    detection: 'bulletin',
    cadence: 'monthly',
    defaultDeadline: '23:59',
    defaultReminder: '00:00',
    defaultEnabled: false,
  },
  {
    key: 'vwp',
    label: 'VWP',
    detection: 'bulletin',
    cadence: 'monthly',
    defaultDeadline: '23:59',
    defaultReminder: '00:00',
    defaultEnabled: false,
  },
  {
    key: 'prism',
    label: 'PRISM',
    detection: 'bulletin',
    cadence: 'monthly',
    defaultDeadline: '23:59',
    defaultReminder: '00:00',
    defaultEnabled: false,
  },
  {
    key: 'rainfall',
    label: 'Rainfall',
    detection: 'bulletin',
    cadence: 'daily',
    defaultDeadline: '06:00',
    defaultReminder: '05:30',
    defaultEnabled: false,
  },
];

/** All report types, radar first. */
export const ALL_REPORT_TYPES: ReportTypeDef[] = [RADAR_TYPE, ...BULLETIN_TYPES];

export function reportTypeDef(key: string): ReportTypeDef | undefined {
  return ALL_REPORT_TYPES.find((t) => t.key === key);
}

/** The default schedule for a report type when a site has no stored row. */
export function defaultScheduleFor(def: ReportTypeDef): SiteSchedule {
  return {
    deadline: def.defaultDeadline,
    reminder: def.defaultReminder,
    enabled: def.defaultEnabled,
    weekday: def.cadence === 'weekly' ? def.defaultWeekday ?? 1 : null,
  };
}
