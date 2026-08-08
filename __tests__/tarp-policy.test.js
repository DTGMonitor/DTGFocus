/**
 * TARP policy resolution.
 *
 * Covers the three layers that decide whether an email subject quotes
 * "TARP Trigger N:":
 *   1. the DTG default (derived from TYPE_MATRIX) — unchanged legacy behaviour
 *   2. the hard-coded alarm-gated override
 *   3. a policy built from a site's own TARP document (authoritative, exhaustive)
 */

import {
    DEFAULT_TARP_POLICY,
    ALARM_GATED_TARP_POLICY,
    getTarpPolicyForSensor,
    resolveTarpLevel,
    resolveSeverityTarpLevel
} from '../config/tarpPolicy';
import {
    normalizeTarpDocument,
    buildPolicyFromDocument,
    tarpLevelLabel,
    inferResponseMethod,
    resolveResponseRequirement,
    responseRequirementForType,
    namesInternalAudience,
    resolveDraftAudience,
    nominalTarpLevel,
    resolveTarpTransition
} from '../config/tarpDocument';
import { generateEmailSubject, getWorkLogDetails } from '../config/formConfig';

// A trimmed version of the seeded Genesis document, in raw Supabase shape.
const genesisRow = {
    id: 42,
    site_id: 7,
    heading: 'Genesis Minerals',
    version: 3,
    status: 'active',
    triggers: [
        {
            id: 2, sort_order: 2, trigger_label: 'Red Alarm', comments: [],
            def_type: null, tarp_level: 4, requires_alarm: true
        },
        {
            id: 1, sort_order: 1, trigger_label: 'Progressive (accelerating) trend',
            comments: ['1. State area of concern'],
            def_type: 'Progressive', tarp_level: 4, requires_alarm: false
        },
        {
            id: 3, sort_order: 3, trigger_label: 'Linear trend (constant velocity)',
            comments: '["1. Monitor as per TARP Trigger 3 procedures"]',
            def_type: 'Linear', tarp_level: 3, requires_alarm: true
        },
        {
            id: 6, sort_order: 6, trigger_label: 'Fall of Ground/failure', comments: [],
            def_type: 'Failure', tarp_level: null, requires_alarm: false
        }
    ],
    contacts: [],
    revisions: []
};

describe('normalizeTarpDocument', () => {
    it('sorts triggers by sort_order and coerces jsonb comments', () => {
        const doc = normalizeTarpDocument(genesisRow);
        expect(doc.triggers.map(t => t.sortOrder)).toEqual([1, 2, 3, 6]);
        expect(doc.triggers[2].comments).toEqual(['1. Monitor as per TARP Trigger 3 procedures']);
        expect(doc.triggers[0].comments).toEqual(['1. State area of concern']);
    });

    it('returns null for a missing row', () => {
        expect(normalizeTarpDocument(null)).toBeNull();
    });
});

describe('tarpLevelLabel', () => {
    it('renders the string form the rest of the app speaks', () => {
        expect(tarpLevelLabel(4)).toBe('TARP 4');
        expect(tarpLevelLabel(null)).toBe('');
        expect(tarpLevelLabel(undefined)).toBe('');
    });
});

describe('default policy', () => {
    it('preserves the legacy TYPE_MATRIX mapping', () => {
        const p = DEFAULT_TARP_POLICY;
        expect(resolveTarpLevel('Progressive', { policy: p })).toBe('TARP 4');
        expect(resolveTarpLevel('Linear Accelerating', { policy: p })).toBe('TARP 4');
        expect(resolveTarpLevel('Linear', { policy: p })).toBe('TARP 3');
        expect(resolveTarpLevel('Regressive', { policy: p })).toBe('TARP 2');
        expect(resolveTarpLevel('Failure', { policy: p })).toBe('');
    });

    it('ignores alarm state', () => {
        const p = DEFAULT_TARP_POLICY;
        expect(resolveTarpLevel('Linear', { policy: p, hasAlarm: false })).toBe('TARP 3');
        expect(resolveTarpLevel('Linear', { policy: p, hasAlarm: true })).toBe('TARP 3');
    });
});

