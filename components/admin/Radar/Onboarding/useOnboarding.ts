// useOnboarding
//
// The onboarding state for one SITE: its row, its six steps, and the per-contact
// trial results.
//
// This hook READS and WRITES but never CREATES an onboarding on its own. A
// missing row means "this site was live before the flow existed" — the migration
// backfills every site that already has a radar as complete, and
// `isOnboardingComplete(null)` is true — so auto-creating one here would put a
// years-old live site back at step one the first time somebody opened it.
// The only place an onboarding is created is `ensureOnboarding`, called
// deliberately when a NEW site is added.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
    ONBOARDING_STEPS,
    isOnboardingComplete,
    trialChannel,
    type ContactTestRow,
    type OnboardingRow,
    type OnboardingStepKey,
    type OnboardingStepStatus
} from '@/config/onboarding';

const ONBOARDING_SELECT = `
  id, site_id, status, commenced_at, started_at, completed_at, notes,
  steps:onboarding_steps (
    id, step_key, sort_order, status, email_drafted_at, completed_at,
    completed_by, notes, payload
  )
`;

const TEST_SELECT = `
  id, step_key, channel, contact_id, name, role, phone, email, shift,
  result, tested_at, remark
`;

// The site's own record. `latest_radar_wall_folders` carries site_name but not
// the company or the location, and an onboarding email that opens "Hi Team, …
// at Leonora" without naming Genesis Minerals reads like a mail-merge failure.
const CLIENT_SELECT = 'id, site_name, company, location, timezone';

export interface OnboardingClient {
    id: number;
    site_name: string | null;
    company: string | null;
    location: string | null;
    timezone: string | null;
}

// ---------------------------------------------------------------------------
// Creating an onboarding — the deliberate act
// ---------------------------------------------------------------------------

/**
 * Start (or find) the onboarding for a site, with its six step rows.
 *
 * Idempotent: `client_onboardings.site_id` is unique, so a second call on the
 * same site returns the existing row rather than a duplicate. Returns the
 * onboarding id, or null if the tables have not been migrated yet — a caller
 * mid-way through creating a radar must not fail because of that.
 */
export const ensureOnboarding = async (
    siteId: number | string,
    userId?: string | null
): Promise<number | null> => {
    if (!siteId) return null;

    const { data: existing, error: readError } = await supabase
        .from('client_onboardings')
        .select('id')
        .eq('site_id', siteId)
        .maybeSingle();

    if (readError) {
        console.error('[useOnboarding] could not read onboarding', readError);
        return null;
    }

    let onboardingId = existing?.id ?? null;

    if (!onboardingId) {
        const { data, error } = await supabase
            .from('client_onboardings')
            .insert({ site_id: siteId, status: 'in_progress', created_by: userId || null })
            .select('id')
            .single();

        if (error) {
            console.error('[useOnboarding] could not create onboarding', error);
            return null;
        }
        onboardingId = data.id;
    }

    // The step rows. `ON CONFLICT DO NOTHING` in Supabase terms: ignoreDuplicates
    // on the unique (onboarding_id, step_key) index, so re-running is harmless.
    const { error: stepError } = await supabase.from('onboarding_steps').upsert(
        ONBOARDING_STEPS.map((step) => ({
            onboarding_id: onboardingId,
            step_key: step.key,
            sort_order: step.order,
            status: 'pending' as const
        })),
        { onConflict: 'onboarding_id,step_key', ignoreDuplicates: true }
    );

    if (stepError) console.error('[useOnboarding] could not seed steps', stepError);

    return onboardingId;
};

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

export interface UseOnboardingResult {
    onboarding: OnboardingRow | null;
    /** The site record, for the drafts' letterhead. Null until the read lands. */
    client: OnboardingClient | null;
    tests: ContactTestRow[];
    loading: boolean;
    error: string | null;
    /** True while nothing is known yet — callers must not gate tabs on a guess. */
    complete: boolean;
    refresh: () => Promise<void>;
    saveStep: (
        stepKey: OnboardingStepKey,
        patch: {
            status?: OnboardingStepStatus;
            notes?: string | null;
            payload?: Record<string, unknown>;
            emailDrafted?: boolean;
        }
    ) => Promise<boolean>;
    /** Copy the site's TARP contacts into the trial as untested rows. */
    seedTrial: (stepKey: OnboardingStepKey) => Promise<number>;
    saveTest: (test: ContactTestRow, patch: Partial<ContactTestRow>) => Promise<boolean>;
    addTest: (stepKey: OnboardingStepKey, row: Partial<ContactTestRow>) => Promise<boolean>;
    removeTest: (testId: number) => Promise<boolean>;
    /** Record the commencement and close the onboarding out. */
    commence: (whenIso: string) => Promise<boolean>;
}

