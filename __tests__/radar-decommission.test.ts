/**
 * Taking a radar out of service, and putting it back.
 *
 * The board narrows on the wall folder's `type`, but a decommission is two
 * writes across two tables that the browser cannot make atomic. These tests pin
 * the parts that decide whether a radar is visible at all, and the two writes
 * the manual process kept forgetting:
 *
 *   splitting     either mark is enough to call a radar out of service, so a
 *                 half-finished decommission surfaces instead of vanishing
 *   stamping      the radar takes the SITE's calendar date, not the UTC one
 *   downtime      an open record is closed, and never before it opened
 */

import {
  ARCHIVE_TYPE,
  RESTORED_TYPE,
  decommissionLogEntries,
  decommissionStamps,
  hasSideEffects,
  impactLines,
  nowOnSiteClock,
  partitionByService,
  planDowntimeClosures,
  recommissionLogEntry,
  validateDecommission
} from '@/utils/radarDecommission';
import type { DecommissionRow } from '@/utils/radarDecommission';

const PERTH = 'Australia/Perth'; // UTC+8, no DST
const JAKARTA = 'Asia/Jakarta'; // UTC+7

const radar = (over: Partial<DecommissionRow> = {}): DecommissionRow => ({
  id: 9,
  radar_number: 'SSR994FX',
  site_name: 'Telfer',
  area: 'Open Pit',
  wallfolder_id: 49,
  status: 'Live',
  ...over
});

describe('decommissionStamps', () => {
  it("files the radar under the site's calendar date, not the UTC one", () => {
    // 20:30 Perth on the 5th is still 12:30 UTC on the 5th...
    expect(decommissionStamps('2026-09-05T12:30:00.000Z', PERTH).serviceDate).toBe('2026-09-05');
    // ...but 07:30 Perth on the 6th is 23:30 UTC on the 5th. A UTC read would
    // record the radar as leaving service the day before it did.
    expect(decommissionStamps('2026-09-05T23:30:00.000Z', PERTH).serviceDate).toBe('2026-09-06');
  });

  it('keeps the instant exactly as given — the folder stores a real timestamp', () => {
    const stamps = decommissionStamps('2026-09-05T23:30:00.000Z', PERTH);
    expect(stamps.instant).toBe('2026-09-05T23:30:00.000Z');
  });

  it('falls back to UTC when the site has no timezone on record', () => {
    expect(decommissionStamps('2026-09-05T23:30:00.000Z', null).serviceDate).toBe('2026-09-05');
  });
});

describe('nowOnSiteClock', () => {
  it("opens the form on the site's wall clock, not the operator's", () => {
    const at = new Date('2026-09-05T23:30:00.000Z');
    expect(nowOnSiteClock(PERTH, at)).toBe('2026-09-06T07:30');
    expect(nowOnSiteClock(JAKARTA, at)).toBe('2026-09-06T06:30');
  });

  it('is a value a datetime-local input accepts', () => {
    expect(nowOnSiteClock(PERTH, new Date('2026-01-02T03:04:00.000Z'))).toMatch(
      /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$/
    );
  });
});

describe('planDowntimeClosures', () => {
  const at = '2026-09-05T12:00:00.000Z';

  it('closes every open record at the moment service ended', () => {
    const plan = planDowntimeClosures(
      [
        { id: 1, wallfolder: 49, from: '2026-09-01T00:00:00.000Z' },
        { id: 2, wallfolder: 50, from: '2026-09-04T00:00:00.000Z' }
      ],
      at
    );
    expect(plan).toEqual([
      { id: 1, to: at },
      { id: 2, to: at }
    ]);
  });

  it('never closes a record before it opened — that reads as negative downtime', () => {
    // A backdated decommission: the operator says service ended on the 5th, but
    // this outage did not begin until the 8th.
    const plan = planDowntimeClosures([{ id: 3, wallfolder: 49, from: '2026-09-08T00:00:00.000Z' }], at);
    expect(plan).toEqual([{ id: 3, to: '2026-09-08T00:00:00.000Z' }]);
  });

  it('closes a record with no start at the decommission instant', () => {
    expect(planDowntimeClosures([{ id: 4, wallfolder: 49, from: null }], at)).toEqual([{ id: 4, to: at }]);
  });

  it('has nothing to do when nothing is open', () => {
    expect(planDowntimeClosures([], at)).toEqual([]);
  });
});

