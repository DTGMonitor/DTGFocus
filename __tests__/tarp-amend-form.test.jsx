/**
 * The amend form, after being cut from one 18-field scroll into three short
 * sections.
 *
 * The rule the whole rearrangement had to obey: a form change must not become a
 * document change. So these tests care less about layout than about what a save
 * ends up holding — derived values only ever fill blanks, a dropdown never drops
 * a document's existing wording, and a field a row cannot use is hidden rather
 * than blanked.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import EditModal from '@/components/admin/Radar/shared/EditModal';
import { TRIGGER_FIELDS } from '@/components/admin/Radar/Tabs/TarpTab';

jest.mock('@/lib/supabaseClient', () => ({ supabase: { from: jest.fn() } }));

const field = (key) => TRIGGER_FIELDS.find((f) => f.key === key);

/** The flat values TarpTab hands the modal, for a Leonora-shaped row. */
const rowValues = (overrides = {}) => ({
  _hasParameterAxis: false,
  _defaultResponseMethod: 'call',
  triggerLabel: 'Linear trend (constant velocity)',
  parameter: '',
  bandLabel: 'TARP Trigger 3 - Orange',
  riskRating: 'Moderate',
  colour: 'orange',
  description: '',
  responseMethod: '',
  responseNotice: '',
  dayShift: 'Email Geotech',
  nightShift: '',
  commentsText: '',
  extraNote: '',
  defType: 'Linear',
  tarpLevel: '3',
  requiresAlarm: 'yes',
  subjectLabel: '',
  subjectLabelAlarm: '',
  severityBracket: '',
  ...overrides,
});

const openForm = (values = rowValues()) => {
  const onSave = jest.fn();
  render(
    <EditModal
      isOpen
      title="Edit trigger"
      fields={TRIGGER_FIELDS}
      initialValues={values}
      onSave={onSave}
      onCancel={() => {}}
    />
  );
  return { onSave };
};

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

describe('the trigger form reads as three sections', () => {
  it('names what the client reads and what the software does, separately', () => {
    openForm();
    expect(screen.getByText('What the chart says')).toBeInTheDocument();
    expect(screen.getByText('What it triggers')).toBeInTheDocument();
  });

  it('starts with the subject overrides folded away', () => {
    openForm();
    const advanced = screen.getByRole('button', { name: /Advanced/i });
    expect(advanced).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Severity bracket')).not.toBeInTheDocument();

    fireEvent.click(advanced);
    expect(advanced).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Severity bracket')).toBeInTheDocument();
  });

  it('keeps a folded override in the saved values', () => {
    // Folding is a display state. A row that already overrides its wording must
    // still save that wording when an engineer edits something else entirely.
    const { onSave } = openForm(rowValues({ severityBracket: '[URGENT]' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ severityBracket: '[URGENT]' })
    );
  });
});

// ---------------------------------------------------------------------------
// Fields a row cannot use
// ---------------------------------------------------------------------------

