import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

// react-hot-toast's <Toaster> asks for prefers-reduced-motion the moment it has
// a toast to place, and jsdom ships no matchMedia.
window.matchMedia =
  window.matchMedia ||
  ((query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList));

const mockUseReportSchedules = jest.fn();
jest.mock('../useReportSchedules', () => ({
  useReportSchedules: () => mockUseReportSchedules(),
}));

// The Send Report button reaches the browser Supabase client and the signed-in
// user. Neither exists under jsdom, and these tests assert on layout, not on a
// send — so both are stubbed and `sendFor` is a spy the send test reads.
const mockSendFor = jest.fn().mockResolvedValue({ ok: true, draft: {}, downloaded: [], failed: [] });
jest.mock('../useDailyReportDraft', () => ({
  useDailyReportDraft: () => ({
    sendFor: mockSendFor,
    sendingSiteId: null,
    error: null,
    clearError: () => {},
  }),
}));
jest.mock('@/components/Reusable/useUserSite', () => ({
  useUserSite: () => ({ user: { email: 'a@dtgeotech.com' }, userSite: { displayname: 'Nessy' } }),
}));

import ScheduledReports from '../ScheduledReports';
import {
  SiteReportStatus,
  BulletinObligation,
} from '../useReportSchedules';
import { RADAR_TYPE, BULLETIN_TYPES, defaultScheduleFor } from '../reportTypes';

function makeBulletins(
  overrides: Partial<Record<string, Partial<BulletinObligation>>> = {}
): BulletinObligation[] {
  return BULLETIN_TYPES.map((def) => ({
    type: def.key,
    label: def.label,
    cadence: def.cadence,
    schedule: defaultScheduleFor(def),
    generatedInPeriod: false,
    ...(overrides[def.key] ?? {}),
  }));
}

function makeSite(overrides: Partial<SiteReportStatus> = {}): SiteReportStatus {
  return {
    id: 'S1',
    name: 'Alpha',
    hasRadar: true,
    sensorCount: 1,
    sensors: [{ radarNumber: 'R1', generatedToday: true }],
    pendingSensors: [],
    generatedToday: true,
    schedule: defaultScheduleFor(RADAR_TYPE),
    bulletins: makeBulletins(),
    saving: false,
    saveError: null,
    ...overrides,
  };
}

function setHook(value: {
  sites: SiteReportStatus[];
  loading: boolean;
  saveSchedule?: jest.Mock;
}) {
  mockUseReportSchedules.mockReturnValue({
    saveSchedule: jest.fn(),
    ...value,
  });
}