describe('alarm-gated policy', () => {
    const p = ALARM_GATED_TARP_POLICY;

    it('keeps TARP 4 for progressive trends with or without an alarm', () => {
        expect(resolveTarpLevel('Progressive', { policy: p, hasAlarm: false })).toBe('TARP 4');
        expect(resolveTarpLevel('Progressive', { policy: p, hasAlarm: true })).toBe('TARP 4');
        expect(resolveTarpLevel('Linear Accelerating', { policy: p, hasAlarm: false })).toBe('TARP 4');
    });

    it('gates linear on a genuine alarm', () => {
        expect(resolveTarpLevel('Linear', { policy: p, hasAlarm: false })).toBe('');
        expect(resolveTarpLevel('Linear', { policy: p, hasAlarm: true })).toBe('TARP 3');
    });

    it('never assigns a trigger to regressive', () => {
        expect(resolveTarpLevel('Regressive', { policy: p, hasAlarm: false })).toBe('');
        expect(resolveTarpLevel('Regressive', { policy: p, hasAlarm: true })).toBe('');
    });

    it('drops the severity bracket with the trigger by default', () => {
        expect(resolveSeverityTarpLevel('Linear', { policy: p, hasAlarm: false })).toBe('');
        expect(resolveSeverityTarpLevel('Linear', { policy: p, hasAlarm: true })).toBe('TARP 3');
    });

    it('keeps the bracket when the policy opts in', () => {
        const keep = { ...p, keepSeverityWhenSuppressed: true };
        expect(resolveSeverityTarpLevel('Linear', { policy: keep, hasAlarm: false })).toBe('TARP 3');
        expect(resolveTarpLevel('Linear', { policy: keep, hasAlarm: false })).toBe('');
    });

    it('is selected for Leonora by site name', () => {
        expect(getTarpPolicyForSensor({ site_name: 'Leonora' }).key).toBe(p.key);
        expect(getTarpPolicyForSensor({ site_name: '  leonora ' }).key).toBe(p.key);
        expect(getTarpPolicyForSensor({ site_name: 'Telfer' }).key).toBe(DEFAULT_TARP_POLICY.key);
        expect(getTarpPolicyForSensor({}).key).toBe(DEFAULT_TARP_POLICY.key);
    });
});

describe('document-backed policy', () => {
    const policy = buildPolicyFromDocument(normalizeTarpDocument(genesisRow));

    it('carries provenance', () => {
        expect(policy.documentId).toBe(42);
        expect(policy.documentVersion).toBe(3);
        expect(policy.exhaustive).toBe(true);
    });

    it('reproduces the site rules', () => {
        expect(resolveTarpLevel('Progressive', { policy, hasAlarm: false })).toBe('TARP 4');
        expect(resolveTarpLevel('Linear', { policy, hasAlarm: false })).toBe('');
        expect(resolveTarpLevel('Linear', { policy, hasAlarm: true })).toBe('TARP 3');
    });

    it('assigns no trigger to a type the document does not list', () => {
        // Regressive is absent from the Genesis chart, so it must NOT inherit
        // the DTG default of TARP 2.
        expect(resolveTarpLevel('Regressive', { policy, hasAlarm: true })).toBe('');
        expect(resolveTarpLevel('Blast Event', { policy, hasAlarm: true })).toBe('');
    });

    it('yields no trigger for a listed row with no TARP level', () => {
        expect(resolveTarpLevel('Failure', { policy, hasAlarm: false })).toBe('');
    });

    it('ignores rows with no def_type', () => {
        expect(Object.keys(policy.rules).sort()).toEqual(['Failure', 'Linear', 'Progressive']);
    });
});

