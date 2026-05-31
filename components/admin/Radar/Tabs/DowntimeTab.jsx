import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { toUTC } from '@/utils/timezoneUtils';
import { Spinner } from '@/components/Reusable/Spinner';
import ConfirmDialog from '@/components/admin/Radar/shared/ConfirmDialog';
import EditModal from '@/components/admin/Radar/shared/EditModal';
import toast from 'react-hot-toast';
import { Pencil, Trash2 } from 'lucide-react';
import {
  resolveDetectedBy,
  formatTimestamp,
  sortDowntimeRecords,
  isoToDatetimeLocal,
} from '@/utils/tabHelpers';

/**
 * DowntimeTab
 *
 * Displays all downtime records for the selected wall-folder in a table.
 * Supports Edit and Delete flows (tasks 3.2 and 3.3).
 *
 * Props:
 *   sensor        {object}   - Sensor object with `wallfolder_id`
 *   timezone      {string}   - IANA timezone string for display formatting
 *   crosscheckers {Array}    - Array of { id, full_name } for UUID resolution
 *   activeTab     {string}   - Current active tab; triggers re-fetch when changed to 'downtime'
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
 *
 * Pure helpers (resolveDetectedBy, formatTimestamp, sortDowntimeRecords,
 * isoToDatetimeLocal) are imported from utils/tabHelpers so they can be
 * property-tested in isolation.
 */

// ─── Downtime type options ────────────────────────────────────────────────────

