/**
 * Per-site subject wording.
 *
 * Three sites announce a deformation trigger three different ways, and none of
 * the three is expressible in code — the wording is data on the TARP document:
 *
 *   Telfer         quotes the TARP number, alarm or not
 *   Leonora        quotes it only when a genuine alarm fired
 *   Hidden Valley  names the band instead: "Red Alarm" / "Yellow Notification"
 *
 * These tests are the contract between a signed TARP chart and the client's
 * inbox, so they assert whole subject lines rather than fragments.
 */

import {
    DEFAULT_SUBJECT_LABEL_TEMPLATE,
    renderSubjectLabel,
    resolveSubjectLabel,
    resolveSeverityBracket,
    resolveAlarmPrefixStyle,
    getTarpPolicyForSensor
} from '../config/tarpPolicy';
import { normalizeTarpDocument, buildPolicyFromDocument } from '../config/tarpDocument';
import { composeDeformationSubject } from '../config/emailSubject';

// ---------------------------------------------------------------------------
// Fixtures — raw Supabase rows, as the app receives them.
// ---------------------------------------------------------------------------

const trigger = (over) => ({
    comments: [], requires_alarm: false, ...over
});

/** Greatland Gold — Telfer. DTG numbering, no gating. */
const telferRow = {
    id: 1, site_id: 1, heading: 'Greatland Gold - Telfer Open Pit', version: 2, status: 'active',
    triggers: [
        trigger({ id: 1, sort_order: 1, trigger_label: 'Progressive trend', colour: 'red', def_type: 'Progressive', tarp_level: 4 }),
        trigger({ id: 2, sort_order: 2, trigger_label: 'Linear trend', colour: 'orange', def_type: 'Linear', tarp_level: 3 }),
        trigger({ id: 3, sort_order: 3, trigger_label: 'Regressive trend', colour: 'yellow', def_type: 'Regressive', tarp_level: 2 }),
        // Migration 009 — Telfer triggers TARP 2 on blast and rainfall.
        trigger({ id: 4, sort_order: 7, trigger_label: 'Blast event', colour: 'yellow', def_type: 'Blast Event', tarp_level: 2 }),
        trigger({ id: 5, sort_order: 8, trigger_label: 'Rainfall event', colour: 'yellow', def_type: 'Rainfall Event', tarp_level: 2 })
    ],
    contacts: [], revisions: []
};

/** Genesis Minerals — Leonora. Same numbering, but linear is alarm-gated. */
const leonoraRow = {
    id: 2, site_id: 2, heading: 'Genesis Minerals', version: 3, status: 'active',
    triggers: [
        trigger({ id: 1, sort_order: 1, trigger_label: 'Progressive trend', colour: 'red', def_type: 'Progressive', tarp_level: 4 }),
        trigger({ id: 2, sort_order: 2, trigger_label: 'Linear trend', colour: 'orange', def_type: 'Linear', tarp_level: 3, requires_alarm: true })
    ],
    contacts: [], revisions: []
};

/** Hidden Valley. Names its bands; the token itself says whether an alarm fired. */
const hiddenValleyRow = {
    id: 3, site_id: 3, heading: 'Hidden Valley', version: 1, status: 'active',
    subject_label_template: '{Colour} Notification:',
    subject_label_template_alarm: '{Colour} Alarm:',
    alarm_prefix_style: 'none',
    triggers: [
        trigger({ id: 1, sort_order: 1, trigger_label: 'Progressive trend', colour: 'red', def_type: 'Progressive', tarp_level: 4 }),
        trigger({ id: 2, sort_order: 2, trigger_label: 'Linear trend', colour: 'orange', def_type: 'Linear', tarp_level: 3 }),
        trigger({ id: 3, sort_order: 3, trigger_label: 'Regressive trend', colour: 'yellow', def_type: 'Regressive', tarp_level: 2 })
    ],
    contacts: [], revisions: []
};

/**
 * PTVI. Its bands are velocity and displacement thresholds, so the ALARM says
 * how fast the slope is moving and the deformation type says what shape the
 * trend is. The level therefore follows the alarm, and the LEVEL 1-4 rows are
 * this site's equivalent of Red / Orange / Yellow Alarm.
 */