describe('response method', () => {
    const doc = normalizeTarpDocument({
        ...genesisRow,
        default_response_method: 'call',
        triggers: [
            {
                id: 1, sort_order: 1, trigger_label: 'Progressive (accelerating) trend',
                comments: [], def_type: 'Progressive', tarp_level: 4,
                requires_alarm: false, response_method: 'call'
            },
            {
                id: 3, sort_order: 3, trigger_label: 'Linear trend (constant velocity)',
                comments: [], def_type: 'Linear', tarp_level: 3, requires_alarm: true,
                response_method: 'email',
                response_notice: 'Report this trend by email to Leonora Geotech — do not call.'
            },
            {
                id: 4, sort_order: 4, trigger_label: 'Fall of Ground/failure', comments: [],
                def_type: 'Failure', tarp_level: null, requires_alarm: false,
                response_method: null   // inherits the document default
            }
        ]
    });

    it('defaults to a phone call when the document says nothing', () => {
        const plain = normalizeTarpDocument({ ...genesisRow });
        expect(plain.defaultResponseMethod).toBe('call');
    });

    it('flags a row whose steady-state response differs, using its custom wording', () => {
        const req = responseRequirementForType(doc, 'Linear');
        expect(req.method).toBe('email');
        expect(req.label).toBe('Email only');
        expect(req.deviates).toBe(true);
        expect(req.notice).toMatch(/do not call/i);
    });

    it('does not flag a row that matches the site default', () => {
        const req = responseRequirementForType(doc, 'Progressive');
        expect(req.method).toBe('call');
        expect(req.deviates).toBe(false);
        expect(req.notice).toBe('');
    });

    it('inherits the document default when the row leaves it blank', () => {
        const req = responseRequirementForType(doc, 'Failure');
        expect(req.method).toBe('call');
        expect(req.deviates).toBe(false);
    });

    it('falls back to generic wording when no custom notice is set', () => {
        const req = resolveResponseRequirement(
            { responseMethod: 'email', responseNotice: null },
            { defaultResponseMethod: 'call' }
        );
        expect(req.notice).toBe('Email only — do NOT call.');
    });

    it('flags the reverse case too — a call on an email-first site', () => {
        const req = resolveResponseRequirement(
            { responseMethod: 'call', responseNotice: null },
            { defaultResponseMethod: 'email' }
        );
        expect(req.deviates).toBe(true);
        expect(req.notice).toMatch(/phone call is required/i);
    });

    it('returns null when the document has no row for the type', () => {
        expect(responseRequirementForType(doc, 'Regressive')).toBeNull();
        expect(responseRequirementForType(null, 'Linear')).toBeNull();
    });
});

