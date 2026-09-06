/**
 * Onboarding drafts in Bahasa Indonesia.
 *
 * The rule is the one config/emailLocale.ts states and the deformation drafts
 * already follow: prose, labels and brackets translate; product and process
 * names do not. A site that receives its alarms in Indonesian must not receive
 * its onboarding in English, and analyst free-text must reach the client
 * exactly as it was typed in either language.
 *
 * jest pins TZ to Asia/Jakarta (see jest.config.js). The site in these fixtures
 * is on Asia/Makassar, which is what makes the timestamp assertions meaningful:
 * a commencement time must carry the SITE's clock, not the analyst's.
 */

import {
    ONBOARDING_STEPS,
    type ContactTestRow,
    type OnboardingRow,
    type OnboardingStepKey
} from '@/config/onboarding';
import {
    buildOnboardingDraft,
    onboardingStrings,
    trialResultBlock
} from '@/config/onboardingEmails';

const ALL_KEYS = ONBOARDING_STEPS.map((s) => s.key);

const makeOnboarding = (doneKeys: OnboardingStepKey[]): OnboardingRow => ({
    id: 1,
    site_id: 42,
    status: doneKeys.length === ALL_KEYS.length ? 'complete' : 'in_progress',
    commenced_at: null,
    steps: ONBOARDING_STEPS.map((step) => ({
        step_key: step.key,
        sort_order: step.order,
        status: doneKeys.includes(step.key) ? 'done' : 'pending'
    }))
});

const phoneTest = (over: Partial<ContactTestRow> = {}): ContactTestRow => ({
    step_key: 'communication_trial',
    channel: 'phone',
    name: 'Budi Santoso',
    role: 'Geotech On-Call',
    phone: '+62 812 3456 7890',
    result: 'reachable',
    ...over
});

const emailTest = (over: Partial<ContactTestRow> = {}): ContactTestRow => ({
    step_key: 'email_trial',
    channel: 'email',
    name: 'Budi Santoso',
    email: 'budi@example.co.id',
    result: 'reachable',
    ...over
});

const idCtx = {
    siteName: 'Batu Hijau',
    company: 'PT Amman Mineral',
    location: 'NTB',
    radars: ['SSR994'],
    engineerName: 'Lintang Putra Sadewa',
    engineerEmail: 'lintang.sadewa@dtgeotech.com',
    onboarding: makeOnboarding(['administration']),
    tests: [] as ContactTestRow[],
    locale: 'id' as const,
    timeZone: 'Asia/Makassar'
};

// ---------------------------------------------------------------------------

describe('Indonesian drafts', () => {
    test('every step opens and closes in the register the sites already receive', () => {
        for (const key of ALL_KEYS) {
            const draft = buildOnboardingDraft(key, idCtx);
            expect(draft).not.toBeNull();
            expect(draft!.body).toContain('Semangat Pagi,');
            expect(draft!.body).toContain('Salam,');
            expect(draft!.body).not.toContain('Hi Team,');
            expect(draft!.body).not.toContain('Kind regards,');
        }
    });

    test('subject brackets reuse the wording every other draft uses', () => {
        expect(buildOnboardingDraft('administration', idCtx)!.subject).toContain(
            '[PERLU TINDAKAN]'
        );
        expect(buildOnboardingDraft('system_readiness', idCtx)!.subject).toContain('[NOTIFIKASI]');
    });

    test('the running checklist is translated, ticks and marker included', () => {
        const body = buildOnboardingDraft('remote_connection', idCtx)!.body;
        expect(body).toContain('[x] Administrasi');
        expect(body).toContain('[ ] Uji Koneksi Remote');
        expect(body).toContain('<-- tahap saat ini');
        expect(body).not.toContain('Administration');
        expect(body).not.toContain('we are here');
    });

    test('product and process names survive untranslated', () => {
        const admin = buildOnboardingDraft('administration', idCtx)!;
        expect(admin.body).toContain('TARP');
        expect(admin.body).toContain('DTG Radar TARP');

        const readiness = buildOnboardingDraft('system_readiness', idCtx)!;
        expect(readiness.body).toContain('wall folder');
        expect(readiness.body).toContain('alarm mask');
    });

    test('trial verdicts and shifts are translated', () => {
        const draft = buildOnboardingDraft('communication_trial', {
            ...idCtx,
            tests: [
                phoneTest({ shift: 'day' }),
                phoneTest({ name: 'Dispatch Malam', shift: 'night', result: 'no_answer' })
            ]
        })!;
        expect(draft.body).toContain('[shift siang]');
        expect(draft.body).toContain('[shift malam]');
        expect(draft.body).toContain('Tidak diangkat');
        expect(draft.body).toContain('TIDAK dapat dihubungi');
        expect(draft.body).not.toContain('No answer');
    });

    test('an empty trial says so in Indonesian', () => {
        expect(trialResultBlock([], 'phone', 'id').join('\n')).toContain(
            'Tidak ada kontak yang terdaftar'
        );
    });

    test('the coverage shortfall warning is translated per channel', () => {
        const phone = trialResultBlock([phoneTest({ result: 'no_answer' })], 'phone', 'id').join(
            '\n'
        );
        expect(phone).toContain('minimum dua level kontak telepon');

        const email = trialResultBlock([emailTest({ result: 'unreachable' })], 'email', 'id').join(
            '\n'
        );
        expect(email).toContain('whitelist domain pengirim DTG');
    });

    test('the commencement notice stamps the SITE zone, not the analyst browser zone', () => {
        // A tz-naive datetime-local value is already the site's wall clock, so it
        // is labelled rather than re-projected. 06:00 entered must read 06:00.
        const draft = buildOnboardingDraft('live_commencement', {
            ...idCtx,
            onboarding: makeOnboarding(ALL_KEYS),
            payload: { commencedAt: '2026-08-01T06:00' }
        })!;
        expect(draft.body).toContain('01/08/2026 06:00 WITA');
    });

    test('a pre-formatted commencement label is used verbatim', () => {
        const draft = buildOnboardingDraft('live_commencement', {
            ...idCtx,
            onboarding: makeOnboarding(ALL_KEYS),
            payload: { commencementLabel: '01/08/2026 06:00 WITA' }
        })!;
        expect(draft.body).toContain('01/08/2026 06:00 WITA');
    });

    test('a commencement with no time at all does not print a dangling dash', () => {
        const draft = buildOnboardingDraft('live_commencement', {
            ...idCtx,
            onboarding: makeOnboarding(ALL_KEYS)
        })!;
        expect(draft.body).toContain('telah resmi dimulai.');
    });

    test('analyst free-text passes through untouched, as it must', () => {
        const draft = buildOnboardingDraft('system_readiness', {
            ...idCtx,
            notes: 'Menunggu konfirmasi alarm mask dari Pak Budi.'
        })!;
        expect(draft.body).toContain('Catatan:');
        expect(draft.body).toContain('Menunggu konfirmasi alarm mask dari Pak Budi.');
    });

    test('the radar list joins with the Indonesian conjunction', () => {
        const draft = buildOnboardingDraft('administration', {
            ...idCtx,
            radars: ['SSR994', 'MSR254']
        })!;
        expect(draft.body).toContain('SSR994 dan MSR254');
    });

    test('a site with no radar named degrades to the Indonesian fallback', () => {
        const draft = buildOnboardingDraft('administration', { ...idCtx, radars: [] })!;
        expect(draft.body).not.toMatch(/undefined|null/);
        expect(draft.body).toContain('remote monitoring radar di');
    });
});

