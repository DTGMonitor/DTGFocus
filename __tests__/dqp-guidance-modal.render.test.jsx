import { render, screen, fireEvent } from '@testing-library/react';
import DqpGuidanceModal from '@/components/admin/Radar/Dqp/DqpGuidanceModal';

// The shape QualityTable's processedGroups produces.
const GROUPS = [
  {
    id: 2,
    name: 'System Health',
    status: 'Optimal',
    items: [
      { value: 'Optimal', parameter: { id: 9, name: 'Data Availability', parent_id: 2, level: 2, weight: '0.2' } },
      { value: 'Optimal', parameter: { id: 10, name: 'SSR Type & Scan Mode', parent_id: 2, level: 2, weight: '0.05' } },
    ],
  },
  {
    id: 6,
    name: 'Alarms',
    status: 'N/A',
    items: [
      { value: 'N/A', parameter: { id: 20, name: 'Alarm Settings', parent_id: 6, level: 2, weight: '0.07' } },
    ],
  },
];

describe('DqpGuidanceModal', () => {
  it('renders nothing until it is opened', () => {
    const { container } = render(<DqpGuidanceModal isOpen={false} onClose={() => {}} groups={GROUPS} radarNumber="SSR500FX" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names the document the radar is scored against', () => {
    render(<DqpGuidanceModal isOpen onClose={() => {}} groups={GROUPS} radarNumber="SSR500FX" />);
    expect(screen.getByText(/Data Quality Parameters for SSR-FX and Omni — SSR500FX/)).toBeInTheDocument();
  });

  it('walks the table groups, so only the rows this wall folder carries appear', () => {
    render(<DqpGuidanceModal isOpen onClose={() => {}} groups={GROUPS} radarNumber="SSR500FX" />);

    expect(screen.getByText('System Health')).toBeInTheDocument();
    expect(screen.getByText('Data Availability')).toBeInTheDocument();
    expect(screen.getByText('Alarm Settings')).toBeInTheDocument();
    // Levelling is in the document but has no parameter row.
    expect(screen.queryByText(/properly levelled/i)).not.toBeInTheDocument();
  });

  it('shows the radar-specific wording', () => {
    const { rerender } = render(<DqpGuidanceModal isOpen onClose={() => {}} groups={GROUPS} radarNumber="SSR500FX" />);
    expect(screen.getByText(/ranges < 2\.8 km/)).toBeInTheDocument();

    rerender(<DqpGuidanceModal isOpen onClose={() => {}} groups={GROUPS} radarNumber="SSR461XT" />);
    expect(screen.getByText(/short range mode is chosen/)).toBeInTheDocument();
    expect(screen.queryByText(/ranges < 2\.8 km/)).not.toBeInTheDocument();
  });

  it('filters on the description text, not just the parameter name', () => {
    render(<DqpGuidanceModal isOpen onClose={() => {}} groups={GROUPS} radarNumber="SSR500FX" />);

    fireEvent.change(screen.getByPlaceholderText(/Search a parameter/), { target: { value: 'lost connection' } });

    expect(screen.getByText('Data Availability')).toBeInTheDocument();
    expect(screen.queryByText('Alarm Settings')).not.toBeInTheDocument();
    expect(screen.queryByText('Alarms')).not.toBeInTheDocument();
  });
});
