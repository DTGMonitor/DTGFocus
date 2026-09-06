/**
 * Client onboarding — the progress rules, the trial summaries and the drafts.
 *
 * The rule this suite exists for is the tab gate: `isOnboardingComplete` decides
 * whether a sensor shows five tabs or one, so both of its failure directions are
 * expensive. Locking an operator out of a live radar's Deformation tab is worse
 * than letting an unfinished site through, and the tests pin that asymmetry
 * rather than just the happy path.
 */

import {
    ONBOARDING_STEPS,
    canStartStep,
    contactChannelValue,
    currentStep,
    describeContact,
    isOnboardingComplete,
    isReachable,
    isStepDone,
    onboardingProgress,
    stepStatus,
    summariseTrial,
    trialChannel,
    type ContactTestRow,
    type OnboardingRow,
    type OnboardingStepKey
} from '@/config/onboarding';
import {
    buildOnboardingDraft,
    confirmedRecipients,
    draftRecipients,
    trialResultBlock
} from '@/config/onboardingEmails';

const ALL_KEYS = ONBOARDING_STEPS.map((s) => s.key);

/** An onboarding whose named steps are done and whose rest are pending. */
const makeOnboarding = (
    doneKeys: OnboardingStepKey[],
    overrides: Partial<OnboardingRow> = {}
): OnboardingRow => ({
    id: 1,
    site_id: 42,
    status: doneKeys.length === ALL_KEYS.length ? 'complete' : 'in_progress',
    commenced_at: null,
    steps: ONBOARDING_STEPS.map((step) => ({
        step_key: step.key,
        sort_order: step.order,
        status: doneKeys.includes(step.key) ? 'done' : 'pending'
    })),
    ...overrides
});

const phoneTest = (over: Partial<ContactTestRow> = {}): ContactTestRow => ({
    step_key: 'communication_trial',
    channel: 'phone',
    name: 'Fred Harvey',
    role: 'Superintendent Geotechnical Projects',
    phone: '+61 427 801 015',
    result: 'reachable',
    ...over
});

const emailTest = (over: Partial<ContactTestRow> = {}): ContactTestRow => ({
    step_key: 'email_trial',
    channel: 'email',
    name: 'Fred Harvey',
    email: 'frederick.harvey@example.com',
    result: 'reachable',
    ...over
});

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