const ptviRow = {
    id: 4, site_id: 4, heading: 'PTVI', version: 1, status: 'active',
    tarp_level_source: 'alarm',
    triggers: [
        trigger({ id: 1, sort_order: 1, trigger_label: 'Pola Deformasi Progresif', colour: 'red', def_type: 'Progressive', tarp_level: 4 }),
        trigger({ id: 2, sort_order: 2, trigger_label: 'LEVEL 4', colour: 'red', tarp_level: 4, requires_alarm: true }),
        trigger({ id: 3, sort_order: 3, trigger_label: 'Pola Deformasi Linear', colour: 'orange', def_type: 'Linear', tarp_level: 3 }),
        trigger({ id: 4, sort_order: 4, trigger_label: 'LEVEL 3', colour: 'orange', tarp_level: 3, requires_alarm: true }),
        trigger({ id: 5, sort_order: 5, trigger_label: 'LEVEL 2', colour: 'yellow', tarp_level: 2, requires_alarm: true }),
        trigger({ id: 6, sort_order: 6, trigger_label: 'LEVEL 1', colour: 'green', tarp_level: 1, requires_alarm: true })
    ],
    contacts: [], revisions: []
};

const policyFor = (row) => buildPolicyFromDocument(normalizeTarpDocument(row));

const RED = [{ type: 'Red', name: 'AR1' }];
const ORANGE = [{ type: 'Orange', name: 'AR2' }];
const YELLOW = [{ type: 'Yellow', name: 'AR3' }];

const subjectFor = (row, type, { alarmRegions = [], sensor, notificationTime = null } = {}) =>
    composeDeformationSubject({
        type,
        sensor,
        alarmRegions,
        notificationTime,
        policy: policyFor(row)
    }).subject;

// ---------------------------------------------------------------------------

describe('renderSubjectLabel', () => {
    const facts = { level: 4, colour: 'red', band: 'TARP Trigger 4 - Red' };

    it('fills the DTG standard template', () => {
        expect(renderSubjectLabel(DEFAULT_SUBJECT_LABEL_TEMPLATE, facts)).toBe('TARP Trigger 4:');
    });

    it('cases the colour by the token used', () => {
        expect(renderSubjectLabel('{Colour} Alarm:', facts)).toBe('Red Alarm:');
        expect(renderSubjectLabel('{colour} alarm:', facts)).toBe('red alarm:');
        expect(renderSubjectLabel('{Colour} Alarm:', { ...facts, colour: 'RED' })).toBe('Red Alarm:');
    });

    it('quotes the band label verbatim', () => {
        expect(renderSubjectLabel('{band}:', facts)).toBe('TARP Trigger 4 - Red:');
    });

    it('says nothing at all when the row lacks the fact the template asks for', () => {
        // "TARP Trigger :" and "Notification:" would both be worse than silence.
        expect(renderSubjectLabel('TARP Trigger {level}:', { ...facts, level: null })).toBe('');
        expect(renderSubjectLabel('{Colour} Alarm:', { ...facts, colour: null })).toBe('');
        expect(renderSubjectLabel('{band}:', { ...facts, band: null })).toBe('');
    });

    it('treats a blank template as no token', () => {
        expect(renderSubjectLabel('', facts)).toBe('');
        expect(renderSubjectLabel(null, facts)).toBe('');
    });

    it('keeps literal text that carries no token', () => {
        expect(renderSubjectLabel('SLOPE ALERT:', facts)).toBe('SLOPE ALERT:');
    });
});

