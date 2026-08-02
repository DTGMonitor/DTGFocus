/**
 * Partial resolution of alarm improvements from the DQP surfaces.
 *
 * The rule the whole feature turns on: a recommendation is only written when the
 * analyst answered it. Everywhere partial resolution is offered — a status
 * change to another non-optimal value, and Edit entry — every row starts inert,
 * so a form submitted without touching the section closes nothing. The one
 * exception is the "→ Optimal" gate, which still requires all of them.
 */

import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));

import {
  LEAVE_OPEN,
  NAMES_ENGINEER,
  initialResolutions,
  isResolved,
  resolutionUpdates,
  unresolved,
} from '@/utils/dqpImprovements';
import ImprovementResolution from '@/components/admin/Radar/Dqp/ImprovementResolution';

const AT = '2026-08-02T09:00:00.000Z';

/** An open alarm_improvement row, shaped as useOpenImprovements returns it. */
const improvement = (over = {}) => ({
  id: over.id ?? 1,
  type: over.type ?? 'Alarm Threshold Review',
  issue: over.issue ?? 'Repeated nuisance alarms',
  action: over.action ?? 'Review the mask',
  alarm_records: { id: 10, alarm_region: over.region ?? 5, cause: over.cause ?? 'Rainfall' },
});

const REGIONS = [
  { id: 5, name: 'North Wall Red', type: 'red' },
  { id: 6, name: 'South Wall Amber', type: 'orange' },
];

describe('resolutionUpdates', () => {
  test('writes only the answered rows', () => {
    const updates = resolutionUpdates(
      {
        1: { status: NAMES_ENGINEER, site_engineer: ' Dave ' },
        2: { status: LEAVE_OPEN, site_engineer: '' },
        3: { status: 'Not Implemented', site_engineer: 'ignored' },
      },
      AT
    );

    expect(updates.map((u) => u.id)).toEqual(['1', '3']);
    expect(updates[0].patch).toEqual({
      improvement_status: 'Modified',
      site_action: AT,
      site_engineer: 'Dave', // trimmed
    });
    // Nobody is credited for a recommendation the site declined.
    expect(updates[1].patch.site_engineer).toBe('');
  });

  test('an untouched form produces no writes at all', () => {
    const rows = [improvement({ id: 1 }), improvement({ id: 2 })];
    expect(resolutionUpdates(initialResolutions(rows), AT)).toEqual([]);
    expect(resolutionUpdates(undefined, AT)).toEqual([]);
    expect(resolutionUpdates({}, AT)).toEqual([]);
  });

  test('an unrecognised status is left open rather than written through', () => {
    expect(isResolved({ status: 'Pending' })).toBe(false);
    expect(resolutionUpdates({ 1: { status: 'Pending' } }, AT)).toEqual([]);
  });
});

describe('initialResolutions', () => {
  test('partial surfaces start inert, so submitting changes nothing', () => {
    const rows = [improvement({ id: 1 }), improvement({ id: 2 })];
    expect(initialResolutions(rows)).toEqual({
      1: { status: LEAVE_OPEN, site_engineer: '' },
      2: { status: LEAVE_OPEN, site_engineer: '' },
    });
    expect(unresolved(rows, initialResolutions(rows))).toHaveLength(2);
  });

  test('the → Optimal gate starts every row answered, as it always has', () => {
    const rows = [improvement({ id: 1 }), improvement({ id: 2 })];
    const seeded = initialResolutions(rows, { requireAll: true });
    expect(Object.values(seeded).every((c) => c.status === NAMES_ENGINEER)).toBe(true);
    expect(unresolved(rows, seeded)).toHaveLength(0);
  });
});

describe('ImprovementResolution', () => {
  const setup = (props = {}) => {
    const onChange = jest.fn();
    const improvements = props.improvements ?? [
      improvement({ id: 1, issue: 'Repeated nuisance alarms', region: 5 }),
      improvement({ id: 2, issue: 'Mask too tight', region: 6 }),
    ];
    render(
      <ImprovementResolution
        improvements={improvements}
        regions={REGIONS}
        value={props.value ?? initialResolutions(improvements, { requireAll: props.requireAll })}
        onChange={onChange}
        requireAll={props.requireAll}
      />
    );
    return { onChange, improvements };
  };

  test('lists each open recommendation against the region it was raised on', () => {
    setup();
    expect(screen.getByText('Repeated nuisance alarms')).toBeInTheDocument();
    expect(screen.getByText('Mask too tight')).toBeInTheDocument();
    expect(screen.getByText('North Wall Red')).toBeInTheDocument();
    expect(screen.getByText('South Wall Amber')).toBeInTheDocument();
  });

  test('counts what has been answered so partial progress is visible', () => {
    const improvements = [improvement({ id: 1 }), improvement({ id: 2 }), improvement({ id: 3 })];
    setup({
      improvements,
      value: {
        1: { status: NAMES_ENGINEER, site_engineer: 'Dave' },
        2: { status: LEAVE_OPEN },
        3: { status: LEAVE_OPEN },
      },
    });
    expect(screen.getByText(/1 of 3 answered/)).toBeInTheDocument();
  });

  test('the engineer field appears only for a Modified resolution', () => {
    const improvements = [improvement({ id: 1 })];
    setup({
      improvements,
      value: { 1: { status: 'Not Implemented' } },
    });
    expect(screen.queryByLabelText(/site engineer/i)).not.toBeInTheDocument();
  });

  test('naming the engineer reports the change without touching the status', () => {
    const improvements = [improvement({ id: 1 })];
    const { onChange } = setup({
      improvements,
      value: { 1: { status: NAMES_ENGINEER, site_engineer: '' } },
    });
    fireEvent.change(screen.getByLabelText(/site engineer/i), { target: { value: 'Dave' } });
    expect(onChange).toHaveBeenCalledWith(1, { site_engineer: 'Dave' });
  });

  test('says so plainly when nothing is awaiting feedback', () => {
    setup({ improvements: [] });
    expect(screen.getByText(/no recommendation is awaiting site feedback/i)).toBeInTheDocument();
  });

  test('the → Optimal gate does not print a partial-progress count', () => {
    setup({ requireAll: true });
    expect(screen.queryByText(/answered —/)).not.toBeInTheDocument();
  });
});
