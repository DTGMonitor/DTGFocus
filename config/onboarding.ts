// onboarding.ts
//
// The six steps that take a client from a signed quotation to a live monitoring
// service, and the rules that decide when each one is finished.
//
// The sequence is DTG's own, lifted from the onboarding email a site receives:
//
//     ☑ Administration        limitations acknowledged, TARP contacts, sign-off
//     ☑ Remote connection test
//     ☐ Communication trial   trial calls to TARP contacts
//     ☐ Email trial
//     ☐ System readiness
//     ☐ Live commencement
//
// Two things are deliberately separated here:
//
//   * WHAT a step is (this module) — its key, order, prose, and the shape of the
//     `payload` it keeps. Pure data and pure functions, so the progress rules
//     are testable without a database.
//   * WHAT a step SAYS (config/onboardingEmails.ts) — the draft an engineer
//     sends when they reach it.
//
// Onboarding is per SITE. The acknowledgement, the contacts and the connection
// are agreed once with the client; a second radar dropped onto a live site
// inherits them rather than repeating them.

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export type OnboardingStepKey =
    | 'administration'
    | 'remote_connection'
    | 'communication_trial'
    | 'email_trial'
    | 'system_readiness'
    | 'live_commencement';

export type OnboardingStepStatus = 'pending' | 'in_progress' | 'blocked' | 'done';

export interface OnboardingStepDefinition {
    key: OnboardingStepKey;
    /** 1-based, and the value written to onboarding_steps.sort_order. */
    order: number;
    label: string;
    /** One line, shown under the step title. */
    summary: string;
    /**
     * What has to be true before the step can be ticked. Rendered as a checklist
     * beside the step, and quoted in the email draft where it is what is being
     * asked of the client.
     */
    requirements: string[];
}

/** The steps, in the order they are worked. */
export const ONBOARDING_STEPS: OnboardingStepDefinition[] = [
    {
        key: 'administration',
        order: 1,
        label: 'Administration',
        summary:
            'Limitations documents acknowledged, the proposed TARP reviewed and signed off, and the TARP contacts supplied.',
        requirements: [
            'Radar Risk and Limitations document sent and acknowledged in writing',
            'Radar brand limitation document sent and acknowledged in writing',
            'Proposed TARP sent and reviewed with the site',
            'TARP contacts supplied for day shift and night shift',
            'Signed quotation / purchase order received'
        ]
    },
    {
        key: 'remote_connection',
        order: 2,
        label: 'Remote Connection Test',
        summary:
            'The preconfigured remote-access licence installed on the monitoring workstation, and a connection plus latency check run against it.',
        requirements: [
            'Site IT approval to remote into the monitoring workstation',
            'Preconfigured licence file sent to the site',
            'Licence installed on the workstation connected to the radar',
            'Connection established and latency measured'
        ]
    },
    {
        key: 'communication_trial',
        order: 3,
        label: 'Communication Trial',
        summary:
            'A trial call to every TARP phone contact, day shift and night shift, so the escalation path is known to work before it is needed.',
        requirements: [
            'Every escalation contact called at least once',
            'Both shifts covered — a day-shift answer says nothing about night shift',
            'At least two phone levels reachable',
            'Unreachable numbers reported back to the site'
        ]
    },
    {
        key: 'email_trial',
        order: 4,
        label: 'Email Trial',
        summary:
            'A test notification to every address on the distribution list, confirming it arrives and is not quarantined as external mail.',
        requirements: [
            'Test notification sent to the full distribution list',
            'Delivery confirmed by at least one recipient per address',
            'Bounced or filtered addresses reported back to the site'
        ]
    },
    {
        key: 'system_readiness',
        order: 5,
        label: 'System Readiness',
        summary:
            'The radar configured in the dashboard — wall folder, data-quality parameters, alarm regions and the TARP document loaded and active.',
        requirements: [
            'Radar and its live wall folder created',
            'Data quality parameters seeded and reviewed against the scan',
            'Alarm regions and masks configured on the radar software',
            'TARP document loaded and set to active',
            'Daily report template and distribution confirmed'
        ]
    },
    {
        key: 'live_commencement',
        order: 6,
        label: 'Live Commencement',
        summary:
            'The notice that the formal monitoring service has started, with the commencement date and time the client is billed from.',
        requirements: [
            'Every preceding step complete',
            'Commencement date and time agreed',
            'Commencement notice sent to the client'
        ]
    }
];

