import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { getAlarmStatusColors } from '@/config/statusConfig';
import { Spinner } from '@/components/Reusable/Spinner';
import AlarmList from '@/components/admin/Radar/Alarm/AlarmList';
import ConfirmDialog from '@/components/admin/Radar/shared/ConfirmDialog';
import EditModal from '@/components/admin/Radar/shared/EditModal';
import { resolveDetectedBy, sortAlarmRecords, getCauseOptions } from '@/utils/tabHelpers';
import toast from 'react-hot-toast';
import { Pencil, Trash2 } from 'lucide-react';

/**
 * AlarmTab
 *
 * Renders the existing AlarmList (region summary) above a "recent alarms" table
 * showing alarm_records created in the last 24 hours for the wall-folder.
 * Supports per-row Edit and Delete.
 *
 * Props:
 *   sensor          {object}
 *   shift           {string}
 *   timezone        {string}
 *   crosscheckers   {Array}
 *   userSite        {object}
 *   userID          {string}
 *   onRegionsLoaded {function}  - forwarded to AlarmList (passes regions up to SensorDetail)
 *   activeTab       {string}    - re-fetch trigger when changed to 'alarm'
 *
 * Requirements: 5.1–5.8, 6.1–6.7, 7.1–7.7
 */

const REASON_OPTIONS = [
  { value: 'Valid', label: 'Valid' },
  { value: 'False', label: 'False' },
];

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export default function AlarmTab({
  sensor,
  shift,
  timezone,
  crosscheckers,
  userSite,
  userID,
  onRegionsLoaded,
  activeTab,
}) {
  // ── Data state ───────────────────────────────────────────────────────────────
  const [regions, setRegions] = useState([]); // alarm_regions for this wall-folder
  const [recentAlarms, setRecentAlarms] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // ── Edit / Delete state ──────────────────────────────────────────────────────
  const [editTarget, setEditTarget] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeletePending, setIsDeletePending] = useState(false);

  // ── Data fetching ─────────────────────────────────────────────────────────────

  const fetchRecentAlarms = useCallback(async () => {
    if (!sensor?.wallfolder_id) return;

    setIsLoading(true);
    setError(null);

    try {
      // 1. Resolve the alarm regions belonging to this wall-folder.
      const { data: regionData, error: regionError } = await supabase
        .from('alarm_regions')
        .select('id, name, alarmtype')
        .eq('wallfolder', sensor.wallfolder_id);

      if (regionError) throw regionError;

      const regionList = regionData || [];
      setRegions(regionList);

      const regionIds = regionList.map((r) => r.id);
      if (regionIds.length === 0) {
        setRecentAlarms([]);
        return;
      }

      // 2. Fetch alarm_records in the last 24h for those regions.
      const since = new Date(Date.now() - ONE_DAY_MS).toISOString();
      const { data, error: alarmError } = await supabase
        .from('alarm_records')
        .select('id, created_at, alarm_region, location, reason, cause, detected_by')
        .in('alarm_region', regionIds)
        .gte('created_at', since)
        .order('created_at', { ascending: false });

      if (alarmError) throw alarmError;

      setRecentAlarms(sortAlarmRecords(data || []));
    } catch (err) {
      console.error('Error fetching recent alarms:', err);
      setError('Failed to load recent alarms.');
    } finally {
      setIsLoading(false);
    }
  }, [sensor?.wallfolder_id]);

  // Fetch on mount and whenever activeTab switches to 'alarm'.
  useEffect(() => {
    if (activeTab === 'alarm') {
      fetchRecentAlarms();
    }
  }, [activeTab, fetchRecentAlarms]);

  // ── Region FK resolution ──────────────────────────────────────────────────────

  const resolveRegion = (regionId) =>
    regions.find((r) => String(r.id) === String(regionId)) || null;

  // ── Edit handlers ──────────────────────────────────────────────────────────────

  const handleEdit = (record) => setEditTarget(record);

  const handleEditSave = async (formValues) => {
    if (!editTarget) return;
    setIsSaving(true);
    try {
      const payload = {
        alarm_region: formValues.alarm_region ? Number(formValues.alarm_region) : null,
        location: formValues.location,
        reason: formValues.reason,
        cause: formValues.cause,
      };

      const { error: updateError } = await supabase
        .from('alarm_records')
        .update(payload)
        .eq('id', editTarget.id);

      if (updateError) throw updateError;

      toast.success('Alarm record updated.');
      setEditTarget(null);
      await fetchRecentAlarms();
    } catch (err) {
      console.error('Error updating alarm record:', err);
      toast.error('Failed to update alarm record.');
      // Keep modal open
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditCancel = () => setEditTarget(null);

  // ── Delete handlers ──────────────────────────────────────────────────────────

  const handleDelete = (record) => setDeleteTarget(record);

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setIsDeletePending(true);
    try {
      const { error: deleteError } = await supabase
        .from('alarm_records')
        .delete()
        .eq('id', deleteTarget.id);

      if (deleteError) throw deleteError;

      toast.success('Alarm record deleted.');
      setDeleteTarget(null);
      await fetchRecentAlarms();
    } catch (err) {
      console.error('Error deleting alarm record:', err);
      toast.error('Failed to delete alarm record.');
    } finally {
      setIsDeletePending(false);
    }
  };

  const handleDeleteCancel = () => setDeleteTarget(null);

  // ── Edit modal config ──────────────────────────────────────────────────────────

  const editFields = [
    {
      key: 'alarm_region',
      label: 'Alarm Region',
      type: 'select',
      options: regions.map((r) => ({ value: String(r.id), label: r.name })),
      required: true,
    },
    { key: 'location', label: 'Location', type: 'text', required: true },
    { key: 'reason', label: 'Reason', type: 'select', options: REASON_OPTIONS, required: true },
    {
      key: 'cause',
      label: 'Cause',
      type: 'select',
      computeOptions: (values) =>
        getCauseOptions(values.reason).map((c) => ({ value: c, label: c })),
      clearWhen: ['reason'],
      required: true,
    },
    { key: 'detected_by', label: 'Detected By', type: 'readonly' },
  ];

  const editInitialValues = editTarget
    ? {
        alarm_region: editTarget.alarm_region != null ? String(editTarget.alarm_region) : '',
        location: editTarget.location || '',
        reason: editTarget.reason || '',
        cause: editTarget.cause || '',
        detected_by: resolveDetectedBy(editTarget.detected_by, crosscheckers),
      }
    : {};

  // ── Render: recent alarms table ────────────────────────────────────────────────

  const renderRecentAlarms = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center py-12">
          <Spinner size={32} />
        </div>
      );
    }

    if (error) {
      return <p className="py-8 text-center text-sm text-red-500">{error}</p>;
    }

    if (recentAlarms.length === 0) {
      return (
        <p className="py-8 text-center text-sm text-[var(--dtg-text-muted)]">
          No alarms in the last 24 hours.
        </p>
      );
    }

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-[var(--dtg-border-medium)] bg-[var(--dtg-bg-secondary)]">
              {['Alarm Region', 'Location', 'Reason', 'Detected By', 'Cause', ''].map((col, i) => (
                <th
                  key={col || `actions-${i}`}
                  className="px-3 py-2 text-left text-xs font-semibold text-[var(--dtg-text-secondary)] uppercase tracking-wide whitespace-nowrap"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recentAlarms.map((record) => {
              const region = resolveRegion(record.alarm_region);
              const dotClass = getAlarmStatusColors(Number(region?.type));
              return (
                <tr
                  key={record.id}
                  className="border-b border-[var(--dtg-border-light)] hover:bg-[var(--dtg-bg-secondary)] transition-colors"
                >
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[var(--dtg-text-primary)]">
                        {region?.name || '—'}
                      </span>
                      {region?.type != null && region?.type !== '' && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--dtg-border-medium)] px-2 py-0.5 text-xs text-[var(--dtg-text-secondary)]">
                          <span className={`w-2 h-2 rounded-full ${dotClass}`} />
                          {region.type}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-[var(--dtg-text-secondary)]">
                    {record.location || '—'}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-[var(--dtg-text-secondary)]">
                    {record.reason || '—'}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-[var(--dtg-text-secondary)]">
                    {resolveDetectedBy(record.detected_by, crosscheckers)}
                  </td>
                  <td className="px-3 py-2 text-[var(--dtg-text-secondary)]">
                    {record.cause || '—'}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleEdit(record)}
                        title="Edit record"
                        className="p-1.5 rounded text-[var(--dtg-text-muted)] hover:text-[var(--dtg-brand-orange)] hover:bg-[var(--dtg-bg-secondary)] transition-colors"
                        aria-label="Edit alarm record"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(record)}
                        title="Delete record"
                        className="p-1.5 rounded text-[var(--dtg-text-muted)] hover:text-red-500 hover:bg-[var(--dtg-bg-secondary)] transition-colors"
                        aria-label="Delete alarm record"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto p-4 space-y-6">
        {/* Existing AlarmList (region summary) — unchanged behaviour */}
        <AlarmList
          sensor={sensor}
          shift={shift}
          timezone={timezone}
          userID={userID}
          crosscheckers={crosscheckers}
          isExpanded={false}
          onBatchInsertClick={() => {}}
          onClose={() => {}}
          onRegionsLoaded={onRegionsLoaded}
        />

        {/* Recent alarms (last 24h) */}
        <div className="flex flex-col w-full gap-2 text-[var(--dtg-text-primary)]">
          <h3 className="text-lg font-medium border-b border-[var(--dtg-border-medium)] pb-2">
            Recent Alarms (last 24 hours)
          </h3>
          {renderRecentAlarms()}
        </div>
      </div>

      {/* Edit Modal */}
      <EditModal
        isOpen={Boolean(editTarget)}
        title="Edit Alarm Record"
        fields={editFields}
        initialValues={editInitialValues}
        onSave={handleEditSave}
        onCancel={handleEditCancel}
        isSaving={isSaving}
      />

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Delete Alarm Record"
        message="Are you sure you want to delete this alarm record? This action cannot be undone."
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
        isDestructive
        isConfirmDisabled={isDeletePending}
      />
    </div>
  );
}
