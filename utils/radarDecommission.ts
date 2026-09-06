// utils/radarDecommission.ts
//
// Taking a radar OUT of service, and putting it back.
//
// A radar leaves a site: the contract ends, the pit is mined out, the unit goes
// back on a truck. It must stop appearing on the hourly checklist — an operator
// cannot verify a radar that is not there, and every hour it stays on the board
// is counted as a missed check against the shift.
//
// There is no separate "retired" flag to switch. The dashboard already has the
// shape, and it has been applied BY HAND in the database three times:
//
//   radars.decommissioned_at              the date service ended (a date)
//   radar_wall_folders.type = 'Archive'   the wall is no longer being scanned
//   radar_wall_folders.decommissioned_at  the instant it stopped (timestamptz)
//
// The board, the report scheduler and the site-wide status list all narrow to
// `type <> 'Archive'` already, so archiving the radar's live wall folder is what
// actually moves it off the checklist. The radar stamp is what says the RADAR is
// gone rather than merely re-aimed — utils/checklistCarryOver.ts archives a
// folder on every re-aim — and it is what availability reads to stop drawing a
// line after service ended.
//
// The two writes the manual process kept forgetting are the ones this module
// exists to make unforgettable:
//
//   1. An OPEN downtime record (`to IS NULL`) never closes. Availability keeps
//      accruing outage against a radar that left the site months ago — both
//      radars retired by hand are still doing this.
//   2. An ACTIVE deformation (`isactive = 'Yes'`) keeps a live TARP level on a
//      dead radar, which is what the risk column and the site-wide status modal
//      read.
//
// Decommissioning is REVERSIBLE. Nothing is deleted; the folder is archived and
// the stamps are set, and recommissioning clears both. What it does not do is
// re-open the downtime and deformation records it closed: a radar coming back
// into service comes back Live, and whatever is wrong with it now is declared
// through the normal status flow.

import { fromUTC } from './timezoneUtils';

/** What a wall folder's `type` becomes when its radar leaves service. */
export const ARCHIVE_TYPE = 'Archive';

/**
 * What a restored wall folder's `type` becomes.
 *
 * Deliberately not "whatever it was before". The decommission closed the open
 * downtime and resolved the active deformations, so restoring a 'Link Down'
 * would put back a fault with no record behind it. A radar returning to service
 * is Live until somebody says otherwise — the state a freshly commissioned one
 * starts in (AddSensorModal).
 */
export const RESTORED_TYPE = 'Live';

/** work_log.subject ids: 'SERVICE OFFLINE' and 'UPDATE' (table `subject`). */
const SUBJECT_SERVICE_OFFLINE = '3';
const SUBJECT_UPDATE = '7';

export interface DecommissionRow {
  /** radars.id — the view's own `id`. */
  id: number;
  radar_number?: string | null;
  site_name?: string | null;
  area?: string | null;
  /** The live wall folder the board row stands on. */
  wallfolder_id?: number | null;
  status?: string | null;
}

/**
 * When service ended, in both the shapes the two tables want.
 *
 * The operator picks a wall-clock time on the SITE's clock, because that is the
 * clock the outage records and the availability chart are read against. The
 * folder takes the instant; the radar takes the site's calendar date, since
 * `radars.decommissioned_at` is a date and a UTC instant would file a Perth
 * evening under tomorrow.
 */
export const decommissionStamps = (
  instantUTC: string,
  siteTimeZone?: string | null
): { instant: string; serviceDate: string } => ({
  instant: instantUTC,
  serviceDate: (fromUTC(instantUTC, siteTimeZone || 'UTC') || instantUTC).slice(0, 10)
});

/** The datetime-local value a fresh form opens on: now, on the site's clock. */
export const nowOnSiteClock = (
  siteTimeZone?: string | null,
  instant: Date = new Date()
): string => (fromUTC(instant.toISOString(), siteTimeZone || 'UTC') || '').slice(0, 16);

export interface OpenDowntime {
  id: number | string;
  wallfolder: number | string;
  from?: string | null;
}

/**
 * How each open downtime record is closed off.
 *
 * Clamped to its own start: an operator backdating a decommission to before an
 * outage began would otherwise write `to` earlier than `from`, and the
 * availability sum reads that as negative downtime. Such a record is closed at
 * the moment it opened instead — zero minutes, which is the honest reading of
 * "the radar left service before this outage could accrue".
 */