describe('response method when an alarm fired', () => {
    // Leonora: plain linear trends were de-escalated to email in TARP v3, but
    // the alarm rows were not — a genuine Red or Orange alarm is still a call.
    const doc = normalizeTarpDocument({
        ...genesisRow,
        default_response_method: 'call',
        triggers: [
            {
                id: 1, sort_order: 1, trigger_label: 'Progressive (accelerating) trend',
                comments: [], def_type: 'Progressive', tarp_level: 4,
                requires_alarm: false, response_method: 'call'
            },
            {
                id: 2, sort_order: 2, trigger_label: 'Red Alarm', comments: [], colour: 'red',
                def_type: null, tarp_level: 4, requires_alarm: true, response_method: 'call'
            },
            {
                id: 3, sort_order: 3, trigger_label: 'Linear trend (constant velocity)',
                comments: [], colour: 'orange', def_type: 'Linear', tarp_level: 3,
                requires_alarm: true, response_method: 'email',
                response_notice: 'Email only — do not call.'
            },
            {
                id: 4, sort_order: 4, trigger_label: 'Orange Alarm', comments: [], colour: 'orange',
                def_type: null, tarp_level: 3, requires_alarm: true, response_method: 'call'
            }
        ]
    });

    it('keeps email only for a linear trend with no alarm', () => {
        const req = responseRequirementForType(doc, 'Linear', { hasAlarm: false });
        expect(req.method).toBe('email');
        expect(req.alarmOverride).toBe(false);
        expect(req.trigger.triggerLabel).toBe('Linear trend (constant velocity)');
    });

    it('asks for a call once a genuine alarm accompanies the same trend', () => {
        const req = responseRequirementForType(doc, 'Linear', {
            hasAlarm: true, alarmColours: ['Red']
        });
        expect(req.method).toBe('call');
        expect(req.alarmOverride).toBe(true);
        expect(req.trigger.triggerLabel).toBe('Red Alarm');
        expect(req.notice).toMatch(/phone call is required/i);
        expect(req.notice).toMatch(/only without an alarm/i);
    });

    it('matches the alarm row on the colour of the region ticked', () => {
        const req = responseRequirementForType(doc, 'Linear', {
            hasAlarm: true, alarmColours: ['Orange']
        });
        expect(req.trigger.triggerLabel).toBe('Orange Alarm');
        expect(req.method).toBe('call');
    });

    it('takes the most severe row when several alarms fired', () => {
        const req = responseRequirementForType(doc, 'Linear', {
            hasAlarm: true, alarmColours: ['Orange', 'Red']
        });
        expect(req.trigger.triggerLabel).toBe('Red Alarm');
    });

    it('errs towards the most severe row while no region is chosen yet', () => {
        const req = responseRequirementForType(doc, 'Linear', { hasAlarm: true });
        expect(req.trigger.triggerLabel).toBe('Red Alarm');
        expect(req.method).toBe('call');
    });

    it('leaves the trend row standing for an alarm colour the TARP does not list', () => {
        const req = responseRequirementForType(doc, 'Linear', {
            hasAlarm: true, alarmColours: ['Yellow']
        });
        expect(req.method).toBe('email');
        expect(req.alarmOverride).toBe(false);
    });

    it('never weakens a row that already asks for more than the alarm row', () => {
        // Progressive is a call with or without an alarm; the alarm row must not
        // be able to talk it down, only up.
        const req = responseRequirementForType(doc, 'Progressive', {
            hasAlarm: true, alarmColours: ['Red']
        });
        expect(req.method).toBe('call');
        expect(req.alarmOverride).toBe(false);
        expect(req.trigger.triggerLabel).toBe('Progressive (accelerating) trend');
    });

    it('ignores alarms on a document that lists no alarm row', () => {
        const noAlarmRows = normalizeTarpDocument({
            ...genesisRow,
            default_response_method: 'call',
            triggers: [{
                id: 3, sort_order: 3, trigger_label: 'Linear trend', comments: [],
                def_type: 'Linear', tarp_level: 3, requires_alarm: true,
                response_method: 'email'
            }]
        });
        const req = responseRequirementForType(noAlarmRows, 'Linear', {
            hasAlarm: true, alarmColours: ['Red']
        });
        expect(req.method).toBe('email');
        expect(req.alarmOverride).toBe(false);
    });
});

