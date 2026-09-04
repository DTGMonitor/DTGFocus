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
  dayShift: 'Email Geotech',
  nightShift: '',
  commentsText: '',
  extraNote: '',
  defType: 'Linear',
  tarpLevel: '3',
  requiresAlarm: 'yes',
  subjectLabel: '',
  subjectLabelAlarm: '',
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
    expect(screen.queryByLabelText('Subject wording, no alarm')).not.toBeInTheDocument();

    fireEvent.click(advanced);
    expect(advanced).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Subject wording, no alarm')).toBeInTheDocument();
  });

  it('keeps a folded override in the saved values', () => {
    // Folding is a display state. A row that already overrides its wording must
    // still save that wording when an engineer edits something else entirely.
    const { onSave } = openForm(rowValues({ subjectLabel: 'SLOPE FAILURE IMMINENT:' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ subjectLabel: 'SLOPE FAILURE IMMINENT:' })
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

// ---------------------------------------------------------------------------
// Subject wording
//
// The tokens were the part engineers could not read: {band} and {Colour} name
// a fact without showing it, and a token the row cannot answer empties the
// whole wording silently. So the help under each box resolves every token
// against the row on screen.
// ---------------------------------------------------------------------------

describe('subject wording help', () => {
  const hiddenValleyRow = (overrides = {}) => rowValues({
    _subjectLabelTemplate: '{band}:',
    _subjectLabelTemplateAlarm: '',
    bandLabel: 'Orange Notification',
    ...overrides,
  });

  it('shows what each token becomes on this row', () => {
    const help = field('subjectLabel').help(hiddenValleyRow());
    expect(help).toContain('{band} → “Orange Notification”');
    expect(help).toContain('{level} → “3”');
    expect(help).toContain('{Colour} → “Orange”');
  });

  it('shows the wording the row inherits, and what it ends up opening with', () => {
    const help = field('subjectLabel').help(hiddenValleyRow());
    expect(help).toContain('follows the site wording, “{band}:”');
    expect(help).toContain('opens with “Orange Notification:”');
  });

  it('says so when a token the wording needs is not on the row', () => {
    // A fall of ground: grey, in no band. "{band}:" cannot be filled, so the
    // subject carries no wording at all — the case that printed
    // "Grey Notification:" while nothing on the form admitted why.
    const help = field('subjectLabel').help(
      hiddenValleyRow({ bandLabel: '', colour: 'grey', tarpLevel: '' })
    );
    expect(help).toContain('{band} → nothing on this row');
    expect(help).toContain('opens with no wording at all');
  });

  it('previews the alarm wording against an example alarm', () => {
    const help = field('subjectLabelAlarm').help(hiddenValleyRow());
    expect(help).toContain('With a red alarm');
    expect(help).toContain('“Orange Notification:”');
    expect(help).toContain('{AlarmColour} → “Red”');
  });

  it('follows the row\'s own no-alarm wording before the site\'s', () => {
    // The same fallback chain resolveSubjectLabel walks.
    const help = field('subjectLabelAlarm').help(
      hiddenValleyRow({ subjectLabel: '{Colour} Notification:' })
    );
    expect(help).toContain('“Orange Notification:”');
  });

  it('lets a row override the wording outright', () => {
    const help = field('subjectLabel').help(
      hiddenValleyRow({ subjectLabel: 'SLOPE FAILURE IMMINENT:' })
    );
    expect(help).toContain('opens with “SLOPE FAILURE IMMINENT:”');
  });
});

// ---------------------------------------------------------------------------
// Subject preview
//
// The help text says what a token resolves to. That is still a description of
// a rule. The preview is the finished subject line, recomputed on every
// keystroke through composeDeformationSubject — the same call the deformation
// form makes — so what an engineer agrees to on save is what the client reads.
// ---------------------------------------------------------------------------

describe('subject preview', () => {
  /** A Hidden Valley row: the band names itself, the alarm rides in the prefix. */
  const previewRow = (overrides = {}) => {
    const trigger = {
      id: 1, sortOrder: 1, triggerLabel: 'Linear trend',
      bandLabel: 'Orange Notification', colour: 'orange',
      defType: 'Linear', tarpLevel: 3, requiresAlarm: false,
      comments: [], subjectLabel: null, subjectLabelAlarm: null,
    };
    return rowValues({
      _subjectLabelTemplate: '{band}:',
      _subjectLabelTemplateAlarm: '',
      _preview: {
        trigger,
        triggers: [trigger],
        siteName: 'Hidden Valley',
        document: {
          id: 3,
          subjectLabelTemplate: '{band}:',
          subjectLabelTemplateAlarm: null,
          alarmPrefixStyle: 'regions',
          tarpLevelSource: 'trigger',
          triggers: [trigger],
        },
      },
      bandLabel: 'Orange Notification',
      colour: 'orange',
      defType: 'Linear',
      tarpLevel: '3',
      requiresAlarm: 'no',
      ...overrides,
    });
  };

  it('shows the finished subject, with and without an alarm', () => {
    openForm(previewRow());
    expect(screen.getByText(
      '[MODERATE RISK] Orange Notification: Linear Deformation Trend on R01 - Hidden Valley'
    )).toBeInTheDocument();
    expect(screen.getByText(
      '[MODERATE RISK] Red Alarms - Orange Notification: '
      + 'Linear Deformation Trend on R01 - Hidden Valley'
    )).toBeInTheDocument();
  });

  it('follows the band label as it is typed, before anything is saved', () => {
    openForm(previewRow());
    fireEvent.change(screen.getByLabelText('TARP band'), {
      target: { value: 'Yellow Notification' },
    });
    expect(screen.getByText(
      '[MODERATE RISK] Yellow Notification: Linear Deformation Trend on R01 - Hidden Valley'
    )).toBeInTheDocument();
  });

  it('empties the wording when the band label is cleared', () => {
    // The fall-of-ground case, reachable from the form: no band, no token, and
    // the finding names itself. Previously only discoverable by sending one.
    openForm(previewRow());
    fireEvent.change(screen.getByLabelText('TARP band'), { target: { value: '' } });
    expect(screen.getByText(
      '[MODERATE RISK] Linear Deformation Trend on R01 - Hidden Valley'
    )).toBeInTheDocument();
  });

  it('shows the gate on a row that only counts with an alarm', () => {
    openForm(previewRow({ requiresAlarm: 'yes' }));
    // Without an alarm the row is an observation: no level, no token.
    expect(screen.getByText(
      '[NOTIFICATION ONLY] Linear Deformation Trend on R01 - Hidden Valley'
    )).toBeInTheDocument();
    expect(screen.getByText(
      '[MODERATE RISK] Red Alarms - Orange Notification: '
      + 'Linear Deformation Trend on R01 - Hidden Valley'
    )).toBeInTheDocument();
  });

  it('says a row with no deformation type sends nothing', () => {
    openForm(previewRow({ defType: '' }));
    expect(screen.getByText(/answers no deformation type, so it sends no email/i))
      .toBeInTheDocument();
  });

  it('stays visible when the wording overrides are folded away', () => {
    // The preview is its own section, so the answer does not fold with the
    // boxes that change it.
    openForm(previewRow());
    expect(screen.getByRole('button', { name: /Advanced/i }))
      .toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('What the client receives')).toBeInTheDocument();
  });
});