describe('Telfer — quotes the TARP number, alarm or not', () => {
    const sensor = 'R01 - Telfer';
    const subject = (type, alarmRegions) => subjectFor(telferRow, type, { alarmRegions, sensor });

    it('quotes the trigger for a progressive trend with no alarm', () => {
        expect(subject('Progressive', []))
            .toBe('[CRITICAL] TARP Trigger 4: Progressive Deformation Trend on R01 - Telfer');
    });

    it('quotes the trigger for a linear trend with no alarm', () => {
        expect(subject('Linear', []))
            .toBe('[MODERATE RISK] TARP Trigger 3: Linear Deformation Trend on R01 - Telfer');
    });

    it('keeps the alarm-colour prefix when an alarm fired', () => {
        expect(subject('Linear', ORANGE))
            .toBe('[MODERATE RISK] Orange Alarms - TARP Trigger 3: Linear Deformation Trend on R01 - Telfer');
    });

    it('drops to NOTIFICATION ONLY below TARP 3, still quoting the trigger', () => {
        expect(subject('Regressive', []))
            .toBe('[NOTIFICATION ONLY] TARP Trigger 2: Regressive on R01 - Telfer');
    });

    it('triggers TARP 2 on a blast and on rainfall', () => {
        // Migration 009. Before it, neither type had a row, and an exhaustive
        // document gave them no trigger at all.
        expect(subject('Blast Event', []))
            .toBe('[NOTIFICATION ONLY] TARP Trigger 2: Blast Event on R01 - Telfer');
        expect(subject('Rainfall Event', []))
            .toBe('[NOTIFICATION ONLY] TARP Trigger 2: Rainfall Event on R01 - Telfer');
    });

    it('stores the level on the record, not just in the subject', () => {
        expect(composeDeformationSubject({
            type: 'Blast Event', sensor, policy: policyFor(telferRow)
        }).tarpLevel).toBe('TARP 2');
    });
});

describe('Leonora — quotes the TARP number only when an alarm fired', () => {
    const sensor = 'R01 - Leonora';
    const subject = (type, alarmRegions) => subjectFor(leonoraRow, type, { alarmRegions, sensor });

    it('quotes TARP Trigger 4 for a progressive trend with no alarm', () => {
        expect(subject('Progressive', []))
            .toBe('[CRITICAL] TARP Trigger 4: Progressive Deformation Trend on R01 - Leonora');
    });

    it('drops the trigger AND the risk bracket for a gated linear trend with no alarm', () => {
        expect(subject('Linear', []))
            .toBe('[NOTIFICATION ONLY] Linear Deformation Trend on R01 - Leonora');
    });

    it('quotes TARP Trigger 3 once an orange alarm exists', () => {
        expect(subject('Linear', ORANGE))
            .toBe('[MODERATE RISK] Orange Alarms - TARP Trigger 3: Linear Deformation Trend on R01 - Leonora');
    });

    it('quotes nothing for a type its document does not list', () => {
        // The document is exhaustive: no row means no trigger, not the DTG default.
        expect(subject('Regressive', ORANGE))
            .toBe('[NOTIFICATION ONLY] Orange Alarms - Regressive on R01 - Leonora');
    });

    it('assigns no TARP level to a blast or rainfall, where Telfer assigns TARP 2', () => {
        // The same two types, the opposite answer — which is the whole reason
        // the mapping is data on each site's document.
        expect(composeDeformationSubject({
            type: 'Blast Event', sensor, policy: policyFor(leonoraRow)
        }).tarpLevel).toBe('');
        expect(composeDeformationSubject({
            type: 'Rainfall Event', sensor, alarmRegions: ORANGE, policy: policyFor(leonoraRow)
        }).tarpLevel).toBe('');
    });
});