describe('who the draft is addressed to', () => {
    // Blast and rainfall rows are DTG watching its own back analysis. Telfer
    // promises the mine an email for them; Hidden Valley does not. The row's own
    // wording is the only thing that decides.
    const row = (dayShift, nightShift = dayShift) => normalizeTarpDocument({
        ...genesisRow,
        triggers: [{
            id: 1, sort_order: 1, trigger_label: 'Blast event', comments: [],
            def_type: 'Blast Event', tarp_level: 2, requires_alarm: false,
            day_shift: dayShift, night_shift: nightShift
        }]
    }).triggers[0];

    const SITE = '"Hidden Valley [All]"';

    it('sends an "Email DTG Internal" row to DTG with no CC', () => {
        const audience = resolveDraftAudience(row('Email DTG Internal'), SITE);
        expect(audience).toEqual({ to: 'DTG Engineers', cc: '', internal: true });
    });

    it('keeps a client-facing row on the site with DTG copied in', () => {
        const audience = resolveDraftAudience(row('Email Geotech'), SITE);
        expect(audience).toEqual({ to: SITE, cc: 'DTG Engineers', internal: false });
    });

    it('reads the audience, not the sender', () => {
        expect(namesInternalAudience('Site Geotech to email DTG monitoring engineers'))
            .toBe(true);
        expect(namesInternalAudience('DTG engineer escalates internally by email'))
            .toBe(true);
    });

    it('never treats a call as internal, however it is phrased', () => {
        expect(namesInternalAudience('Call DTG')).toBe(false);
        expect(namesInternalAudience('Call Geotech then email DTG internal')).toBe(false);
    });

    it('tolerates a shift that has nothing to do', () => {
        const audience = resolveDraftAudience(row('Email DTG Internal', 'NA'), SITE);
        expect(audience.internal).toBe(true);
    });

    it('stays client-facing when the two shifts disagree', () => {
        // Withholding an email the chart promised the site is the worse mistake.
        const audience = resolveDraftAudience(row('Email DTG Internal', 'Call Geotech'), SITE);
        expect(audience.internal).toBe(false);
        expect(audience.to).toBe(SITE);
    });

    it('falls back to the site when no row matched at all', () => {
        expect(resolveDraftAudience(null, SITE))
            .toEqual({ to: SITE, cc: 'DTG Engineers', internal: false });
    });

    it('returns the site once an alarm makes the response client-facing', () => {
        // A blast that also raised a red alarm resolves to the alarm row, and an
        // alarm is a trigger the mine is owed regardless of the blast wording.
        const doc = normalizeTarpDocument({
            ...genesisRow,
            triggers: [
                {
                    id: 1, sort_order: 1, trigger_label: 'Blast event', comments: [],
                    colour: 'yellow', def_type: 'Blast Event', tarp_level: 2,
                    requires_alarm: false, day_shift: 'Email DTG Internal',
                    night_shift: 'Email DTG Internal'
                },
                {
                    id: 2, sort_order: 2, trigger_label: 'Red Alarm', comments: [],
                    colour: 'red', def_type: null, tarp_level: 4, requires_alarm: true,
                    day_shift: 'Call Geotech', night_shift: 'Call Geotech'
                }
            ]
        });

        const quiet = responseRequirementForType(doc, 'Blast Event', { hasAlarm: false });
        expect(resolveDraftAudience(quiet.trigger, SITE).internal).toBe(true);

        const alarmed = responseRequirementForType(doc, 'Blast Event', {
            hasAlarm: true, alarmColours: ['Red']
        });
        expect(resolveDraftAudience(alarmed.trigger, SITE)).toEqual({
            to: SITE, cc: 'DTG Engineers', internal: false
        });
    });
});