describe('locale selection', () => {
    test('the English draft is untouched by any of this', () => {
        const en = buildOnboardingDraft('administration', { ...idCtx, locale: 'en' })!;
        expect(en.body).toContain('Hi Team,');
        expect(en.body).toContain('Kind regards,');
        expect(en.subject).toContain('[ACTION REQUIRED]');
    });

    test('no locale at all means English', () => {
        const draft = buildOnboardingDraft('administration', {
            siteName: 'Leonora',
            onboarding: makeOnboarding([])
        })!;
        expect(draft.body).toContain('Hi Team,');
    });

    test('an unknown locale falls back to English rather than to blank strings', () => {
        const draft = buildOnboardingDraft('administration', {
            ...idCtx,
            // @ts-expect-error deliberately out of contract
            locale: 'fr'
        })!;
        expect(draft.body).toContain('Hi Team,');
        expect(draft.body).not.toMatch(/undefined/);
    });
});

describe('the two string packs stay in step', () => {
    test('every step has a checklist label in both languages', () => {
        for (const step of ONBOARDING_STEPS) {
            expect(onboardingStrings('en').stepLabels[step.key]).toBeTruthy();
            expect(onboardingStrings('id').stepLabels[step.key]).toBeTruthy();
        }
    });

    test('the packs carry the same keys, so no draft can fall through to undefined', () => {
        expect(Object.keys(onboardingStrings('id')).sort()).toEqual(
            Object.keys(onboardingStrings('en')).sort()
        );
    });

    test('every contact verdict has an Indonesian word', () => {
        const en = onboardingStrings('en').results;
        const id = onboardingStrings('id').results;
        for (const key of Object.keys(en)) {
            expect(id[key]).toBeTruthy();
            expect(id[key]).not.toBe(en[key]);
        }
    });

    test('the list-shaped entries are the same length in both packs', () => {
        // A missing bullet is silent — the draft still sends, one item short.
        const en = onboardingStrings('en');
        const id = onboardingStrings('id');
        expect(id.adminAttachments).toHaveLength(en.adminAttachments.length);
        expect(id.adminItems).toHaveLength(en.adminItems.length);
        expect(id.readinessConfirmed).toHaveLength(en.readinessConfirmed.length);
        expect(id.commencementItems).toHaveLength(en.commencementItems.length);
        expect(id.connectionItems('R', '')).toHaveLength(en.connectionItems('R', '').length);
    });

    test('no plain-string entry was left as its English original', () => {
        const en = onboardingStrings('en') as unknown as Record<string, unknown>;
        const id = onboardingStrings('id') as unknown as Record<string, unknown>;
        const untranslated = Object.keys(en).filter(
            (key) => typeof en[key] === 'string' && en[key] === id[key]
        );
        // `roleFallback` is a job title DTG writes in English on both sides —
        // it is what appears under a signature on an Indonesian draft today.
        expect(untranslated).toEqual(['roleFallback']);
    });
});
