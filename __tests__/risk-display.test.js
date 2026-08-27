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

// The hook module pulls in supabaseClient at import time; stub it so importing
// the pure helper does not spin up a real client.
jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));

import { recordsForRisk, deriveRisk } from '@/components/admin/Reports/useComprehensiveReportData';
import {
    resolveRiskPresentation,
    presentationFromLabel,
    pendingPresentation,
    recordBadgeLabel,
    getRiskDisplayMode,
    defTypeColour,
    recordColour,
    labelColour,
    riskSentence,
    tarpPriority,
    COLOUR_RANK,
    RISK_ORDER,
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
        ['Rapid Movement', 'darkred'],
        ['Progressive', 'red'],
        ['Linear Accelerating', 'red'],
        ['Linear', 'orange'],
        ['Regressive', 'yellow'],
        ['Blast Event', 'yellow'],
        ['Rainfall Event', 'yellow'],
        ['Rock Fall', 'grey'],
        ['Failure', 'grey'],
        ['Material Detachment', 'grey'],
    ])('%s is %s', (type, colour) => {
        expect(defTypeColour(type)).toBe(colour);
    });

    it('keeps the type\'s own band where the level agrees or is absent', () => {
        // Telfer's blast rows are TARP 2, which is yellow either way; and a
        // record carrying no level at all still has a band from its type.
        expect(recordColour(rec('Rock Fall', ''))).toBe('grey');
        expect(recordColour(rec('Blast Event', 'TARP 2'))).toBe('yellow');
        expect(recordColour(rec('Linear', ''))).toBe('orange');
    });

    it('takes the TARP level when it is the more severe of the two', () => {
        // A site whose levels are alarm thresholds: a linear trend on a red
        // alarm is TARP 4, and a card badged TARP 4 must not print orange.
        expect(recordColour(rec('Linear', 'TARP 4'))).toBe('red');
        expect(recordColour(rec('Regressive', 'TARP 3'))).toBe('orange');
        expect(recordColour(rec('Failure', 'TARP 4'))).toBe('red');
    });

    it('keeps the type when IT is the more severe', () => {
        // The same site notifies a progressive trend at TARP 3 when only an
        // orange alarm fired. What the ground is doing has not become calmer.
        expect(recordColour(rec('Progressive', 'TARP 3'))).toBe('red');
        expect(recordColour(rec('Linear', 'TARP 2'))).toBe('orange');
        expect(recordColour(rec('Rock Fall', 'TARP 1'))).toBe('grey');
    });

    it('falls back to the TARP level when the type is unreadable', () => {
        expect(recordColour(rec('', 'TARP 4'))).toBe('red');
        expect(recordColour(rec(null, ''))).toBe('grey');
    });
});

describe('the ranking', () => {
    it('is rapid movement, the TARP bands, fall of ground, contamination, then green', () => {
        expect(RISK_ORDER).toEqual(['darkred', 'red', 'orange', 'yellow', 'grey', 'pink', 'green']);
        expect(RISK_ORDER.map((c) => COLOUR_RANK[c])).toEqual([6, 5, 4, 3, 2, 1, 0]);
    });

    it('puts a rapid movement above a TARP 4', () => {
        expect(COLOUR_RANK[recordColour(rec('Rapid Movement', ''))])
            .toBeGreaterThan(COLOUR_RANK[recordColour(rec('Progressive', 'TARP 4'))]);
    });

    it('keeps darkred even when the record also carries a TARP level', () => {
        // A level can only ever reach red, and the type outranks it.
        expect(recordColour(rec('Rapid Movement', 'TARP 4'))).toBe('darkred');
    });

    it('puts fall of ground above nothing, and below every live trend', () => {
        const fallOfGround = ['Rock Fall', 'Failure', 'Material Detachment'];
        for (const type of fallOfGround) {
            expect(COLOUR_RANK[defTypeColour(type)]).toBeGreaterThan(COLOUR_RANK.green);
            expect(COLOUR_RANK[defTypeColour(type)]).toBeLessThan(COLOUR_RANK[defTypeColour('Regressive')]);
        }
    });

    it('puts data contamination last, and still above nothing at all', () => {
        // The band makes no claim about the slope, so it must not out-rank a
        // record that does — including a rock fall, which is only "past tense".
        expect(defTypeColour('Data Contamination')).toBe('pink');
        expect(COLOUR_RANK.pink).toBeGreaterThan(COLOUR_RANK.green);
        expect(COLOUR_RANK.pink).toBeLessThan(COLOUR_RANK[defTypeColour('Rock Fall')]);
    });

    it('reads contamination out of a free-typed value, but never over a trend', () => {
        expect(defTypeColour('Data contamination from machinery')).toBe('pink');
        expect(labelColour('Data Contamination')).toBe('pink');
        // Contamination is last in the keyword rules on purpose: it is the
        // calmest band, and a free-typed value that names a real trend must
        // keep that trend's band rather than be softened by the caveat.
        expect(defTypeColour('Linear trend, data contamination present')).toBe('orange');
    });

    it('reads a rapid movement out of a free-typed value', () => {
        expect(defTypeColour('Rapid movement observed on the north wall')).toBe('darkred');
        expect(labelColour('Rapid Movement')).toBe('darkred');
    });
});

