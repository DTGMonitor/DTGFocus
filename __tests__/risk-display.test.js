/**
 * Per-site risk wording.
 *
 * The rolled-up risk of a sensor is a NOTIFICATION statement, and the three
 * sites do not notify the same way. These tests are the contract between what a
 * site's TARP chart contains and what the board, the sensor detail and the
 * comprehensive report print for it:
 *
 *   Telfer         quotes the highest TARP level, blast and rain included
 *   Leonora        quotes a level only at TARP 3/4, else names the deformation
 *   Hidden Valley  names the band colour and never a level
 *
 * Colour is the fact underneath all three: it always follows the deformation
 * TYPE, so the same trend is the same colour at every site.
 */

import {
    resolveRiskPresentation,
    presentationFromLabel,
    pendingPresentation,
    getRiskDisplayMode,
    defTypeColour,
    recordColour,
    labelColour,
    riskSentence,
    tarpPriority,
    NO_SIGNIFICANT,
} from '@/config/riskDisplay';
import { ALARM_GATED_TARP_POLICY, DEFAULT_TARP_POLICY, resolveTarpLevel } from '@/config/tarpPolicy';

const rec = (def_type, tarp_level = '', over = {}) => ({
    def_type,
    tarp_level,
    created_at: '2026-07-01T00:00:00Z',
    ...over,
});

const telfer = { site_name: 'Telfer' };
const leonora = { site_name: 'Leonora' };
const hiddenValley = { site_name: 'Hidden Valley' };

describe('band colour follows the deformation type', () => {
    it.each([
        ['Progressive', 'red'],
        ['Linear Accelerating', 'red'],
        ['Linear', 'orange'],
        ['Regressive', 'yellow'],
        ['Blast Event', 'yellow'],
        ['Rainfall Event', 'yellow'],
        ['Rock Fall', 'grey'],
        ['Failure', 'grey'],
        ['Material Detachment', 'grey'],
        ['Rapid Movement', 'grey'],
    ])('%s is %s', (type, colour) => {
        expect(defTypeColour(type)).toBe(colour);
    });

    it('does not let a TARP level override the type', () => {
        // Telfer's blast rows are TARP 2; a TARP 2 badge is yellow either way,
        // but the colour must come from the type so a levelless record still has one.
        expect(recordColour(rec('Rock Fall', ''))).toBe('grey');
        expect(recordColour(rec('Blast Event', 'TARP 2'))).toBe('yellow');
        expect(recordColour(rec('Linear', ''))).toBe('orange');
    });

    it('falls back to the TARP level only when the type is unreadable', () => {
        expect(recordColour(rec('', 'TARP 4'))).toBe('red');
        expect(recordColour(rec(null, ''))).toBe('grey');
    });
});

describe('site → wording mode', () => {
    it('reads the site name', () => {
        expect(getRiskDisplayMode(telfer)).toBe('tarp');
        expect(getRiskDisplayMode(leonora)).toBe('tarp-major');
        expect(getRiskDisplayMode(hiddenValley)).toBe('notification');
    });

    it('defaults an unknown site to the DTG standard', () => {
        expect(getRiskDisplayMode({ site_name: 'Somewhere Else' })).toBe('tarp');
        expect(getRiskDisplayMode(null)).toBe('tarp');
    });
});

describe('Telfer — always the highest TARP level', () => {
    it('quotes the highest level across the active records', () => {
        const p = resolveRiskPresentation(
            [rec('Regressive', 'TARP 2'), rec('Progressive', 'TARP 4'), rec('Linear', 'TARP 3')],
            telfer
        );
        expect(p.label).toBe('TARP 4');
        expect(p.colour).toBe('red');
        expect(p.subtitle).toBe('Critical');
    });

    it('falls back to TARP 1 when nothing is active', () => {
        expect(resolveRiskPresentation([], telfer).label).toBe('TARP 1');
        expect(resolveRiskPresentation([], telfer).colour).toBe('green');
    });

    it('quotes TARP 2 for a blast, and colours it yellow', () => {
        const p = resolveRiskPresentation([rec('Blast Event', 'TARP 2')], telfer);
        expect(p.label).toBe('TARP 2');
        expect(p.colour).toBe('yellow');
    });

    it('still colours by type when the only active records carry no level', () => {
        // A rock fall is not a TARP trigger, but the board should not paint the
        // sensor green as though nothing had happened.
        const p = resolveRiskPresentation([rec('Rock Fall', '')], telfer);
        expect(p.label).toBe('TARP 1');
        expect(p.colour).toBe('grey');
    });
});

describe('Leonora — a TARP level only when one must be responded to', () => {
    it('quotes TARP 4 and TARP 3', () => {
        expect(resolveRiskPresentation([rec('Progressive', 'TARP 4')], leonora).label).toBe('TARP 4');
        expect(resolveRiskPresentation([rec('Linear', 'TARP 3')], leonora).label).toBe('TARP 3');
    });

    it('names the deformation instead of quoting a lower level', () => {
        const p = resolveRiskPresentation([rec('Regressive', 'TARP 2')], leonora);
        expect(p.label).toBe('Regressive');
        expect(p.colour).toBe('yellow');
    });

    it('names the worst deformation on the colour scale, not the newest', () => {
        const p = resolveRiskPresentation(
            [
                rec('Rock Fall', '', { created_at: '2026-07-05T00:00:00Z' }),
                rec('Regressive', '', { created_at: '2026-07-01T00:00:00Z' }),
            ],
            leonora
        );
        expect(p.label).toBe('Regressive');
    });

    it('reads a blast as the event it is — the site assigns it no TARP 2', () => {
        expect(resolveTarpLevel('Blast Event', { policy: ALARM_GATED_TARP_POLICY })).toBe('');
        expect(resolveTarpLevel('Rainfall Event', { policy: ALARM_GATED_TARP_POLICY, hasAlarm: true })).toBe('');
        const p = resolveRiskPresentation([rec('Blast Event', '')], leonora);
        expect(p.label).toBe('Blast Event');
        expect(p.tarpLevel).toBe('');
    });

    it('falls back to no significant with nothing active', () => {
        expect(resolveRiskPresentation([], leonora).label).toBe(NO_SIGNIFICANT);
    });
});