describe('response method inferred from the shift cell', () => {
    // Rows whose response_method never got backfilled because their wording did
    // not match migration 004's patterns. The chart used to print the document
    // default — CALL — beside a cell that says email.
    it('reads the wording the seeded rows actually use', () => {
        expect(inferResponseMethod('Call Geotech')).toBe('call');
        expect(inferResponseMethod('Email Geotech')).toBe('email');
        expect(inferResponseMethod('Site Geotech to email DTG monitoring engineers'))
            .toBe('email');
        expect(inferResponseMethod('NA')).toBe('na');
    });

    it('treats a cell naming both as call-then-email', () => {
        expect(inferResponseMethod(
            'Call Supervisor and Mine Manager and email off-site Geotechs'
        )).toBe('call_then_email');
    });

    it('names nothing when the cell names no response', () => {
        expect(inferResponseMethod('')).toBeNull();
        expect(inferResponseMethod(null)).toBeNull();
        expect(inferResponseMethod(undefined)).toBeNull();
        expect(inferResponseMethod('Monitor as per site procedure')).toBeNull();
    });

    it('does not print CALL beside a cell that says email', () => {
        // Telfer's blast row: call-first site, no response_method, email prose.
        const req = resolveResponseRequirement(
            { responseMethod: null, responseNotice: null, dayShift: 'Email Geotech' },
            { defaultResponseMethod: 'call' }
        );
        expect(req.method).toBe('email');
        expect(req.label).toBe('Email only');
        expect(req.deviates).toBe(true);
        expect(req.notice).toMatch(/do NOT call/i);
    });

    it('lets the column win over the prose', () => {
        // Leonora phrases a call row as "Call … and notify … by Email"; the
        // explicit column is the signed answer and must not be second-guessed.
        const req = resolveResponseRequirement(
            {
                responseMethod: 'call',
                responseNotice: null,
                dayShift: 'Call supervisor and notify Leonorageotech by Email.'
            },
            { defaultResponseMethod: 'call' }
        );
        expect(req.method).toBe('call');
        expect(req.deviates).toBe(false);
    });

    it('still falls back to the document default, and never calls that a deviation', () => {
        const req = resolveResponseRequirement(
            { responseMethod: null, responseNotice: null, dayShift: null },
            { defaultResponseMethod: 'call' }
        );
        expect(req.method).toBe('call');
        expect(req.deviates).toBe(false);
        expect(req.notice).toBe('');
    });
});

describe('de-escalation', () => {
    // Leonora: stand a level down by email, everything else by phone.
    const leonora = normalizeTarpDocument({
        ...genesisRow,
        default_response_method: 'call',
        deescalation_response_method: 'email',
        deescalation_notice: 'Leonora does not want a phone call to stand down a TARP level.',
    });

    // Telfer: DTG default throughout.
    const telfer = normalizeTarpDocument({
        ...genesisRow,
        default_response_method: 'call',
        deescalation_response_method: 'call',
    });

    describe('nominalTarpLevel', () => {
        it('reads the level from the document when the row exists', () => {
            expect(nominalTarpLevel('Progressive', leonora)).toBe(4);
            expect(nominalTarpLevel('Linear', leonora)).toBe(3);
        });

        it('ignores alarm gating — the trend is what it is', () => {
            // Linear requires an alarm before a trigger is QUOTED, but the trend
            // is still nominally TARP 3 for ranking purposes.
            const linear = leonora.triggers.find(t => t.defType === 'Linear');
            expect(linear.requiresAlarm).toBe(true);
            expect(nominalTarpLevel('Linear', leonora)).toBe(3);
        });

        it('falls back to the DTG standard for types the document omits', () => {
            expect(nominalTarpLevel('Regressive', leonora)).toBe(2);
            expect(nominalTarpLevel('Linear Accelerating', leonora)).toBe(4);
        });

        it('returns null for an unknown or empty type', () => {
            expect(nominalTarpLevel('', leonora)).toBeNull();
            expect(nominalTarpLevel(null, leonora)).toBeNull();
            expect(nominalTarpLevel('Rock Fall', leonora)).toBeNull();
        });
    });

    it('detects Progressive → Linear as a de-escalation', () => {
        const t = resolveTarpTransition(['Progressive'], 'Linear', leonora);
        expect(t.direction).toBe('deescalation');
        expect(t.fromLevel).toBe(4);
        expect(t.toLevel).toBe(3);
        expect(t.summary).toBe('Progressive → Linear (TARP 4 → TARP 3)');
    });

    it('requires email for Leonora and flags it as a deviation', () => {
        const t = resolveTarpTransition(['Progressive'], 'Linear', leonora);
        expect(t.method).toBe('email');
        expect(t.label).toBe('Email only');
        expect(t.deviates).toBe(true);
        expect(t.notice).toMatch(/does not want a phone call/i);
    });

    it('requires a call on a site that kept the DTG default', () => {
        const t = resolveTarpTransition(['Progressive'], 'Linear', telfer);
        expect(t.method).toBe('call');
        expect(t.deviates).toBe(false);
        expect(t.notice).toMatch(/call the site/i);
    });

    it('detects Linear → Progressive as an escalation, not a de-escalation', () => {
        const t = resolveTarpTransition(['Linear'], 'Progressive', leonora);
        expect(t.direction).toBe('escalation');
        expect(t.notice).toBe('');
        expect(t.deviates).toBe(false);
    });

    it('treats a same-level change as unchanged', () => {
        const t = resolveTarpTransition(['Progressive'], 'Linear Accelerating', leonora);
        expect(t.direction).toBe('unchanged');
        expect(t.notice).toBe('');
    });

    it('de-escalates from the HIGHEST prior level when several precursors exist', () => {
        const t = resolveTarpTransition(['Regressive', 'Progressive'], 'Linear', leonora);
        expect(t.fromType).toBe('Progressive');
        expect(t.fromLevel).toBe(4);
        expect(t.direction).toBe('deescalation');
    });

    it('handles Linear → Regressive', () => {
        const t = resolveTarpTransition(['Linear'], 'Regressive', leonora);
        expect(t.direction).toBe('deescalation');
        expect(t.summary).toBe('Linear → Regressive (TARP 3 → TARP 2)');
    });

    it('is unknown with no precursor, so a first report never warns', () => {
        const t = resolveTarpTransition([], 'Linear', leonora);
        expect(t.direction).toBe('unknown');
        expect(t.notice).toBe('');
        expect(t.summary).toBe('');
    });

    it('is unknown when a level cannot be ranked', () => {
        expect(resolveTarpTransition(['Rock Fall'], 'Linear', leonora).direction).toBe('unknown');
        expect(resolveTarpTransition(['Progressive'], 'Rock Fall', leonora).direction).toBe('unknown');
    });

    it('falls back to a call when the site has no TARP document', () => {
        const t = resolveTarpTransition(['Progressive'], 'Linear', null);
        expect(t.direction).toBe('deescalation');
        expect(t.method).toBe('call');
        expect(t.deviates).toBe(false);
    });
});

