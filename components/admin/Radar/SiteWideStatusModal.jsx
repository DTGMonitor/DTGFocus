import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { toUTC, fromUTC } from '@/utils/timezoneUtils';
import { getStatusColor } from '@/config/statusConfig';
import { getWorkLogDetails, generateEmailBodyOthers, generateEmailBodyScheduledOffline } from '@/config/formConfig';
import { openOutlookDraft } from '@/utils/openOutlookDraft';
import {
    ALL_SELECTED_LABEL,
    defaultOfflineWindow,
    planDowntimeWrites,
    sensorSelectionLabel,
} from '@/utils/siteWideStatus';
import { Spinner } from '@/components/Reusable/Spinner';
import toast from 'react-hot-toast';

/**
 * SiteWideStatusModal
 *
 * The status flow for the two events that never hit one sensor alone:
 *
 *   Lost Connection  — the site link drops and takes every radar with it. One
 *                      downtime record per ticked wall folder, then a draft.
 *   Scheduled Offline— DTG-side maintenance, announced before it happens. NO
 *                      database write at all: nothing is down yet, and a record
 *                      would count planned minutes against the site's
 *                      availability. Draft only.
 *
 * Both are driven by a checkbox list of every non-archived wall folder on the
 * sensor's site, so the analyst ticks once and the email names the selection —
 * "All Radars - Telfer" when everything is ticked, the radar numbers otherwise.
 *
 * Props:
 *   isOpen        {boolean}
 *   status        {'Lost Connection'|'Scheduled Offline'}
 *   sensor        {object}   - the open sensor: site_id, site_name, wallfolder_id, area
 *   timezone      {string}   - IANA timezone of the SITE
 *   crosscheckers {Array}    - [{ id, full_name }]
 *   userID        {string}   - detected_by
 *   userName      {string}   - signature on the draft
 *   onClose       {Function}
 *   onSubmitted   {Function} - (status, selectedWallfolderIds) after a DB write
 */

const REASON_OPTIONS = ['Radar System Issue', 'Maintenance', 'Relocation', 'Connection', 'PMP Issue'];
const ACTION_OPTIONS = ['Check Fuel', 'Check Connection', 'Site Action', 'Reboot PMP', 'Other'];
const DEFAULT_OFFLINE_REASON = 'Scheduled maintenance from the DTG side.';