describe('ScheduledReports', () => {
  it('shows a loading spinner while loading', () => {
    setHook({ loading: true, sites: [] });
    const { container } = render(<ScheduledReports />);
    expect(screen.getByText(/Loading sites/i)).toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('shows an empty state when there are no sites', () => {
    setHook({ loading: false, sites: [] });
    render(<ScheduledReports />);
    expect(screen.getByText('No sites available.')).toBeInTheDocument();
  });

  it('reveals editable radar time inputs when Manage Schedule is toggled', () => {
    setHook({ loading: false, sites: [makeSite()] });
    const { container } = render(<ScheduledReports />);

    expect(container.querySelectorAll('input[type="time"]')).toHaveLength(0);
    fireEvent.click(screen.getByText('Manage Schedule'));
    // Radar deadline + reminder inputs (bulletins are disabled, so hidden).
    expect(container.querySelectorAll('input[type="time"]')).toHaveLength(2);
  });

  it('shows a saving indicator for a row that is saving', () => {
    setHook({ loading: false, sites: [makeSite({ saving: true })] });
    const { container } = render(<ScheduledReports />);
    fireEvent.click(screen.getByText('Manage Schedule'));
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('shows a save-failed message for a row with a save error', () => {
    setHook({ loading: false, sites: [makeSite({ saveError: 'DB error' })] });
    render(<ScheduledReports />);
    fireEvent.click(screen.getByText('Manage Schedule'));
    expect(screen.getByText('Save failed')).toBeInTheDocument();
  });

  it('exposes a per-type bulletin opt-in (InSAR) in manage mode', () => {
    setHook({ loading: false, sites: [makeSite()] });
    render(<ScheduledReports />);
    fireEvent.click(screen.getByText('Manage Schedule'));
    expect(screen.getByText('InSAR')).toBeInTheDocument();
  });

  it('saves a bulletin schedule with its report type when the toggle is switched on', () => {
    const saveSchedule = jest.fn();
    setHook({ loading: false, sites: [makeSite()], saveSchedule });
    render(<ScheduledReports />);
    fireEvent.click(screen.getByText('Manage Schedule'));

    const insarLabel = screen.getByText('InSAR').closest('label')!;
    const checkbox = insarLabel.querySelector('input[type="checkbox"]')!;
    fireEvent.click(checkbox);

    expect(saveSchedule).toHaveBeenCalledWith('S1', { enabled: true }, 'insar');
  });

  it('shows an enabled bulletin status row in read mode', () => {
    setHook({
      loading: false,
      sites: [
        makeSite({
          bulletins: makeBulletins({
            insar: {
              schedule: { deadline: '23:59', reminder: '00:00', enabled: true, weekday: null },
              generatedInPeriod: true,
            },
          }),
        }),
      ],
    });
    render(<ScheduledReports />);
    expect(screen.getByText('InSAR')).toBeInTheDocument();
    expect(screen.getByText(/Generated this month/i)).toBeInTheDocument();
  });
});

describe('sites with nothing scheduled', () => {
  const allOff = (overrides: Partial<SiteReportStatus> = {}) =>
    makeSite({
      schedule: { ...defaultScheduleFor(RADAR_TYPE), enabled: false },
      ...overrides,
    });

  it('leaves a site off the list when every obligation is disabled', () => {
    setHook({
      loading: false,
      sites: [
        allOff({ id: 'B', name: 'BIB' }),
        allOff({ id: 'I', name: 'IBP' }),
        allOff({ id: 'T', name: 'Test' }),
        makeSite({ id: 'H', name: 'Hidden Valley' }),
      ],
    });
    render(<ScheduledReports />);

    expect(screen.getByText('Hidden Valley')).toBeInTheDocument();
    expect(screen.queryByText('BIB')).not.toBeInTheDocument();
    expect(screen.queryByText('IBP')).not.toBeInTheDocument();
    expect(screen.queryByText('Test')).not.toBeInTheDocument();
  });

  it('keeps a site whose only enabled obligation is a bulletin', () => {
    setHook({
      loading: false,
      sites: [
        allOff({
          name: 'InSAR only',
          bulletins: makeBulletins({
            insar: {
              schedule: { deadline: '23:59', reminder: '00:00', enabled: true, weekday: null },
            },
          }),
        }),
      ],
    });
    render(<ScheduledReports />);
    expect(screen.getByText('InSAR only')).toBeInTheDocument();
  });

  it('drops a radar-enabled site that has no radar hardware', () => {
    setHook({
      loading: false,
      sites: [
        makeSite({ name: 'No Hardware', hasRadar: false, sensorCount: 0, sensors: [], pendingSensors: [] }),
      ],
    });
    render(<ScheduledReports />);
    expect(screen.queryByText('No Hardware')).not.toBeInTheDocument();
  });

  it('brings every site back in manage mode so it can be re-enabled', () => {
    setHook({ loading: false, sites: [allOff({ name: 'BIB' })] });
    render(<ScheduledReports />);

    expect(screen.queryByText('BIB')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Manage Schedule'));
    expect(screen.getByText('BIB')).toBeInTheDocument();
  });

  it('explains an all-disabled list rather than looking broken', () => {
    setHook({ loading: false, sites: [allOff({ name: 'BIB' })] });
    render(<ScheduledReports />);
    expect(screen.getByText(/No sites have a report scheduled/i)).toBeInTheDocument();
    expect(screen.queryByText('No sites available.')).not.toBeInTheDocument();
  });

  it('still distinguishes having no sites at all', () => {
    setHook({ loading: false, sites: [] });
    render(<ScheduledReports />);
    expect(screen.getByText('No sites available.')).toBeInTheDocument();
  });
});

describe('Send Report', () => {
  beforeEach(() => mockSendFor.mockClear());

  it('offers the button for an enabled radar obligation', () => {
    setHook({ loading: false, sites: [makeSite()] });
    render(<ScheduledReports />);
    expect(screen.getByRole('button', { name: /Send Report/i })).toBeEnabled();
  });

  // The site must stay on screen for these two, or the button would be absent
  // merely because its card is — so both keep one bulletin switched on.
  const withInsarOn = () =>
    makeBulletins({
      insar: {
        schedule: { deadline: '23:59', reminder: '00:00', enabled: true, weekday: null },
      },
    });

  it('hides the button when the radar obligation is off but the card still shows', () => {
    setHook({
      loading: false,
      sites: [
        makeSite({
          schedule: { ...defaultScheduleFor(RADAR_TYPE), enabled: false },
          bulletins: withInsarOn(),
        }),
      ],
    });
    render(<ScheduledReports />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Send Report/i })).not.toBeInTheDocument();
  });

  it('hides the button for a site with no radar at all', () => {
    setHook({
      loading: false,
      sites: [
        makeSite({
          hasRadar: false,
          sensorCount: 0,
          sensors: [],
          pendingSensors: [],
          bulletins: withInsarOn(),
        }),
      ],
    });
    render(<ScheduledReports />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Send Report/i })).not.toBeInTheDocument();
  });

  it('disables the button while nothing has been generated to attach', () => {
    setHook({
      loading: false,
      sites: [
        makeSite({
          sensors: [{ radarNumber: 'R1', generatedToday: false }],
          pendingSensors: [{ radarNumber: 'R1', generatedToday: false }],
          generatedToday: false,
        }),
      ],
    });
    render(<ScheduledReports />);
    expect(screen.getByRole('button', { name: /Send Report/i })).toBeDisabled();
  });

  it('stays available on a partial day — the reported radars are still sendable', () => {
    setHook({
      loading: false,
      sites: [
        makeSite({
          sensorCount: 2,
          sensors: [
            { radarNumber: 'R1', generatedToday: true },
            { radarNumber: 'R2', generatedToday: false },
          ],
          pendingSensors: [{ radarNumber: 'R2', generatedToday: false }],
          generatedToday: false,
        }),
      ],
    });
    render(<ScheduledReports />);
    expect(screen.getByRole('button', { name: /Send Report/i })).toBeEnabled();
  });

  it('sends for the site it belongs to', async () => {
    setHook({ loading: false, sites: [makeSite({ id: 'S9', name: 'Hidden Valley' })] });
    render(<ScheduledReports />);
    // Awaited: the handler resolves and raises a toast, which is a state update.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Send Report/i }));
    });
    expect(mockSendFor).toHaveBeenCalledWith('S9', 'Hidden Valley');
  });

  it('is a read-mode control — manage mode hides it', () => {
    setHook({ loading: false, sites: [makeSite()] });
    render(<ScheduledReports />);
    fireEvent.click(screen.getByText('Manage Schedule'));
    expect(screen.queryByRole('button', { name: /Send Report/i })).not.toBeInTheDocument();
  });
});
