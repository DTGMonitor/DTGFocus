/**
 * Rotating a radar onto a new wall folder, without stranding its downtime.
 *
 * The old folder leaves the UI the instant the new one exists, so an outage
 * still open on it becomes unreachable while the availability RPCs go on
 * reading it as running. These tests pin the three things that decide whether
 * that happens:
 *
 *   instant     the close lands on the SITE's clock, to the minute
 *   closing     every open record on the folder is closed, and never backwards
 *   failure     a refused close throws, so the caller abandons the changeover
 */

import {
  changeoverInstant,
  closeOpenDowntime,
  closureMessage,
} from '@/utils/wallFolderChangeover';
import type { DowntimeClient } from '@/utils/wallFolderChangeover';

const PERTH = 'Australia/Perth'; // UTC+8, no DST
const JAKARTA = 'Asia/Jakarta'; // UTC+7, the clock jest is pinned to

/**
 * A stand-in for the Supabase query builder, narrow to what the module uses:
 * `.select().eq().is()` to read, `.update().eq()` to write. Records the writes
 * so the assertions can look at exactly what would land in the column.
 */
const clientWith = (
  open: Array<{ id: number; wallfolder: number; from: string | null }>,
  faults: { read?: unknown; write?: unknown } = {}
) => {
  const updates: Array<{ id: number; to: string }> = [];
  const reads: Array<{ wallfolder: unknown }> = [];

  const supabase = {
    from: (table: string) => {
      if (table !== 'downtime_records') throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: (_column: string, wallfolder: unknown) => {
            reads.push({ wallfolder });
            return {
              is: async () =>
                faults.read
                  ? { data: null, error: faults.read }
                  : { data: open.filter((r) => String(r.wallfolder) === String(wallfolder)), error: null },
            };
          },
        }),
        update: (payload: { to: string }) => ({
          eq: async (_column: string, id: number) => {
            if (faults.write) return { error: faults.write };
            updates.push({ id, to: payload.to });
            return { error: null };
          },
        }),
      };
    },
  };

  return { supabase: supabase as unknown as DowntimeClient, updates, reads };
};

describe('changeoverInstant', () => {
  it('resolves now against the site clock, not the runtime one', () => {
    // 18:40 UTC is the 3rd in Perth (+8) but still the 2nd in UTC. A close that
    // used the browser clock would file this outage under the wrong site day.
    const now = new Date('2026-09-02T18:40:37.482Z');
    expect(changeoverInstant(PERTH, now)).toBe('2026-09-02T18:40:00.000Z');
  });

  it('truncates to the minute, matching every other value in the column', () => {
    const now = new Date('2026-09-02T18:40:37.482Z');
    expect(changeoverInstant(JAKARTA, now)).toBe('2026-09-02T18:40:00.000Z');
    expect(changeoverInstant(JAKARTA, now).endsWith(':00.000Z')).toBe(true);
  });

  it('falls back to the raw instant when the site carries no timezone', () => {
    const now = new Date('2026-09-02T18:40:37.482Z');
    expect(changeoverInstant(null, now)).toBe('2026-09-02T18:40:00.000Z');
  });
});

describe('closeOpenDowntime', () => {
  const AT = '2026-09-30T04:00:00.000Z';

  it('closes every record still open on the folder', async () => {
    const { supabase, updates } = clientWith([
      { id: 1, wallfolder: 49, from: '2026-09-28T22:15:00.000Z' },
      { id: 2, wallfolder: 49, from: '2026-09-29T06:00:00.000Z' },
    ]);

    await expect(closeOpenDowntime(supabase, 49, AT)).resolves.toBe(2);
    expect(updates).toEqual([
      { id: 1, to: AT },
      { id: 2, to: AT },
    ]);
  });

  it('leaves other folders alone', async () => {
    const { supabase, updates, reads } = clientWith([
      { id: 1, wallfolder: 49, from: '2026-09-28T22:15:00.000Z' },
      { id: 9, wallfolder: 50, from: '2026-09-28T22:15:00.000Z' },
    ]);

    await expect(closeOpenDowntime(supabase, 49, AT)).resolves.toBe(1);
    expect(reads).toEqual([{ wallfolder: 49 }]);
    expect(updates).toEqual([{ id: 1, to: AT }]);
  });

  it('never writes a window that runs backwards', async () => {
    // A record opened with a mis-typed future date. Closing it at "now" would
    // leave `to` before `from`, and the availability RPCs drop such a row — the
    // outage would vanish from the figures rather than show up wrong.
    const { supabase, updates } = clientWith([
      { id: 3, wallfolder: 49, from: '2026-10-05T00:00:00.000Z' },
    ]);

    await expect(closeOpenDowntime(supabase, 49, AT)).resolves.toBe(1);
    expect(updates).toEqual([{ id: 3, to: '2026-10-05T00:00:00.000Z' }]);
  });

  it('closes a record with no start at the changeover instant', async () => {
    const { supabase, updates } = clientWith([{ id: 4, wallfolder: 49, from: null }]);

    await expect(closeOpenDowntime(supabase, 49, AT)).resolves.toBe(1);
    expect(updates).toEqual([{ id: 4, to: AT }]);
  });

  it('writes nothing when the folder is clean, so a retry is safe', async () => {
    const { supabase, updates } = clientWith([]);

    await expect(closeOpenDowntime(supabase, 49, AT)).resolves.toBe(0);
    expect(updates).toEqual([]);
  });

  it('does nothing at all for a sensor carrying no folder id', async () => {
    const { supabase, reads } = clientWith([]);

    await expect(closeOpenDowntime(supabase, null as unknown as number, AT)).resolves.toBe(0);
    expect(reads).toEqual([]);
  });

  it('throws when the records cannot be read, so the folder is not created', async () => {
    const { supabase, updates } = clientWith([], { read: { message: 'permission denied' } });

    await expect(closeOpenDowntime(supabase, 49, AT)).rejects.toMatchObject({
      message: 'permission denied',
    });
    expect(updates).toEqual([]);
  });

  it('throws when a close is refused, so the folder is not created', async () => {
    const { supabase } = clientWith(
      [{ id: 1, wallfolder: 49, from: '2026-09-28T22:15:00.000Z' }],
      { write: { message: 'downtime_window_guard' } }
    );

    await expect(closeOpenDowntime(supabase, 49, AT)).rejects.toMatchObject({
      message: 'downtime_window_guard',
    });
  });
});

describe('closureMessage', () => {
  it('says nothing when nothing was open', () => {
    expect(closureMessage(0)).toBe('');
  });

  it('is plural-correct', () => {
    expect(closureMessage(1)).toContain('The downtime still open');
    expect(closureMessage(3)).toContain('The 3 downtime records still open');
  });
});