export const planDowntimeClosures = (
  openRecords: OpenDowntime[],
  instantUTC: string
): Array<{ id: number | string; to: string }> => {
  const at = Date.parse(instantUTC);
  return (openRecords || []).map((record) => {
    const from = Date.parse(record?.from || '');
    const tooEarly = Number.isFinite(from) && Number.isFinite(at) && at < from;
    return { id: record.id, to: tooEarly ? (record.from as string) : instantUTC };
  });
};

export interface DecommissionImpact {
  /** Wall folders that will be archived — normally the one live folder. */
  folders: number;
  /** Open downtime records that will be closed off. */
  downtime: number;
  /** Active deformation records that will be resolved. */
  deformations: number;
}

/** Does this decommission reach past the folder itself? Drives the warning copy. */
export const hasSideEffects = (impact: DecommissionImpact): boolean =>
  impact.downtime > 0 || impact.deformations > 0;

/**
 * The consequences, worded for the confirmation panel.
 *
 * Every line is something the operator cannot see from the board row, which is
 * the whole reason the panel exists.
 */
export const impactLines = (impact: DecommissionImpact): string[] => {
  const lines = [
    impact.folders === 1
      ? 'Its wall folder is archived — the radar leaves the checklist, the report scheduler and the site status list.'
      : `Its ${impact.folders} wall folders are archived — the radar leaves the checklist, the report scheduler and the site status list.`
  ];

  if (impact.downtime > 0) {
    lines.push(
      impact.downtime === 1
        ? '1 open downtime record is closed at that time, so availability stops accruing.'
        : `${impact.downtime} open downtime records are closed at that time, so availability stops accruing.`
    );
  }

  if (impact.deformations > 0) {
    lines.push(
      impact.deformations === 1
        ? '1 active deformation is marked resolved, clearing its TARP level.'
        : `${impact.deformations} active deformations are marked resolved, clearing their TARP levels.`
    );
  }

  lines.push('Nothing is deleted — the radar can be recommissioned from the board.');
  return lines;
};

/** A reason is required: the work log is the only audit trail this leaves. */
export const validateDecommission = (
  form: { at: string; reason: string },
  row: DecommissionRow | null
): string | null => {
  if (!row?.id) return 'This row has no radar to decommission.';
  if (!row?.wallfolder_id) return 'This radar has no wall folder to archive.';
  if (!form.at) return 'Set the date and time service ended.';
  if (Number.isNaN(Date.parse(form.at.replace(' ', 'T')))) return 'That date and time could not be read.';
  if (!form.reason.trim()) return 'Give a reason — it is the only record of why this radar left service.';
  return null;
};

/**
 * The work log rows a decommission writes, one per archived folder.
 *
 * Logged against the folder rather than the radar because `work_log.wallfolder`
 * is the only handle the table has, and it is the handle the notification feed
 * and the handover already read.
 */
export const decommissionLogEntries = (
  row: DecommissionRow,
  folderIds: number[],
  reason: string,
  userID: string,
  at: string
) =>
  folderIds.map((folderId) => ({
    created_at: at,
    subject: SUBJECT_SERVICE_OFFLINE,
    wallfolder: folderId,
    location: row.area || null,
    category: 'decommission',
    action: reason.trim(),
    notes: `${row.radar_number || 'Radar'} decommissioned — removed from the hourly checklist.`,
    submitted_by: userID
  }));

export const recommissionLogEntry = (
  row: DecommissionRow,
  folderId: number,
  userID: string,
  at: string
) => ({
  created_at: at,
  subject: SUBJECT_UPDATE,
  wallfolder: folderId,
  location: row.area || null,
  category: 'recommission',
  action: 'Returned to service',
  notes: `${row.radar_number || 'Radar'} recommissioned — back on the hourly checklist as ${RESTORED_TYPE}.`,
  submitted_by: userID
});

/**
 * Split a station's view rows into the board and the out-of-service list.
 *
 * A row counts as out of service when its radar carries the stamp OR its latest
 * wall folder is archived. Either alone is enough on purpose: the two writes
 * cannot be made atomic from the browser, and a half-finished decommission must
 * surface somewhere an operator can finish it rather than vanish from both
 * lists. The radars retired by hand before this flow existed carry both, so they
 * land here too.
 */
export const partitionByService = <T extends { id: number; type?: string | null }>(
  rows: T[],
  decommissionedRadarIds: Iterable<number>
): { active: T[]; decommissioned: T[] } => {
  const stamped = new Set(decommissionedRadarIds);
  const active: T[] = [];
  const decommissioned: T[] = [];

  (rows || []).forEach((row) => {
    const archived = String(row?.type ?? '') === ARCHIVE_TYPE;
    if (archived || stamped.has(row.id)) decommissioned.push(row);
    else active.push(row);
  });

  return { active, decommissioned };
};