export default function SiteWideStatusModal({
    isOpen,
    status,
    sensor,
    timezone,
    crosscheckers = [],
    userID,
    userName,
    onClose,
    onSubmitted,
}) {
    const isScheduled = status === 'Scheduled Offline';

    const [siteSensors, setSiteSensors] = useState([]);
    const [selectedIds, setSelectedIds] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [loadError, setLoadError] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const [selectedCrosschecker, setSelectedCrosschecker] = useState('');

    const [form, setForm] = useState({
        reason: 'Radar System Issue',
        action: 'Check Connection',
        notes: '',
        from: '',
        notificationTime: '',
        siteEngineer: '',
    });

    // Scheduled Offline carries a window, not an instant — held as two "HH:mm"
    // values already in the site's clock (that is what the email quotes).
    const [window_, setWindow_] = useState({ from: '', to: '', reason: DEFAULT_OFFLINE_REASON });

    // ── Load every wall folder on this site, plus any record already open ───────
    const loadSiteSensors = useCallback(async () => {
        if (!sensor?.site_id && !sensor?.site_name) return;

        setIsLoading(true);
        setLoadError(null);
        try {
            // Deliberately NOT filtered by station: the link and the maintenance
            // window belong to the site, not to one monitoring board.
            let query = supabase
                .from('latest_radar_wall_folders')
                .select('wallfolder_id, radar_number, area, status, type, wallfolder:radar_wall_folders!inner(id, name)')
                .neq('type', 'Archive')
                .order('radar_number');

            query = sensor.site_id
                ? query.eq('site_id', sensor.site_id)
                : query.eq('site_name', sensor.site_name);

            const { data, error } = await query;

            if (error) throw error;

            setSiteSensors(
                (data || []).map((row) => ({
                    wallfolder_id: row.wallfolder_id,
                    radar_number: row.radar_number,
                    area: row.area,
                    folder_name: Array.isArray(row.wallfolder) ? row.wallfolder[0]?.name : row.wallfolder?.name,
                    status: row.status,
                }))
            );
        } catch (err) {
            console.error('Error loading site sensors:', err);
            setLoadError('Failed to load the sensors for this site.');
        } finally {
            setIsLoading(false);
        }
    }, [sensor?.site_id, sensor?.site_name]);

    /**
     * Seed the form from the record already open on the sensor the analyst had
     * on screen, so re-picking the same status edits it rather than restating it
     * from defaults — the behaviour the single-sensor flow has always had.
     */
    const seedFromOpenRecord = useCallback(async () => {
        const nowSiteLocal = (fromUTC(new Date().toISOString(), timezone) || '').slice(0, 16);
        const formatForInput = (iso) => (iso ? (fromUTC(iso, timezone) || '').slice(0, 16) : '');

        let seeded = {
            reason: 'Radar System Issue',
            action: 'Check Connection',
            notes: '',
            from: nowSiteLocal,
            notificationTime: '',
            siteEngineer: '',
        };

        if (!isScheduled && sensor?.wallfolder_id) {
            const { data: open } = await supabase
                .from('downtime_records')
                .select('*')
                .eq('wallfolder', sensor.wallfolder_id)
                .eq('type', status)
                .is('to', null)
                .order('from', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (open) {
                seeded = {
                    reason: open.reason || seeded.reason,
                    action: open.action || seeded.action,
                    notes: open.notes || '',
                    from: formatForInput(open.from) || nowSiteLocal,
                    notificationTime: formatForInput(open.notification_time),
                    siteEngineer: open.site_engineer || '',
                };
                if (open.crosschecked_by) setSelectedCrosschecker(open.crosschecked_by);
            }
        }

        setForm(seeded);
    }, [isScheduled, sensor?.wallfolder_id, status, timezone]);

    useEffect(() => {
        if (!isOpen) return;

        // The sensor the analyst opened is ticked; the rest is their call.
        setSelectedIds(sensor?.wallfolder_id ? [sensor.wallfolder_id] : []);
        setWindow_({ ...defaultOfflineWindow(timezone), reason: DEFAULT_OFFLINE_REASON });
        loadSiteSensors();
        seedFromOpenRecord();
    }, [isOpen, sensor?.wallfolder_id, timezone, loadSiteSensors, seedFromOpenRecord]);

    // ── Selection ───────────────────────────────────────────────────────────────
    const allSelected = siteSensors.length > 0 && selectedIds.length === siteSensors.length;

    const toggleOne = (wallfolderId) => {
        setSelectedIds((prev) =>
            prev.includes(wallfolderId) ? prev.filter((id) => id !== wallfolderId) : [...prev, wallfolderId]
        );
    };

    const toggleAll = () => {
        setSelectedIds(allSelected ? [] : siteSensors.map((s) => s.wallfolder_id));
    };

    // ── The draft ───────────────────────────────────────────────────────────────
    const label = useMemo(
        () =>
            sensorSelectionLabel(
                siteSensors,
                selectedIds,
                sensor?.site_name || 'Unknown Site',
                ALL_SELECTED_LABEL[status] || 'All Sensors'
            ),
        [siteSensors, selectedIds, sensor?.site_name, status]
    );

    const crosscheckerName = useMemo(() => {
        const match = crosscheckers.find((u) => String(u.id) === String(selectedCrosschecker));
        return match ? `& ${match.full_name}` : '';
    }, [crosscheckers, selectedCrosschecker]);

    const logDetails = getWorkLogDetails(status, form.notificationTime);
    const emailSubject = `[${logDetails.subject}] ${status} on ${label.withSite}`;
    const emailBody = isScheduled
        ? generateEmailBodyScheduledOffline(
            label.bare,
            window_.from,
            window_.to,
            window_.reason,
            userName,
            crosscheckerName
        )
        : generateEmailBodyOthers(form, status, label.withSite, userName, crosscheckerName);

    const draft = () =>
        openOutlookDraft(emailSubject, emailBody, `"${sensor?.site_name} [All]"`, 'DTG Engineers');

    // ── Submit ──────────────────────────────────────────────────────────────────

    /**
     * Scheduled Offline: notification only. Deliberately no downtime record, no
     * radar_wall_folders.type change and no work log — the sensors are still
     * live, and stamping them offline ahead of a window that may move would put
     * minutes the site never lost into the availability figures.
     */
    const submitScheduled = () => {
        if (!window_.from || !window_.to) {
            toast.error('Set both the start and end of the maintenance window.');
            return;
        }
        draft();
        onClose();
    };

    const submitLostConnection = async () => {
        if (!form.from) {
            toast.error('Set the time the connection was lost.');
            return;
        }

        setIsSaving(true);
        try {
            const utcFrom = toUTC(form.from, timezone);
            const utcNotify = form.notificationTime ? toUTC(form.notificationTime, timezone) : null;
            const submissionTime = new Date().toISOString();

            const { data: openRecords, error: openError } = await supabase
                .from('downtime_records')
                .select('id, wallfolder, type, from')
                .in('wallfolder', selectedIds)
                .is('to', null);

            if (openError) throw openError;

            const plan = planDowntimeWrites(selectedIds, openRecords || [], status);

            const payloadFor = (wallfolderId) => ({
                wallfolder: wallfolderId,
                type: status,
                reason: form.reason,
                action: form.action,
                notes: form.notes,
                from: utcFrom,
                to: null,
                detected_by: userID,
                crosschecked_by: selectedCrosschecker || null,
                notification_time: utcNotify,
                site_engineer: form.siteEngineer,
                submission: submissionTime,
            });

            // A different failure was open on some folders — it ended where this
            // one begins, exactly as the single-sensor switch does.
            if (plan.closeIds.length > 0) {
                const { error } = await supabase
                    .from('downtime_records')
                    .update({ to: utcFrom })
                    .in('id', plan.closeIds);
                if (error) throw error;
            }

            if (plan.insertFolders.length > 0) {
                const { error } = await supabase
                    .from('downtime_records')
                    .insert(plan.insertFolders.map(payloadFor));
                if (error) throw error;
            }

            for (const { id, wallfolder } of plan.updates) {
                const { error } = await supabase
                    .from('downtime_records')
                    .update(payloadFor(wallfolder))
                    .eq('id', id);
                if (error) throw error;
            }

            const { error: wallError } = await supabase
                .from('radar_wall_folders')
                .update({ type: status })
                .in('id', selectedIds);
            if (wallError) throw wallError;

            // Work log is a record OF the notification, not a precondition for it.
            const byFolder = new Map(siteSensors.map((s) => [String(s.wallfolder_id), s]));
            const { error: logError } = await supabase.from('work_log').insert(
                selectedIds.map((id) => ({
                    created_at: submissionTime,
                    subject: String(logDetails.id),
                    wallfolder: id,
                    location: byFolder.get(String(id))?.area || sensor?.area,
                    category: 'downtime',
                    action: form.action,
                    notes: `${status} record have been submitted`,
                    submitted_by: userID,
                }))
            );
            if (logError) console.error('Work Log Insert Failed:', logError);

            toast.success(
                selectedIds.length > 1
                    ? `${status} recorded for ${selectedIds.length} sensors`
                    : `${status} recorded`
            );

            if (onSubmitted) onSubmitted(status, selectedIds);
            draft();
            onClose();
        } catch (err) {
            console.error('Site-wide status update failed:', err);
            toast.error('Failed to update status. Check console.');
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    const canSubmit = selectedIds.length > 0 && !isSaving;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-[var(--dtg-bg-card)] p-6 rounded-lg w-full max-w-[560px] max-h-[90vh] overflow-y-auto border border-gray-700 shadow-xl text-[var(--dtg-text-primary)]">
                <h2 className="text-xl font-bold mb-1 border-b border-gray-600 pb-2">
                    {isScheduled ? 'Notify: ' : 'Change Status to: '}
                    <span className={`px-2 py-0.5 rounded border text-base ${getStatusColor(status)}`}>{status}</span>
                </h2>
                <p className="text-xs text-gray-400 mb-4">
                    {isScheduled
                        ? 'Notification only — no downtime record is created.'
                        : 'A downtime record is created for every sensor ticked below.'}
                </p>

                {/* ── Sensor selection ─────────────────────────────────────────── */}
                <div className="mb-4">
                    <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs text-gray-400">
                            Sensors at {sensor?.site_name}
                        </label>
                        <span className="text-xs text-gray-500">{selectedIds.length} selected</span>
                    </div>

                    <div className="border border-gray-600 rounded max-h-52 overflow-y-auto divide-y divide-gray-700/60">
                        {isLoading ? (
                            <div className="flex justify-center py-6"><Spinner size={24} /></div>
                        ) : loadError ? (
                            <p className="py-4 text-center text-sm text-red-500">{loadError}</p>
                        ) : siteSensors.length === 0 ? (
                            <p className="py-4 text-center text-sm text-gray-400">
                                No active sensors found for this site.
                            </p>
                        ) : (
                            <>
                                <label className="flex items-center gap-2 px-3 py-2 cursor-pointer bg-[var(--dtg-bg-primary)]/40 sticky top-0">
                                    <input
                                        type="checkbox"
                                        className="accent-[var(--dtg-brand-orange)]"
                                        checked={allSelected}
                                        onChange={toggleAll}
                                    />
                                    <span className="text-sm font-semibold">
                                        Select all ({siteSensors.length})
                                    </span>
                                </label>

                                {siteSensors.map((s) => (
                                    <label
                                        key={s.wallfolder_id}
                                        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[var(--dtg-bg-primary)]/40"
                                    >
                                        <input
                                            type="checkbox"
                                            className="accent-[var(--dtg-brand-orange)]"
                                            checked={selectedIds.includes(s.wallfolder_id)}
                                            onChange={() => toggleOne(s.wallfolder_id)}
                                        />
                                        <span className="text-sm flex-1">
                                            {s.radar_number}
                                            <span className="text-gray-500">
                                                {s.folder_name ? ` — ${s.folder_name}` : ''}
                                                {s.area ? ` (${s.area})` : ''}
                                            </span>
                                        </span>
                                        <span className={`text-xs px-1.5 py-0.5 rounded border ${getStatusColor(s.status)}`}>
                                            {s.status || '—'}
                                        </span>
                                    </label>
                                ))}
                            </>
                        )}
                    </div>

                    <p className="mt-1 text-xs text-gray-500">
                        Email will read: <span className="text-[var(--dtg-text-primary)]">{label.withSite}</span>
                    </p>
                </div>

                {/* ── Scheduled Offline: the window ────────────────────────────── */}
                {isScheduled ? (
                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs text-gray-400">From (site local)</label>
                                <input
                                    type="time"
                                    className="w-full bg-gray-800 border border-gray-600 p-2 rounded text-sm text-white"
                                    value={window_.from}
                                    onChange={(e) => setWindow_({ ...window_, from: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400">To (site local)</label>
                                <input
                                    type="time"
                                    className="w-full bg-gray-800 border border-gray-600 p-2 rounded text-sm text-white"
                                    value={window_.to}
                                    onChange={(e) => setWindow_({ ...window_, to: e.target.value })}
                                />
                            </div>
                        </div>
                        <p className="text-xs text-gray-500">
                            Pre-filled from 11:30–13:00 your local time, converted to {timezone || 'UTC'}.
                            Adjust either end as needed.
                        </p>

                        <div>
                            <label className="block text-xs text-gray-400">Reason</label>
                            <textarea
                                className="w-full bg-gray-800 border border-gray-600 p-2 rounded text-sm h-16"
                                value={window_.reason}
                                onChange={(e) => setWindow_({ ...window_, reason: e.target.value })}
                            />
                        </div>
                    </div>
                ) : (
                    /* ── Lost Connection: the downtime record ─────────────────── */
                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs text-gray-400">Reason</label>
                                <select
                                    className="w-full bg-[var(--dtg-bg-card)] border border-gray-600 p-2 rounded text-sm"
                                    value={form.reason}
                                    onChange={(e) => setForm({ ...form, reason: e.target.value })}
                                >
                                    {REASON_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400">Action</label>
                                <select
                                    className="w-full bg-[var(--dtg-bg-card)] border border-gray-600 p-2 rounded text-sm"
                                    value={form.action}
                                    onChange={(e) => setForm({ ...form, action: e.target.value })}
                                >
                                    {ACTION_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                                </select>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs text-gray-400">From</label>
                                <input
                                    type="datetime-local"
                                    className="w-full bg-gray-800 border border-gray-600 p-2 rounded text-sm text-white"
                                    value={form.from}
                                    onChange={(e) => setForm({ ...form, from: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400">Notification Time</label>
                                <input
                                    type="datetime-local"
                                    className="w-full bg-gray-800 border border-gray-600 p-2 rounded text-sm text-white"
                                    value={form.notificationTime}
                                    onChange={(e) => setForm({ ...form, notificationTime: e.target.value })}
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs text-gray-400">Site Engineer</label>
                            <input
                                type="text"
                                className="w-full bg-gray-800 border border-gray-600 p-2 rounded text-sm"
                                value={form.siteEngineer}
                                onChange={(e) => setForm({ ...form, siteEngineer: e.target.value })}
                            />
                        </div>

                        <div>
                            <label className="block text-xs text-gray-400">Notes</label>
                            <textarea
                                className="w-full bg-gray-800 border border-gray-600 p-2 rounded text-sm h-20"
                                value={form.notes}
                                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                            />
                        </div>
                    </div>
                )}

                <div className="mt-3">
                    <label className="block text-xs text-gray-400">Crosschecked By</label>
                    <select
                        value={selectedCrosschecker}
                        onChange={(e) => setSelectedCrosschecker(e.target.value)}
                        className="w-full bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-md py-2 px-3 text-sm text-[var(--dtg-text-primary)] appearance-none outline-none focus:border-[var(--dtg-brand-orange)]"
                    >
                        <option value="">-- Select User --</option>
                        {crosscheckers.map((user) => (
                            <option key={user.id} value={user.id}>{user.full_name}</option>
                        ))}
                    </select>
                </div>

                <div className="flex justify-end gap-3 mt-6">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm text-gray-300 hover:text-white"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={isScheduled ? submitScheduled : submitLostConnection}
                        disabled={!canSubmit}
                        className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded shadow-md disabled:opacity-50"
                    >
                        {isSaving ? 'Processing...' : isScheduled ? 'Open Draft Email' : 'Submit & Draft Email'}
                    </button>
                </div>
            </div>
        </div>
    );
}