describe('step definitions', () => {
    test('the six steps are ordered 1..6 with no gaps or duplicates', () => {
        expect(ONBOARDING_STEPS.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6]);
        expect(new Set(ALL_KEYS).size).toBe(ALL_KEYS.length);
    });

    test('live commencement is last — nothing may follow the notice', () => {
        expect(ALL_KEYS[ALL_KEYS.length - 1]).toBe('live_commencement');
    });

    test('only the two trials have a channel', () => {
        expect(trialChannel('communication_trial')).toBe('phone');
        expect(trialChannel('email_trial')).toBe('email');
        expect(trialChannel('administration')).toBeNull();
        expect(trialChannel('live_commencement')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

describe('progress', () => {
    test('an untouched onboarding is at zero and points at administration', () => {
        const onboarding = makeOnboarding([]);
        expect(onboardingProgress(onboarding)).toEqual({ done: 0, total: 6, percent: 0 });
        expect(currentStep(onboarding)?.key).toBe('administration');
    });

    test('current step is the first NOT done, skipping over completed ones', () => {
        const onboarding = makeOnboarding(['administration', 'remote_connection']);
        expect(currentStep(onboarding)?.key).toBe('communication_trial');
        expect(onboardingProgress(onboarding).done).toBe(2);
    });

    test('a blocked step is still the current step, not skipped past', () => {
        const onboarding = makeOnboarding([]);
        onboarding.steps![0].status = 'blocked';
        expect(stepStatus(onboarding, 'administration')).toBe('blocked');
        expect(currentStep(onboarding)?.key).toBe('administration');
    });

    test('an unknown status reads as pending rather than throwing', () => {
        const onboarding = makeOnboarding([]);
        onboarding.steps![0].status = 'something-else';
        expect(stepStatus(onboarding, 'administration')).toBe('pending');
        expect(isStepDone(onboarding, 'administration')).toBe(false);
    });

    test('step rows for keys this version does not know are ignored', () => {
        const onboarding = makeOnboarding(ALL_KEYS);
        onboarding.steps!.push({ step_key: 'invoicing', status: 'done' });
        expect(onboardingProgress(onboarding).total).toBe(6);
        expect(onboardingProgress(onboarding).done).toBe(6);
    });
});

// ---------------------------------------------------------------------------
// The tab gate
// ---------------------------------------------------------------------------

describe('isOnboardingComplete — the tab gate', () => {
    test('a site with NO onboarding row is treated as complete', () => {
        // Every site live before this feature is backfilled by the migration, so
        // a missing row is a failed read. Locking an operator out of a live
        // radar's Deformation tab over that would be the worse failure.
        expect(isOnboardingComplete(null)).toBe(true);
        expect(isOnboardingComplete(undefined)).toBe(true);
    });

    test('every step done but no commencement is NOT complete', () => {
        const onboarding = makeOnboarding(ALL_KEYS, { commenced_at: null });
        expect(isOnboardingComplete(onboarding)).toBe(false);
    });

    test('a commencement stamp with an unfinished step is NOT complete', () => {
        const onboarding = makeOnboarding(
            ALL_KEYS.filter((k) => k !== 'email_trial'),
            { commenced_at: '2026-08-01T00:00:00Z' }
        );
        expect(isOnboardingComplete(onboarding)).toBe(false);
    });

    test('every step done AND the commencement sent is complete', () => {
        const onboarding = makeOnboarding(ALL_KEYS, { commenced_at: '2026-08-01T00:00:00Z' });
        expect(isOnboardingComplete(onboarding)).toBe(true);
    });
});

describe('canStartStep', () => {
    test('the first five steps may be worked in any order', () => {
        const onboarding = makeOnboarding([]);
        for (const key of ALL_KEYS.filter((k) => k !== 'live_commencement')) {
            expect(canStartStep(onboarding, key)).toBe(true);
        }
    });

    test('commencement is refused until everything before it is done', () => {
        expect(canStartStep(makeOnboarding([]), 'live_commencement')).toBe(false);
        expect(
            canStartStep(
                makeOnboarding(ALL_KEYS.filter((k) => k !== 'system_readiness')),
                'live_commencement'
            )
        ).toBe(false);
        expect(
            canStartStep(
                makeOnboarding(ALL_KEYS.filter((k) => k !== 'live_commencement')),
                'live_commencement'
            )
        ).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Trial summaries
// ---------------------------------------------------------------------------

describe('summariseTrial', () => {
    test('only rows of the asked-for channel are counted', () => {
        const rows = [phoneTest(), emailTest()];
        expect(summariseTrial(rows, 'phone').total).toBe(1);
        expect(summariseTrial(rows, 'email').total).toBe(1);
    });

    test('reachable, unreachable and untested partition the list', () => {
        const rows = [
            phoneTest({ result: 'reachable' }),
            phoneTest({ result: 'no_answer' }),
            phoneTest({ result: 'wrong_details' }),
            phoneTest({ result: 'pending' })
        ];
        const summary = summariseTrial(rows, 'phone');
        expect(summary.reachable).toHaveLength(1);
        expect(summary.unreachable).toHaveLength(2);
        expect(summary.untested).toHaveLength(1);
        expect(summary.tested).toBe(3);
        expect(summary.allTested).toBe(false);
    });

    test('a phone trial needs two reachable levels, not one', () => {
        const one = summariseTrial([phoneTest(), phoneTest({ result: 'no_answer' })], 'phone');
        expect(one.meetsMinimumCoverage).toBe(false);

        const two = summariseTrial([phoneTest(), phoneTest()], 'phone');
        expect(two.meetsMinimumCoverage).toBe(true);
    });

    test('a one-contact phone list cannot be held to a two-level minimum', () => {
        // The requirement is two levels; a site that has only nominated one
        // cannot be failed forever by arithmetic it has no way to satisfy.
        expect(summariseTrial([phoneTest()], 'phone').meetsMinimumCoverage).toBe(true);
    });

    test('one confirmed address is enough for the email trial', () => {
        expect(summariseTrial([emailTest()], 'email').meetsMinimumCoverage).toBe(true);
        expect(
            summariseTrial([emailTest({ result: 'unreachable' })], 'email').meetsMinimumCoverage
        ).toBe(false);
    });

    test('an empty trial never counts as covered', () => {
        const summary = summariseTrial([], 'phone');
        expect(summary.meetsMinimumCoverage).toBe(false);
        expect(summary.allTested).toBe(false);
    });

    test('only "reachable" is reachable', () => {
        expect(isReachable('reachable')).toBe(true);
        for (const bad of ['pending', 'no_answer', 'unreachable', 'wrong_details', null, 'nonsense']) {
            expect(isReachable(bad)).toBe(false);
        }
    });
});

describe('contact descriptions', () => {
    test('name and role together, or whichever exists', () => {
        expect(describeContact(phoneTest())).toBe(
            'Fred Harvey (Superintendent Geotechnical Projects)'
        );
        expect(describeContact(phoneTest({ role: null }))).toBe('Fred Harvey');
        expect(describeContact(phoneTest({ name: null }))).toBe(
            'Superintendent Geotechnical Projects'
        );
        expect(describeContact(phoneTest({ name: null, role: null }))).toBe('Unnamed contact');
    });

    test('the channel value is the detail actually tested', () => {
        expect(contactChannelValue(phoneTest())).toBe('+61 427 801 015');
        expect(contactChannelValue(emailTest())).toBe('frederick.harvey@example.com');
    });
});

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

describe('email drafts', () => {
    const ctx = {
        siteName: 'Leonora',
        company: 'Genesis Minerals',
        location: 'WA',
        radars: ['MSR254'],
        engineerName: 'Lintang Putra Sadewa',
        engineerEmail: 'lintang.sadewa@dtgeotech.com',
        onboarding: makeOnboarding(['administration']),
        tests: [] as ContactTestRow[]
    };

    test('every step has a draft', () => {
        for (const key of ALL_KEYS) {
            const draft = buildOnboardingDraft(key, ctx);
            expect(draft).not.toBeNull();
            expect(draft!.subject.length).toBeGreaterThan(10);
            expect(draft!.body.length).toBeGreaterThan(50);
        }
    });

    test('an unknown step gets no draft rather than a half-written one', () => {
        expect(buildOnboardingDraft('invoicing', ctx)).toBeNull();
    });

    test('the subject names the site and the company', () => {
        const draft = buildOnboardingDraft('administration', ctx)!;
        expect(draft.subject).toContain('Leonora');
        expect(draft.subject).toContain('Genesis Minerals');
    });

    test('every draft reprints the running checklist with its ticks', () => {
        const draft = buildOnboardingDraft('remote_connection', ctx)!;
        expect(draft.body).toContain('[x] Administration');
        expect(draft.body).toContain('[ ] Remote Connection Test');
        expect(draft.body).toContain('<-- we are here');
    });

    test('a trial with unreachable contacts asks for action; a clean one does not', () => {
        const dirty = buildOnboardingDraft('communication_trial', {
            ...ctx,
            tests: [phoneTest(), phoneTest(), phoneTest({ name: 'Night Dispatch', result: 'no_answer' })]
        })!;
        expect(dirty.subject).toContain('[ACTION REQUIRED]');
        expect(dirty.body).toContain('could NOT reach');
        expect(dirty.body).toContain('Night Dispatch');

        const clean = buildOnboardingDraft('communication_trial', {
            ...ctx,
            tests: [phoneTest(), phoneTest()]
        })!;
        expect(clean.subject).toContain('[NOTIFICATION ONLY]');
        expect(clean.body).not.toContain('could NOT reach');
    });

    test('the commencement notice carries the date and both trial tallies', () => {
        const draft = buildOnboardingDraft('live_commencement', {
            ...ctx,
            onboarding: makeOnboarding(ALL_KEYS),
            tests: [phoneTest(), phoneTest({ result: 'no_answer' }), emailTest()],
            payload: { commencedAt: '1 August 2026, 06:00 AWST' }
        })!;
        expect(draft.body).toContain('1 August 2026, 06:00 AWST');
        expect(draft.body).toContain('1 of 2 contacts reachable');
        expect(draft.body).toContain('1 of 1 addresses confirmed');
    });

    test('analyst notes reach the draft', () => {
        const draft = buildOnboardingDraft('system_readiness', {
            ...ctx,
            notes: 'Alarm masks still to be agreed with Fred.'
        })!;
        expect(draft.body).toContain('Alarm masks still to be agreed with Fred.');
    });

    test('a missing company or radar list degrades rather than printing undefined', () => {
        const draft = buildOnboardingDraft('administration', {
            siteName: 'Leonora',
            onboarding: makeOnboarding([])
        })!;
        expect(draft.subject).not.toMatch(/undefined|null/);
        expect(draft.body).not.toMatch(/undefined|null/);
        expect(draft.body).toContain('the radar');
    });
});

describe('trialResultBlock', () => {
    test('an empty trial says so instead of printing empty headings', () => {
        expect(trialResultBlock([], 'phone').join('\n')).toContain('No contacts were listed');
    });

    test('a shift is named beside the contact it was tested on', () => {
        const block = trialResultBlock([phoneTest({ shift: 'night' })], 'phone').join('\n');
        expect(block).toContain('[night shift]');
    });

    test('remarks travel with the failure they explain', () => {
        const block = trialResultBlock(
            [phoneTest({ result: 'no_answer', remark: 'diverts to voicemail after 18:00' })],
            'phone'
        ).join('\n');
        expect(block).toContain('diverts to voicemail after 18:00');
        expect(block).toContain('No answer');
    });
});

describe('recipients', () => {
    test('draft recipients dedupe across the trials and the fallback', () => {
        const list = draftRecipients(
            [emailTest(), emailTest(), emailTest({ email: 'dan@example.com' })],
            ['frederick.harvey@example.com', 'peter@dtgeotech.com']
        );
        expect(list.split('; ').sort()).toEqual([
            'dan@example.com',
            'frederick.harvey@example.com',
            'peter@dtgeotech.com'
        ]);
    });

    test('confirmed recipients exclude everyone whose delivery failed', () => {
        const list = confirmedRecipients([
            emailTest(),
            emailTest({ email: 'bounced@example.com', result: 'unreachable' }),
            emailTest({ email: 'untested@example.com', result: 'pending' })
        ]);
        expect(list).toBe('frederick.harvey@example.com');
    });
});