describe('PTVI — the alarm that fired decides the level, not the trend', () => {
    const sensor = 'R01 - PTVI';
    const subject = (type, alarmRegions) => subjectFor(ptviRow, type, { alarmRegions, sensor });
    const level = (type, alarmRegions = []) => composeDeformationSubject({
        type, sensor, alarmRegions, policy: policyFor(ptviRow)
    }).tarpLevel;

    it('reports a progressive trend on an ORANGE alarm as TARP 3', () => {
        // The headline case. Everywhere else this is TARP 4 because the trend is
        // progressive; here the orange alarm says the slope has only crossed the
        // LEVEL 3 threshold, and the threshold is what the band means.
        expect(subject('Progressive', ORANGE))
            .toBe('[MODERATE RISK] Orange Alarms - TARP Trigger 3: Progressive Deformation Trend on R01 - PTVI');
    });

    it('reports the same trend on a RED alarm as TARP 4', () => {
        expect(subject('Progressive', RED))
            .toBe('[CRITICAL] Red Alarms - TARP Trigger 4: Progressive Deformation Trend on R01 - PTVI');
    });

    it('raises as readily as it lowers — a linear trend on a red alarm is TARP 4', () => {
        expect(level('Linear', RED)).toBe('TARP 4');
        expect(level('Linear', ORANGE)).toBe('TARP 3');
        expect(level('Linear', YELLOW)).toBe('TARP 2');
    });

    it('quotes no trigger at all without an alarm', () => {
        // No alarm means no threshold was breached, so the record is an
        // observation — and the risk bracket follows it down.
        expect(subject('Progressive', []))
            .toBe('[NOTIFICATION ONLY] Progressive Deformation Trend on R01 - PTVI');
        expect(level('Progressive', [])).toBe('');
    });

    it('answers two alarms at once with the more severe of them', () => {
        expect(level('Linear', [...ORANGE, ...RED])).toBe('TARP 4');
    });

    it('errs upwards when an alarm fired but no region has been named yet', () => {
        // findAlarmTrigger takes the same view: the engineer has ticked Alarm
        // and not yet chosen a region, and over-stating is the safe direction.
        expect(composeDeformationSubject({
            type: 'Progressive', sensor, alarmRegions: [{ name: 'AR1' }], policy: policyFor(ptviRow)
        }).tarpLevel).toBe('TARP 4');
    });

    it('still quotes nothing for a type the document does not list', () => {
        // The alarm cannot conjure a trigger for a trend this site does not
        // treat as one.
        expect(level('Regressive', RED)).toBe('');
    });

    it('leaves every other site alone', () => {
        // The same record at Telfer and Leonora keeps the trend's own level.
        expect(composeDeformationSubject({
            type: 'Progressive', sensor: 'R01 - Telfer', alarmRegions: ORANGE, policy: policyFor(telferRow)
        }).tarpLevel).toBe('TARP 4');
        expect(composeDeformationSubject({
            type: 'Progressive', sensor: 'R01 - Leonora', alarmRegions: ORANGE, policy: policyFor(leonoraRow)
        }).tarpLevel).toBe('TARP 4');
    });
});

describe('Hidden Valley — names the band, and the token says whether an alarm fired', () => {
    const sensor = 'R01 - Hidden Valley';
    const subject = (type, alarmRegions) => subjectFor(hiddenValleyRow, type, { alarmRegions, sensor });

    it('says "<Colour> Notification" when no alarm fired', () => {
        expect(subject('Progressive', []))
            .toBe('[CRITICAL] Red Notification: Progressive Deformation Trend on R01 - Hidden Valley');
        expect(subject('Linear', []))
            .toBe('[MODERATE RISK] Orange Notification: Linear Deformation Trend on R01 - Hidden Valley');
        expect(subject('Regressive', []))
            .toBe('[NOTIFICATION ONLY] Yellow Notification: Regressive on R01 - Hidden Valley');
    });

    it('says "<Colour> Alarm" when one did', () => {
        expect(subject('Progressive', RED))
            .toBe('[CRITICAL] Red Alarm: Progressive Deformation Trend on R01 - Hidden Valley');
        expect(subject('Linear', ORANGE))
            .toBe('[MODERATE RISK] Orange Alarm: Linear Deformation Trend on R01 - Hidden Valley');
    });

    it('takes the colour from the TARP band, not from the region the engineer ticked', () => {
        // An orange region on a red row is still a Red Alarm — the chart wins.
        expect(subject('Progressive', ORANGE))
            .toBe('[CRITICAL] Red Alarm: Progressive Deformation Trend on R01 - Hidden Valley');
    });

    it('does not also list the alarm colours, which would say it twice', () => {
        expect(subject('Progressive', RED)).not.toContain('Alarms - ');
    });

    it('keeps the TARP level on the record even without an alarm', () => {
        // Wording only — Hidden Valley gates nothing.
        const composed = composeDeformationSubject({
            type: 'Linear', sensor, policy: policyFor(hiddenValleyRow)
        });
        expect(composed.tarpLevel).toBe('TARP 3');
    });
});

