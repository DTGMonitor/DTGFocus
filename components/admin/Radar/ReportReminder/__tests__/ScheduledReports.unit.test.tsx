import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

const mockUseReportSchedules = jest.fn();
jest.mock('../useReportSchedules', () => ({
  useReportSchedules: () => mockUseReportSchedules(),
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