const BY_KEY: Record<string, OnboardingStepDefinition> = ONBOARDING_STEPS.reduce(
    (acc, step) => {
        acc[step.key] = step;
        return acc;
    },
    {} as Record<string, OnboardingStepDefinition>
);

export const ONBOARDING_STEP_KEYS: OnboardingStepKey[] = ONBOARDING_STEPS.map((s) => s.key);

export const stepDefinition = (key: string | null | undefined): OnboardingStepDefinition | null =>
    (key && BY_KEY[key]) || null;

export const stepLabel = (key: string | null | undefined): string =>
    stepDefinition(key)?.label ?? String(key ?? '');

/** The two steps whose result is a per-contact verdict rather than a tick. */
export const CONTACT_TRIAL_STEPS: OnboardingStepKey[] = ['communication_trial', 'email_trial'];

export const isContactTrialStep = (key: string | null | undefined): boolean =>
    CONTACT_TRIAL_STEPS.includes(key as OnboardingStepKey);

/** Which channel a trial step tests. */
export const trialChannel = (key: string | null | undefined): 'phone' | 'email' | null =>
    key === 'communication_trial' ? 'phone' : key === 'email_trial' ? 'email' : null;

// ---------------------------------------------------------------------------
// Rows, as they come back from the database
// ---------------------------------------------------------------------------

export interface OnboardingStepRow {
    id?: number;
    step_key: string;
    sort_order?: number;
    status: string;
    email_drafted_at?: string | null;
    completed_at?: string | null;
    completed_by?: string | null;
    notes?: string | null;
    payload?: Record<string, unknown> | null;
}

export interface OnboardingRow {
    id: number;
    site_id: number;
    status: string;
    commenced_at?: string | null;
    started_at?: string | null;
    completed_at?: string | null;
    notes?: string | null;
    steps?: OnboardingStepRow[];
}

export type ContactTestResult =
    | 'pending'
    | 'reachable'
    | 'no_answer'
    | 'unreachable'
    | 'wrong_details';

export interface ContactTestRow {
    id?: number;
    step_key: string;
    channel: 'phone' | 'email';
    contact_id?: number | null;
    name?: string | null;
    role?: string | null;
    phone?: string | null;
    email?: string | null;
    shift?: 'day' | 'night' | null;
    result: ContactTestResult;
    tested_at?: string | null;
    remark?: string | null;
}

/** How each verdict reads, and whether it counts as a working contact. */
export const CONTACT_RESULT_OPTIONS: {
    value: ContactTestResult;
    label: string;
    reachable: boolean;
}[] = [
    { value: 'pending', label: 'Not yet tested', reachable: false },
    { value: 'reachable', label: 'Reachable', reachable: true },
    { value: 'no_answer', label: 'No answer', reachable: false },
    { value: 'unreachable', label: 'Unreachable', reachable: false },
    { value: 'wrong_details', label: 'Wrong details', reachable: false }
];

export const contactResultLabel = (result: string | null | undefined): string =>
    CONTACT_RESULT_OPTIONS.find((o) => o.value === result)?.label ?? 'Not yet tested';

export const isReachable = (result: string | null | undefined): boolean =>
    CONTACT_RESULT_OPTIONS.find((o) => o.value === result)?.reachable ?? false;

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

/** Step rows keyed by step, with anything unknown to this version dropped. */
export const indexSteps = (
    steps: OnboardingStepRow[] | null | undefined
): Record<string, OnboardingStepRow> =>
    (steps || []).reduce((acc, row) => {
        if (row?.step_key && BY_KEY[row.step_key]) acc[row.step_key] = row;
        return acc;
    }, {} as Record<string, OnboardingStepRow>);

export const stepStatus = (
    onboarding: OnboardingRow | null | undefined,
    key: OnboardingStepKey
): OnboardingStepStatus => {
    const row = indexSteps(onboarding?.steps)[key];
    const value = row?.status;
    return value === 'done' || value === 'in_progress' || value === 'blocked' ? value : 'pending';
};

export const isStepDone = (
    onboarding: OnboardingRow | null | undefined,
    key: OnboardingStepKey
): boolean => stepStatus(onboarding, key) === 'done';

/** How many steps are done, out of how many there are. */
export const onboardingProgress = (
    onboarding: OnboardingRow | null | undefined
): { done: number; total: number; percent: number } => {
    const total = ONBOARDING_STEPS.length;
    const done = ONBOARDING_STEPS.filter((s) => isStepDone(onboarding, s.key)).length;
    return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
};

