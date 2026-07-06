import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';

const mockUseReportSchedules = jest.fn();
jest.mock('../useReportSchedules', () => ({
  useReportSchedules: () => mockUseReportSchedules(),
}));

import ReportReminderManager from '../ReportReminderManager';
import { SiteReportStatus, BulletinObligation } from '../useReportSchedules';
import { BULLETIN_TYPES, defaultScheduleFor } from '../reportTypes';

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

// Radar overdue: reminder passed, report missing, enabled, has sensors.
function overdueSite(id: string, name: string): SiteReportStatus {
  return {
    id,
    name,
    hasRadar: true,
    sensorCount: 1,
    sensors: [{ radarNumber: `${id}-R1`, generatedToday: false }],
    pendingSensors: [{ radarNumber: `${id}-R1`, generatedToday: false }],
    generatedToday: false,
    schedule: { deadline: '06:00', reminder: '00:00', enabled: true, weekday: null },
    bulletins: makeBulletins(),
    saving: false,
    saveError: null,
  };
}

// Radar report already in; nothing should fire.
function doneSite(id: string, name: string): SiteReportStatus {
  return {
    id,
    name,
    hasRadar: true,
    sensorCount: 1,
    sensors: [{ radarNumber: `${id}-R1`, generatedToday: true }],
    pendingSensors: [],
    generatedToday: true,
    schedule: { deadline: '06:00', reminder: '00:00', enabled: true, weekday: null },
    bulletins: makeBulletins(),
    saving: false,
    saveError: null,
  };
}

// Radar done, but the monthly InSAR bulletin is enabled and missing this month.
function insarOverdueSite(id: string, name: string): SiteReportStatus {
  return {
    ...doneSite(id, name),
    bulletins: makeBulletins({
      insar: {
        schedule: { deadline: '23:59', reminder: '00:00', enabled: true, weekday: null },
        generatedInPeriod: false,
      },
    }),
  };
}

function setSites(sites: SiteReportStatus[]) {
  mockUseReportSchedules.mockReturnValue({ sites, refresh: jest.fn() });
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('ReportReminderManager', () => {
  it('renders nothing when every obligation is satisfied', () => {
    setSites([doneSite('S1', 'Alpha')]);
    const { container } = render(<ReportReminderManager />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a blocking overlay when radar is overdue', () => {
    setSites([overdueSite('S1', 'Alpha')]);
    const { container } = render(<ReportReminderManager />);
    expect(container.querySelector('.fixed.inset-0')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });

  it('removes only the acknowledged obligation from the popup', () => {
    setSites([overdueSite('S1', 'Alpha'), overdueSite('S2', 'Beta')]);
    render(<ReportReminderManager />);

    const alphaRow = screen.getByText('Alpha').closest('div')!.parentElement!
      .parentElement as HTMLElement;
    fireEvent.click(within(alphaRow).getByRole('button', { name: /Acknowledge/i }));

    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('closes the popup once the last overdue obligation is acknowledged', () => {
    setSites([overdueSite('S1', 'Alpha')]);
    const { container } = render(<ReportReminderManager />);
    fireEvent.click(screen.getByRole('button', { name: /Acknowledge/i }));
    expect(container.querySelector('.fixed.inset-0')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('registers 30s tick and 5min refresh intervals', () => {
    const spy = jest.spyOn(global, 'setInterval');
    setSites([doneSite('S1', 'Alpha')]);
    render(<ReportReminderManager />);

    const delays = spy.mock.calls.map((c) => c[1]);
    expect(delays).toContain(30_000);
    expect(delays).toContain(300_000);
    spy.mockRestore();
  });

  it('does not surface a radar reminder for a site with no radar sensors', () => {
    const noRadar: SiteReportStatus = {
      ...overdueSite('S1', 'Alpha'),
      hasRadar: false,
      sensors: [],
      pendingSensors: [],
    };
    setSites([noRadar]);
    const { container } = render(<ReportReminderManager />);
    expect(container).toBeEmptyDOMElement();
  });

  describe('monthly InSAR reminder', () => {
    afterEach(() => jest.useRealTimers());

    it('fires on the last day of the month when the bulletin is missing', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date(2026, 0, 31, 12, 0, 0)); // Jan 31 — last day
      setSites([insarOverdueSite('S1', 'Alpha')]);
      render(<ReportReminderManager />);
      expect(screen.getByText('InSAR (monthly)')).toBeInTheDocument();
      expect(screen.getByText('InSAR report')).toBeInTheDocument();
    });

    it('does not fire before the last day of the month', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date(2026, 0, 15, 12, 0, 0)); // Jan 15 — not last day
      setSites([insarOverdueSite('S1', 'Alpha')]);
      const { container } = render(<ReportReminderManager />);
      expect(container).toBeEmptyDOMElement();
    });

    it('acknowledging hides the InSAR reminder for the current hour', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date(2026, 0, 31, 12, 0, 0));
      window.localStorage.clear();
      setSites([insarOverdueSite('S1', 'Alpha')]);
      const { container } = render(<ReportReminderManager />);
      fireEvent.click(screen.getByRole('button', { name: /Acknowledge/i }));
      expect(container).toBeEmptyDOMElement();
    });
  });
});
