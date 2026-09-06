import { useMemo, useState } from 'react';
import { Plus, Trash2, Phone, Mail, RefreshCw, Check, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    CONTACT_RESULT_OPTIONS,
    contactChannelValue,
    describeContact,
    isReachable,
    MINIMUM_REACHABLE,
    summariseTrial
} from '@/config/onboarding';

/**
 * ContactTrialPanel
 *
 * The communication trial and the email trial, which are the same act performed
 * down two different columns of the TARP contact list: dial every number, or
 * mail every address, and record who answered.
 *
 * The panel exists because "we tested the contacts" is not a tick. A TARP names
 * a day-shift on-call, a night-shift on-call, dispatch and two escalation
 * levels, and an onboarding that reached three of them has found a gap the site
 * needs to close BEFORE a trigger fires, not after. So every contact carries its
 * own verdict, and the summary at the top says plainly whether the escalation
 * path holds up.
 *
 * Props:
 *   stepKey    'communication_trial' | 'email_trial'
 *   channel    'phone' | 'email'
 *   tests      ContactTestRow[] — already filtered to this onboarding
 *   onSeed     () => Promise<number>   copy the TARP contacts in
 *   onSave     (test, patch) => Promise<boolean>
 *   onAdd      (stepKey, row) => Promise<boolean>
 *   onRemove   (testId) => Promise<boolean>
 *   disabled   read-only while a save is in flight
 */
