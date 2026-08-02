/**
 * The report window: which instants a report's End Date actually resolves to.
 *
 * Guards the bug where a two-day report generated with the default End Date came
 * back missing everything from the last ~19 h. The End Date is a day on the
 * SITE's calendar, but the modal filled it from the VIEWER's clock — so a Jakarta
 * analyst late in their evening offered a day the Perth/PNG site had already left,
 * windowForFrequency read it as a closed historical period, and the window ended
 * at 05:00 site-local the previous morning instead of at `now`.
 */

import { render, screen } from '@testing-library/react';

// The modal reaches Supabase on mount; stub it so the form renders without one.
jest.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
    }),
    storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: null }) }) },
  },
}));

// No signed-in user, so the client-list fetch never fires: these tests assert on
// the form's INITIAL dates, and a settled clock matters more here than a
// populated client dropdown the assertions never read.
jest.mock('@/components/Reusable/useUserSite', () => ({
  useUserSite: () => ({ user: null, userSite: { displayname: 'Tester' }, loading: false }),
}));

import { windowForFrequency } from '@/utils/reportAvailability';
import ReportTemplateModal from '@/components/admin/Reports/ReportTemplateModal';

const HOURS = (w) => (w.windowEnd.getTime() - w.windowStart.getTime()) / 3_600_000;

describe('windowForFrequency — the open period is always [now − N×24 h, now]', () => {
  // 2026-08-02 16:10Z: 23:10 in Jakarta (the runtime tz these tests pin), but
  // already 00:10 on 2026-08-03 in Perth — the exact hour the two calendars split.
  const NOW = new Date('2026-08-02T16:10:00Z').getTime();

  test.each([
    ['daily', 24],
    ['weekly', 168],
    ['custom:2', 48],
  ])('%s ends at now and spans %i h when the End Date is the site today', (frequency, hours) => {
    const w = windowForFrequency(frequency, '2026-08-03', 'Australia/Perth', NOW);
    expect(w.windowEnd.toISOString()).toBe('2026-08-02T16:10:00.000Z');
    expect(HOURS(w)).toBe(hours);
    expect(w.windowStart.getTime()).toBe(NOW - hours * 3_600_000);
  });

  test('a VIEWER-calendar day the site has already left reads as a closed period', () => {
    // This is the reported failure, kept as documentation of what the modal must
    // not hand over: the window ends 19+ h before now, so today's records are gone.
    const stale = windowForFrequency('custom:2', '2026-08-02', 'Australia/Perth', NOW);
    expect(stale.windowEnd.toISOString()).toBe('2026-08-01T21:00:00.000Z');
    expect(stale.windowEnd.getTime()).toBeLessThan(NOW - 19 * 3_600_000);
  });

  test('a genuinely past day still resolves to its closed 05:00 site-local period', () => {
    const w = windowForFrequency('daily', '2026-07-28', 'Australia/Perth', NOW);
    expect(w.windowEnd.toISOString()).toBe('2026-07-27T21:00:00.000Z'); // 05:00 Perth
    expect(HOURS(w)).toBe(24);
  });
});

describe('ReportTemplateModal — End Date defaults to the SITE calendar', () => {
  const sensor = {
    id: 1,
    site_id: 7,
    wallfolder_id: 42,
    radar_number: 'RDR-01',
    site_name: 'Telfer',
    timezone: 'Australia/Perth',
  };

  const freezeClock = (iso) => { jest.useFakeTimers().setSystemTime(new Date(iso)); };
  afterEach(() => { jest.useRealTimers(); });

  // `radarData: null` short-circuits the image-signing effect, so the form has no
  // async work outstanding and its initial dates can be read straight off.
  const mount = (props) => {
    render(<ReportTemplateModal onClose={() => {}} radarData={null} {...props} />);
    return screen.getByLabelText(/end date/i, { selector: 'input' });
  };

  test('offers the site\'s today, not the browser\'s, when the two differ', () => {
    freezeClock('2026-08-02T16:10:00Z'); // Jakarta 2nd, Perth 3rd
    expect(mount({ sensor }).value).toBe('2026-08-03');
  });

  test('a sensor-less (manual) report keeps the viewer\'s date', () => {
    freezeClock('2026-08-02T16:10:00Z');
    expect(mount({ sensor: null }).value).toBe('2026-08-02');
  });
});