const DOWNTIME_TYPE_OPTIONS = [
  { value: 'Link Down', label: 'Link Down' },
  { value: 'Lost Connection', label: 'Lost Connection' },
  { value: 'Maintenance', label: 'Maintenance' },
  { value: 'Power Outage', label: 'Power Outage' },
  { value: 'Other', label: 'Other' },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function DowntimeTab({ sensor, timezone, crosscheckers, activeTab }) {
  // ── Data state ──────────────────────────────────────────────────────────────
  const [downtimeList, setDowntimeList] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // ── Edit flow state (task 3.2 scaffold) ─────────────────────────────────────
  const [editTarget, setEditTarget] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  // ── Delete flow state (task 3.3 scaffold) ───────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeletePending, setIsDeletePending] = useState(false);

  // ── Data fetching ────────────────────────────────────────────────────────────

  const fetchDowntimeRecords = useCallback(async () => {
    if (!sensor?.wallfolder_id) return;

    setIsLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('downtime_records')
        .select('id, type, reason, from, to, detected_by, action, notes, notification_time, site_engineer')
        .eq('wallfolder', sensor.wallfolder_id)
        .order('from', { ascending: false, nullsFirst: false });

      if (fetchError) throw fetchError;

      setDowntimeList(sortDowntimeRecords(data || []));
    } catch (err) {
      console.error('Error fetching downtime records:', err);
      setError('Failed to load downtime records.');
    } finally {
      setIsLoading(false);
    }
  }, [sensor?.wallfolder_id]);

  // Fetch on mount and whenever activeTab switches to 'downtime'
  useEffect(() => {
    if (activeTab === 'downtime') {
      fetchDowntimeRecords();
    }
  }, [activeTab, fetchDowntimeRecords]);

  // ── Edit handlers (scaffold for task 3.2) ────────────────────────────────────

  const handleEdit = (record) => {
    setEditTarget(record);
  };

  const handleEditSave = async (formValues) => {
    if (!editTarget) return;
    setIsSaving(true);
    try {
      const payload = {
        type: formValues.type,
        reason: formValues.reason,
        action: formValues.action,
        notes: formValues.notes,
        site_engineer: formValues.site_engineer,
        from: formValues.from ? toUTC(formValues.from, timezone) : null,
        to: formValues.to ? toUTC(formValues.to, timezone) : null,
        notification_time: formValues.notification_time
          ? toUTC(formValues.notification_time, timezone)
          : null,
      };

      const { error: updateError } = await supabase
        .from('downtime_records')
        .update(payload)
        .eq('id', editTarget.id);

      if (updateError) throw updateError;

      toast.success('Downtime record updated.');
      setEditTarget(null);
      await fetchDowntimeRecords();
    } catch (err) {
      console.error('Error updating downtime record:', err);
      toast.error('Failed to update downtime record.');
      // Keep modal open — do NOT clear editTarget
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditCancel = () => {
    setEditTarget(null);
  };

  // ── Delete handlers (scaffold for task 3.3) ──────────────────────────────────

  const handleDelete = (record) => {
    setDeleteTarget(record);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setIsDeletePending(true);
    try {
      const { error: deleteError } = await supabase
        .from('downtime_records')
        .delete()
        .eq('id', deleteTarget.id);

      if (deleteError) throw deleteError;

      toast.success('Downtime record deleted.');
      setDeleteTarget(null);
      await fetchDowntimeRecords();
    } catch (err) {
      console.error('Error deleting downtime record:', err);
      toast.error('Failed to delete downtime record.');
      // Keep dialog open
    } finally {
      setIsDeletePending(false);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteTarget(null);
  };

  // ── Edit modal field config ───────────────────────────────────────────────────

  const editFields = [
    {
      key: 'type',
      label: 'Type',
      type: 'select',
      options: DOWNTIME_TYPE_OPTIONS,
      required: true,
    },
    { key: 'reason', label: 'Reason', type: 'text', required: true },
    { key: 'from', label: 'From', type: 'datetime-local' },
    { key: 'to', label: 'To', type: 'datetime-local' },
    { key: 'action', label: 'Action', type: 'text' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
    { key: 'notification_time', label: 'Notification Time', type: 'datetime-local' },
    { key: 'site_engineer', label: 'Site Engineer', type: 'text' },
  ];

  const editInitialValues = editTarget
    ? {
        type: editTarget.type || '',
        reason: editTarget.reason || '',
        from: isoToDatetimeLocal(editTarget.from, timezone),
        to: isoToDatetimeLocal(editTarget.to, timezone),
        action: editTarget.action || '',
        notes: editTarget.notes || '',
        notification_time: isoToDatetimeLocal(editTarget.notification_time, timezone),
        site_engineer: editTarget.site_engineer || '',
      }
    : {};

  // ── Render ───────────────────────────────────────────────────────────────────

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center py-12">
          <Spinner size={32} />
        </div>
      );
    }

    if (error) {
      return (
        <p className="py-8 text-center text-sm text-red-500">{error}</p>
      );
    }

    if (downtimeList.length === 0) {
      return (
        <p className="py-8 text-center text-sm text-[var(--dtg-text-muted)]">
          No downtime records found.
        </p>
      );
    }

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-[var(--dtg-border-medium)] bg-[var(--dtg-bg-secondary)]">
              {[
                'Type',
                'Reason',
                'From',
                'To',
                'Detected By',
                'Action',
                'Notes',
                'Notification Time',
                'Site Engineer',
                '', // Actions column (Edit / Delete)
              ].map((col) => (
                <th
                  key={col}
                  className="px-3 py-2 text-left text-xs font-semibold text-[var(--dtg-text-secondary)] uppercase tracking-wide whitespace-nowrap"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {downtimeList.map((record) => (
              <tr
                key={record.id}
                className="border-b border-[var(--dtg-border-light)] hover:bg-[var(--dtg-bg-secondary)] transition-colors"
              >
                <td className="px-3 py-2 whitespace-nowrap font-medium text-[var(--dtg-text-primary)]">
                  {record.type || '—'}
                </td>
                <td className="px-3 py-2 text-[var(--dtg-text-secondary)]">
                  {record.reason || '—'}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-[var(--dtg-text-secondary)]">
                  {formatTimestamp(record.from, timezone)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-[var(--dtg-text-secondary)]">
                  {formatTimestamp(record.to, timezone)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-[var(--dtg-text-secondary)]">
                  {resolveDetectedBy(record.detected_by, crosscheckers)}
                </td>
                <td className="px-3 py-2 text-[var(--dtg-text-secondary)]">
                  {record.action || '—'}
                </td>
                <td className="px-3 py-2 text-[var(--dtg-text-secondary)] max-w-[200px] truncate">
                  {record.notes || '—'}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-[var(--dtg-text-secondary)]">
                  {formatTimestamp(record.notification_time, timezone)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-[var(--dtg-text-secondary)]">
                  {record.site_engineer || '—'}
                </td>
                {/* Action buttons — Edit and Delete (scaffolded for tasks 3.2 and 3.3) */}
                <td className="px-3 py-2 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleEdit(record)}
                      title="Edit record"
                      className="p-1.5 rounded text-[var(--dtg-text-muted)] hover:text-[var(--dtg-brand-orange)] hover:bg-[var(--dtg-bg-secondary)] transition-colors"
                      aria-label="Edit downtime record"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(record)}
                      title="Delete record"
                      className="p-1.5 rounded text-[var(--dtg-text-muted)] hover:text-red-500 hover:bg-[var(--dtg-bg-secondary)] transition-colors"
                      aria-label="Delete downtime record"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Table area */}
      <div className="flex-1 overflow-auto p-4">
        {renderContent()}
      </div>

      {/* Edit Modal (task 3.2) */}
      <EditModal
        isOpen={Boolean(editTarget)}
        title="Edit Downtime Record"
        fields={editFields}
        initialValues={editInitialValues}
        onSave={handleEditSave}
        onCancel={handleEditCancel}
        isSaving={isSaving}
      />

      {/* Delete Confirm Dialog (task 3.3) */}
      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Delete Downtime Record"
        message="Are you sure you want to delete this downtime record? This action cannot be undone."
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
        isDestructive
        isConfirmDisabled={isDeletePending}
      />
    </div>
  );
}
