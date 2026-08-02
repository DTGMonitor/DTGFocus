import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EditDqpEntryModal from '@/components/admin/Radar/Dqp/EditDqpEntryModal';
import { LEAVE_OPEN } from '@/utils/dqpImprovements';

/** Open recommendations the alarm-improvement query resolves to, per test. */
let openImprovements = [];

jest.mock('@/lib/supabaseClient', () => ({
  supabase: {
    storage: {
      from: () => ({
        createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://signed/one.png' }, error: null }),
      }),
    },
    // useOpenImprovements' chain: .select().eq().in().order() → { data, error }
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => Promise.resolve({ data: openImprovements, error: null }),
      };
      return chain;
    },
  },
}));

// jsdom has no object URLs; the modal makes one per replacement preview.
beforeAll(() => {
  URL.createObjectURL = jest.fn(() => 'blob:preview');
  URL.revokeObjectURL = jest.fn();
});

const ITEM = {
  parameter_id: 20,
  value: 'Sub-Optimal',
  notes: 'Two regions alarmed on noise.',
  appendix: 'Long write-up.',
  parameter: { id: 20, name: 'Alarm Settings', parent_id: 6, weight: '0.07' },
  images: [
    { id: 11, caption: 'Alarm map', image_url: 'site/one.png' },
    { id: 12, caption: 'Coherence', image_url: 'site/two.png' },
  ],
};

const renderModal = (props = {}) => {
  const onSubmit = jest.fn().mockResolvedValue(undefined);
  const onClose = jest.fn();
  render(<EditDqpEntryModal isOpen onClose={onClose} onSubmit={onSubmit} item={ITEM} {...props} />);
  return { onSubmit, onClose };
};

describe('EditDqpEntryModal', () => {
  it('renders nothing without a row to edit', () => {
    const { container } = render(<EditDqpEntryModal isOpen onClose={() => {}} onSubmit={() => {}} item={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says plainly that the status is untouched and no improvement is raised', () => {
    renderModal();
    expect(screen.getByText(/status is not changed and no new\s+improvement is raised/i)).toBeInTheDocument();
  });

  it('offers no way to change the status', () => {
    renderModal();
    for (const status of ['Optimal', 'Acceptable', 'Sub-Optimal', 'Critical']) {
      expect(screen.queryByRole('checkbox', { name: status })).not.toBeInTheDocument();
    }
  });

  it('prefills the notes, appendix and captions from the row', () => {
    renderModal();
    expect(screen.getByDisplayValue('Two regions alarmed on noise.')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Long write-up.')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Alarm map')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Coherence')).toBeInTheDocument();
  });

  it('hands back edited text and captions, keeping figure order', async () => {
    const { onSubmit } = renderModal();

    fireEvent.change(screen.getByDisplayValue('Two regions alarmed on noise.'), {
      target: { value: 'Corrected note.' },
    });
    fireEvent.change(screen.getByDisplayValue('Alarm map'), { target: { value: 'Alarm map (west wall)' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const [payload, item] = onSubmit.mock.calls[0];
    expect(item).toBe(ITEM);
    expect(payload.notes).toBe('Corrected note.');
    expect(payload.appendix).toBe('Long write-up.');
    expect(payload.figures).toEqual([
      { id: 11, caption: 'Alarm map (west wall)', replacement: null },
      { id: 12, caption: 'Coherence', replacement: null },
    ]);
  });

  it('carries a replacement file against the figure it replaces', async () => {
    const { onSubmit } = renderModal();

    const file = new File(['x'], 'new-map.png', { type: 'image/png' });
    const inputs = document.querySelectorAll('input[type="file"]');
    fireEvent.change(inputs[0], { target: { files: [file] } });

    expect(screen.getByText(/replaced with new-map\.png/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());

    const { figures } = onSubmit.mock.calls[0][0];
    expect(figures[0].replacement).toBe(file);
    expect(figures[1].replacement).toBeNull();
  });

  it('drops a detached figure from the payload', async () => {
    const { onSubmit } = renderModal();

    fireEvent.click(screen.getAllByTitle(/Detach this figure/i)[0]);
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].figures.map((f) => f.id)).toEqual([12]);
  });

  it('sends null rather than an empty string when the text is cleared', async () => {
    const { onSubmit } = renderModal();

    fireEvent.change(screen.getByDisplayValue('Two regions alarmed on noise.'), { target: { value: '   ' } });
    fireEvent.change(screen.getByDisplayValue('Long write-up.'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].notes).toBeNull();
    expect(onSubmit.mock.calls[0][0].appendix).toBeNull();
  });

  it('does not offer to attach a figure to a row that has none', () => {
    render(
      <EditDqpEntryModal isOpen onClose={() => {}} onSubmit={() => {}} item={{ ...ITEM, images: [] }} />
    );
    expect(screen.getByText(/Attaching one is part of logging an improvement/i)).toBeInTheDocument();
    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(0);
  });

  /**
   * Closing a recommendation is the opposite of raising one, which is why this
   * modal is allowed to do it: feedback on one of several raised alarms arrives
   * while the row itself stays where it is.
   */
  describe('open recommendations', () => {
    const REGIONS = [{ id: 5, name: 'North Wall', type: 'red' }];
    const OPEN = [
      { id: 77, type: 'Alarm Threshold Review', issue: 'Repeated nuisance alarms', action: 'Review the mask',
        alarm_records: { id: 10, alarm_region: 5, cause: 'Rainfall' } },
      { id: 78, type: 'Alarm Threshold Review', issue: 'Mask too tight', action: 'Widen it',
        alarm_records: { id: 11, alarm_region: 5, cause: 'Blasting' } },
    ];

    beforeEach(() => { openImprovements = OPEN; });
    afterEach(() => { openImprovements = []; });

    it('lists them for an alarm row and leaves every one open by default', async () => {
      const { onSubmit } = renderModal({ regions: REGIONS });

      expect(await screen.findByText('Repeated nuisance alarms')).toBeInTheDocument();
      expect(screen.getByText('Mask too tight')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
      await waitFor(() => expect(onSubmit).toHaveBeenCalled());

      // The whole point: an edit that ignores the section closes nothing.
      const { improvementResolutions } = onSubmit.mock.calls[0][0];
      expect(improvementResolutions).toEqual({
        77: { status: LEAVE_OPEN, site_engineer: '' },
        78: { status: LEAVE_OPEN, site_engineer: '' },
      });
    });

    it('offers a per-row choice rather than one decision for all of them', async () => {
      renderModal({ regions: REGIONS });
      await screen.findByText('Repeated nuisance alarms');

      // One Resolution control per recommendation is what makes it partial; a
      // single shared control would only ever close all or none.
      expect(screen.getAllByLabelText(/^resolution$/i)).toHaveLength(2);
      expect(screen.getByText(/0 of 2 answered/)).toBeInTheDocument();
      // What each choice then writes is covered by resolutionUpdates' own tests —
      // Radix's Select cannot be opened under jsdom's pointer model.
    });

    it('is not offered on a row that carries no alarm recommendations', () => {
      render(
        <EditDqpEntryModal
          isOpen
          onClose={() => {}}
          onSubmit={() => {}}
          regions={REGIONS}
          item={{ ...ITEM, parameter_id: 7, parameter: { id: 7, name: 'Coherence' } }}
        />
      );
      expect(screen.queryByText(/open recommendations/i)).not.toBeInTheDocument();
    });
  });
});