export default function ContactTrialPanel({
    stepKey,
    channel,
    tests,
    onSeed,
    onSave,
    onAdd,
    onRemove,
    disabled = false
}) {
    const [seeding, setSeeding] = useState(false);
    const [adding, setAdding] = useState(false);
    const [draft, setDraft] = useState({ name: '', role: '', phone: '', email: '', shift: '' });

    const rows = useMemo(
        () => (tests || []).filter((t) => t.step_key === stepKey),
        [tests, stepKey]
    );
    const summary = useMemo(() => summariseTrial(rows, channel), [rows, channel]);

    const ChannelIcon = channel === 'phone' ? Phone : Mail;
    const needed = Math.min(MINIMUM_REACHABLE[channel], Math.max(summary.total, 1));

    const handleSeed = async () => {
        setSeeding(true);
        try {
            await onSeed();
        } finally {
            setSeeding(false);
        }
    };

    const handleAdd = async () => {
        const value = channel === 'phone' ? draft.phone.trim() : draft.email.trim();
        if (!value) return;
        const ok = await onAdd(stepKey, {
            name: draft.name.trim() || null,
            role: draft.role.trim() || null,
            phone: draft.phone.trim() || null,
            email: draft.email.trim() || null,
            shift: draft.shift || null
        });
        if (ok) {
            setDraft({ name: '', role: '', phone: '', email: '', shift: '' });
            setAdding(false);
        }
    };

    const cell = 'px-3 py-2 text-sm align-top';
    const head = 'px-3 py-2 text-left text-xs text-[var(--dtg-gray-700)] font-medium';

    return (
        <div className="space-y-3">
            {/* --- Coverage summary --------------------------------------- */}
            <div
                className={[
                    'flex items-start gap-2 rounded-md border p-3 text-sm',
                    summary.meetsMinimumCoverage
                        ? 'border-emerald-600/40 bg-emerald-500/5 text-emerald-300'
                        : 'border-amber-600/40 bg-amber-500/5 text-amber-300'
                ].join(' ')}
            >
                {summary.meetsMinimumCoverage ? (
                    <Check size={16} className="mt-0.5 shrink-0" />
                ) : (
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                )}
                <div>
                    {summary.total === 0 ? (
                        <span>
                            No contacts in this trial yet. Pull them in from the site&apos;s active TARP
                            document, or add one by hand.
                        </span>
                    ) : (
                        <>
                            <span className="font-medium">
                                {summary.reachable.length} of {summary.total} reachable
                            </span>
                            {summary.untested.length > 0 && (
                                <span> · {summary.untested.length} not yet tested</span>
                            )}
                            {!summary.meetsMinimumCoverage && (
                                <span className="block text-xs mt-0.5">
                                    {channel === 'phone'
                                        ? `The TARP asks for at least two reachable phone levels — ${needed} needed, ${summary.reachable.length} confirmed.`
                                        : 'At least one address must confirm delivery before the distribution list can be trusted.'}
                                </span>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* --- Actions ------------------------------------------------ */}
            <div className="flex flex-wrap items-center gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSeed}
                    disabled={disabled || seeding}
                    title="Copy every TARP contact with a matching detail into this trial"
                >
                    <RefreshCw size={14} className={seeding ? 'animate-spin' : ''} />
                    {seeding ? 'Loading…' : 'Load TARP contacts'}
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAdding((v) => !v)}
                    disabled={disabled}
                >
                    <Plus size={14} />
                    Add contact
                </Button>
                <span className="text-xs text-[var(--dtg-gray-700)]">
                    Contacts already in the trial keep their verdict when the TARP list is reloaded.
                </span>
            </div>

            {/* --- Manual add --------------------------------------------- */}
            {adding && (
                <div className="grid gap-2 rounded-md border border-[var(--dtg-border-medium)] p-3 md:grid-cols-5">
                    <Input
                        placeholder="Name"
                        value={draft.name}
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    />
                    <Input
                        placeholder="Role"
                        value={draft.role}
                        onChange={(e) => setDraft({ ...draft, role: e.target.value })}
                    />
                    {channel === 'phone' ? (
                        <Input
                            placeholder="Phone"
                            value={draft.phone}
                            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                        />
                    ) : (
                        <Input
                            placeholder="Email"
                            value={draft.email}
                            onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                        />
                    )}
                    <select
                        value={draft.shift}
                        onChange={(e) => setDraft({ ...draft, shift: e.target.value })}
                        className="rounded-md border border-[var(--dtg-border-medium)] bg-[var(--dtg-bg-card)] px-3 text-sm text-[var(--dtg-text-primary)] outline-none"
                    >
                        <option value="">Any shift</option>
                        <option value="day">Day shift</option>
                        <option value="night">Night shift</option>
                    </select>
                    <div className="flex gap-2">
                        <Button variant="brand" size="sm" onClick={handleAdd} disabled={disabled}>
                            Add
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setAdding(false)}>
                            Cancel
                        </Button>
                    </div>
                </div>
            )}

            {/* --- The list ------------------------------------------------ */}
            {rows.length > 0 && (
                <div className="overflow-x-auto rounded-md border border-[var(--dtg-border-medium)]">
                    <table className="w-full min-w-[720px] border-collapse">
                        <thead className="bg-[var(--dtg-bg-primary)]">
                            <tr className="border-b border-[var(--dtg-border-medium)]">
                                <th className={head}>Contact</th>
                                <th className={head}>{channel === 'phone' ? 'Number' : 'Address'}</th>
                                <th className={head}>Shift</th>
                                <th className={head}>Result</th>
                                <th className={head}>Remark</th>
                                <th className={head} />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => (
                                <tr
                                    key={row.id}
                                    className="border-b border-[var(--dtg-border-medium)] last:border-0"
                                >
                                    <td className={`${cell} text-[var(--dtg-text-primary)]`}>
                                        <span className="flex items-center gap-2">
                                            <ChannelIcon
                                                size={14}
                                                className={
                                                    isReachable(row.result)
                                                        ? 'text-emerald-400'
                                                        : 'text-[var(--dtg-gray-500)]'
                                                }
                                            />
                                            {describeContact(row)}
                                        </span>
                                    </td>
                                    <td className={`${cell} text-[var(--dtg-gray-500)]`}>
                                        {contactChannelValue(row) || '—'}
                                    </td>
                                    <td className={cell}>
                                        <select
                                            value={row.shift || ''}
                                            disabled={disabled}
                                            onChange={(e) =>
                                                onSave(row, { shift: e.target.value || null })
                                            }
                                            className="rounded-md border border-[var(--dtg-border-medium)] bg-[var(--dtg-bg-card)] px-2 py-1 text-sm text-[var(--dtg-text-primary)] outline-none"
                                        >
                                            <option value="">Any</option>
                                            <option value="day">Day</option>
                                            <option value="night">Night</option>
                                        </select>
                                    </td>
                                    <td className={cell}>
                                        <select
                                            value={row.result || 'pending'}
                                            disabled={disabled}
                                            onChange={(e) => onSave(row, { result: e.target.value })}
                                            className={[
                                                'rounded-md border bg-[var(--dtg-bg-card)] px-2 py-1 text-sm outline-none',
                                                isReachable(row.result)
                                                    ? 'border-emerald-600/50 text-emerald-300'
                                                    : (row.result || 'pending') === 'pending'
                                                      ? 'border-[var(--dtg-border-medium)] text-[var(--dtg-gray-500)]'
                                                      : 'border-red-600/50 text-red-300'
                                            ].join(' ')}
                                        >
                                            {CONTACT_RESULT_OPTIONS.map((opt) => (
                                                <option key={opt.value} value={opt.value}>
                                                    {opt.label}
                                                </option>
                                            ))}
                                        </select>
                                    </td>
                                    <td className={cell}>
                                        <Input
                                            defaultValue={row.remark || ''}
                                            disabled={disabled}
                                            placeholder="e.g. diverts to voicemail after hours"
                                            onBlur={(e) => {
                                                const value = e.target.value.trim();
                                                if (value !== (row.remark || '')) {
                                                    onSave(row, { remark: value || null });
                                                }
                                            }}
                                        />
                                    </td>
                                    <td className={`${cell} text-right`}>
                                        <button
                                            type="button"
                                            title="Remove from trial"
                                            disabled={disabled}
                                            onClick={() => onRemove(row.id)}
                                            className="text-[var(--dtg-gray-500)] hover:text-red-400 disabled:opacity-40"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