describe('Hidden Valley — names the band, never the level', () => {
    it.each([
        ['Progressive', 'Red Notification'],
        ['Linear Accelerating', 'Red Notification'],
        ['Linear', 'Orange Notification'],
        ['Regressive', 'Yellow Notification'],
        ['Blast Event', 'Yellow Notification'],
        ['Rainfall Event', 'Yellow Notification'],
    ])('%s reads "%s"', (type, label) => {
        expect(resolveRiskPresentation([rec(type, 'TARP 3')], hiddenValley).label).toBe(label);
    });

    it('names the event itself for a grey type, which has no notification band', () => {
        expect(resolveRiskPresentation([rec('Rock Fall', '')], hiddenValley).label).toBe('Rock Fall');
        expect(resolveRiskPresentation([rec('Failure', '')], hiddenValley).label).toBe('Failure');
    });

    it('never prints a TARP number, whatever the record carries', () => {
        const p = resolveRiskPresentation([rec('Progressive', 'TARP 4')], hiddenValley);
        expect(p.label).not.toMatch(/TARP/i);
        // The record's own level is still carried, for the badge on the record.
        expect(p.tarpLevel).toBe('TARP 4');
    });

    it('falls back to no significant with nothing active', () => {
        expect(resolveRiskPresentation([], hiddenValley).label).toBe(NO_SIGNIFICANT);
    });
});

describe('the driving record', () => {
    it('is the one the label was read from, so the location can be cited', () => {
        const p = resolveRiskPresentation(
            [rec('Linear', 'TARP 3', { location: 'WEST DOME' }), rec('Regressive', 'TARP 2', { location: 'Area 2' })],
            telfer
        );
        expect(p.driver.location).toBe('WEST DOME');
    });

    it('breaks a colour tie on the TARP level', () => {
        const p = resolveRiskPresentation(
            [rec('Blast Event', ''), rec('Regressive', 'TARP 2')],
            hiddenValley
        );
        expect(p.driver.def_type).toBe('Regressive');
    });
});

describe('presentations built from a bare label', () => {
    it('reads a TARP level', () => {
        expect(presentationFromLabel('TARP 4').colour).toBe('red');
        expect(presentationFromLabel('TARP 3').colour).toBe('orange');
        expect(presentationFromLabel('TARP 2').colour).toBe('yellow');
        expect(presentationFromLabel('TARP 1').colour).toBe('green');
    });

    it('reads a band name and a deformation type', () => {
        expect(labelColour('Red Notification')).toBe('red');
        expect(labelColour('Yellow Notification')).toBe('yellow');
        expect(labelColour('Regressive')).toBe('yellow');
        expect(labelColour(NO_SIGNIFICANT)).toBe('green');
    });

    it('carries the level for the badge only when there is one', () => {
        expect(presentationFromLabel('TARP 3').tarpLevel).toBe('TARP 3');
        expect(presentationFromLabel('Red Notification').tarpLevel).toBe('');
    });
});

describe('the pending state, before records load', () => {
    it('shows the view value where the site words risk that way', () => {
        expect(pendingPresentation({ ...telfer, risk: 'TARP 3' }).label).toBe('TARP 3');
    });

    it('waits rather than printing a TARP number a site does not use', () => {
        expect(pendingPresentation({ ...hiddenValley, risk: 'TARP 3' }).label).toBe('—');
        expect(pendingPresentation({ ...leonora, risk: 'TARP 2' }).label).toBe('—');
    });
});

describe('the Key Findings sentence', () => {
    it('reads correctly for every kind of label', () => {
        expect(riskSentence(resolveRiskPresentation([rec('Progressive', 'TARP 4')], telfer)))
            .toBe('Overall risk is on TARP 4 – Critical condition.');
        expect(riskSentence(resolveRiskPresentation([rec('Progressive', 'TARP 4')], hiddenValley)))
            .toBe('Overall risk is on Red Notification – Critical condition.');
        expect(riskSentence(resolveRiskPresentation([rec('Regressive', '')], leonora)))
            .toBe('Overall risk is on Regressive – Intermediate Risk condition.');
        expect(riskSentence(resolveRiskPresentation([], leonora)))
            .toBe('No significant deformation risk recorded for this period.');
    });
});

describe('tarpPriority', () => {
    it('reads the four levels and nothing else', () => {
        expect(tarpPriority('TARP 4')).toBe(4);
        expect(tarpPriority('tarp 1')).toBe(1);
        expect(tarpPriority('')).toBe(0);
        expect(tarpPriority(null)).toBe(0);
        expect(tarpPriority('Red Notification')).toBe(0);
    });
});

describe('the DTG standard is unchanged', () => {
    it('still triggers TARP 2 on blast and rainfall for a site with no document', () => {
        expect(resolveTarpLevel('Blast Event', { policy: DEFAULT_TARP_POLICY })).toBe('TARP 2');
        expect(resolveTarpLevel('Rainfall Event', { policy: DEFAULT_TARP_POLICY })).toBe('TARP 2');
    });
});
