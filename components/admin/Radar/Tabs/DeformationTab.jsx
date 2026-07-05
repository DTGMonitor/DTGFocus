import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { toUTC } from '@/utils/timezoneUtils';
import { Spinner } from '@/components/Reusable/Spinner';
import DeformationList from '@/components/admin/Radar/Deformation/DeformationList';
import AddDeformationForm from '@/components/admin/Radar/Deformation/AddDeformationForm';
import ConfirmDialog from '@/components/admin/Radar/shared/ConfirmDialog';
import EditModal from '@/components/admin/Radar/shared/EditModal';
import PatternRecognitionPopup from '@/components/admin/Radar/PatternRecognition/PatternRecognitionPopup';
import { resolveDetectedBy, isoToDatetimeLocal, resolveTimelineChain, normalizePrecursorss } from '@/utils/tabHelpers';
import { TYPE_MATRIX, FIELD_DEFINITIONS, getConfigForType } from '@/config/formConfig';
import toast from 'react-hot-toast';

/**
 * DeformationTab
 *
 * Owns all deformation-specific state: list fetching, edit, hard-delete,
 * update (archive + precursors), and timeline chain resolution.
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
  'id, created_at, location, precursors, def_type, tarp_level, isactive, start, detected_by, alarm, crosschecked_by, notification_time, site_engineer, properties';

const DEF_TYPE_OPTIONS = Object.keys(TYPE_MATRIX).map((t) => ({ value: t, label: t }));

export default function DeformationTab({
  sensor,
  timezone,
  crosscheckers,
  userSite,
  alarmRegions = [],
  activeTab,
  onRainfallSaved,
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
  const [pendingPrecursors, setPendingPrecursors] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // ── Pattern Recognition state (Requirements 1.1–1.6) ──────────────────────────
  const [showPRPrompt, setShowPRPrompt] = useState(false);
  const [showPRP, setShowPRP] = useState(false);
  const [prpAutoFillValues, setPrpAutoFillValues] = useState(null);
  const [prpSummary, setPrpSummary] = useState(null);
  const [isArchivingPrecursors, setIsArchivingPrecursors] = useState(false);

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

  // Ids that are referenced as a precursor by some other active record. These
  // are "rolled up" into their descendant's timeline and must NOT also appear as
  // their own top-level card (otherwise e.g. a Linear that a later Rainfall points
  // at would show both standalone and inside the Rainfall's chain).
  const referencedPrecursorIds = useMemo(() => {
    const ids = new Set();
    deformationList.forEach((d) => {
      normalizePrecursorss(d.precursors).forEach((id) => ids.add(String(id)));
    });
    return ids;
  }, [deformationList]);

  const filtered = useMemo(() => {
    const lower = search.toLowerCase();
    return deformationList
      // Only "head" records (not a precursor of any other active record) are cards.
      .filter((d) => !referencedPrecursorIds.has(String(d.id)))
      .filter(
        (d) =>
          d.location?.toLowerCase().includes(lower) ||
          d.def_type?.toLowerCase().includes(lower) ||
          d.tarp_level?.toLowerCase().includes(lower)
      );
  }, [deformationList, search, referencedPrecursorIds]);

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
    setPendingPrecursors(updateTarget.id);
    setUpdateTarget(null);
    setShowPRPrompt(true); // NEW: show PR prompt instead of directly opening form (Requirement 1.1)
  };

  const handleUpdateCancel = () => setUpdateTarget(null);

  // ── PR Prompt handlers (Requirements 1.2–1.5) ─────────────────────────────────

  /** User chose "Open Pattern Recognition" — open PRP instead of form (Requirement 1.4) */
  const handlePRPromptOpenPRP = () => {
    setShowPRPrompt(false);
    setShowPRP(true);
  };

  /** User chose "Fill Form Directly" or dismissed via Escape/backdrop (Requirements 1.3, 1.5) */
  const handlePRPromptFillDirectly = () => {
    setShowPRPrompt(false);
    setShowAddForm(true);
  };

  /** PRP close (×) — discard without modifying records (Requirement 2.7) */
  const handlePRPClose = () => {
    setShowPRP(false);
    setPrpAutoFillValues(null);
    setPendingPrecursors(null);
  };

  /** PRP "Use Results to Fill Form" — auto-fill values + summary (Requirements 8.2, 8.3) */
  const handlePRPUseResults = (autoFillValues, summary) => {
    setPrpAutoFillValues(autoFillValues);
    setPrpSummary(summary);
    setShowPRP(false);
    setShowAddForm(true);
  };

  /**
   * PRP "Archive Blast Record" — when the latest stage is No Significant
   * Movement the slope has settled, so we archive the precursors record directly
   * instead of creating a follow-up deformation record (issue 3).
   */
  const handlePRPArchive = async () => {
    if (!pendingPrecursors) return;
    setIsArchivingPrecursors(true);
    try {
      const { error: archiveError } = await supabase
        .from('def_records')
        .update({ isactive: 'No' })
        .eq('id', pendingPrecursors);

      if (archiveError) throw archiveError;

      toast.success('Blast record archived — slope settled (No Significant Movement).');
      setShowPRP(false);
      setPrpAutoFillValues(null);
      setPrpSummary(null);
      setPendingPrecursors(null);
      await fetchDeformationRecords();
    } catch (err) {
      console.error('Error archiving blast record:', err);
      toast.error('Failed to archive blast record.');
    } finally {
      setIsArchivingPrecursors(false);
    }
  };

  // Pre-fill values for the AddDeformationForm from the precursors record.
  const precursorsRecord = useMemo(
    () => deformationList.find((d) => d.id === pendingPrecursors) || null,
    [deformationList, pendingPrecursors]
  );

  const addFormInitialValues = useMemo(() => {
    if (prpAutoFillValues) return prpAutoFillValues; // auto-fill takes precedence (Requirement 1.6 / design)
    if (!precursorsRecord) return undefined;
    return {
      WallFolderID: precursorsRecord.wallfolder_id || sensor.wallfolder_id,
      Location: precursorsRecord.location || '',
      alarmRegions: Array.isArray(precursorsRecord.alarm) ? precursorsRecord.alarm : [],
    };
  }, [precursorsRecord, sensor?.wallfolder_id, prpAutoFillValues]);

  const handleAddFormClose = () => {
    // Discard the pending precursors; no records modified (Requirement 11.4).
    setShowAddForm(false);
    setPendingPrecursors(null);
    setPrpAutoFillValues(null);
    setPrpSummary(null);
  };

  const handleAddFormSuccess = async () => {
    setShowAddForm(false);
    setPendingPrecursors(null);
    setPrpAutoFillValues(null);
    setPrpSummary(null);
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

      // No precursorss → single-node timeline. `related` kept for TimelineView symmetry.
      if (normalizePrecursorss(record.precursors).length === 0) {
        setTimelineChain([{ ...record, related: [] }]);
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
        setTimelineChain([{ ...record, related: [] }]);
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
  // Requirement 1.4: AddDeformationForm must NOT be simultaneously open when PRP is open.
  if (showAddForm && !showPRP) {
    return (
      <div className="flex flex-col h-full p-4">
        <AddDeformationForm
          sensor={sensor}
          alarmRegion={alarmRegions}
          crosscheckers={crosscheckers}
          userID={userID}
          userName={userName}
          clientTimezone={timezone}
          precursors={pendingPrecursors}
          initialValues={addFormInitialValues}
          patternRecognitionSummary={prpSummary}
          onClose={handleAddFormClose}
          onSuccess={handleAddFormSuccess}
          onRainfallSaved={onRainfallSaved}
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
            onRainfallSaved={onRainfallSaved}
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

      {/* Update (archive + precursors) Confirm Dialog */}
      <ConfirmDialog
        isOpen={Boolean(updateTarget)}
        title="Update Deformation Record"
        message="This will archive the current record and create a new deformation record with this record set as its precursors. Do you want to continue?"
        onConfirm={handleUpdateConfirm}
        onCancel={handleUpdateCancel}
        confirmLabel="Continue"
      />

      {/* PR Prompt — step between update confirm and add form (Requirements 1.1–1.5) */}
      <ConfirmDialog
        isOpen={showPRPrompt}
        title="Run Pattern Recognition?"
        message="Would you like to run Pattern Recognition first to auto-fill the form?"
        onConfirm={handlePRPromptOpenPRP}
        onCancel={handlePRPromptFillDirectly}
        confirmLabel="Open Pattern Recognition"
        cancelLabel="Fill Form Directly"
      />

      {/* Pattern Recognition Popup (Requirements 1.4, 2.x–8.x) */}
      <PatternRecognitionPopup
        isOpen={showPRP}
        precursors={pendingPrecursors}
        precursorsInitialValues={addFormInitialValues}
        timezone={timezone}
        onClose={handlePRPClose}
        onUseResults={handlePRPUseResults}
        onArchive={handlePRPArchive}
        isArchiving={isArchivingPrecursors}
        sensor={sensor}
        userSite={userSite}
      />
    </div>
  );
}