describe('end-to-end subject lines for Leonora', () => {
    const policy = buildPolicyFromDocument(normalizeTarpDocument(genesisRow));
    const sensor = 'R01 - Leonora';

    const subjectFor = (type, alarmRegions) => {
        const hasAlarm = alarmRegions.length > 0;
        const tarp = resolveTarpLevel(type, { policy, hasAlarm });
        const severity = resolveSeverityTarpLevel(type, { policy, hasAlarm });
        const { subject } = getWorkLogDetails(severity, null);
        return generateEmailSubject(subject, tarp, type, sensor, alarmRegions);
    };

    it('quotes TARP Trigger 4 for a progressive trend with no alarm', () => {
        expect(subjectFor('Progressive', []))
            .toBe('[CRITICAL] TARP Trigger 4: Progressive Deformation Trend on R01 - Leonora');
    });

    it('drops the trigger for a linear trend with no alarm', () => {
        expect(subjectFor('Linear', []))
            .toBe('[NOTIFICATION ONLY] Linear Deformation Trend on R01 - Leonora');
    });

    it('quotes TARP Trigger 3 for a linear trend with an orange alarm', () => {
        expect(subjectFor('Linear', [{ type: 'Orange', name: 'AR1' }]))
            .toBe('[MODERATE RISK] Orange Alarms - TARP Trigger 3: Linear Deformation Trend on R01 - Leonora');
    });

    it('never quotes a trigger for a regressive trend', () => {
        expect(subjectFor('Regressive', [{ type: 'Orange', name: 'AR1' }]))
            .toBe('[NOTIFICATION ONLY] Orange Alarms - Regressive on R01 - Leonora');
    });
});
