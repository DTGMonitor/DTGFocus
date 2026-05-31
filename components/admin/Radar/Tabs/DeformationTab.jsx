import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { toUTC } from '@/utils/timezoneUtils';
import { Spinner } from '@/components/Reusable/Spinner';
import DeformationList from '@/components/admin/Radar/Deformation/DeformationList';
import AddDeformationForm from '@/components/admin/Radar/Deformation/AddDeformationForm';
import ConfirmDialog from '@/components/admin/Radar/shared/ConfirmDialog';
import EditModal from '@/components/admin/Radar/shared/EditModal';
import { resolveDetectedBy, isoToDatetimeLocal, resolveTimelineChain } from '@/utils/tabHelpers';
import { TYPE_MATRIX, FIELD_DEFINITIONS, getConfigForType } from '@/config/formConfig';
import toast from 'react-hot-toast';

/**
 * DeformationTab
 *
 * Owns all deformation-specific state: list fetching, edit, hard-delete,
 * update (archive + precursor), and timeline chain resolution.
 *
 * Props:
 *   sensor        {object}
 *   timezone      {string}
 *   crosscheckers {Array}
 *   userSite      {object}
 *   alarmRegions  {Array}   - from sharedRegions in SensorDetail
 *   activeTab     {string}  - re-fetch trigger when changed to 'deformation'
 *
 * Requirements: 9.x, 10.x, 11.x, 12.x, 14.3
 */

const TIMELINE_SELECT =
  'id, created_at, location, precursor, def_type, tarp_level, isactive, start, detected_by, alarm, crosschecked_by, notification_time, site_engineer, properties';

const DEF_TYPE_OPTIONS = Object.keys(TYPE_MATRIX).map((t) => ({ value: t, label: t }));