describe('partitionByService', () => {
  const row = (id: number, type: string) => ({ id, type });

  it('keeps a live radar on the board', () => {
    const { active, decommissioned } = partitionByService([row(1, 'Live'), row(2, 'Link Down')], []);
    expect(active.map((r) => r.id)).toEqual([1, 2]);
    expect(decommissioned).toEqual([]);
  });

  it('moves a radar out once both marks are set', () => {
    const { active, decommissioned } = partitionByService([row(1, 'Live'), row(3, ARCHIVE_TYPE)], [3]);
    expect(active.map((r) => r.id)).toEqual([1]);
    expect(decommissioned.map((r) => r.id)).toEqual([3]);
  });

  it('surfaces a half-finished decommission rather than losing it', () => {
    // Stamp written, folder archive failed: the row is still Live in the view.
    const stampedOnly = partitionByService([row(1, 'Live'), row(2, 'Live')], [2]);
    expect(stampedOnly.decommissioned.map((r) => r.id)).toEqual([2]);

    // Folder archived, stamp missing — how the radars retired by hand before
    // this flow existed would look if their stamp were absent.
    const archivedOnly = partitionByService([row(1, 'Live'), row(2, ARCHIVE_TYPE)], []);
    expect(archivedOnly.decommissioned.map((r) => r.id)).toEqual([2]);
  });

  it('preserves the order the board was fetched in', () => {
    const { active } = partitionByService([row(3, 'Live'), row(1, 'Live'), row(2, 'Live')], []);
    expect(active.map((r) => r.id)).toEqual([3, 1, 2]);
  });
});

describe('validateDecommission', () => {
  const form = { at: '2026-09-05T07:30', reason: 'Contract ended' };

  it('accepts a complete form', () => {
    expect(validateDecommission(form, radar())).toBeNull();
  });

  it('refuses a radar with no wall folder to archive', () => {
    expect(validateDecommission(form, radar({ wallfolder_id: null }))).toMatch(/wall folder/i);
  });

  it('refuses a missing or unreadable time', () => {
    expect(validateDecommission({ ...form, at: '' }, radar())).toMatch(/date and time/i);
    expect(validateDecommission({ ...form, at: 'yesterday' }, radar())).toMatch(/could not be read/i);
  });

  it('requires a reason — the work log is the only trace of why', () => {
    expect(validateDecommission({ ...form, reason: '   ' }, radar())).toMatch(/reason/i);
  });

  it('refuses when there is no row at all', () => {
    expect(validateDecommission(form, null)).toMatch(/no radar/i);
  });
});

describe('impactLines', () => {
  it('says only what is actually there', () => {
    const lines = impactLines({ folders: 1, downtime: 0, deformations: 0 });
    expect(lines.some((l) => /wall folder is archived/.test(l))).toBe(true);
    expect(lines.some((l) => /downtime/.test(l))).toBe(false);
    expect(lines.some((l) => /deformation/.test(l))).toBe(false);
  });

  it('warns about the records the manual process kept leaving open', () => {
    const lines = impactLines({ folders: 1, downtime: 1, deformations: 3 });
    expect(lines.some((l) => /1 open downtime record is closed/.test(l))).toBe(true);
    expect(lines.some((l) => /3 active deformations are marked resolved/.test(l))).toBe(true);
  });

  it('always says the decommission can be undone', () => {
    const lines = impactLines({ folders: 1, downtime: 0, deformations: 0 });
    expect(lines[lines.length - 1]).toMatch(/recommissioned/i);
  });

  it('reports side effects only when the decommission reaches past the folder', () => {
    expect(hasSideEffects({ folders: 1, downtime: 0, deformations: 0 })).toBe(false);
    expect(hasSideEffects({ folders: 1, downtime: 1, deformations: 0 })).toBe(true);
    expect(hasSideEffects({ folders: 2, downtime: 0, deformations: 1 })).toBe(true);
  });
});

describe('work log entries', () => {
  const at = '2026-09-05T12:00:00.000Z';

  it('logs one row per archived folder, carrying the reason as the action', () => {
    const entries = decommissionLogEntries(radar(), [49, 50], '  Contract ended  ', 'user-1', at);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.wallfolder)).toEqual([49, 50]);
    expect(entries[0].action).toBe('Contract ended');
    expect(entries[0].category).toBe('decommission');
    expect(entries[0].submitted_by).toBe('user-1');
    expect(entries[0].notes).toMatch(/SSR994FX/);
  });

  it('names the state a recommissioned radar comes back in', () => {
    const entry = recommissionLogEntry(radar(), 49, 'user-1', at);
    expect(entry.category).toBe('recommission');
    expect(entry.wallfolder).toBe(49);
    expect(entry.notes).toContain(RESTORED_TYPE);
  });
});