export function useOnboarding(
    siteId?: number | string | null,
    userId?: string | null
): UseOnboardingResult {
    const [onboarding, setOnboarding] = useState<OnboardingRow | null>(null);
    const [client, setClient] = useState<OnboardingClient | null>(null);
    const [tests, setTests] = useState<ContactTestRow[]>([]);
    const [loading, setLoading] = useState(Boolean(siteId));
    const [error, setError] = useState<string | null>(null);
    // Until the first read lands, nothing is known. Gating the sensor panel's
    // tabs on an unresolved read would flash the whole panel away and back on
    // every open, so callers are told to wait via `loading`.
    const [loaded, setLoaded] = useState(false);

    const load = useCallback(async () => {
        if (!siteId) {
            setOnboarding(null);
            setClient(null);
            setTests([]);
            setLoading(false);
            setLoaded(true);
            return;
        }

        setLoading(true);
        setError(null);

        const [{ data, error: queryError }, { data: clientRow }] = await Promise.all([
            supabase
                .from('client_onboardings')
                .select(ONBOARDING_SELECT)
                .eq('site_id', siteId)
                .maybeSingle(),
            supabase.from('clients').select(CLIENT_SELECT).eq('id', siteId).maybeSingle()
        ]);

        setClient((clientRow as OnboardingClient) || null);

        if (queryError) {
            console.error('[useOnboarding] load failed', queryError);
            setError(queryError.message);
            setOnboarding(null);
            setTests([]);
            setLoading(false);
            setLoaded(true);
            return;
        }

        const row = (data as OnboardingRow) || null;
        setOnboarding(row);

        if (row?.id) {
            const { data: testRows, error: testError } = await supabase
                .from('onboarding_contact_tests')
                .select(TEST_SELECT)
                .eq('onboarding_id', row.id)
                .order('id');

            if (testError) {
                console.error('[useOnboarding] trial results failed', testError);
                setTests([]);
            } else {
                setTests((testRows as ContactTestRow[]) || []);
            }
        } else {
            setTests([]);
        }

        setLoading(false);
        setLoaded(true);
    }, [siteId]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            await load();
            if (cancelled) return;
        })();
        return () => {
            cancelled = true;
        };
    }, [load]);

    // The id on its own. Every mutation depends on WHICH onboarding it is
    // writing to, never on the rest of the record, and a callback that reads
    // `onboarding?.id` makes the React Compiler infer the whole object as its
    // dependency — rebuilding every handler on each refetch.
    const onboardingId = onboarding?.id ?? null;

    const saveStep = useCallback<UseOnboardingResult['saveStep']>(
        async (stepKey, patch) => {
            if (!onboardingId) return false;

            const update: Record<string, unknown> = {};
            if (patch.status !== undefined) {
                update.status = patch.status;
                // The completion stamp follows the status both ways: a step
                // un-ticked after a client comes back with a correction must not
                // keep the date it was first signed off on.
                update.completed_at = patch.status === 'done' ? new Date().toISOString() : null;
                update.completed_by = patch.status === 'done' ? userId || null : null;
            }
            if (patch.notes !== undefined) update.notes = patch.notes;
            if (patch.payload !== undefined) update.payload = patch.payload;
            if (patch.emailDrafted) update.email_drafted_at = new Date().toISOString();

            const { error: updateError } = await supabase
                .from('onboarding_steps')
                .update(update)
                .eq('onboarding_id', onboardingId)
                .eq('step_key', stepKey);

            if (updateError) {
                console.error('[useOnboarding] step save failed', updateError);
                setError(updateError.message);
                return false;
            }

            await load();
            return true;
        },
        [onboardingId, userId, load]
    );

    /**
     * Pull the site's TARP contacts into a trial.
     *
     * The channel decides who is relevant: a phone trial wants everyone with a
     * number, an email trial everyone with an address. Contacts already in the
     * trial are left alone — reseeding after the TARP gains a contact must not
     * wipe the verdicts already recorded against the others.
     */
    const seedTrial = useCallback<UseOnboardingResult['seedTrial']>(
        async (stepKey) => {
            if (!onboardingId || !siteId) return 0;
            const channel = trialChannel(stepKey);
            if (!channel) return 0;

            const { data: doc, error: docError } = await supabase
                .from('tarp_documents')
                .select('id, contacts:tarp_contacts (id, kind, sort_order, name, role, phone, email)')
                .eq('site_id', siteId)
                .eq('status', 'active')
                .maybeSingle();

            if (docError) {
                console.error('[useOnboarding] could not read TARP contacts', docError);
                setError(docError.message);
                return 0;
            }

            const contacts = (doc?.contacts || []) as {
                id: number;
                kind: string;
                sort_order: number;
                name: string | null;
                role: string | null;
                phone: string | null;
                email: string | null;
            }[];

            const already = new Set(
                tests
                    .filter((t) => t.step_key === stepKey && t.contact_id != null)
                    .map((t) => t.contact_id)
            );

            const rows = contacts
                .filter((c) => !already.has(c.id))
                .filter((c) => (channel === 'phone' ? Boolean(c.phone) : Boolean(c.email)))
                .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                .map((c) => ({
                    onboarding_id: onboardingId,
                    step_key: stepKey,
                    channel,
                    contact_id: c.id,
                    name: c.name,
                    role: c.role,
                    phone: c.phone,
                    email: c.email,
                    result: 'pending' as const
                }));

            if (rows.length === 0) return 0;

            const { error: insertError } = await supabase
                .from('onboarding_contact_tests')
                .insert(rows);

            if (insertError) {
                console.error('[useOnboarding] could not seed trial', insertError);
                setError(insertError.message);
                return 0;
            }

            await load();
            return rows.length;
        },
        [onboardingId, siteId, tests, load]
    );

    const saveTest = useCallback<UseOnboardingResult['saveTest']>(
        async (test, patch) => {
            if (!test?.id) return false;

            const update: Record<string, unknown> = { ...patch };
            if (patch.result !== undefined) {
                // A verdict is only meaningful with the moment it was reached —
                // "unreachable" from three weeks ago is not evidence about today.
                update.tested_at = patch.result === 'pending' ? null : new Date().toISOString();
                update.tested_by = patch.result === 'pending' ? null : userId || null;
            }

            const { error: updateError } = await supabase
                .from('onboarding_contact_tests')
                .update(update)
                .eq('id', test.id);

            if (updateError) {
                console.error('[useOnboarding] trial result save failed', updateError);
                setError(updateError.message);
                return false;
            }

            // Patched in place rather than refetched: an operator working down a
            // list of ten contacts should not have the list rebuild under them
            // after every dropdown.
            setTests((prev) =>
                prev.map((row) => (row.id === test.id ? { ...row, ...update } as ContactTestRow : row))
            );
            return true;
        },
        [userId]
    );

    const addTest = useCallback<UseOnboardingResult['addTest']>(
        async (stepKey, row) => {
            if (!onboardingId) return false;
            const channel = trialChannel(stepKey);
            if (!channel) return false;

            const { error: insertError } = await supabase.from('onboarding_contact_tests').insert({
                onboarding_id: onboardingId,
                step_key: stepKey,
                channel,
                contact_id: null,
                name: row.name ?? null,
                role: row.role ?? null,
                phone: row.phone ?? null,
                email: row.email ?? null,
                shift: row.shift ?? null,
                result: row.result ?? 'pending'
            });

            if (insertError) {
                console.error('[useOnboarding] could not add contact', insertError);
                setError(insertError.message);
                return false;
            }

            await load();
            return true;
        },
        [onboardingId, load]
    );

    const removeTest = useCallback<UseOnboardingResult['removeTest']>(
        async (testId) => {
            const { error: deleteError } = await supabase
                .from('onboarding_contact_tests')
                .delete()
                .eq('id', testId);

            if (deleteError) {
                console.error('[useOnboarding] could not remove contact', deleteError);
                setError(deleteError.message);
                return false;
            }

            setTests((prev) => prev.filter((row) => row.id !== testId));
            return true;
        },
        []
    );

    /**
     * Commencement: the step, the onboarding status and the commencement stamp
     * all move together.
     *
     * `commenced_at` is what finally unlocks the rest of the sensor panel, so it
     * is written LAST — a failure part-way through leaves the flow visibly
     * unfinished rather than a site that looks live with a half-written record.
     */
    const commence = useCallback<UseOnboardingResult['commence']>(
        async (whenIso) => {
            if (!onboardingId) return false;

            const ok = await saveStep('live_commencement', {
                status: 'done',
                payload: { commencedAt: whenIso }
            });
            if (!ok) return false;

            const { error: updateError } = await supabase
                .from('client_onboardings')
                .update({
                    status: 'complete',
                    commenced_at: whenIso,
                    completed_at: new Date().toISOString()
                })
                .eq('id', onboardingId);

            if (updateError) {
                console.error('[useOnboarding] commencement failed', updateError);
                setError(updateError.message);
                return false;
            }

            await load();
            return true;
        },
        [onboardingId, saveStep, load]
    );

    const complete = useMemo(
        () => (loaded ? isOnboardingComplete(onboarding) : true),
        [loaded, onboarding]
    );

    return {
        onboarding,
        client,
        tests,
        loading,
        error,
        complete,
        refresh: load,
        saveStep,
        seedTrial,
        saveTest,
        addTest,
        removeTest,
        commence
    };
}