/**
 * The step an engineer should be working on: the first one not done.
 *
 * Deliberately NOT "the first pending" — a blocked step (a site that has gone
 * quiet on the acknowledgement) is still the thing standing in the way, and
 * skipping past it would present the flow as further along than it is.
 */
export const currentStep = (
    onboarding: OnboardingRow | null | undefined
): OnboardingStepDefinition | null =>
    ONBOARDING_STEPS.find((s) => !isStepDone(onboarding, s.key)) ?? null;

/**
 * Is this site onboarded?
 *
 * Both halves of the user's rule have to hold: every step done AND the live
 * commencement actually sent. They are not the same fact — an engineer can tick
 * the last step off a checklist without the notice having gone out — so the
 * commencement timestamp is what finally opens the rest of the panel.
 *
 * A site with NO onboarding row at all reads as complete. Every site that was
 * live before this feature existed is backfilled by the migration, so a missing
 * row means a read that failed or a row not yet created; locking the operator
 * out of Deformation on a live radar because of it would be the worse failure.
 */
export const isOnboardingComplete = (onboarding: OnboardingRow | null | undefined): boolean => {
    if (!onboarding) return true;
    if (!onboarding.commenced_at) return false;
    return ONBOARDING_STEPS.every((s) => isStepDone(onboarding, s.key));
};

/**
 * Whether a step can be started yet.
 *
 * The order is a real dependency chain, not presentation: there is nothing to
 * trial-call before the site has supplied its TARP contacts, and no connection
 * to test before IT has approved the remote access. The one step this is
 * enforced strictly on is the last — a commencement notice sent over an
 * unfinished checklist is the failure this whole flow exists to prevent.
 *
 * Everything in between is advisory: the UI marks a step "waiting on" its
 * predecessor but does not refuse it, because sites genuinely do run the
 * connection test while the paperwork is still with their legal team — which is
 * exactly what the Genesis thread shows happening.
 */
export const canStartStep = (
    onboarding: OnboardingRow | null | undefined,
    key: OnboardingStepKey
): boolean => {
    if (key !== 'live_commencement') return true;
    return ONBOARDING_STEPS.filter((s) => s.key !== 'live_commencement').every((s) =>
        isStepDone(onboarding, s.key)
    );
};

// ---------------------------------------------------------------------------
// Contact trial summaries
// ---------------------------------------------------------------------------

export interface TrialSummary {
    total: number;
    tested: number;
    reachable: ContactTestRow[];
    unreachable: ContactTestRow[];
    untested: ContactTestRow[];
    /** Every contact has a verdict that is not 'pending'. */
    allTested: boolean;
    /**
     * The TARP asks for at least two phone levels. A trial that reached one
     * person is not an escalation path, so this is what the step's tick is
     * gated on rather than "everyone answered" — a site will always have one
     * number that never picks up.
     */
    meetsMinimumCoverage: boolean;
}

/** The minimum reachable contacts a trial has to find. Two phone levels; one email. */
export const MINIMUM_REACHABLE: Record<'phone' | 'email', number> = { phone: 2, email: 1 };

export const summariseTrial = (
    rows: ContactTestRow[] | null | undefined,
    channel: 'phone' | 'email'
): TrialSummary => {
    const list = (rows || []).filter((r) => r?.channel === channel);
    const reachable = list.filter((r) => isReachable(r.result));
    const untested = list.filter((r) => (r.result ?? 'pending') === 'pending');
    const unreachable = list.filter((r) => !isReachable(r.result) && (r.result ?? 'pending') !== 'pending');

    return {
        total: list.length,
        tested: list.length - untested.length,
        reachable,
        unreachable,
        untested,
        allTested: list.length > 0 && untested.length === 0,
        meetsMinimumCoverage:
            reachable.length >= Math.min(MINIMUM_REACHABLE[channel], list.length) && list.length > 0
    };
};

/** "Fred Harvey (Superintendent Geotechnical Projects)" — however much of it there is. */
export const describeContact = (row: ContactTestRow | null | undefined): string => {
    const name = String(row?.name ?? '').trim();
    const role = String(row?.role ?? '').trim();
    if (name && role) return `${name} (${role})`;
    return name || role || 'Unnamed contact';
};

/** The detail that was actually tested — the number dialled, or the address mailed. */
export const contactChannelValue = (row: ContactTestRow | null | undefined): string =>
    String((row?.channel === 'email' ? row?.email : row?.phone) ?? '').trim();
