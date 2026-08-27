/**
 * Data contamination — the caveat on a finding whose radar data is interfered
 * with (machinery working the face, a truck parked in the beam).
 *
 * The rule these tests exist to hold is that there are TWO ways an engineer
 * reports it and the client must not be able to tell which one was used:
 *
 *   approach 1  the box is ticked on the trend's own form. The trend record is
 *               written first and archived behind a Data Contamination record
 *               that points back at it. One draft.
 *   approach 2  the caveat is reported later as its own record, with the earlier
 *               trend picked as its precursor.
 *
 * Both must produce the same subject line, the same FINDINGS line, and the same
 * database shape. Everything below is that claim, stated three ways.
 */

import {
    DATA_CONTAMINATION_TYPE,
    TYPE_MATRIX,
    composeFinding,
    generateEmailBody
} from '../config/formConfig';
import { composeDeformationSubject } from '../config/emailSubject';
import { DEFAULT_TARP_POLICY } from '../config/tarpPolicy';
import { defTypeColour } from '../config/riskDisplay';
import { performContaminationSplit } from '../utils/tabHelpers';

const SENSOR = 'R01 - Telfer';

/** Approach 1 — ticked on a Linear form. */
const ticked = { type: 'Linear', contaminatedFrom: 'Linear' };
/** Approach 2 — its own record, raised against a Linear. */
const raised = { type: DATA_CONTAMINATION_TYPE, contaminatedFrom: 'Linear' };

// ---------------------------------------------------------------------------
// The wording
// ---------------------------------------------------------------------------

describe('the finding names both halves', () => {
    it('reads "<trend> with Data Contamination"', () => {
        expect(composeFinding('Linear', 'en', 'Linear'))
            .toBe('Linear Deformation Trend with Data Contamination');
        expect(composeFinding('Progressive', 'en', 'Progressive'))
            .toBe('Progressive Deformation Trend with Data Contamination');
    });

    it('is identical whichever way round the engineer reported it', () => {
        expect(composeFinding(raised.type, 'en', raised.contaminatedFrom))
            .toBe(composeFinding(ticked.type, 'en', ticked.contaminatedFrom));
    });

    it('names only itself when there is no trend to qualify', () => {
        expect(composeFinding(DATA_CONTAMINATION_TYPE, 'en', null)).toBe('Data Contamination');
        // A caveat qualifying a caveat is not a sentence — the argument is
        // ignored rather than printed twice.
        expect(composeFinding(DATA_CONTAMINATION_TYPE, 'en', DATA_CONTAMINATION_TYPE))
            .toBe('Data Contamination');
    });

    it('translates both halves for an Indonesian site', () => {
        expect(composeFinding('Linear', 'id', 'Linear'))
            .toBe('Pola Deformasi Linear dengan Kontaminasi Data');
        expect(composeFinding(DATA_CONTAMINATION_TYPE, 'id', null)).toBe('Kontaminasi Data');
    });

    it('leaves an uncontaminated finding exactly as it was', () => {
        expect(composeFinding('Linear', 'en', null)).toBe('Linear Deformation Trend');
        expect(composeFinding('Rock Fall', 'en', '')).toBe('Rock Fall');
    });
});

// ---------------------------------------------------------------------------
// The subject line
// ---------------------------------------------------------------------------

describe('the subject line', () => {
    const subject = (over) => composeDeformationSubject({
        sensor: SENSOR, policy: DEFAULT_TARP_POLICY, ...over
    });

    it('quotes no TARP trigger — the numbers behind the trend are what is in doubt', () => {
        // Without the caveat this same trend is a TARP 3.
        expect(subject({ type: 'Linear' }).subject)
            .toBe('[MODERATE RISK] TARP Trigger 3: Linear Deformation Trend on R01 - Telfer');

        expect(subject(ticked).subject)
            .toBe('[NOTIFICATION ONLY] Linear Deformation Trend with Data Contamination on R01 - Telfer');
        expect(subject(ticked).tarpLevel).toBe('');
        expect(subject(ticked).triggerLabel).toBe('');
    });

    it('is the same line by either route', () => {
        expect(subject(raised).subject).toBe(subject(ticked).subject);
        expect(subject(raised).bracket).toBe(subject(ticked).bracket);
    });

    it('does not withhold the trigger from a trend that carries no caveat', () => {
        expect(subject({ type: 'Progressive' }).tarpLevel).toBe('TARP 4');
    });

    it('reports a bare contamination as a notification', () => {
        expect(subject({ type: DATA_CONTAMINATION_TYPE }).subject)
            .toBe('[NOTIFICATION ONLY] Data Contamination on R01 - Telfer');
    });
});

