import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { toUTC } from '@/utils/timezoneUtils';
import { Spinner } from '@/components/Reusable/Spinner';
import DeformationList from '@/components/admin/Radar/Deformation/DeformationList';
import AddDeformationForm from '@/components/admin/Radar/Deformation/AddDeformationForm';
import ConfirmDialog from '@/components/admin/Radar/shared/ConfirmDialog';
import EditModal from '@/components/admin/Radar/shared/EditModal';
import PatternRecognitionPopup from '@/components/admin/Radar/PatternRecognition/PatternRecognitionPopup';
import MonitoringAreasPanel from '@/components/admin/Radar/Deformation/MonitoringAreasPanel';
import ChainSelectDialog from '@/components/admin/Radar/Deformation/ChainSelectDialog';
import { usesAreaRoster } from '@/config/movementTableStyle';
import {
  resolveDetectedBy,
  isoToDatetimeLocal,
  resolveTimelineChain,
  normalizePrecursorss,
  isMergeEventRecord,
  resolveChainHeads,
  archiveDefRecords,
  performEventArchiveFlow,
} from '@/utils/tabHelpers';
import { TYPE_MATRIX, FIELD_DEFINITIONS, getConfigForType } from '@/config/formConfig';
import { getTarpPolicyForSensor, resolveTarpLevel } from '@/config/tarpPolicy';
import { getRiskDisplayMode } from '@/config/riskDisplay';
import { useTarpDocument } from '@/components/admin/Radar/Tarp/useTarpDocument';
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