describe('a rapid movement outranks the TARP scale it has no level on', () => {
    const rapid = rec('Rapid Movement', '');

    it('colours the sensor darkred even when a TARP 4 is the one carrying a level', () => {
        // The bug the floor exists to stop: the driver is picked by TARP level,
        // and a rapid movement carries none, so the tile took the TARP 4's red.
        const p = resolveRiskPresentation([rapid, rec('Progressive', 'TARP 4')], telfer);
        expect(p.colour).toBe('darkred');
    });

    it('names the event rather than quoting a level that cannot express it', () => {
        expect(resolveRiskPresentation([rapid], telfer).label).toBe('Rapid Movement');
        expect(resolveRiskPresentation([rapid, rec('Progressive', 'TARP 4')], telfer).label)
            .toBe('Rapid Movement');
        expect(resolveRiskPresentation([rapid, rec('Linear', 'TARP 3')], leonora).label)
            .toBe('Rapid Movement');
        expect(resolveRiskPresentation([rapid], hiddenValley).label).toBe('Rapid Movement');
    });

    it('never prints TARP 1 for it, which is the other end of the same scale', () => {
        expect(resolveRiskPresentation([rapid], telfer).label).not.toMatch(/TARP/i);
    });

    it('badges nothing on the record itself, which already names it', () => {
        expect(recordBadgeLabel(rapid, telfer)).toBe('');
        expect(recordBadgeLabel(rapid, hiddenValley)).toBe('');
    });
});

describe('the tile can never under-state the board', () => {
    it('takes the worst band on the sensor, not just the driving record\'s', () => {
        // Telfer quotes TARP 3 here, but the progressive trend beside it is red.
        const p = resolveRiskPresentation(
            [rec('Regressive', 'TARP 3'), rec('Progressive', 'TARP 2')],
            telfer
        );
        expect(p.label).toBe('TARP 3');
        expect(p.colour).toBe('red');
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
    // Each type carries the level Hidden Valley's own chart puts it at. The
    // colour is the more severe of the two (see `recordColour`), so pairing a
    // yellow type with TARP 3 would be asserting a band this site never issues.
    it.each([
        ['Progressive', 'TARP 4', 'Red'],
        ['Linear Accelerating', 'TARP 4', 'Red'],
        ['Linear', 'TARP 3', 'Orange'],
        ['Regressive', 'TARP 2', 'Yellow'],
        ['Blast Event', 'TARP 2', 'Yellow'],
        ['Rainfall Event', 'TARP 2', 'Yellow'],
    ])('%s at %s reads "%s"', (type, level, label) => {
        expect(resolveRiskPresentation([rec(type, level)], hiddenValley).label).toBe(label);
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

describe('the badge on an individual record', () => {
    it('quotes the TARP level at a site that words risk that way', () => {
        expect(recordBadgeLabel(rec('Linear', 'TARP 3'), telfer)).toBe('TARP 3');
        expect(recordBadgeLabel(rec('Linear', 'TARP 3'), leonora)).toBe('TARP 3');
        // Leonora's risk LINE says "Regressive", but a record that carries a
        // level still shows it — the level is theirs, it is just not the headline.
        expect(recordBadgeLabel(rec('Progressive', 'TARP 4'), leonora)).toBe('TARP 4');
    });

    it('names the band at Hidden Valley, which quotes no levels anywhere', () => {
        // The level is still stored — it derives the email's severity bracket —
        // but printing it cites a number their chart does not contain.
        expect(recordBadgeLabel(rec('Linear', 'TARP 3'), hiddenValley)).toBe('Orange');
        expect(recordBadgeLabel(rec('Progressive', 'TARP 4'), hiddenValley)).toBe('Red');
        expect(recordBadgeLabel(rec('Blast Event', 'TARP 2'), hiddenValley)).toBe('Yellow');
    });

    it('badges nothing when there is nothing to say', () => {
        expect(recordBadgeLabel(rec('Rock Fall', ''), telfer)).toBe('');
        expect(recordBadgeLabel(rec('Rock Fall', ''), hiddenValley)).toBe('');
        expect(recordBadgeLabel(rec('Blast Event', ''), leonora)).toBe('');
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
        expect(labelColour('Red')).toBe('red');
        expect(labelColour('Yellow')).toBe('yellow');
        // The longer wording this replaced is still readable, for rows stored
        // or exported before the change.
        expect(labelColour('Orange Notification')).toBe('orange');
        expect(labelColour('Regressive')).toBe('yellow');
        expect(labelColour(NO_SIGNIFICANT)).toBe('green');
    });

    it('carries the level for the badge only when there is one', () => {
        expect(presentationFromLabel('TARP 3').tarpLevel).toBe('TARP 3');
        expect(presentationFromLabel('Red').tarpLevel).toBe('');
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
            .toBe('Overall risk is on Red – Critical condition.');
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

describe('the report reads the same records the screens do', () => {
    const inFolder = (folder, def_type, tarp_level = '') => ({ ...rec(def_type, tarp_level), wallfolder_id: folder });

    it('ignores records held by a folder the radar has moved off', () => {
        // The bug: an archived folder still holding an active TARP 3 out-ranked
        // the live folder, so the report and the board disagreed.
        const records = [inFolder(9, 'Linear', 'TARP 3'), inFolder(1, 'Linear', '')];
        expect(deriveRisk(recordsForRisk(records, 1), leonora).label).toBe('Linear');
        expect(deriveRisk(records, leonora).label).toBe('TARP 3');
    });

    it('reads everything when the sensor carries no current folder', () => {
        const records = [inFolder(9, 'Progressive', 'TARP 4')];
        expect(recordsForRisk(records, null)).toHaveLength(1);
        expect(recordsForRisk(null, 1)).toEqual([]);
    });
});

describe('the DTG standard is unchanged', () => {
    it('still triggers TARP 2 on blast and rainfall for a site with no document', () => {
        expect(resolveTarpLevel('Blast Event', { policy: DEFAULT_TARP_POLICY })).toBe('TARP 2');
        expect(resolveTarpLevel('Rainfall Event', { policy: DEFAULT_TARP_POLICY })).toBe('TARP 2');
    });
});