describe('fields that do not apply are hidden, not emptied', () => {
  it('offers the parameter axis only to a chart that has one', () => {
    openForm();
    expect(screen.queryByLabelText('Parameter')).not.toBeInTheDocument();
  });

  it('shows the parameter axis on a matrix-layout chart', () => {
    openForm(rowValues({ _hasParameterAxis: true, parameter: 'Pola Deformasi' }));
    expect(screen.getByLabelText('Parameter')).toHaveValue('Pola Deformasi');
  });

  it('does not ask an alarm row whether it needs an alarm', () => {
    // No deformation type means the row IS the alarm. The stored flag is what
    // lets a fired alarm find its band, so it is kept, not cleared.
    const { onSave } = openForm(rowValues({ defType: '', requiresAlarm: 'yes' }));
    expect(screen.queryByLabelText(/Only counts when an alarm/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ requiresAlarm: 'yes' })
    );
  });

  it('asks a deformation row, where it is a real question', () => {
    openForm();
    expect(screen.getByLabelText(/Only counts when an alarm/i)).toBeInTheDocument();
  });

  it('asks for a deviation notice only where the chart will print one', () => {
    // 'Email Geotech' against a call-first site: this row deviates.
    openForm();
    expect(screen.getByLabelText('Deviation notice')).toBeInTheDocument();
  });

  it('stays quiet on a row that matches the site default', () => {
    openForm(rowValues({ dayShift: 'Call the supervisor', responseMethod: '' }));
    expect(screen.queryByLabelText('Deviation notice')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Derived values
// ---------------------------------------------------------------------------

describe('values the form can answer for itself', () => {
  it('reads the TARP level out of the band label when it is blank', () => {
    openForm(rowValues({ tarpLevel: '', bandLabel: '' }));
    const band = screen.getByLabelText('TARP band');

    fireEvent.change(band, { target: { value: 'TARP Trigger 4 - Red' } });
    expect(screen.getByLabelText('TARP level')).toHaveValue('4');
  });

  it('never overwrites a level the document already states', () => {
    // A band renamed on a row whose level was deliberately set lower must not
    // have that level quietly rewritten underneath the engineer.
    openForm(rowValues({ tarpLevel: '2' }));
    fireEvent.change(screen.getByLabelText('TARP band'), {
      target: { value: 'TARP Trigger 4 - Red' },
    });
    expect(screen.getByLabelText('TARP level')).toHaveValue('2');
  });

  it('leaves the level alone for a band named without a number', () => {
    openForm(rowValues({ tarpLevel: '' }));
    fireEvent.change(screen.getByLabelText('TARP band'), {
      target: { value: 'Watch and act' },
    });
    expect(screen.getByLabelText('TARP level')).toHaveValue('');
  });

  it('names a blank row after the deformation type it answers', () => {
    openForm(rowValues({ triggerLabel: '', defType: '' }));
    fireEvent.change(screen.getByLabelText('What this row answers'), {
      target: { value: 'Regressive' },
    });
    expect(screen.getByLabelText(/^Trigger/)).toHaveValue('Regressive');
  });

  it("leaves the client's own wording alone", () => {
    openForm();
    fireEvent.change(screen.getByLabelText('What this row answers'), {
      target: { value: 'Regressive' },
    });
    expect(screen.getByLabelText(/^Trigger/)).toHaveValue('Linear trend (constant velocity)');
  });
});

// ---------------------------------------------------------------------------
// Dropdowns that cannot lose a document's wording
// ---------------------------------------------------------------------------

describe('dropdowns keep what a document already says', () => {
  it('constrains the risk rating to the vocabulary in use', () => {
    const options = field('riskRating').computeOptions({ riskRating: 'Moderate' });
    expect(options.map((o) => o.value))
      .toEqual(['', 'Extreme', 'High', 'Moderate', 'Intermediate', 'Low']);
  });

  it('offers back a rating no standard list contains', () => {
    const options = field('riskRating').computeOptions({ riskRating: 'Katastropik' });
    expect(options.map((o) => o.value)).toContain('Katastropik');
  });

  it('does not offer call-then-email as a choice', () => {
    const options = field('responseMethod').computeOptions({ responseMethod: '' });
    expect(options.map((o) => o.value)).toEqual(['', 'call', 'email', 'whatsapp', 'na']);
  });

  it('still offers it to a row that reads that way today', () => {
    // Leonora's alarm rows infer call-then-email from their shift cells. Opening
    // one and saving must not silently stand the row down to a single method.
    const options = field('responseMethod')
      .computeOptions({ responseMethod: 'call_then_email' });
    expect(options.map((o) => o.value)).toContain('call_then_email');
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('validation', () => {
  it('will not save a row with no trigger wording', () => {
    const { onSave } = openForm(rowValues({ triggerLabel: '' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Trigger is required');
  });
});
