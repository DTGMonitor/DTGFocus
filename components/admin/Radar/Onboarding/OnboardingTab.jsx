import { useMemo, useState } from 'react';
import {
    Check,
    ChevronDown,
    ChevronRight,
    Circle,
    Loader,
    Mail,
    Pencil,
    Rocket,
    TriangleAlert
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { openOutlookDraft } from '@/utils/openOutlookDraft';
import {
    ONBOARDING_STEPS,
    canStartStep,
    currentStep,
    indexSteps,
    isContactTrialStep,
    isStepDone,
    onboardingProgress,
    stepStatus,
    summariseTrial,
    trialChannel
} from '@/config/onboarding';
import { buildOnboardingDraft, draftRecipients } from '@/config/onboardingEmails';
import { formatEmailTimestamp } from '@/config/emailLocale';
import { fromUTC, toUTC } from '@/utils/timezoneUtils';
import ContactTrialPanel from './ContactTrialPanel';

/**
 * OnboardingTab
 *
 * The six-step flow that takes a site from a signed quotation to live
 * monitoring, with the email draft each step sends.
 *
 * This is the ONLY tab a sensor shows until its site's onboarding is complete —
 * see SensorDetail. That gate is the point of the feature: an engineer cannot
 * start filing deformation records against a radar whose escalation path has
 * never been dialled, because there is nowhere to file them yet.
 *
 * Nothing here sends mail. Every "draft" button writes its step FIRST and then
 * hands a pre-filled message to Outlook, the same order every other draft in
 * this app uses — the analyst reads and sends it themselves.
 *
 * Props:
 *   sensor        the wall-folder row (radar_number, site_name, site_id, …)
 *   client        the site record (company, location) — the board view has neither
 *   onboarding    OnboardingRow | null
 *   tests         ContactTestRow[]
 *   loading       boolean
 *   userSite      { displayname, user_id } — signs the drafts
 *   userEmail     the engineer's own address
 *   emailLocale   'en' | 'id' — the language the SITE is emailed in, resolved by
 *                 config/emailLocale.ts. The tab itself stays English: it is a
 *                 DTG console, and only what reaches the client is translated.
 *   timezone      the site's IANA zone. The commencement time is entered and
 *                 quoted on the SITE's clock, as every other form here is.
 *   onSaveStep    (stepKey, patch) => Promise<boolean>
 *   onSeedTrial   (stepKey) => Promise<number>
 *   onSaveTest    (test, patch) => Promise<boolean>
 *   onAddTest     (stepKey, row) => Promise<boolean>
 *   onRemoveTest  (testId) => Promise<boolean>
 *   onCommence    (isoString) => Promise<boolean>
 *   onEditSite    () => void — opens the site & company details editor
 */
export default function OnboardingTab({
    sensor,
    client,
    onboarding,
    tests,
    loading,
    userSite,
    userEmail,
    emailLocale = 'en',
    timezone,
    onSaveStep,
    onSeedTrial,
    onSaveTest,
    onAddTest,
    onRemoveTest,
    onCommence,
    onEditSite
}) {
    const active = currentStep(onboarding);
    const [openKey, setOpenKey] = useState(active?.key || 'administration');
    const [busyKey, setBusyKey] = useState(null);
    const [notes, setNotes] = useState({});
    const [payloads, setPayloads] = useState({});
    // Defaults to now on the SITE's clock. The client is told the commencement
    // moment, so it has to be a real one rather than midnight — and it has to be
    // the moment they read on their own wall, not the analyst's. Every other
    // datetime field in this panel is entered in site time; this one matches.
    const [commenceAt, setCommenceAt] = useState(() =>
        (fromUTC(new Date().toISOString(), timezone) || '').slice(0, 16)
    );

    const stepRows = useMemo(() => indexSteps(onboarding?.steps), [onboarding]);
    const progress = useMemo(() => onboardingProgress(onboarding), [onboarding]);

    /** What the drafts know about this site. */
    const emailContext = useMemo(
        () => ({
            siteName: client?.site_name || sensor?.site_name,
            company: client?.company,
            location: client?.location,
            radars: [sensor?.radar_number].filter(Boolean),
            engineerName: userSite?.displayname,
            engineerEmail: userEmail,
            onboarding,
            tests,
            locale: emailLocale,
            timeZone: timezone || client?.timezone
        }),
        [sensor, client, userSite, userEmail, onboarding, tests, emailLocale, timezone]
    );

    const noteFor = (key) => notes[key] ?? stepRows[key]?.notes ?? '';
    const payloadFor = (key) => payloads[key] ?? stepRows[key]?.payload ?? {};

    const setPayloadField = (key, field, value) =>
        setPayloads((prev) => ({ ...prev, [key]: { ...payloadFor(key), [field]: value } }));

    /**
     * Persist a step, then open its draft.
     *
     * The write comes first on purpose. A draft that opens on a step whose notes
     * were never saved reaches the client quoting figures the dashboard has no
     * record of.
     */
    const draftStep = async (key) => {
        setBusyKey(key);
        try {
            const saved = await onSaveStep(key, {
                notes: noteFor(key) || null,
                payload: payloadFor(key),
                status: isStepDone(onboarding, key) ? undefined : 'in_progress',
                emailDrafted: true
            });
            if (!saved) {
                toast.error('Could not save the step — draft not opened.');
                return;
            }

            const draft = buildOnboardingDraft(key, { ...emailContext, notes: noteFor(key), payload: payloadFor(key) });
            if (!draft) {
                toast.error('No email template for this step.');
                return;
            }

            openOutlookDraft(draft.subject, draft.body, draftRecipients(tests));
            toast.success('Draft opened in your mail client.');
        } finally {
            setBusyKey(null);
        }
    };

    const saveStep = async (key, patch) => {
        setBusyKey(key);
        try {
            const ok = await onSaveStep(key, {
                notes: noteFor(key) || null,
                payload: payloadFor(key),
                ...patch
            });
            if (ok) toast.success('Saved.');
            else toast.error('Could not save the step.');
        } finally {
            setBusyKey(null);
        }
    };

    const toggleDone = async (key) => {
        const done = isStepDone(onboarding, key);
        await saveStep(key, { status: done ? 'in_progress' : 'done' });
    };

    const commence = async () => {
        if (!commenceAt) {
            toast.error('Pick the commencement date and time first.');
            return;
        }
        setBusyKey('live_commencement');
        try {
            // Stored as a real instant, read as the site's wall clock — the same
            // toUTC/fromUTC pair every other timestamp in this panel goes through.
            const iso = toUTC(commenceAt, timezone || client?.timezone);
            const ok = await onCommence(iso);
            if (!ok) {
                toast.error('Could not record the commencement.');
                return;
            }

            const draft = buildOnboardingDraft('live_commencement', {
                ...emailContext,
                notes: noteFor('live_commencement'),
                // The naive value, not the instant: formatEmailTimestamp stamps a
                // tz-naive string with the site's zone label rather than
                // re-projecting it out of the analyst's browser zone.
                payload: {
                    commencementLabel: formatEmailTimestamp(commenceAt, {
                        locale: emailLocale,
                        timeZone: timezone || client?.timezone
                    })
                }
            });
            if (draft) openOutlookDraft(draft.subject, draft.body, draftRecipients(tests));
            toast.success('Monitoring commenced. The rest of the sensor panel is now open.');
        } finally {
            setBusyKey(null);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center p-10 text-[var(--dtg-gray-700)]">
                <Loader size={18} className="mr-2 animate-spin" />
                Loading onboarding…
            </div>
        );
    }

    if (!onboarding) {
        return (
            <div className="p-6 text-sm text-[var(--dtg-gray-500)]">
                <p className="mb-2 text-[var(--dtg-text-primary)]">No onboarding record for this site.</p>
                <p>
                    Sites that were already live when this flow was introduced have no onboarding to
                    work through, and every tab stays open. A record is created when a site is added
                    for the first time from <span className="text-[var(--dtg-text-primary)]">Add Sensor</span>.
                </p>
            </div>
        );
    }

    return (
        <div className="flex w-full flex-col gap-4 p-4 text-[var(--dtg-text-primary)]">
            {/* --- Heading + progress ------------------------------------- */}
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--dtg-border-medium)] pb-3">
                <div>
                    <h2 className="text-xl font-medium">Onboarding</h2>
                    <p className="mt-0.5 text-sm text-[var(--dtg-gray-500)]">
                        {client?.site_name || sensor?.site_name}
                        {client?.company ? ` — ${client.company}` : ''} · {progress.done} of{' '}
                        {progress.total} steps complete
                    </p>
                </div>
                <Button variant="outline" size="sm" onClick={onEditSite}>
                    <Pencil size={14} />
                    Site &amp; company details
                </Button>
            </div>

            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--dtg-bg-primary)]">
                <div
                    className="h-full rounded-full bg-[var(--dtg-brand-orange)] transition-all duration-300"
                    style={{ width: `${progress.percent}%` }}
                />
            </div>

            {/* --- Steps --------------------------------------------------- */}
            <div className="flex flex-col gap-2">
                {ONBOARDING_STEPS.map((step) => {
                    const done = isStepDone(onboarding, step.key);
                    const status = stepStatus(onboarding, step.key);
                    const open = openKey === step.key;
                    const busy = busyKey === step.key;
                    const startable = canStartStep(onboarding, step.key);
                    const channel = trialChannel(step.key);
                    const trial = channel ? summariseTrial(tests, channel) : null;

                    return (
                        <div
                            key={step.key}
                            className={[
                                'rounded-lg border transition-colors',
                                done
                                    ? 'border-emerald-600/40 bg-emerald-500/[0.03]'
                                    : open
                                      ? 'border-[var(--dtg-brand-orange)]/50 bg-[var(--dtg-bg-card)]'
                                      : 'border-[var(--dtg-border-medium)] bg-[var(--dtg-bg-card)]'
                            ].join(' ')}
                        >
                            {/* Header row */}
                            <button
                                type="button"
                                onClick={() => setOpenKey(open ? null : step.key)}
                                className="flex w-full items-center gap-3 px-4 py-3 text-left"
                            >
                                {done ? (
                                    <Check size={18} className="shrink-0 text-emerald-400" />
                                ) : status === 'blocked' ? (
                                    <TriangleAlert size={18} className="shrink-0 text-red-400" />
                                ) : (
                                    <Circle
                                        size={18}
                                        className={
                                            status === 'in_progress'
                                                ? 'shrink-0 text-[var(--dtg-brand-orange)]'
                                                : 'shrink-0 text-[var(--dtg-gray-700)]'
                                        }
                                    />
                                )}

                                <span className="flex-1">
                                    <span className="block text-sm font-medium">
                                        {step.order}. {step.label}
                                    </span>
                                    <span className="block text-xs text-[var(--dtg-gray-500)]">
                                        {step.summary}
                                    </span>
                                </span>

                                {trial && trial.total > 0 && (
                                    <span
                                        className={[
                                            'shrink-0 rounded px-2 py-0.5 text-xs',
                                            trial.meetsMinimumCoverage
                                                ? 'bg-emerald-500/10 text-emerald-300'
                                                : 'bg-amber-500/10 text-amber-300'
                                        ].join(' ')}
                                    >
                                        {trial.reachable.length}/{trial.total} reachable
                                    </span>
                                )}

                                {open ? (
                                    <ChevronDown size={16} className="shrink-0 text-[var(--dtg-gray-500)]" />
                                ) : (
                                    <ChevronRight size={16} className="shrink-0 text-[var(--dtg-gray-500)]" />
                                )}
                            </button>

                            {/* Body */}
                            {open && (
                                <div className="space-y-4 border-t border-[var(--dtg-border-medium)] px-4 py-4">
                                    {!startable && (
                                        <div className="flex items-start gap-2 rounded-md border border-amber-600/40 bg-amber-500/5 p-3 text-sm text-amber-300">
                                            <TriangleAlert size={16} className="mt-0.5 shrink-0" />
                                            <span>
                                                Every preceding step has to be complete before monitoring
                                                can be declared live. That is what this notice tells the
                                                client, and it is the one step this flow will not let you
                                                run out of order.
                                            </span>
                                        </div>
                                    )}

                                    {/* Requirements */}
                                    <div>
                                        <p className="mb-1.5 text-xs font-medium text-[var(--dtg-gray-700)]">
                                            What this step covers
                                        </p>
                                        <ul className="space-y-1">
                                            {step.requirements.map((req) => (
                                                <li
                                                    key={req}
                                                    className="flex items-start gap-2 text-sm text-[var(--dtg-gray-500)]"
                                                >
                                                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--dtg-gray-700)]" />
                                                    {req}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>

                                    {/* Step-specific fields */}
                                    {step.key === 'remote_connection' && (
                                        <div className="grid gap-3 md:grid-cols-3">
                                            <div className="space-y-1.5">
                                                <label className="text-xs text-[var(--dtg-gray-700)]">
                                                    Remote-access licence link
                                                </label>
                                                <Input
                                                    value={payloadFor(step.key).licenceLink || ''}
                                                    onChange={(e) =>
                                                        setPayloadField(step.key, 'licenceLink', e.target.value)
                                                    }
                                                    placeholder="https://custom.teamviewer.com/…"
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-xs text-[var(--dtg-gray-700)]">
                                                    Monitoring workstation
                                                </label>
                                                <Input
                                                    value={payloadFor(step.key).workstation || ''}
                                                    onChange={(e) =>
                                                        setPayloadField(step.key, 'workstation', e.target.value)
                                                    }
                                                    placeholder="the PC connected to the radar"
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-xs text-[var(--dtg-gray-700)]">
                                                    Measured latency
                                                </label>
                                                <Input
                                                    value={payloadFor(step.key).latency || ''}
                                                    onChange={(e) =>
                                                        setPayloadField(step.key, 'latency', e.target.value)
                                                    }
                                                    placeholder="e.g. 180 ms"
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {isContactTrialStep(step.key) && (
                                        <ContactTrialPanel
                                            stepKey={step.key}
                                            channel={channel}
                                            tests={tests}
                                            onSeed={() => onSeedTrial(step.key)}
                                            onSave={onSaveTest}
                                            onAdd={onAddTest}
                                            onRemove={onRemoveTest}
                                            disabled={busy}
                                        />
                                    )}

                                    {step.key === 'live_commencement' && (
                                        <div className="space-y-1.5">
                                            <label className="text-xs text-[var(--dtg-gray-700)]">
                                                Commencement date and time
                                            </label>
                                            <input
                                                type="datetime-local"
                                                value={commenceAt}
                                                onChange={(e) => setCommenceAt(e.target.value)}
                                                className="w-full max-w-xs rounded-md border border-[var(--dtg-border-medium)] bg-[var(--dtg-bg-card)] p-2 text-sm text-[var(--dtg-text-primary)] outline-none"
                                            />
                                            <p className="text-xs text-[var(--dtg-gray-700)]">
                                                Site local time. This is the moment the client is billed
                                                from, and it is what opens the rest of this sensor&apos;s
                                                panel.
                                            </p>
                                        </div>
                                    )}

                                    {/* Notes */}
                                    <div className="space-y-1.5">
                                        <label className="text-xs text-[var(--dtg-gray-700)]">
                                            Notes — appended to the email draft
                                        </label>
                                        <textarea
                                            rows={3}
                                            value={noteFor(step.key)}
                                            onChange={(e) =>
                                                setNotes({ ...notes, [step.key]: e.target.value })
                                            }
                                            placeholder="Anything the client should read alongside this step."
                                            className="w-full rounded-md border border-[var(--dtg-border-medium)] bg-transparent p-2 text-sm text-[var(--dtg-text-primary)] outline-none"
                                        />
                                    </div>

                                    {/* Actions */}
                                    <div className="flex flex-wrap items-center gap-2">
                                        {step.key === 'live_commencement' ? (
                                            <Button
                                                variant="brand"
                                                size="sm"
                                                onClick={commence}
                                                disabled={busy || !startable || done}
                                            >
                                                {busy ? (
                                                    <Loader size={14} className="animate-spin" />
                                                ) : (
                                                    <Rocket size={14} />
                                                )}
                                                {done ? 'Commenced' : 'Commence & draft notice'}
                                            </Button>
                                        ) : (
                                            <>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => draftStep(step.key)}
                                                    disabled={busy}
                                                >
                                                    {busy ? (
                                                        <Loader size={14} className="animate-spin" />
                                                    ) : (
                                                        <Mail size={14} />
                                                    )}
                                                    Open email draft
                                                </Button>
                                                <Button
                                                    variant={done ? 'outline' : 'brand'}
                                                    size="sm"
                                                    onClick={() => toggleDone(step.key)}
                                                    disabled={busy}
                                                >
                                                    {done ? 'Reopen step' : 'Mark complete'}
                                                </Button>
                                            </>
                                        )}

                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => saveStep(step.key, {})}
                                            disabled={busy}
                                        >
                                            Save
                                        </Button>

                                        {stepRows[step.key]?.email_drafted_at && (
                                            <span className="text-xs text-[var(--dtg-gray-700)]">
                                                Last drafted{' '}
                                                {new Date(stepRows[step.key].email_drafted_at).toLocaleString()}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