// ---------------------------------------------------------------------------
// The body
// ---------------------------------------------------------------------------

describe('the email body', () => {
    const body = (formData) => generateEmailBody(
        { Location: 'North Wall', SurfaceArea: '120', Notes: '', ...formData },
        SENSOR, 'NOTIFICATION ONLY', 'A. Analyst', ''
    );

    it('carries the caveat on the FINDINGS line', () => {
        expect(body({ Type: 'Linear', ContaminatedFrom: 'Linear' }))
            .toContain('FINDINGS:     Linear Deformation Trend with Data Contamination');
    });

    it('still prints the trend\'s metrics when the caveat rides on it', () => {
        // Approach 1 is one draft for both records, so the velocities the
        // engineer measured have to survive into it.
        const text = body({
            Type: 'Linear', ContaminatedFrom: 'Linear', AverageVelocity: '3.2', VCP: '60'
        });
        expect(text).toContain('Velocity: 3.2 mm/h');
        expect(text).toContain('VCP: 60');
    });

    it('carries the pre-filled note through', () => {
        const note = 'This finding is interfered by the machinery activity close to the area';
        expect(body({ Type: 'Linear', ContaminatedFrom: 'Linear', Notes: note })).toContain(note);
    });
});

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

describe('the deformation type', () => {
    it('is selectable in the form and carries no TARP trigger of its own', () => {
        expect(TYPE_MATRIX[DATA_CONTAMINATION_TYPE]).toEqual({ tarp: '', fields: [] });
    });

    it('is the last band before nothing at all', () => {
        expect(defTypeColour(DATA_CONTAMINATION_TYPE)).toBe('pink');
    });
});

// ---------------------------------------------------------------------------
// The two-record write (approach 1)
// ---------------------------------------------------------------------------

/**
 * Minimal Supabase double. Records every insert and update so the test can
 * assert the ORDER the two writes happened in, which is the part that matters:
 * the caveat has to be safely stored before the trend is archived behind it.
 */
const makeClient = ({ insertError = null, updateError = null } = {}) => {
    const calls = [];
    return {
        calls,
        from() {
            return {
                insert(rows) {
                    calls.push({ op: 'insert', rows });
                    return {
                        select() {
                            return {
                                single: async () =>
                                    insertError
                                        ? { data: null, error: insertError }
                                        : { data: { id: 202 }, error: null }
                            };
                        }
                    };
                },
                update(patch) {
                    return {
                        eq: async (_col, id) => {
                            calls.push({ op: 'update', patch, id });
                            return { error: updateError };
                        }
                    };
                }
            };
        }
    };
};

describe('performContaminationSplit', () => {
    const payload = { def_type: DATA_CONTAMINATION_TYPE, location: 'North Wall' };

    it('points the caveat at the trend and archives the trend behind it', async () => {
        const client = makeClient();
        const res = await performContaminationSplit(client, 101, payload);

        expect(res).toEqual({ ok: true, inserted: { id: 202 } });
        expect(client.calls).toEqual([
            { op: 'insert', rows: [{ ...payload, precursors: [101] }] },
            { op: 'update', patch: { isactive: 'No' }, id: 101 }
        ]);
    });

    it('merges extra precursors after the trend, without duplicating it', async () => {
        const client = makeClient();
        await performContaminationSplit(client, 101, { ...payload, precursors: [101, 99] });
        expect(client.calls[0].rows[0].precursors).toEqual([101, 99]);
    });

    it('leaves the trend active when the caveat cannot be stored', async () => {
        // The trend is a real finding on its own. Archiving it with nothing
        // standing in its place would take it off the board entirely.
        const client = makeClient({ insertError: { message: 'nope' } });
        const res = await performContaminationSplit(client, 101, payload);

        expect(res.ok).toBe(false);
        expect(res.stage).toBe('insert');
        expect(client.calls.some((c) => c.op === 'update')).toBe(false);
    });

    it('reports the archive failure rather than claiming success', async () => {
        const client = makeClient({ updateError: { message: 'nope' } });
        const res = await performContaminationSplit(client, 101, payload);

        expect(res.ok).toBe(false);
        expect(res.stage).toBe('archive');
        // Nothing is lost — the caveat is stored and points at the trend — so
        // the caller is handed the id to say so.
        expect(res.inserted).toEqual({ id: 202 });
    });
});
