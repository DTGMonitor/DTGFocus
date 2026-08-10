/**
 * The detector / crosschecker roster derived from user_sites.
 *
 * The rule these cover: everyone with role = 'admin' is on the roster, which is
 * what makes a newly added member's records resolve to a name instead of the
 * raw UUID; the two access-only admins are not.
 */

import {
  EXCLUDED_CROSSCHECKERS,
  fetchCrosscheckers,
  toCrosscheckers,
} from '@/utils/crosscheckers';

const ROWS = [
  { user_id: 'uuid-adib', displayname: 'Adib Izzuddin' },
  { user_id: 'uuid-aris', displayname: 'Aris Regiansyah' },
  { user_id: 'uuid-lintang', displayname: 'Lintang Sadewa' },
  { user_id: 'uuid-mark', displayname: 'Mark Burdett' },
  { user_id: 'uuid-nessy', displayname: 'Nessy Salsabilita' },
  { user_id: 'uuid-nurhuda', displayname: 'Nurhuda Santoso' },
  { user_id: 'uuid-peter', displayname: 'Peter Saunders' },
];

describe('toCrosscheckers', () => {
  it('keeps every admin except the excluded ones, sorted by name', () => {
    expect(toCrosscheckers(ROWS)).toEqual([
      { id: 'uuid-adib', full_name: 'Adib Izzuddin' },
      { id: 'uuid-aris', full_name: 'Aris Regiansyah' },
      { id: 'uuid-lintang', full_name: 'Lintang Sadewa' },
      { id: 'uuid-nessy', full_name: 'Nessy Salsabilita' },
      { id: 'uuid-nurhuda', full_name: 'Nurhuda Santoso' },
    ]);
  });

  it('excludes the named admins whatever case or padding the row carries', () => {
    const rows = EXCLUDED_CROSSCHECKERS.map((name, i) => ({
      user_id: `uuid-${i}`,
      displayname: `  ${name.toUpperCase()} `,
    }));
    expect(toCrosscheckers(rows)).toEqual([]);
  });

  it('lists a person once even when they hold several user_sites rows', () => {
    const rows = [
      { user_id: 'uuid-aris', displayname: 'Aris Regiansyah' },
      { user_id: 'uuid-aris', displayname: 'Aris Regiansyah' },
    ];
    expect(toCrosscheckers(rows)).toHaveLength(1);
  });

  it('drops rows with no name or no user_id, and tolerates no rows at all', () => {
    const rows = [
      { user_id: 'uuid-blank', displayname: '   ' },
      { user_id: null, displayname: 'Nameless Uuid' },
      { user_id: 'uuid-null', displayname: null },
    ];
    expect(toCrosscheckers(rows)).toEqual([]);
    expect(toCrosscheckers(null)).toEqual([]);
    expect(toCrosscheckers(undefined)).toEqual([]);
  });
});

describe('fetchCrosscheckers', () => {
  afterEach(() => {
    // @ts-expect-error — restoring the jsdom global between cases
    delete global.fetch;
  });

  it('returns the roster the route sends', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ crosscheckers: [{ id: 'uuid-aris', full_name: 'Aris Regiansyah' }] }),
    }) as unknown as typeof fetch;

    await expect(fetchCrosscheckers()).resolves.toEqual([
      { id: 'uuid-aris', full_name: 'Aris Regiansyah' },
    ]);
  });

  it('throws on a failed request, so the caller logs it instead of silently emptying the list', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    await expect(fetchCrosscheckers()).rejects.toThrow('401');
  });
});
