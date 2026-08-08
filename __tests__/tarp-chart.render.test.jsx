/**
 * Render tests for the TARP chart in Bahasa Indonesia.
 *
 * The one that matters is the last: an engineer editing a translated chart must
 * be handed the ENGLISH row, because that is the row the email engine reads.
 */

import { fireEvent, render, screen } from '@testing-library/react';

import TarpChart from '@/components/admin/Radar/Tarp/TarpChart';
import { normalizeTarpDocument } from '@/config/tarpDocument';

const triggers = normalizeTarpDocument({
  id: 1,
  site_id: 3,
  triggers: [
    {
      id: 1, sort_order: 1, risk_rating: 'Extreme', band_label: 'TARP Trigger 4 (Red)',
      trigger_label: 'Progressive trend', colour: 'red',
      description: 'Progressive (accelerating) slope displacement trend is identified',
      day_shift: 'Call Geotech', night_shift: 'Call Geotech',
      comments: ['1. State area of concern'],
      def_type: 'Progressive', tarp_level: 4, requires_alarm: false, response_method: 'call',
    },
    {
      id: 2, sort_order: 2, risk_rating: 'Moderate', band_label: 'TARP Trigger 3 (Orange)',
      trigger_label: 'Linear trend', colour: 'orange',
      description: 'A consistent linear (constant velocity) displacement trend is identified.',
      day_shift: 'Email Geotech', night_shift: 'Email Geotech', comments: [],
      def_type: 'Linear', tarp_level: 3, requires_alarm: true, response_method: 'email',
    },
  ],
  contacts: [],
  revisions: [],
}).triggers;

describe('TarpChart in Bahasa Indonesia', () => {
  it('translates the column headings and the standard rows', () => {
    render(<TarpChart triggers={triggers} locale="id" />);

    expect(screen.getByText('Tingkat Risiko')).toBeInTheDocument();
    expect(screen.getByText('Shift Malam')).toBeInTheDocument();
    expect(screen.getByText('Ekstrem')).toBeInTheDocument();
    expect(screen.getByText('Pola Progresif')).toBeInTheDocument();
    expect(screen.getByText('TARP Trigger 4 (Merah)')).toBeInTheDocument();
    expect(screen.getByText('1. Sampaikan area yang menjadi perhatian')).toBeInTheDocument();
    expect(screen.queryByText('Progressive trend')).not.toBeInTheDocument();
  });

  it('states a de-escalated row’s response in Bahasa Indonesia', () => {
    render(<TarpChart triggers={triggers} defaultResponseMethod="call" locale="id" />);

    expect(screen.getByText('EMAIL SAJA')).toBeInTheDocument();
    expect(screen.getByText('Email saja — JANGAN menelepon.')).toBeInTheDocument();
  });

  it('leaves an English site alone', () => {
    render(<TarpChart triggers={triggers} locale="en" />);
    expect(screen.getByText('Risk Rating')).toBeInTheDocument();
    expect(screen.getByText('Progressive trend')).toBeInTheDocument();
  });

  it('hands the untranslated row to the editor', () => {
    const onEdit = jest.fn();
    render(<TarpChart triggers={triggers} locale="id" editable onEdit={onEdit} />);

    fireEvent.click(screen.getByLabelText('Edit Pola Progresif'));

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit.mock.calls[0][0]).toBe(triggers[0]);
    expect(onEdit.mock.calls[0][0].triggerLabel).toBe('Progressive trend');
  });
});