describe('per-row overrides', () => {
    const withRow = (over) => ({
        ...hiddenValleyRow,
        triggers: [trigger({
            id: 1, sort_order: 1, trigger_label: 'Progressive trend',
            colour: 'red', def_type: 'Progressive', tarp_level: 4, ...over
        })]
    });

    it('lets one row depart from the document wording', () => {
        expect(subjectFor(withRow({ subject_label: 'SLOPE FAILURE IMMINENT:' }), 'Progressive', { sensor: 'R01 - HV' }))
            .toBe('[CRITICAL] SLOPE FAILURE IMMINENT: Progressive Deformation Trend on R01 - HV');
    });

    it('applies the alarm override only when an alarm fired', () => {
        const row = withRow({ subject_label_alarm: 'RED ALARM CONFIRMED:' });
        expect(subjectFor(row, 'Progressive', { sensor: 'R01 - HV' }))
            .toContain('Red Notification:');
        expect(subjectFor(row, 'Progressive', { alarmRegions: RED, sensor: 'R01 - HV' }))
            .toContain('RED ALARM CONFIRMED:');
    });

    it('falls back to the row\'s no-alarm wording before the document alarm template', () => {
        const label = resolveSubjectLabel('Progressive', {
            hasAlarm: true,
            policy: policyFor(withRow({ subject_label: 'ROW WORDING:' }))
        });
        expect(label).toBe('ROW WORDING:');
    });

    it('overrides the risk bracket when the row says so', () => {
        const row = withRow({ severity_bracket: 'EVACUATE' });
        expect(subjectFor(row, 'Progressive', { sensor: 'R01 - HV' }))
            .toBe('[EVACUATE] Red Notification: Progressive Deformation Trend on R01 - HV');
    });

    it('writes the body in the risk-derived tone even when the bracket is overridden', () => {
        const composed = composeDeformationSubject({
            type: 'Progressive', sensor: 'R01 - HV',
            policy: policyFor(withRow({ severity_bracket: 'EVACUATE' }))
        });
        expect(composed.bracket).toBe('CRITICAL');
    });
});

describe('sites with no TARP document', () => {
    it('are unchanged — the DTG standard wording still applies', () => {
        const policy = getTarpPolicyForSensor({ site_name: 'Somewhere New' });
        expect(composeDeformationSubject({
            type: 'Progressive', sensor: 'R01 - Somewhere New', policy
        }).subject).toBe('[CRITICAL] TARP Trigger 4: Progressive Deformation Trend on R01 - Somewhere New');
    });

    it('still gate Leonora by the hard-coded fallback until its document loads', () => {
        const policy = getTarpPolicyForSensor({ site_name: 'Leonora' });
        expect(resolveSubjectLabel('Linear', { hasAlarm: false, policy })).toBe('');
        expect(resolveSubjectLabel('Linear', { hasAlarm: true, policy })).toBe('TARP Trigger 3:');
    });

    it('keep the alarm-colour prefix', () => {
        expect(resolveAlarmPrefixStyle(getTarpPolicyForSensor({ site_name: 'Telfer' }))).toBe('regions');
        expect(resolveAlarmPrefixStyle(null)).toBe('regions');
    });
});

describe('a notification time still downgrades the bracket', () => {
    it('reports an already-notified critical trend as NOTIFICATION ONLY', () => {
        expect(subjectFor(hiddenValleyRow, 'Progressive', {
            sensor: 'R01 - Hidden Valley',
            notificationTime: '2026-07-28T04:00:00Z'
        })).toBe('[NOTIFICATION ONLY] Red Notification: Progressive Deformation Trend on R01 - Hidden Valley');
    });
});

describe('resolveSeverityBracket', () => {
    it('is null when the row has no override, so the TARP level decides', () => {
        expect(resolveSeverityBracket('Progressive', { policy: policyFor(telferRow) })).toBeNull();
    });

    it('is null for a type the document does not list', () => {
        expect(resolveSeverityBracket('Rock Fall', { policy: policyFor(telferRow) })).toBeNull();
    });
});