// `notes` and `wallfolder_id` are here because a chain continuation is a copy of
// the record it carries forward — a column missing from this list is a column the
// copy silently loses.
const TIMELINE_SELECT =
  'id, created_at, location, precursors, def_type, tarp_level, isactive, start, detected_by, alarm, crosschecked_by, notification_time, site_engineer, properties, notes, wallfolder_id';

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

  // The site's own TARP document decides which types carry a TARP level. The
  // edit form re-derives the level when the type changes, and used to take it
  // straight from TYPE_MATRIX — which would hand a Leonora blast the DTG
  // default TARP 2 that its document deliberately withholds, and drop the
  // TARP 2 Telfer's document does assign. Same resolution the add form uses.
  const { policy: documentPolicy } = useTarpDocument(sensor?.site_id);
  const tarpPolicy = documentPolicy || getTarpPolicyForSensor(sensor);

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
  // `{ record, branchId }` — the record about to be superseded, and which of ITS
  // precursors the replacement continues (null when there is nothing to choose).
  const [updateTarget, setUpdateTarget] = useState(null);
  const [pendingPrecursors, setPendingPrecursors] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // ── Chain state (Rainfall/Blast merge events) ─────────────────────────────────
  // A rainfall lists every trend that was running when it fell, so continuing one
  // of them means naming which. `chainChoiceTarget` holds the event whose branch
  // the engineer is being asked to pick; the `pendingChain*` values are what that
  // choice resolved to, carried through the PR prompt into the add form.
  const [chainChoiceTarget, setChainChoiceTarget] = useState(null);
  const [chainChoiceOptions, setChainChoiceOptions] = useState([]);
  const [isLoadingChains, setIsLoadingChains] = useState(false);
  const [pendingChainBranch, setPendingChainBranch] = useState(null);
  // Whether the record being superseded also leaves the board. It does not when
  // other chains are still sitting on it — see handleUpdateConfirm.
  const [pendingArchiveOriginal, setPendingArchiveOriginal] = useState(true);

  // ── Archive state ─────────────────────────────────────────────────────────────
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [isArchivePending, setIsArchivePending] = useState(false);

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

  // One card per LIVE chain.
  //
  // A precursor is rolled up into its descendant's timeline and must not also
  // stand as its own card. A Rainfall/Blast is the exception: several chains run
  // into it and it goes on being the current node of each until that chain is
  // continued past it, so it stays a head while any branch is still open.
  // `openBranchesById` is which of its chains those are.
  const { heads, openBranchesById } = useMemo(
    () => resolveChainHeads(deformationList),
    [deformationList]
  );

  const filtered = useMemo(() => {
    const lower = search.toLowerCase();
    return heads
      .filter(
        (d) =>
          d.location?.toLowerCase().includes(lower) ||
          d.def_type?.toLowerCase().includes(lower) ||
          d.tarp_level?.toLowerCase().includes(lower)
      );
  }, [heads, search]);

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

      // An alarm-gated row keeps its trigger only where an alarm accompanied the
      // record, exactly as it did when it was submitted.
      // Which alarm, not just whether: a site that reads its level off the alarm
      // colour would otherwise have the level recomputed from the trend alone.
      const alarms = Array.isArray(editTarget.alarm) ? editTarget.alarm : [];
      const resolvedTarp = resolveTarpLevel(formValues.def_type, {
        hasAlarm: alarms.length > 0,
        alarmColours: alarms.map((a) => a?.type),
        policy: tarpPolicy,
      });

      const payload = {
        def_type: formValues.def_type,
        // '' is a real answer here — the site assigns this type no level — so
        // only an UNCHANGED type falls back to what the record already carried.
        tarp_level: formValues.def_type === editTarget.def_type ? editTarget.tarp_level : resolvedTarp,
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

  // ── Chain helpers (Rainfall/Blast merge events) ───────────────────────────────

  /**
   * Full rows for a record's `precursors`, in the order the record lists them.
   *
   * Not served from `deformationList`: that holds active records only, and a
   * chain may well have been archived out from under an event that is still
   * standing. It is still one of the event's branches and still has to be named.
   *
   * `only` narrows the result to a subset of the event's precursors — the OPEN
   * branches, when the point is to ask which chain to continue.
   */
  const fetchPrecursorRecords = useCallback(async (record, only = null) => {
    const all = normalizePrecursorss(record?.precursors);
    const keep = only ? new Set(only.map(String)) : null;
    const ids = keep ? all.filter((id) => keep.has(String(id))) : all;
    if (ids.length === 0) return [];
    const { data, error: fetchError } = await supabase
      .from('def_records')
      .select(TIMELINE_SELECT)
      .in('id', ids);
    if (fetchError) throw fetchError;
    const byId = new Map((data || []).map((r) => [String(r.id), r]));
    return ids.map((id) => byId.get(String(id))).filter(Boolean);
  }, []);

  const clearPendingChain = useCallback(() => {
    setPendingChainBranch(null);
    setPendingArchiveOriginal(true);
  }, []);

  // ── Update flow (task 7.4) ────────────────────────────────────────────────────

  /**
   * Update — supersede a record with a new one that points back at it.
   *
   * A Rainfall/Blast has several trends running INTO it, so the new record has to
   * say which of them it continues; nothing in `precursors` alone can. When
   * Update was pressed on a chain card the answer is already on screen — that
   * card IS the branch — so only the event's own card asks, and it asks only
   * about the chains that have not already moved on.
   */
  const handleUpdate = async (record, parentEvent = null) => {
    if (parentEvent) {
      setUpdateTarget({ record: parentEvent, branchId: record.id });
      return;
    }

    const open = openBranchesById.get(String(record.id)) || [];
    if (isMergeEventRecord(record) && open.length > 1) {
      setChainChoiceTarget(record);
      setIsLoadingChains(true);
      try {
        setChainChoiceOptions(await fetchPrecursorRecords(record, open));
      } catch (err) {
        console.error('Error loading chains for record:', err);
        toast.error('Could not load the chains on this record.');
        setChainChoiceTarget(null);
      } finally {
        setIsLoadingChains(false);
      }
      return;
    }

    // One open chain, or none at all (an event that started its own chain): there
    // is nothing to ask, but a single open branch still has to be NAMED so the
    // new record's timeline walks back out of the event the right way.
    setUpdateTarget({ record, branchId: open.length === 1 ? open[0] : null });
  };

  const handleChainChoice = (branchId) => {
    const record = chainChoiceTarget;
    setChainChoiceTarget(null);
    setChainChoiceOptions([]);
    if (record) setUpdateTarget({ record, branchId });
  };

  const handleChainChoiceCancel = () => {
    setChainChoiceTarget(null);
    setChainChoiceOptions([]);
  };

  const handleUpdateConfirm = () => {
    if (!updateTarget) return;
    const { record, branchId } = updateTarget;

    // Continuing ONE chain out of a merge event must not take the event off the
    // board: the other chains are still sitting on it, and it is their current
    // node. It stops being a head on its own once every branch has moved past it
    // (resolveChainHeads), so there is nothing left to archive here.
    const stillCarriesOtherChains =
      isMergeEventRecord(record) &&
      (openBranchesById.get(String(record.id)) || []).length > 0;

    setPendingPrecursors(record.id);
    setPendingChainBranch(branchId);
    setPendingArchiveOriginal(!stillCarriesOtherChains);
    setUpdateTarget(null);
    setShowPRPrompt(true); // NEW: show PR prompt instead of directly opening form (Requirement 1.1)
  };

  const handleUpdateCancel = () => setUpdateTarget(null);

  // ── Archive flow ──────────────────────────────────────────────────────────────

  /**
   * Take a record off the board.
   *
   * Archiving a Rainfall/Blast is a statement about the EVENT, not about the
   * trends that were running when it happened. So every chain still sitting on
   * it is carried forward: the trend is re-stated with the same values as a
   * fresh active record pointing at the event, and goes on being tracked until
   * someone archives that record — which is the statement about the trend.
   *
   * Chains that already moved PAST the event are untouched (their current record
   * is elsewhere and only reads the event as history), and so is a branch whose
   * own record has already been archived: that chain is closed already.
   */
  const archiveRecord = useCallback(
    async (record) => {
      if (!record) return false;
      setIsArchivePending(true);
      try {
        const open = isMergeEventRecord(record)
          ? (openBranchesById.get(String(record.id)) || [])
          : [];
        let carried = 0;

        if (open.length > 0) {
          const live = (await fetchPrecursorRecords(record, open)).filter(
            (r) => r.isactive === 'Yes'
          );
          const flow = await performEventArchiveFlow(supabase, {
            event: record,
            precursorRecords: live,
          });

          if (!flow.ok) {
            toast.error(
              flow.stage === 'insert'
                ? 'The chains could not be carried forward, so nothing was archived.'
                : 'The chains were carried forward but the event could not be archived — archive it from the list.'
            );
            return false;
          }
          carried = flow.inserted.length;
        } else {
          const archived = await archiveDefRecords(supabase, [record.id]);
          if (!archived.ok) throw archived.error;
        }

        const workLogPayload = {
          created_at: new Date().toISOString(),
          subject: 7,
          wallfolder: sensor?.wallfolder_id,
          location: sensor?.area,
          category: 'deformation',
          action: 'No action required',
          notes: carried
            ? `${record.def_type} record has been archived; ${carried} chain${carried > 1 ? 's' : ''} carried forward`
            : `${record.def_type} record has been archived`,
          submitted_by: userID,
        };

        const { error: logError } = await supabase.from('work_log').insert([workLogPayload]);
        if (logError) {
          console.error('Work Log Insert Failed:', logError);
          toast.error('Record archived, but failed to create log entry.');
        } else if (carried) {
          toast.success(
            `Record archived — ${carried} chain${carried > 1 ? 's' : ''} carried forward.`
          );
        } else {
          toast.success('Deformation record archived.');
        }

        await fetchDeformationRecords();
        return true;
      } catch (err) {
        console.error('Error archiving deformation:', err);
        toast.error('Could not archive the record.');
        return false;
      } finally {
        setIsArchivePending(false);
      }
    },
    [
      openBranchesById,
      fetchPrecursorRecords,
      fetchDeformationRecords,
      sensor?.wallfolder_id,
      sensor?.area,
      userID,
    ]
  );

  const handleArchive = (record) => {
    // Only the archive that also WRITES records asks first.
    if (isMergeEventRecord(record) && (openBranchesById.get(String(record.id)) || []).length > 0) {
      setArchiveTarget(record);
      return;
    }
    archiveRecord(record);
  };

  const handleArchiveConfirm = async () => {
    const record = archiveTarget;
    if (await archiveRecord(record)) setArchiveTarget(null);
  };

  const handleArchiveCancel = () => setArchiveTarget(null);

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
    clearPendingChain();
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
    if (!precursorsRecord) return;
    setIsArchivingPrecursors(true);
    try {
      // Same archive the list's Archive button runs, so the blast leaving the
      // board here carries its trends forward too — the slope settling is a
      // statement about the blast, not about the trends that pre-dated it.
      const archived = await archiveRecord(precursorsRecord);
      if (!archived) return;

      setShowPRP(false);
      setPrpAutoFillValues(null);
      setPrpSummary(null);
      setPendingPrecursors(null);
      clearPendingChain();
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
    clearPendingChain();
  };

  const handleAddFormSuccess = async () => {
    setShowAddForm(false);
    setPendingPrecursors(null);
    setPrpAutoFillValues(null);
    setPrpSummary(null);
    clearPendingChain();
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
    async (record, tailRecord = null) => {
      setTimelineRecord(record);
      setTimelineError(null);

      // When a timeline card is a precursor of an event (Rainfall/Blast), append
      // that event as the chain tail so the precursor's continuous history flows
      // root → precursor → event (Current). `related` is left empty on the tail so
      // sibling precursors are not merged back into this timeline.
      const withTail = (chain) =>
        tailRecord ? [...chain, { ...tailRecord, related: [] }] : chain;

      // No precursorss → single-node timeline. `related` kept for TimelineView symmetry.
      if (normalizePrecursorss(record.precursors).length === 0) {
        setTimelineChain(withTail([{ ...record, related: [] }]));
        return;
      }

      setTimelineLoading(true);
      try {
        const { chain, error: chainError } = await resolveTimelineChain(
          record,
          fetchRecordById,
          50
        );
        setTimelineChain(withTail(chain));
        setTimelineError(chainError);
      } catch (err) {
        console.error('Error resolving timeline chain:', err);
        setTimelineChain(withTail([{ ...record, related: [] }]));
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
          chainBranchId={pendingChainBranch}
          archiveOriginal={pendingArchiveOriginal}
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
        {/* The board this radar's daily report is written against. Only the
            radars that print every point have one — on the rest the report is
            the list of active findings and there is no roster to keep. */}
        {usesAreaRoster(sensor) && (
          <MonitoringAreasPanel sensor={sensor} activeTab={activeTab} />
        )}

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
            openBranchesById={openBranchesById}
            search={search}
            onSearchChange={(e) => setSearch(e.target.value)}
            crosscheckers={crosscheckers}
            userSite={userSite}
            onEdit={handleEdit}
            onHardDelete={handleHardDelete}
            onUpdate={handleUpdate}
            onArchive={handleArchive}
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

      {/* Chain picker — which of a Rainfall/Blast event's trends the update continues */}
      <ChainSelectDialog
        isOpen={Boolean(chainChoiceTarget)}
        eventRecord={chainChoiceTarget}
        options={chainChoiceOptions}
        isLoading={isLoadingChains}
        timezone={timezone}
        riskMode={getRiskDisplayMode(sensor)}
        onSelect={handleChainChoice}
        onCancel={handleChainChoiceCancel}
      />

      {/* Update (archive + precursors) Confirm Dialog */}
      <ConfirmDialog
        isOpen={Boolean(updateTarget)}
        title="Update Deformation Record"
        message={
          updateTarget && isMergeEventRecord(updateTarget.record) && updateTarget.branchId != null
            ? 'This will create a new deformation record continuing the selected chain past this event. The event stays on the board as the current record for the chains that have not moved on. Do you want to continue?'
            : 'This will archive the current record and create a new deformation record with this record set as its precursors. Do you want to continue?'
        }
        onConfirm={handleUpdateConfirm}
        onCancel={handleUpdateCancel}
        confirmLabel="Continue"
      />

      {/* Archive Confirm Dialog — only for an event other chains are still on */}
      <ConfirmDialog
        isOpen={Boolean(archiveTarget)}
        title="Archive Event"
        message={`This ${archiveTarget?.def_type || 'event'} is still the current record for ${
          (openBranchesById.get(String(archiveTarget?.id)) || []).length
        } chain(s). Archiving it carries each of them forward as a new active record with the same values, so the chains continue past the event. Do you want to continue?`}
        onConfirm={handleArchiveConfirm}
        onCancel={handleArchiveCancel}
        confirmLabel="Archive"
        isConfirmDisabled={isArchivePending}
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