export default function DeformationTab({
  sensor,
  timezone,
  crosscheckers,
  userSite,
  alarmRegions = [],
  activeTab,
}) {
  const userID = userSite?.user_id;
  const userName = userSite?.displayname;

  // ── Data state ───────────────────────────────────────────────────────────────
  const [deformationList, setDeformationList] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  // ── Edit / Delete / Update state ───────────────────────────────────────────────
  const [editTarget, setEditTarget] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeletePending, setIsDeletePending] = useState(false);
  const [updateTarget, setUpdateTarget] = useState(null);
  const [pendingPrecursor, setPendingPrecursor] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // ── Timeline state ──────────────────────────────────────────────────────────────
  const [timelineRecord, setTimelineRecord] = useState(null);
  const [timelineChain, setTimelineChain] = useState([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState(null);

  // ── Data fetching ─────────────────────────────────────────────────────────────

  const fetchDeformationRecords = useCallback(async () => {
    if (!sensor?.wallfolder_id) return;
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('def_records')
        .select(TIMELINE_SELECT)
        .eq('wallfolder_id', sensor.wallfolder_id)
        .eq('isactive', 'Yes')
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;
      setDeformationList(data || []);
    } catch (err) {
      console.error('Error fetching deformation records:', err);
      setError('Failed to load deformation records.');
    } finally {
      setIsLoading(false);
    }
  }, [sensor?.wallfolder_id]);

  useEffect(() => {
    if (activeTab === 'deformation') {
      fetchDeformationRecords();
    }
  }, [activeTab, fetchDeformationRecords]);

  const filtered = useMemo(() => {
    const lower = search.toLowerCase();
    return deformationList.filter(
      (d) =>
        d.location?.toLowerCase().includes(lower) ||
        d.def_type?.toLowerCase().includes(lower) ||
        d.tarp_level?.toLowerCase().includes(lower)
    );
  }, [deformationList, search]);

  // ── Edit flow (task 7.2) ─────────────────────────────────────────────────────

  const handleEdit = (record) => setEditTarget(record);

  // Build edit fields dynamically based on the record's def_type.
  const editFields = useMemo(() => {
    if (!editTarget) return [];
    const config = getConfigForType(editTarget.def_type);
    const dynamicFields = (config.fields || []).map((fieldKey) => {
      const def = FIELD_DEFINITIONS[fieldKey];
      const inputType =
        def?.type === 'datetime-local'
          ? 'datetime-local'
          : def?.type === 'number'
          ? 'number'
          : 'text';
      return { key: `prop_${fieldKey}`, label: def?.label || fieldKey, type: inputType };
    });

    return [
      { key: 'def_type', label: 'Type', type: 'select', options: DEF_TYPE_OPTIONS, required: true },
      { key: 'tarp_level', label: 'TARP Level', type: 'readonly' },
      { key: 'location', label: 'Location', type: 'text', required: true },
      { key: 'start', label: 'Time of Event/Trend Start', type: 'datetime-local' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
      {
        key: 'crosschecked_by',
        label: 'Crosschecked By',
        type: 'select',
        options: (crosscheckers || []).map((c) => ({ value: String(c.id), label: c.full_name })),
      },
      { key: 'notification_time', label: 'Notification Time', type: 'datetime-local' },
      { key: 'site_engineer', label: 'Site Engineer', type: 'text' },
      { key: 'detected_by', label: 'Detected By', type: 'readonly' },
      ...dynamicFields,
    ];
  }, [editTarget, crosscheckers]);

  const editInitialValues = useMemo(() => {
    if (!editTarget) return {};
    const config = getConfigForType(editTarget.def_type);
    const props = editTarget.properties || {};
    const dynamicValues = {};
    (config.fields || []).forEach((fieldKey) => {
      const def = FIELD_DEFINITIONS[fieldKey];
      const raw = props[fieldKey];
      dynamicValues[`prop_${fieldKey}`] =
        def?.type === 'datetime-local'
          ? isoToDatetimeLocal(raw, timezone)
          : raw ?? '';
    });

    return {
      def_type: editTarget.def_type || '',
      tarp_level: editTarget.tarp_level || '',
      location: editTarget.location || '',
      start: isoToDatetimeLocal(editTarget.start, timezone),
      notes: editTarget.notes || '',
      crosschecked_by: editTarget.crosschecked_by != null ? String(editTarget.crosschecked_by) : '',
      notification_time: isoToDatetimeLocal(editTarget.notification_time, timezone),
      site_engineer: editTarget.site_engineer || '',
      detected_by: resolveDetectedBy(editTarget.detected_by, crosscheckers),
      ...dynamicValues,
    };
  }, [editTarget, timezone, crosscheckers]);

  const handleEditSave = async (formValues) => {
    if (!editTarget) return;
    setIsSaving(true);
    try {
      const config = getConfigForType(formValues.def_type);

      // Reconstruct the dynamic properties JSONB from prop_* fields.
      const properties = { ...(editTarget.properties || {}) };
      (config.fields || []).forEach((fieldKey) => {
        const def = FIELD_DEFINITIONS[fieldKey];
        const raw = formValues[`prop_${fieldKey}`];
        if (raw === '' || raw === undefined || raw === null) {
          properties[fieldKey] = null;
        } else if (def?.type === 'number') {
          const num = parseFloat(raw);
          properties[fieldKey] = isNaN(num) ? null : num;
        } else if (def?.type === 'datetime-local') {
          properties[fieldKey] = toUTC(raw, timezone);
        } else {
          properties[fieldKey] = raw;
        }
      });

      const payload = {
        def_type: formValues.def_type,
        tarp_level: config.tarp || editTarget.tarp_level,
        location: formValues.location,
        start: formValues.start ? toUTC(formValues.start, timezone) : null,
        notes: formValues.notes,
        crosschecked_by: formValues.crosschecked_by || null,
        notification_time: formValues.notification_time
          ? toUTC(formValues.notification_time, timezone)
          : null,
        site_engineer: formValues.site_engineer,
        properties,
      };

      const { error: updateError } = await supabase
        .from('def_records')
        .update(payload)
        .eq('id', editTarget.id);

      if (updateError) throw updateError;

      toast.success('Deformation record updated.');
      setEditTarget(null);
      await fetchDeformationRecords();
    } catch (err) {
      console.error('Error updating deformation record:', err);
      toast.error('Failed to update deformation record.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditCancel = () => setEditTarget(null);

  // ── Hard delete flow (task 7.3) ───────────────────────────────────────────────

  const handleHardDelete = (record) => setDeleteTarget(record);

  const handleHardDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setIsDeletePending(true);
    try {
      const { error: deleteError } = await supabase
        .from('def_records')
        .delete()
        .eq('id', deleteTarget.id);

      if (deleteError) throw deleteError;

      toast.success('Deformation record permanently deleted.');
      setDeleteTarget(null);
      await fetchDeformationRecords();
    } catch (err) {
      console.error('Error deleting deformation record:', err);
      toast.error('Failed to delete deformation record.');
    } finally {
      setIsDeletePending(false);
    }
  };

  const handleHardDeleteCancel = () => setDeleteTarget(null);

  // ── Update flow (task 7.4) ────────────────────────────────────────────────────

  const handleUpdate = (record) => setUpdateTarget(record);

  const handleUpdateConfirm = () => {
    if (!updateTarget) return;
    setPendingPrecursor(updateTarget.id);
    setShowAddForm(true);
    setUpdateTarget(null);
  };

  const handleUpdateCancel = () => setUpdateTarget(null);

  // Pre-fill values for the AddDeformationForm from the precursor record.
  const precursorRecord = useMemo(
    () => deformationList.find((d) => d.id === pendingPrecursor) || null,
    [deformationList, pendingPrecursor]
  );

  const addFormInitialValues = useMemo(() => {
    if (!precursorRecord) return undefined;
    return {
      WallFolderID: precursorRecord.wallfolder_id || sensor.wallfolder_id,
      Location: precursorRecord.location || '',
      alarmRegions: Array.isArray(precursorRecord.alarm) ? precursorRecord.alarm : [],
    };
  }, [precursorRecord, sensor?.wallfolder_id]);

  const handleAddFormClose = () => {
    // Discard the pending precursor; no records modified (Requirement 11.4).
    setShowAddForm(false);
    setPendingPrecursor(null);
  };

  const handleAddFormSuccess = async () => {
    setShowAddForm(false);
    setPendingPrecursor(null);
    await fetchDeformationRecords();
  };

  // ── Timeline flow (task 7.5) ──────────────────────────────────────────────────

  const fetchRecordById = useCallback(async (id) => {
    const { data, error: fetchError } = await supabase
      .from('def_records')
      .select(TIMELINE_SELECT)
      .eq('id', id)
      .single();
    if (fetchError) throw fetchError;
    return data;
  }, []);

  const handleTimelineExpand = useCallback(
    async (record) => {
      setTimelineRecord(record);
      setTimelineError(null);

      if (record.precursor === null || record.precursor === undefined) {
        setTimelineChain([record]);
        return;
      }

      setTimelineLoading(true);
      try {
        const { chain, error: chainError } = await resolveTimelineChain(
          record,
          fetchRecordById,
          50
        );
        setTimelineChain(chain);
        setTimelineError(chainError);
      } catch (err) {
        console.error('Error resolving timeline chain:', err);
        setTimelineChain([record]);
        setTimelineError('Timeline may be incomplete.');
      } finally {
        setTimelineLoading(false);
      }
    },
    [fetchRecordById]
  );

  const handleTimelineCollapse = useCallback(() => {
    setTimelineRecord(null);
    setTimelineChain([]);
    setTimelineError(null);
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────────

  // While the AddDeformationForm (Update flow) is open, show it instead of the list.
  if (showAddForm) {
    return (
      <div className="flex flex-col h-full p-4">
        <AddDeformationForm
          sensor={sensor}
          alarmRegion={alarmRegions}
          crosscheckers={crosscheckers}
          userID={userID}
          userName={userName}
          clientTimezone={timezone}
          precursor={pendingPrecursor}
          initialValues={addFormInitialValues}
          onClose={handleAddFormClose}
          onSuccess={handleAddFormSuccess}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner size={32} />
          </div>
        ) : error ? (
          <p className="py-8 text-center text-sm text-red-500">{error}</p>
        ) : (
          <DeformationList
            sensor={sensor}
            alarmRegion={alarmRegions}
            rawList={deformationList}
            filtered={filtered}
            search={search}
            onSearchChange={(e) => setSearch(e.target.value)}
            crosscheckers={crosscheckers}
            userSite={userSite}
            onEdit={handleEdit}
            onHardDelete={handleHardDelete}
            onUpdate={handleUpdate}
            onTimelineExpand={handleTimelineExpand}
            onTimelineCollapse={handleTimelineCollapse}
            timelineRecord={timelineRecord}
            timelineChain={timelineChain}
            timelineLoading={timelineLoading}
            timelineError={timelineError}
            timezone={timezone}
            onSuccess={fetchDeformationRecords}
          />
        )}
      </div>

      {/* Edit Modal */}
      <EditModal
        isOpen={Boolean(editTarget)}
        title="Edit Deformation Record"
        fields={editFields}
        initialValues={editInitialValues}
        onSave={handleEditSave}
        onCancel={handleEditCancel}
        isSaving={isSaving}
      />

      {/* Hard Delete Confirm Dialog */}
      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Permanently Delete Record"
        message="Are you sure you want to permanently delete this deformation record? This action cannot be undone."
        onConfirm={handleHardDeleteConfirm}
        onCancel={handleHardDeleteCancel}
        isDestructive
        isConfirmDisabled={isDeletePending}
      />

      {/* Update (archive + precursor) Confirm Dialog */}
      <ConfirmDialog
        isOpen={Boolean(updateTarget)}
        title="Update Deformation Record"
        message="This will archive the current record and create a new deformation record with this record set as its precursor. Do you want to continue?"
        onConfirm={handleUpdateConfirm}
        onCancel={handleUpdateCancel}
        confirmLabel="Continue"
      />
    </div>
  );
}
