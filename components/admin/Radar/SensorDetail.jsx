import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabaseClient";
import { getStatusColor, getRiskColor, getOverallColor, getBandColor } from "@/config/statusConfig";
import { resolveRiskPresentation, pendingPresentation } from "@/config/riskDisplay";
import { Button } from "@/components/ui/button";
import {
    X, Download, Mail, Printer, Calendar, ListChecks, Wifi, TriangleAlert,
    Wrench, Check, Plus
} from 'lucide-react';
import { LocalTime } from "@/components/Reusable/Formatting";
import { QualityTable } from "./Dqp/DqpTable";
import { ActionRequiredModal } from "./Dqp/ActionRequiredModal";
import FeedbackModal from "./Dqp/FeedbackModal";
import { Spinner, PageLoader } from "@/components/Reusable/Spinner";
import Tab_Container from "./Tabs/Tab_Container";
import DeformationTab from "./Tabs/DeformationTab";
import AlarmTab from "./Tabs/AlarmTab";
import DQPTab from "./Tabs/DQPTab";
import DowntimeTab from "./Tabs/DowntimeTab";
import TarpTab from "./Tabs/TarpTab";
import { motion, AnimatePresence } from 'framer-motion';
import { toUTC, fromUTC } from "@/utils/timezoneUtils";
import { DQP_IMAGE_COLUMNS, attachDqpImages, buildDqpImagePayload } from "@/utils/dqpImages";
import { generateEmailBodyOthers, getWorkLogDetails, generateEmailBodyDQP } from '../../../config/formConfig';
import toast, { Toaster } from 'react-hot-toast';
import ReportTemplateModal from "@/components/admin/Reports/ReportTemplateModal";
import SiteWideStatusModal from "@/components/admin/Radar/SiteWideStatusModal";
import { isSiteWideStatus } from "@/utils/siteWideStatus";
import { openOutlookDraft } from "@/utils/openOutlookDraft";

/**
 * Detaching every figure from a DQP row.
 *
 * Both arrays must be cleared together — the dqp_values_image_arrays_aligned
 * CHECK rejects a write that empties one and leaves the other. The legacy
 * single-image columns are cleared alongside so a client still on the old read
 * path does not resurrect a figure the analyst just removed.
 */
const CLEARED_DQP_IMAGES = { image: null, caption: null, image_ids: [], image_captions: [] };

const validateCompleteness = (dataList) => {
    // 1. Define the ID for Alarms (from your CSV, Alarms is ID 6)
    const ALARMS_PARENT_ID = 6;

    // 2. Filter for invalid items
    const missingItems = dataList.filter(item => {
        const parentId = item.parameter?.parent_id;
        if (parentId !== ALARMS_PARENT_ID && item.value === 'N/A') {
            return true;
        }
        return false;
    });

    // 3. Handle the result
    if (missingItems.length > 0) {
        console.warn("Validation Failed: The following parameters are missing values:", missingItems);
        return false;
    }

    console.log("Validation Passed: All required fields are filled.");
    // setFormError(null);
    return true;
};

const SensorDetail = ({
    sensor,
    onClose,
    onRefresh,
    shift,
    userSite,
    timezone,
    onUpdateComplete
}) => {
    const [isLoading, setIsLoading] = useState(false);
    const userID = userSite?.user_id;
    const userName = userSite?.displayname;
    const [activeView, setActiveView] = useState('default');

    // --- Tabbed navigation (Requirement 1) ---
    const [activeTab, setActiveTab] = useState('deformation');

    // --- Data States ---
    const [deformationList, setDeformationList] = useState([]);
    const [dqpList, setDqpList] = useState([]);

    // --- Search States ---
    const [searchDeformation, setSearchDeformation] = useState('');

    // --- Wrench/Folder Management States ---
    const [showWrenchMenu, setShowWrenchMenu] = useState(false);
    const [isRenaming, setIsRenaming] = useState(false);
    const [isCreating, setIsCreating] = useState(false);

    // WallFolder for inputs
    const wallFolderData = sensor.wallfolder?.find(wf => wf.id === sensor.wallfolder_id);
    const [currentFolderName, setCurrentFolderName] = useState(wallFolderData?.name || "NA");
    const [renameInput, setRenameInput] = useState(wallFolderData?.name || "");
    const [newFolderInput, setNewFolderInput] = useState("");
    const [newAreaInput, setNewAreaInput] = useState("");
    // "Same/overlay with previous location": when checked, the new folder inherits
    // the current folder's location_group so the report clusters them as one wall;
    // when unchecked it is treated as a different location (its own report section).
    const [sameLocation, setSameLocation] = useState(false);

    const now = new Date();
    const menuRef = useRef(null);
    const [crosscheckers, setCrosscheckers] = useState([]);
    const [selectedCrosschecker, setSelectedCrosschecker] = useState('');

    // --- Downtime States ---
    const [isModalOpen, setIsModalOpen] = useState(false);
    // Lost Connection / Scheduled Offline take the multi-sensor route instead —
    // see SiteWideStatusModal. Kept as its own flag so the single-sensor modal
    // above is untouched by it.
    const [siteWideStatus, setSiteWideStatus] = useState(null);
    const [targetStatus, setTargetStatus] = useState('');
    const [localStatus, setLocalStatus] = useState(sensor.status);
    // The risk line, worded and coloured the way this sensor's SITE words it —
    // see config/riskDisplay.ts. Held as the resolved presentation, not a bare
    // string, because the label alone no longer implies its colour.
    const [riskInfo, setRiskInfo] = useState(() => pendingPresentation(sensor));
    const [localQuality, setLocalQuality] = useState(sensor.quality);
    const [localScore, setLocalScore] = useState(sensor.normalised_score);
    const [loading, setLoading] = useState(false);
    // NEW: Track if we are editing an existing downtime record
    const [activeDowntimeId, setActiveDowntimeId] = useState(null);

    // [NEW] Refs for handling race conditions
    const lastEditTimeRef = useRef(0);
    const prevSensorIdRef = useRef(sensor.id);

    // DQP
    const [isDQPModalOpen, setIsDQPModalOpen] = useState(false);
    const [pendingUpdate, setPendingUpdate] = useState(null);
    const [sharedRegions, setSharedRegions] = useState([]);
    const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
    const [feedbackModalData, setFeedbackModalData] = useState([]);
    const [pendingOptimalUpdate, setPendingOptimalUpdate] = useState(null); // To resume the update after modal closes
    // Rainfall → Refractivity flow: dedicated modal state (separate from DQP tab modal)
    const [dqpModalDefaultSubject, setDqpModalDefaultSubject] = useState(null);
    const [isRainfallModalOpen, setIsRainfallModalOpen] = useState(false);
    const [rainfallPendingUpdate, setRainfallPendingUpdate] = useState(null);

    // Report
    const [showReportModal, setShowReportModal] = useState(false);

    useEffect(() => {
        // 1. Check if Sensor ID changed (User switched sensors)
        if (sensor.id !== prevSensorIdRef.current) {
            prevSensorIdRef.current = sensor.id;
            lastEditTimeRef.current = 0; // Reset edit timer

            // Property 1: reset to the Deformation tab whenever the sensor changes.
            setActiveTab('deformation');

            setLocalStatus(sensor.status);
            setRiskInfo(pendingPresentation(sensor));
            setLocalQuality(sensor.quality);
            setLocalScore(sensor.normalised_score);
            return;
        }

        // 2. If same sensor, check if we recently edited
        const timeSinceEdit = Date.now() - lastEditTimeRef.current;
        if (timeSinceEdit < 2000) {
            // Ignore prop updates for 2 seconds after edit to prevent stale data overwrite
            return;
        }

        setLocalStatus(sensor.status);
        setRiskInfo(pendingPresentation(sensor));
        setLocalQuality(sensor.quality);
        setLocalScore(sensor.normalised_score);
    }, [sensor.status, sensor.risk, sensor.quality, sensor.normalised_score, sensor.id]);

    // Form State
    const [formData, setFormData] = useState({
        Type: targetStatus,
        reason: 'Radar System Issue',
        action: 'Check Fuel',
        notes: '',
        from: '',
        to: '',
        notificationTime: '',
        siteEngineer: '',
        crosscheckedBy: '',
    });

    // --- 1. Fetching Data Effects ---
    const fetchDeformationRecords = useCallback(async () => {
        if (!sensor?.wallfolder_id) return;
        try {
            const { data, error } = await supabase
                .from('def_records')
                .select('id, created_at, location, precursors, def_type, tarp_level, isactive, start, detected_by,alarm,crosschecked_by, notification_time, site_engineer, properties')
                .eq('wallfolder_id', sensor.wallfolder_id)
                .eq('isactive', "Yes")
                .order('created_at', { ascending: false });

            if (error) throw error;
            setDeformationList(data || []);

            // Roll the active records up into this site's risk wording.
            setRiskInfo(resolveRiskPresentation(data || [], sensor));

        } catch (error) {
            console.error('error fetching deformation list', error);
        }
        // site_name decides the risk wording, so a re-resolve must follow it too.
    }, [sensor.wallfolder_id, sensor.site_name]);

    // Add this state to hold the parameter definitions
    const [parameterMap, setParameterMap] = useState({});

    // 1. Fetch the definitions (Map)
    const fetchParameters = useCallback(async () => {
        const { data, error } = await supabase
            .from('parameters')
            .select('id, name, parent_id, level, weight');

        if (data) {
            // Create a lookup object: { 9: { name: 'Data Availability', parentId: 2 }, ... }
            const map = {};
            data.forEach(p => map[p.id] = p);
            setParameterMap(map);
        }
    }, []);

    // 2. Fetch the values (Data) - Simplified Query
    const fetchDataQuality = useCallback(async () => {
        if (!sensor?.dqp_record_id) return;

        // We don't need the complex join anymore, just the local parameter_id
        // Figures live in image_ids[] / image_captions[]. PostgREST cannot embed
        // a join through an array, so attachDqpImages resolves the ids to storage
        // paths in one follow-up query — see utils/dqpImages.js.
        const { data, error } = await supabase
            .from('dqp_values')
            .select(`
            value,
            value_numeric,
            notes,
            parameter_id,
            appendix,
            ${DQP_IMAGE_COLUMNS}
        `)
            .eq('dqp_record_id', sensor.dqp_record_id)
            .order('parameter_id', { ascending: true });

        // inside fetchDataQuality
        if (error) {
            console.error('error fetching dqp', error);
        } else {
            const withImages = await attachDqpImages(supabase, data);
            const mergedData = withImages.map(item => {
                const paramDef = parameterMap[item.parameter_id];
                return {
                    ...item,
                    // FORCE N/A: If value is null, undefined, or empty string, force it to "N/A"
                    value: item.value || "N/A",
                    parameter: {
                        ...paramDef,
                        parent: paramDef?.parent_id ? parameterMap[paramDef.parent_id] : null
                    }
                };
            });
            setDqpList(mergedData);

            // Trigger validation immediately after setting data
            validateCompleteness(mergedData);
        }

        // [NEW] Fetch latest score/quality to keep metadata in sync
        try {
            const { data: parentRecord, error: parentError } = await supabase
                .from('latest_radar_wall_folders')
                .select('quality, normalised_score, type')
                .eq('wallfolder_id', sensor.wallfolder_id)
                .single();

            if (!parentError && parentRecord) {
                const timeSinceEdit = Date.now() - lastEditTimeRef.current;
                if (timeSinceEdit > 2000) {
                    setLocalStatus(parentRecord.type);
                    setLocalQuality(parentRecord.quality);
                    setLocalScore(parentRecord.normalised_score);
                }
            }
        } catch (err) {
            console.error("Error fetching parent record quality:", err);
        }
    }, [sensor.dqp_record_id, parameterMap, sensor.wallfolder_id]); // Dependency on parameterMap is key!

    // 3. Load them in order
    useEffect(() => {
        fetchParameters().then(() => {
            // Trigger values fetch only after map is ready
        });
    }, []);

    useEffect(() => {
        let isMounted = true;
        const loadAll = async () => {
            setIsLoading(true);
            await Promise.all([
                fetchDeformationRecords(),
                fetchDataQuality()
            ]);
            if (isMounted) setIsLoading(false);
        };
        loadAll();
        return () => { isMounted = false; };
    }, [fetchDeformationRecords, fetchDataQuality]);

    // Crosschecker
    useEffect(() => {
        const fetchUsers = async () => {
            try {
                const targetNames = ['Adib Izzuddin', 'Lintang Sadewa', 'Nurhuda Santoso', 'Nessy Salsabilita'];
                const { data, error } = await supabase.rpc('get_safe_crosscheckers', { target_names: targetNames });
                if (error) throw error;
                if (data) setCrosscheckers(data);
            } catch (err) {
                console.error("Error fetching crosscheckers:", err);
            }
        };
        fetchUsers();
    }, []);

    // --- Re-fetch data when the active tab changes (Requirement 14) ---
    // Alarm/Downtime tabs own their fetches (triggered via the activeTab prop).
    useEffect(() => {
        if (activeTab === 'deformation') {
            fetchDeformationRecords();
        } else if (activeTab === 'dqp') {
            if (sensor?.dqp_record_id) fetchDataQuality();
        }
    }, [activeTab, fetchDeformationRecords, fetchDataQuality, sensor?.dqp_record_id]);

    // --- Load alarm regions for THIS wall-folder on sensor change ---
    // sharedRegions is consumed by the DQP feedback check, the DQP email body,
    // and the modals — none of which should depend on the Alarm tab being
    // mounted. Previously regions only arrived via AlarmTab's onRegionsLoaded,
    // so opening a sensor straight to the DQP tab left sharedRegions empty and
    // the "non-optimal → Optimal" FeedbackModal never fired.
    useEffect(() => {
        if (!sensor?.wallfolder_id) return;
        let cancelled = false;

        const loadRegions = async () => {
            const { data, error } = await supabase
                .from('alarm_regions')
                .select('id, name, alarmtype')
                .eq('wallfolder', sensor.wallfolder_id);

            if (error) {
                console.error('Error loading alarm regions:', error);
                return;
            }
            if (cancelled) return;

            setSharedRegions((data || []).map(r => ({
                id: r.id,
                name: r.name,
                type: r.alarmtype,
            })));
        };

        loadRegions();
        return () => { cancelled = true; };
    }, [sensor?.wallfolder_id]);

    // --- 2. Action Handlers for Wrench ---

    const handleSaveRename = async () => {
        if (!renameInput || renameInput === currentFolderName) {
            setIsRenaming(false);
            return;
        }
        const { error } = await supabase
            .from('radar_wall_folders')
            .update({ name: renameInput })
            .eq('id', sensor.wallfolder_id);

        if (!error) {
            setCurrentFolderName(renameInput);
            setIsRenaming(false);
        } else {
            toast.error("Error renaming folder");
        }
    };

    const handleCreateFolder = async () => {
        if (!newFolderInput || !newAreaInput) {
            toast.error("Please enter both Name and Area");
            return;
        }

        // "Same/overlay with previous location": inherit the current folder's
        // location_group so the report clusters both under one wall. Otherwise
        // pass null and let the RPC default the group to the new area (a distinct
        // location → its own report section). The current group is read straight
        // from radar_wall_folders because the sensor row does not carry it.
        let locationGroup = null;
        if (sameLocation) {
            const { data: prev } = await supabase
                .from('radar_wall_folders')
                .select('location_group, area')
                .eq('id', sensor.wallfolder_id)
                .maybeSingle();
            locationGroup = prev?.location_group || prev?.area || newAreaInput;
        }

        const { data, error } = await supabase
            .rpc('create_wall_folder_with_defaults', {
                _radar_id: sensor.id,
                _name: newFolderInput,
                _area: newAreaInput,
                _location_group: locationGroup
            });

        if (!error) {
            toast.success(`Folder "${newFolderInput}" created successfully!`);
            setNewFolderInput("");
            setNewAreaInput("");
            setSameLocation(false);
            setIsCreating(false);
            setShowWrenchMenu(false);
            if (onRefresh) await onRefresh();
        } else {
            console.error(error);
            toast.error("Error creating folder. Check console.");
        }
    };

    // --- REFACTORED STATUS CHANGE LOGIC ---

    // Convert a stored UTC ISO into a datetime-local value expressed in the
    // SITE timezone (never the user's local / raw UTC time).
    const formatForInput = (isoString) => {
        if (!isoString) return '';
        return (fromUTC(isoString, timezone) || '').slice(0, 16);
    };

    const handleStatusChange = async (e) => {
        const newStatus = e.target.value;
        const currentStatus = sensor.status;

        // A dropped link and DTG-side maintenance hit every sensor on the site at
        // once, so both are raised against a selection rather than this one wall
        // folder. The site-wide modal owns its own form and submission.
        if (isSiteWideStatus(newStatus)) {
            setSiteWideStatus(newStatus);
            return;
        }

        setTargetStatus(newStatus);

        // Default: Assume new entry
        setActiveDowntimeId(null);
        // "Now", expressed as a datetime-local value in the site timezone.
        const nowSiteLocal = (fromUTC(new Date().toISOString(), timezone) || '').slice(0, 16);
        let initialForm = {
            Type: targetStatus,
            reason: 'Radar System Issue',
            action: 'Check Fuel',
            notes: '',
            from: nowSiteLocal,
            to: '',
            notificationTime: '',
            siteEngineer: '',
            crosscheckedBy: '',
        };

        // IF switching FROM a non-Live status, we fetch the existing open record
        if (currentStatus !== 'Live') {
            try {
                const { data: activeRecord, error } = await supabase
                    .from('downtime_records')
                    .select('*')
                    .eq('wallfolder', sensor.wallfolder_id)
                    .is('to', null) // Check where 'to' is null (active)
                    .order('from', { ascending: false })
                    .limit(1)
                    .single();

                if (activeRecord && !error) {
                    setActiveDowntimeId(activeRecord.id); // capture ID for update
                    initialForm = {
                        Type: targetStatus,
                        reason: activeRecord.reason || 'Radar System Issue',
                        action: activeRecord.action || 'Check Fuel',
                        notes: activeRecord.notes || '',
                        from: formatForInput(activeRecord.from), // Fill existing start time
                        to: newStatus === 'Live' ? nowSiteLocal : '', // Pre-fill end time if going Live
                        notificationTime: formatForInput(activeRecord.notification_time),
                        siteEngineer: activeRecord.site_engineer || '',
                        crosscheckedBy: activeRecord.crosschecked_by || ''
                    };
                    if (activeRecord.crosschecked_by) setSelectedCrosschecker(activeRecord.crosschecked_by);
                }
            } catch (err) {
                console.error("Error fetching active downtime:", err);
            }
        }

        setFormData(initialForm);
        setIsModalOpen(true);
    };

    const handleSubmit = async () => {
        setLoading(true);
        try {
            // --- A. Logic for DQP Values ---
            let snapshot = null;

            // Get the latest DQP Record ID for this Wallfolder
            const { data: dqpRecord, error: dqpError } = await supabase
                .from('dqp_records')
                .select('id')
                .eq('wall_folder_id', sensor.wallfolder_id)
                .order('created_time', { ascending: false })
                .limit(1)
                .single();

            if (dqpError && dqpError.code !== 'PGRST116') throw dqpError;

            if (dqpRecord) {
                const targetParamIds = [1, 2, 9];
                // If going TO Link Down (and we are creating a NEW entry or updating to it)
                if (targetStatus === 'Link Down') {
                    // Fetch current values
                    const { data: currentValues } = await supabase
                        .from('dqp_values')
                        .select('*')
                        .eq('dqp_record_id', dqpRecord.id)
                        .in('parameter_id', targetParamIds);

                    // Only take a snapshot if one doesn't exist (creating new) 
                    // or if explicitly overwriting (logic depends on your preference, usually on creation)
                    if (!activeDowntimeId) {
                        snapshot = currentValues;
                    }

                    const cleanReason = formData.reason.toLowerCase();

                    await supabase
                        .from('dqp_values')
                        .update({ value: 'Critical', notes: `Link down due to ${cleanReason}` })
                        .eq('dqp_record_id', dqpRecord.id)
                        .in('parameter_id', targetParamIds);

                } else if (targetStatus === 'Live') {
                    // RESTORE VALUES
                    // If we have an active ID, we fetch that specific record's snapshot.
                    // If not (fallback), we search for the last Link Down record.

                    let recordToRestoreFrom = null;

                    if (activeDowntimeId) {
                        const { data } = await supabase
                            .from('downtime_records')
                            .select('snapshot')
                            .eq('id', activeDowntimeId)
                            .single();
                        recordToRestoreFrom = data;
                    } else {
                        // Fallback logic (your original logic)
                        const { data } = await supabase
                            .from('downtime_records')
                            .select('snapshot')
                            .eq('wallfolder', sensor.wallfolder_id)
                            .eq('type', 'Link Down')
                            .order('created_at', { ascending: false })
                            .limit(1)
                            .single();
                        recordToRestoreFrom = data;
                    }

                    if (recordToRestoreFrom?.snapshot) {
                        const restorePromises = recordToRestoreFrom.snapshot.map(item =>
                            supabase
                                .from('dqp_values')
                                // The snapshot is a `select('*')` of the row, so it
                                // already carries both figure arrays — restore them
                                // together or the CHECK constraint rejects the write.
                                .update({
                                    value: item.value,
                                    notes: item.notes,
                                    appendix: item.appendix,
                                    image: item.image ?? null,
                                    caption: item.caption ?? null,
                                    image_ids: item.image_ids ?? [],
                                    image_captions: item.image_captions ?? [],
                                })
                                .eq('id', item.id)
                        );
                        await Promise.all(restorePromises);
                    }
                }
            }

            // --- B. Submit or Update Downtime Record ---

            const utcFrom = formData.from ? toUTC(formData.from, timezone) : null;
            const utcTo = formData.to ? toUTC(formData.to, timezone) : null;
            const utcNotify = formData.notificationTime ? toUTC(formData.notificationTime, timezone) : null;
            const submissionTime = new Date().toISOString();

            // --- B. Submit Logic ---

            // Scenario 1: Switching from one Down status to another (e.g., Lost -> Link Down)
            if (activeDowntimeId && targetStatus !== 'Live' && targetStatus !== localStatus) {

                // Step 1: Close the OLD record (using the new 'from' time as the old 'to' time)
                const { error: closeError } = await supabase
                    .from('downtime_records')
                    .update({ to: utcFrom }) // The old failure ends when the new one starts
                    .eq('id', activeDowntimeId);

                if (closeError) throw closeError;

                // Step 2: Insert the NEW record
                const { error: insertError } = await supabase
                    .from('downtime_records')
                    .insert([{
                        wallfolder: sensor.wallfolder_id,
                        type: targetStatus, // New Status
                        reason: formData.reason,
                        action: formData.action,
                        notes: formData.notes,
                        from: utcFrom, // Starts at the user selected time
                        to: null, // Still active
                        detected_by: userID,
                        crosschecked_by: selectedCrosschecker || null,
                        notification_time: utcNotify,
                        site_engineer: formData.siteEngineer,
                        submission: submissionTime,
                        // snapshot: snapshot // Include snapshot if your logic generated one
                    }]);

                if (insertError) throw insertError;

            }
            // Scenario 2: Going Live (Closing an active record)
            else if (targetStatus === 'Live' && activeDowntimeId) {
                const { error: updateError } = await supabase
                    .from('downtime_records')
                    .update({
                        to: utcTo || submissionTime // Ensure we have a closing time
                    })
                    .eq('id', activeDowntimeId);

                if (updateError) throw updateError;
            }
            // Scenario 3: Editing an existing record (No status change) or Creating brand new from Live
            else {
                // Prepare standard payload
                const payload = {
                    wallfolder: sensor.wallfolder_id,
                    type: targetStatus,
                    reason: formData.reason,
                    action: formData.action,
                    notes: formData.notes,
                    from: utcFrom,
                    to: targetStatus === 'Live' ? (utcTo || submissionTime) : null,
                    detected_by: userID,
                    crosschecked_by: selectedCrosschecker || null,
                    notification_time: targetStatus === 'Live' ? null : utcNotify,
                    site_engineer: targetStatus === 'Live' ? null : formData.siteEngineer,
                };

                // Add snapshot if it exists (from your DQP logic)
                if (typeof snapshot !== 'undefined' && snapshot) {
                    payload.snapshot = snapshot;
                }

                if (activeDowntimeId) {
                    // Update existing (Edit mode)
                    const { error: updateError } = await supabase
                        .from('downtime_records')
                        .update(payload)
                        .eq('id', activeDowntimeId);
                    if (updateError) throw updateError;
                } else {
                    // Insert new (Coming from Live)
                    const { error: insertError } = await supabase
                        .from('downtime_records')
                        .insert([{ ...payload, submission: submissionTime }]);
                    if (insertError) throw insertError;
                }
            }

            // --- C. Update Radar Wall Folders ---
            const { error: wallError } = await supabase
                .from('radar_wall_folders')
                .update({ type: targetStatus })
                .eq('id', sensor.wallfolder_id);

            if (wallError) throw wallError;

            // --- D. INSERT WORK LOG (New) ---
            try {

                // 2. Prepare Log Payload
                const workLogPayload = {
                    created_at: new Date().toISOString(),
                    subject: `${targetStatus === 'Live' ? 1 : 3}`, // Fixed ID as requested
                    wallfolder: sensor.wallfolder_id,
                    location: sensor.area,
                    category: `${targetStatus === 'Live' ? 'restored' : 'downtime'}`,
                    action: `${targetStatus === 'Live' ? 'No action required' : formData.action}`, // Added 'Batch Insert' as the action name
                    notes: `${targetStatus === 'Live' ? 'Connection restored' : targetStatus} record have been submitted`,
                    submitted_by: userID
                };

                // 3. Insert Log (Non-blocking: if log fails, we still consider the import a success)
                const { error: logError } = await supabase.from('work_log').insert([workLogPayload]);
                if (logError) console.error("Work Log Insert Failed:", logError);

            } catch (logErr) {
                console.warn("Failed to create work log, but alarms were saved.", logErr);
            }

            // [NEW] Update UI Immediately
            // Wait for DB triggers/views to update before fetching
            lastEditTimeRef.current = Date.now();

            // 2. Optimistic UI Update (Do this BEFORE fetching)
            // This ensures the numbers flip instantly, even if "Lost Connection" is selected.
            setLocalStatus(targetStatus);

            if (targetStatus === 'Live') {
                setLocalQuality('Optimal');
                setLocalScore(1);
            } else {
                // Covers 'Link Down', 'Lost Connection', 'Maintenance', etc.
                setLocalQuality('Critical');
                setLocalScore(0);
            }

            // 3. Update DQP Table (This is fast)
            await fetchDataQuality();

            // 4. Background Verification (Optional but good for consistency)
            // We let this run in the background. If it finds new data, it will refine the score,
            // but the user already sees the correct "Critical/0%" status from Step 2.
            const verifyBackend = async () => {
                let attempts = 0;
                while (attempts < 3) {
                    await new Promise(r => setTimeout(r, 1000)); // Wait 1s between checks

                    const { data, error } = await supabase
                        .from('latest_radar_wall_folders')
                        .select('quality, normalised_score, type')
                        .eq('wallfolder_id', sensor.wallfolder_id)
                        .single();

                    if (data && data.type === targetStatus) {
                        // Backend has caught up, sync exact values
                        setLocalQuality(data.quality);
                        setLocalScore(data.normalised_score);
                        break;
                    }
                    attempts++;
                }
            };

            // Trigger background verification without awaiting it to block the UI closing
            verifyBackend();

            // 5. Success & Close
            toast.success('Status updated successfully');
            setIsModalOpen(false);

            if (onUpdateComplete) onUpdateComplete();

            openOutlookDraft(emailSubject, emailBody, siteName, "DTG Engineers");

        } catch (error) {
            console.error('Error updating status:', error);
            toast.error('Failed to update status. Check console.');
        } finally {
            setLoading(false);
        }
    };

    /**
     * The site-wide modal has already written its downtime records. All that is
     * left here is the header: flip it optimistically, but only if the sensor on
     * screen was one of the ones ticked — the analyst may well have unticked it.
     *
     * Not called for Scheduled Offline, which writes nothing.
     */
    const handleSiteWideSubmitted = async (status, submittedIds = []) => {
        const includesThisSensor = submittedIds.some(
            (id) => String(id) === String(sensor.wallfolder_id)
        );

        if (includesThisSensor) {
            lastEditTimeRef.current = Date.now();
            setLocalStatus(status);
            setLocalQuality('Critical');
            setLocalScore(0);
            await fetchDataQuality();
        }

        if (onUpdateComplete) onUpdateComplete();
        if (onRefresh) await onRefresh();
    };

    const checkAndFetchFeedbackItems = async (item, newValue) => {
        try {
            // Ensure we have regions to check against
            if (!sharedRegions || sharedRegions.length === 0) return false;

            const regionIds = sharedRegions.map(r => r.id);

            // Fetch 'Awaiting Feedback' items linked to the current regions
            const { data, error } = await supabase
                .from('alarm_improvement')
                .select(`
                *,
                alarm_records!inner (
                    alarm_region
                )
            `)
                .eq('improvement_status', 'Awaiting Feedback')
                // This 'in' filter combined with the !inner join ensures we only get 
                // improvements related to the current wall folder's regions
                .in('alarm_records.alarm_region', regionIds);

            if (error) {
                console.error("Error checking feedback items:", error);
                return false; // Fail safe: proceed with update if DB errors
            }

            if (data && data.length > 0) {
                // FOUND RECORDS: Open the specific Feedback Modal
                setFeedbackModalData(data);
                setPendingOptimalUpdate({ item, newValue }); // Save intent to update later
                setIsFeedbackModalOpen(true);
                return true; // We interrupted the flow
            }

            return false; // No records found, proceed as normal
        } catch (err) {
            console.error("Unexpected error in feedback check:", err);
            return false;
        }
    };

    const handleFeedbackSubmit = async (itemData) => {
        const itemIds = Object.keys(itemData);

        // 1. Process the individual ticket updates
        if (itemIds.length > 0) {
            try {
                // Create an array of update promises so they run concurrently
                const updatePromises = itemIds.map(id => {
                    const { status, site_engineer } = itemData[id];
                    return supabase // Using your browser client here
                        .from('alarm_improvement')
                        .update({
                            improvement_status: status,
                            site_action: new Date().toISOString(),
                            site_engineer: status === 'Modified' ? site_engineer : ""
                        })
                        .eq('id', id);
                });

                // Wait for all updates to finish
                const results = await Promise.all(updatePromises);

                // Check if any of the individual updates threw an error
                const failures = results.filter(result => result.error);
                if (failures.length > 0) {
                    console.error("Supabase Update Errors:", failures.map(f => f.error));
                    throw new Error(`Failed to update ${failures.length} tickets. Check console for details.`);
                }

            } catch (error) {
                console.error("Failed to update feedback items:", error);
                toast.error("Failed to update feedback tickets. Update paused.");
                return; // Halt the DQP update if the database update fails
            }
        }

        // 2. Resume the original DQP update to 'Optimal'
        if (pendingOptimalUpdate) {
            const { item, newValue } = pendingOptimalUpdate;
            const weight = item.parameter?.weight || item.parameters?.weight || 1;
            const newNumeric = calculateNumericScore(newValue, weight);

            await executeDirectUpdate(item, 'value', newValue, newNumeric);
        }

        // --- D. INSERT WORK LOG (New) ---
        try {

            // 2. Prepare Log Payload
            const workLogPayload = {
                created_at: new Date().toISOString(),
                subject: 1, // Fixed ID as requested
                wallfolder: sensor.wallfolder_id,
                location: sensor.area,
                category: `dqp`,
                action: `No action required`, // Added 'Batch Insert' as the action name
                notes: `Alarm improvement record have been updated`,
                submitted_by: userID
            };

            // 3. Insert Log (Non-blocking: if log fails, we still consider the import a success)
            const { error: logError } = await supabase.from('work_log').insert([workLogPayload]);
            if (logError) console.error("Work Log Insert Failed:", logError);

        } catch (logErr) {
            console.warn("Failed to create work log, but alarms were saved.", logErr);
        }

        // 3. Clean up the state
        setIsFeedbackModalOpen(false);
        setPendingOptimalUpdate(null);
        setFeedbackModalData([]);
    };

    const handleFeedbackCancel = () => {
        // Just close the modal and wipe the pending intent
        setIsFeedbackModalOpen(false);
        setPendingOptimalUpdate(null);
        setFeedbackModalData([]);
    };

    // --- Rainfall → Refractivity flow ---
    // Called by DeformationTab after a Rainfall Event record is saved.
    // Re-fetches DQP data fresh from the DB (resolving dqp_record_id if not on the sensor prop),
    // then finds Atmospheric Refractivity and opens the dedicated rainfall ActionRequiredModal
    // pre-set to Sub-Optimal / Service Impacted.
    // Tolerant match — the DB parameter name is "Atmospheric Refractivity",
    // but we match on any row whose name contains "refractivity" so a minor
    // naming difference never silently breaks the flow.
    const isRefractivityRow = (row) =>
        row?.parameter?.name?.toLowerCase().includes('refractivity');

    const handleRainfallSaved = useCallback(async () => {
        console.log('[Rainfall→Refractivity] handler fired. dqpList rows:', dqpList.length);
        try {
            // Step 1: Prefer the DQP data already loaded in state (no extra round-trip).
            // If dqpList is loaded at all, sensor.dqp_record_id is guaranteed present,
            // which is exactly what the eventual update write relies on.
            let refractivityItem = dqpList.find(isRefractivityRow);

            // Step 2: Fallback — dqpList not loaded yet, fetch fresh.
            if (!refractivityItem) {
                console.warn('[Rainfall→Refractivity] not in dqpList, fetching fresh…');

                let dqpRecordId = sensor?.dqp_record_id;
                if (!dqpRecordId) {
                    const { data: rec } = await supabase
                        .from('dqp_records')
                        .select('id')
                        .eq('wall_folder_id', sensor.wallfolder_id)
                        .order('created_time', { ascending: false })
                        .limit(1)
                        .single();
                    dqpRecordId = rec?.id;
                }

                if (dqpRecordId) {
                    // Ensure we have parameter definitions to resolve names.
                    let localParamMap = parameterMap;
                    if (Object.keys(localParamMap).length === 0) {
                        const { data: paramData } = await supabase
                            .from('parameters')
                            .select('id, name, parent_id, level, weight');
                        if (paramData) {
                            localParamMap = {};
                            paramData.forEach((p) => { localParamMap[p.id] = p; });
                            setParameterMap(localParamMap);
                        }
                    }

                    const { data: valuesData } = await supabase
                        .from('dqp_values')
                        .select('value, value_numeric, notes, parameter_id, appendix, caption')
                        .eq('dqp_record_id', dqpRecordId)
                        .order('parameter_id', { ascending: true });

                    const freshList = (valuesData || []).map((item) => {
                        const paramDef = localParamMap[item.parameter_id];
                        return {
                            ...item,
                            value: item.value || 'N/A',
                            parameter: {
                                ...paramDef,
                                parent: paramDef?.parent_id ? localParamMap[paramDef.parent_id] : null,
                            },
                        };
                    });

                    if (freshList.length) setDqpList(freshList);
                    refractivityItem = freshList.find(isRefractivityRow);
                }
            }

            if (!refractivityItem) {
                console.warn('[Rainfall→Refractivity] Refractivity parameter not found for this radar.');
                toast.error(
                    'Rainfall saved, but the Atmospheric Refractivity parameter was not found for this radar. Update DQP manually.'
                );
                return;
            }

            // Step 3: Open the dedicated rainfall ActionRequiredModal
            // (preset to Sub-Optimal / Service Impacted). The actual DQP write
            // happens when the user submits the modal (handleModalSubmit).
            console.log('[Rainfall→Refractivity] opening modal for:', refractivityItem.parameter?.name);
            setRainfallPendingUpdate({ item: refractivityItem, field: 'value', newValue: 'Sub-Optimal' });
            setIsRainfallModalOpen(true);
        } catch (err) {
            console.error('[Rainfall→Refractivity] handler error:', err);
            toast.error('Rainfall saved, but failed to open the DQP modal. Update DQP manually.');
        }
    }, [dqpList, sensor?.dqp_record_id, sensor?.wallfolder_id, parameterMap]);

    const calculateNumericScore = (status, weight = 1) => {
        switch (status) {
            case 'Optimal':
            case 'N/A': return 1 * weight;
            case 'Acceptable': return 0.5 * weight;
            case 'Sub-Optimal': return 0.25 * weight;
            case 'Critical': return -1 * weight;
            default: return 0;
        }
    };

    const handleStatusRequest = async (item, field, newValue) => {
        // 1. If updating NOTES, just do it.
        if (field === 'notes') {
            executeDirectUpdate(item, field, newValue);
            return;
        }

        // --- [NEW] EXCEPTION FOR PARAMETERS 20 & 21 ---
        const isAlarmParam = item.parameter?.id === 20 || item.parameter?.id === 21 || item.parameter_id === 20 || item.parameter_id === 21;
        const isTurningOptimal = newValue === 'Optimal';
        // Check if "Previous Value" was NOT Optimal and NOT N/A (meaning it was likely Action Req/Improvement Req)
        const wasNotOptimal = item.value !== 'Optimal' && item.value !== 'N/A';

        if (isAlarmParam && isTurningOptimal && wasNotOptimal) {
            // We need to check for pending improvements before allowing this update
            const hasPendingFeedback = await checkAndFetchFeedbackItems(item, newValue);

            if (hasPendingFeedback) {
                // Stop here. The modal opening logic is handled inside the helper function.
                return;
            }
            // If false, we fall through to the standard logic below
        }
        // ----------------------------------------------

        // --- [NEW] EXCEPTION FOR PARAMETERS 22-26 (Weather Recovery) ---
        const paramId = item.parameter?.id || item.parameter_id;
        const isWeatherParam = paramId >= 22 && paramId <= 26;

        if (isWeatherParam && isTurningOptimal && wasNotOptimal) {
            const notesLower = (item.notes || '').toLowerCase();
            const hasWeatherNotes = notesLower.includes('weather') || notesLower.includes('atmospheric') || notesLower.includes('rainfall');

            if (hasWeatherNotes) {
                const cleanSensorName = `${sensor.radar_number} - ${sensor.site_name}`;
                const emailSiteName = `"${sensor.site_name} [All]"` || "Unknown Site";

                const subject = `Service Operating Normally on ${cleanSensorName}`;
                const body = `Dear All,\n\nPlease be advised that the data quality on ${cleanSensorName} is now reliable for monitoring.\n\nWe will continue to monitor the system and will notify you if any new risks are detected.\n\n\nKind regards,\n${userName}`;

                openOutlookDraft(subject, body, emailSiteName, "DTG Engineers");
            }
        }
        // ---------------------------------------------------------------

        // 2. If setting status to Optimal/N/A (Standard Path), skip modal, calculate score.
        if (newValue === 'Optimal' || newValue === 'N/A') {
            const weight = item.parameter?.weight || item.parameters?.weight || 1;
            const newNumeric = calculateNumericScore(newValue, weight);

            executeDirectUpdate(item, 'value', newValue, newNumeric);
            return;
        }

        // 3. Otherwise (Setting to Improvement Required/Action Required), open the DQP modal
        setPendingUpdate({ item, field, newValue });
        setIsDQPModalOpen(true);
    };

    const executeDirectUpdate = async (item, field, newValue, newNumericValue = null) => {
        const oldList = [...dqpList];

        // 1. Optimistic Update
        const updatedList = dqpList.map(row =>
            row.parameter_id === item.parameter_id
                ? {
                    ...row,
                    [field]: newValue,
                    // Only update numeric if it was passed (i.e. we are updating status, not notes)
                    ...(newNumericValue !== null && { value_numeric: newNumericValue }),
                    ...(field === 'value' && { notes: null, appendix: null, ...CLEARED_DQP_IMAGES, images: [] })
                }
                : row
        );
        setDqpList(updatedList);

        try {
            // 2. Send to Supabase
            const additionalPayload = field === 'value' ? { notes: null, appendix: null, ...CLEARED_DQP_IMAGES } : {};
            await updateSupabaseDqp(item, field, newValue, additionalPayload);

            // [NEW] Work Log for Direct Updates
            if (field === 'value') {
                const workLogPayload = {
                    created_at: new Date().toISOString(),
                    subject: 1,
                    wallfolder: sensor.wallfolder_id,
                    location: sensor.area,
                    category: 'dqp',
                    action: 'No action required',
                    notes: `${item.parameter?.name || 'Parameter'} has been updated to ${newValue}`,
                    submitted_by: userID
                };
                const { error: logError } = await supabase.from('work_log').insert([workLogPayload]);
                if (logError) console.error("Work Log Insert Failed:", logError);
            }

            toast.success("Saved!");
        } catch (error) {
            console.error("Update failed", error);
            setDqpList(oldList); // Revert on failure
        }
    };

    // 2. Create the "Courier" function
    // This function will be called by the Child
    // Inside DqpPage.jsx
    const handleRegionsLoaded = useCallback((regionsFromChild) => {
        // Optional: Standardize the keys if the RPC names are different
        const formattedRegions = regionsFromChild.map(r => ({
            id: r.alarm_region_id,   // Adjust based on your actual RPC column name
            name: r.name,
            type: r.alarmtype
        }));

        setSharedRegions(formattedRegions);
    }, []);

    // 3. Modal Submission Handler (The complex one)
    const handleModalSubmit = async (formData, item, targetStatus) => {
        setIsDQPModalOpen(false); // Close immediately
        const oldList = [...dqpList];

        // Calculate score
        const weight = item.parameter?.weight || item.parameters?.weight || 1;
        const newNumeric = calculateNumericScore(targetStatus, weight);

        // 1. Optimistic Update
        const updatedList = dqpList.map(row =>
            row.parameter_id === item.parameter_id
                ? { ...row, value: targetStatus, value_numeric: newNumeric, notes: formData.notes }
                : row
        );
        setDqpList(updatedList);
        try {
            const isAlarmItem = item.parameter?.id === 20 || item.parameter?.id === 21;
            const rowsToInsert = [];

            if (isAlarmItem) {
                // Common data for all rows
                const basePayload = {
                    recommendation_submission: new Date().toISOString(),
                    improvement_status: "Awaiting Feedback",
                    type: formData.subject,
                    issue: formData.issue,
                    action: formData.action,
                    alarm_mask: formData.alarmMask || null, // Only relevant for ID 21
                };

                // --- BRANCH A: ALARM ITEMS (Multi-row logic) ---
                if (formData.alarmRegions.length > 0) {

                    // Run queries in PARALLEL for speed
                    const lookupPromises = formData.alarmRegions.map(async (regionId) => {
                        const { data } = await supabase
                            .from('alarm_records')
                            .select('id')
                            .eq('alarm_region', regionId) // Check THIS specific region
                            .order('created_at', { ascending: false })
                            .limit(1)
                            .maybeSingle();
                        // Return the ID if found, otherwise null
                        return data ? data.id : null;
                    });

                    // Wait for all checks to fini
                    const foundRecordIds = await Promise.all(lookupPromises);
                    // Build insert rows only for the ones that were found
                    foundRecordIds.forEach((recordId) => {
                        if (recordId) {
                            rowsToInsert.push({
                                ...basePayload,
                                alarm_record: recordId, // Link to the specific record found
                            });
                        }
                    });
                    if (rowsToInsert.length === 0) {
                        console.warn("Selected regions have no matching alarm_records. Skipping insert as requested.");
                    }
                }
            }

            // 2. Perform Batch Insert (if we have rows)
            if (rowsToInsert.length > 0) {
                const { error: insertError } = await supabase
                    .from('alarm_improvement')
                    .insert(rowsToInsert); // Supabase accepts an array for batch insert
                if (insertError) throw insertError;
            }

            // --- Handle File Uploads ---
            // Every uploaded file is kept. This loop used to assign a single
            // `uploadedImageId`, so a multi-file upload stored a client_images
            // row per file but pointed dqp_values at only the last one — the
            // rest stayed in Storage with nothing referencing them.
            const uploadedImages = [];
            if (formData.files && formData.files.length > 0) {
                const clientId = sensor.site_id || userSite?.site?.id;
                const bucket = 'Radar';

                for (const entry of formData.files) {
                    // The modal now hands over { file, caption }; tolerate a bare
                    // File so any other caller keeps working.
                    const file = entry?.file ?? entry;
                    const caption = entry?.caption ?? '';
                    const fileName = `${clientId}/${new Date().toISOString().split('T')[0]}_${file.name}`;

                    const { error: uploadError } = await supabase.storage
                        .from(bucket)
                        .upload(fileName, file, {
                            cacheControl: '3600',
                            upsert: false
                        });

                    if (uploadError) {
                        console.error("Upload failed:", uploadError);
                        continue;
                    }

                    const { data: imgData, error: dbError } = await supabase
                        .from('client_images')
                        .insert({
                            client_id: clientId,
                            image_url: fileName,
                            type: 'radar',
                            category: 'dqp',
                            uploaded_at: new Date().toISOString(),
                            uploadedby: userName,
                            size: (file.size / (1024 * 1024)).toFixed(2) + ' MB',
                            date: new Date().toISOString().split('T')[0],
                            subcategory: item.parameter?.name || null,
                        })
                        .select('id')
                        .single();

                    if (!dbError && imgData) {
                        uploadedImages.push({ id: imgData.id, caption });
                    }
                }
            }

            // 3. FINAL STEP: Update the DQP table with Status AND Score
            // We reuse the same supabase helper to ensure consistency
            const additionalPayload = { notes: formData.notes };
            // Uploading REPLACES the row's figures rather than appending, matching
            // how notes and appendix are replaced: the modal files one action plan
            // per status change, and figures carried over from a previous incident
            // would be captioned against notes that no longer describe them.
            if (uploadedImages.length) {
                Object.assign(additionalPayload, buildDqpImagePayload(uploadedImages));
            }
            if (formData.appendix) {
                additionalPayload.appendix = formData.appendix;
            }

            await updateSupabaseDqp(item, 'value', targetStatus, additionalPayload);

            // [NEW] Work Log for Modal Updates
            const isRelocation = formData.subject === 'DSRA Relocation';
            const logSubject = isRelocation ? 1 : 2;
            const logAction = logSubject === 2 ? formData.action : null;
            const dqpEmailPrefix = isRelocation ? "NOTIFICATION ONLY" : "ACTION REQUIRED";
            const dqpEmailSubject = `[${dqpEmailPrefix}] ${formData.subject} on ${cleanSensor}`;
            const dqpEmailBody = generateEmailBodyDQP(formData, cleanSensor, userName, crosscheckerName, sharedRegions);

            const workLogPayload = {
                created_at: new Date().toISOString(),
                subject: logSubject,
                wallfolder: sensor.wallfolder_id,
                location: sensor.area,
                category: 'dqp',
                action: logAction,
                notes: `${item.parameter?.name || 'Parameter'} has been updated to ${targetStatus}`,
                submitted_by: userID
            };
            const { error: logError } = await supabase.from('work_log').insert([workLogPayload]);
            if (logError) console.error("Work Log Insert Failed:", logError);

            toast.success("Success! Improvement record saved and DQP updated.");
            openOutlookDraft(dqpEmailSubject, dqpEmailBody, siteName, "DTG Engineers");

        } catch (error) {
            console.error("Submission failed", error);
            setDqpList(oldList);
            toast.error("Failed to save improvement record.");
        }

    };

    // Helper to keep code DRY
    const updateSupabaseDqp = async (item, field, value, additionalPayload = {}) => {
        // 1. Prepare the payload
        const payload = { [field]: value };

        // Merge additional payload if provided (e.g. notes)
        if (additionalPayload && typeof additionalPayload === 'object') {
            Object.assign(payload, additionalPayload);
        }

        // 2. If changing the STATUS ('value'), we MUST recalculate the numeric score
        if (field === 'value') {
            const score = calculateNumericScore(value);
            // Ensure we have a weight (default to 0 if missing to prevent NaN)
            const weight = parseFloat(item.parameter?.weight || item.parameters?.weight || 0);

            // Apply your formula: Score * Weight
            payload.value_numeric = score * weight;
        }

        // 3. Send update to Supabase
        // This updates the CHILD (Level 2). The Postgres Trigger will handle the rest.
        const { error } = await supabase
            .from('dqp_values')
            .update(payload)
            .eq('dqp_record_id', sensor.dqp_record_id)
            .eq('parameter_id', item.parameter_id);

        if (error) {
            console.error("Error updating DQP:", error);
            throw error;
        }

        // 4. Wait for the Trigger (The "Hack")
        // Triggers are fast, but not instant. 200ms is usually safe, 
        // but if your server is under load, you might need 500ms.
        await new Promise(resolve => setTimeout(resolve, 200));

        // 5. Fetch fresh data (UI Refresh)
        await fetchDataQuality();
    };

    // Close menu when clicking outside
    useEffect(() => {
        function handleClickOutside(event) {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                setShowWrenchMenu(false);
                setIsCreating(false);
            };
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [menuRef]);


    // --- 3. Filtering Logic ---
    const filteredDeformation = useMemo(() => {
        return deformationList.filter(d => {
            const lowerSearch = searchDeformation.toLowerCase();
            return (
                d.location?.toLowerCase().includes(lowerSearch) ||
                d.def_type?.toLowerCase().includes(lowerSearch) ||
                d.tarp_level?.toLowerCase().includes(lowerSearch) ||
                d.reported_by?.toLowerCase().includes(lowerSearch)
            );
        })
    }, [deformationList, searchDeformation]);

    const overallColConfig = getOverallColor(localStatus, localQuality, riskInfo.label, riskInfo.colour);

    // --- Email ---
    const siteName = `"${sensor.site_name} [All]"` || "Unknown Site";
    const cleanSensor = `${sensor.radar_number} - ${sensor.site_name}`;
    const crosscheckerName = selectedCrosschecker ? `& ${selectedCrosschecker.full_name}` : "";
    const logDetails = getWorkLogDetails(targetStatus, formData.notificationTime);
    const emailSubject = `[${logDetails.subject}] ${targetStatus !== "Live" ? targetStatus : ""} on ${cleanSensor}`;
    const emailBody = generateEmailBodyOthers(formData, targetStatus, cleanSensor, userName, crosscheckerName);


    return (
        <div className="fixed inset-0 bg-[var(--dtg-bg-primary)]/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">            <Toaster position="top-center" reverseOrder={false} />
            <div className="bg-[var(--dtg-bg-primary)] rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col border border-[var(--dtg-border-medium)]"
                onClick={(e) => e.stopPropagation()}>

                {/* --- HEADER SECTION --- */}
                <div className={`bg-gradient-to-r ${overallColConfig.bgGradient} border-b border-[var(--dtg-border-medium)] p-6`}>
                    <div className="flex items-start justify-between mb-4">
                        <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                                <div className={`w-2 h-12 rounded-full bg-${overallColConfig.bg}`} />

                                {/* Title and WallFolder Logic */}
                                <div>
                                    <h1 className="text-3xl text-[var(--dtg-text-primary)] font-bold">
                                        {sensor.radar_number} - {sensor.area}, {sensor.site_name}
                                    </h1>

                                    <div className="flex gap-2 items-center mt-1 relative">

                                        {/* INLINE EDIT MODE */}
                                        {isRenaming ? (
                                            <div className="flex items-center gap-2 bg-white/10 p-1 rounded">
                                                <input
                                                    autoFocus
                                                    className="bg-transparent border-b border-white text-sm text-[var(--dtg-text-primary)] outline-none w-48"
                                                    value={renameInput}
                                                    onChange={(e) => setRenameInput(e.target.value)}
                                                />
                                                <button onClick={handleSaveRename} className="p-1 hover:bg-green-500/20 rounded text-green-400">
                                                    <Check size={14} />
                                                </button>
                                                <button onClick={() => setIsRenaming(false)} className="p-1 hover:bg-red-500/20 rounded text-red-400">
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        ) : (
                                            // NORMAL VIEW
                                            <p className="text-[var(--dtg-gray-500)] text-sm">
                                                {currentFolderName}
                                            </p>
                                        )}

                                        {/* WRENCH ICON & POPOVER */}
                                        <div className="relative" ref={menuRef}>
                                            <Wrench
                                                className={`w-4 h-4 cursor-pointer transition-colors ${showWrenchMenu ? 'text-[var(--dtg-brand-orange)]' : 'text-[var(--dtg-gray-500)] hover:text-[var(--dtg-text-primary)]'}`}
                                                onClick={() => setShowWrenchMenu(!showWrenchMenu)}
                                            />

                                            {/* THE POPOVER MENU */}
                                            {showWrenchMenu && (
                                                <div className="absolute top-6 left-0 w-64 bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] shadow-xl rounded-lg z-50 p-2 flex flex-col gap-1">

                                                    {!isCreating ? (
                                                        // DEFAULT MENU
                                                        <>
                                                            <button
                                                                onClick={() => { setIsRenaming(true); setShowWrenchMenu(false); }}
                                                                className="flex items-center gap-2 text-left px-3 py-2 hover:bg-[var(--dtg-bg-primary)] rounded text-sm text-[var(--dtg-text-primary)]"
                                                            >
                                                                <span>Rename Current</span>
                                                            </button>
                                                            <button
                                                                onClick={() => setIsCreating(true)}
                                                                className="flex items-center gap-2 text-left px-3 py-2 hover:bg-[var(--dtg-bg-primary)] rounded text-sm text-[var(--dtg-text-primary)]"
                                                            >
                                                                <Plus size={14} />
                                                                <span>Add New Wallfolder</span>
                                                            </button>
                                                        </>
                                                    ) : (
                                                        // ADD NEW FOLDER FORM
                                                        <div className="p-2 bg-[var(--dtg-bg-primary)]/50 rounded animate-in fade-in zoom-in-95 duration-200">
                                                            {/* FOLDER NAME INPUT */}
                                                            <div className="mb-2">
                                                                <label className="text-xs font-semibold text-[var(--dtg-gray-500)] mb-1 block">
                                                                    New Folder Name
                                                                </label>
                                                                <input
                                                                    className="w-full bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded p-1.5 text-sm text-[var(--dtg-text-primary)] outline-none focus:border-[var(--dtg-brand-orange)]"
                                                                    placeholder="e.g. Stage 8 East"
                                                                    value={newFolderInput}
                                                                    onChange={(e) => setNewFolderInput(e.target.value)}
                                                                    autoFocus
                                                                />
                                                            </div>

                                                            {/* AREA INPUT (NEW) */}
                                                            <div className="mb-3">
                                                                <label className="text-xs font-semibold text-[var(--dtg-gray-500)] mb-1 block">
                                                                    Area
                                                                </label>
                                                                <input
                                                                    className="w-full bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded p-1.5 text-sm text-[var(--dtg-text-primary)] outline-none focus:border-[var(--dtg-brand-orange)]"
                                                                    placeholder="e.g. Open Pit"
                                                                    value={newAreaInput}
                                                                    onChange={(e) => setNewAreaInput(e.target.value)}
                                                                />
                                                            </div>

                                                            {/* SAME/OVERLAY LOCATION — clusters this folder with the
                                                                current one in the comprehensive report (same wall);
                                                                leave unchecked when re-aiming at a different location. */}
                                                            <label className="mb-3 flex items-start gap-2 cursor-pointer">
                                                                <input
                                                                    type="checkbox"
                                                                    className="mt-0.5 accent-[var(--dtg-brand-orange)]"
                                                                    checked={sameLocation}
                                                                    onChange={(e) => setSameLocation(e.target.checked)}
                                                                />
                                                                <span className="text-xs text-[var(--dtg-text-primary)] leading-tight">
                                                                    Same / overlay with previous location
                                                                    <span className="block text-[10px] text-[var(--dtg-gray-500)]">
                                                                        Reports group both folders as one wall.
                                                                    </span>
                                                                </span>
                                                            </label>

                                                            <div className="flex justify-end gap-2">
                                                                <button
                                                                    onClick={() => { setIsCreating(false); setSameLocation(false); }}
                                                                    className="text-xs text-[var(--dtg-gray-500)] hover:text-[var(--dtg-text-primary)]"
                                                                >
                                                                    Back
                                                                </button>
                                                                <Button
                                                                    onClick={handleCreateFolder}
                                                                    variant="brand"
                                                                    size="sm"
                                                                    className="h-7 text-xs"
                                                                >
                                                                    Create
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-white/10 rounded-lg transition-all"
                        >
                            <X className="w-6 h-6 text-[var(--dtg-gray-500)] hover:text-[var(--dtg-text-primary)]" />
                        </button>
                    </div>

                    {/* Report Metadata */}
                    <div className="grid grid-cols-4 gap-4">
                        <div className="bg-[var(--dtg-bg-card)]/50 rounded-lg p-3 border border-[var(--dtg-border-medium)]">
                            <div className="flex items-center gap-2 text-[var(--dtg-gray-500)] text-sm mb-1">
                                <Calendar className="w-4 h-4" />
                                <span>Latest Check</span>
                            </div>
                            <p className="text-[var(--dtg-text-primary)] text-sm py-1.5"><LocalTime utcTime={sensor.created_time} format="full" /></p>
                        </div>
                        <div className="bg-[var(--dtg-bg-card)]/50 rounded-lg p-3 border border-[var(--dtg-border-medium)]">
                            <div className="flex items-center gap-2 text-[var(--dtg-gray-500)] text-sm mb-1">
                                <ListChecks className="w-4 h-4" />
                                <span>Data Quality</span>
                            </div>
                            <div className="flex justify-between align-baseline">
                                <p className={`text-${getRiskColor(localQuality)} text-sm py-1.5`}>{localQuality}</p> {/* Assuming localQuality is a string like "Optimal" */}
                                <p className={`text-${getRiskColor(localQuality)} text-sm py-1.5`}>{(localScore * 100)?.toFixed(2)}%</p>
                            </div>
                        </div>
                        <div className="bg-[var(--dtg-bg-card)]/50 rounded-lg p-3 border border-[var(--dtg-border-medium)]">
                            <div className="flex items-center gap-2 text-[var(--dtg-gray-500)] text-sm mb-1">
                                <Wifi className="w-4 h-4" />
                                <span>Status</span>
                            </div>
                            {/* --- The Trigger Dropdown --- */}
                            <select
                                value={localStatus}
                                onChange={handleStatusChange}
                                className={`py-1.5 text-sm text-${getStatusColor(localStatus)} bg-[var(--dtg-bg-card)] outline-none border-none w-full cursor-pointer`}
                            >
                                <option value="Live" className="text-[var(--dtg-text-primary)]">Live</option>
                                <option value="Link Down" className="text-[var(--dtg-text-primary)]">Link Down</option>
                                <option value="Lost Connection" className="text-[var(--dtg-text-primary)]">Lost Connection</option>
                                {/* Notification only — never becomes the sensor's status, so it
                                    is listed but the select never settles on it. */}
                                <option value="Scheduled Offline" className="text-[var(--dtg-text-primary)]">Scheduled Offline</option>
                            </select>

                            {/* --- The Modal --- */}
                            {isModalOpen && (
                                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                                    <div className="bg-[var(--dtg-bg-card)] p-6 rounded-lg w-[500px] border border-gray-700 shadow-xl text-[var(--dtg-text-primary)]">
                                        <h2 className="text-xl font-bold mb-4 border-b border-gray-600 pb-2">
                                            {activeDowntimeId ? 'Update Status to: ' : 'Change Status to: '}
                                            <span className={`text-${getStatusColor(targetStatus)}`}>{targetStatus}</span>
                                        </h2>

                                        <div className="space-y-3">

                                            {/* Reason & Action (Row) */}
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-xs text-gray-400">Reason</label>
                                                    <select
                                                        className="w-full bg-[var(--dtg-bg-card)] border border-gray-600 p-2 rounded text-sm"
                                                        value={formData.reason}
                                                        onChange={e => setFormData({ ...formData, reason: e.target.value })}
                                                    >
                                                        {['Radar System Issue', 'Maintenance', 'Relocation', 'Connection', 'PMP Issue'].map(o => <option key={o} value={o}>{o}</option>)}
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="block text-xs text-gray-400">Action</label>
                                                    <select
                                                        className="w-full bg-[var(--dtg-bg-card)] border border-gray-600 p-2 rounded text-sm"
                                                        value={formData.action}
                                                        onChange={e => setFormData({ ...formData, action: e.target.value })}
                                                    >
                                                        {['Check Fuel', 'Check Connection', 'Site Action', 'Reboot PMP', 'Other'].map(o => <option key={o} value={o}>{o}</option>)}
                                                    </select>
                                                </div>
                                            </div>

                                            {/* CONDITIONAL FIELDS: Only if NOT Live */}

                                            <div className="grid grid-cols-2 gap-4">
                                                {/* From Time */}
                                                {targetStatus !== 'Live' && (
                                                    <>
                                                        <div>
                                                            <label className="block text-xs text-gray-400">From</label>
                                                            <input
                                                                type="datetime-local"
                                                                className="w-full bg-gray-800 border border-gray-600 p-2 rounded text-sm text-white"
                                                                value={formData.from}
                                                                onChange={e => setFormData({ ...formData, from: e.target.value })}
                                                            />
                                                        </div>
                                                    </>
                                                )}
                                                {/* To Time */}
                                                {targetStatus === 'Live' && (
                                                    <>
                                                        <div>
                                                            <label className="block text-xs text-gray-400">To (Est)</label>
                                                            <input
                                                                type="datetime-local"
                                                                className="w-full bg-gray-800 border border-gray-600 p-2 rounded text-sm text-white"
                                                                value={formData.to}
                                                                onChange={e => setFormData({ ...formData, to: e.target.value })}
                                                            />
                                                        </div>
                                                    </>
                                                )}
                                            </div>

                                            {targetStatus !== 'Live' && (
                                                <>
                                                    <div className="grid grid-cols-2 gap-4">
                                                        <div>
                                                            <label className="block text-xs text-gray-400">Notification Time</label>
                                                            <input
                                                                type="datetime-local"
                                                                className="w-full bg-gray-800 border border-gray-600 p-2 rounded text-sm text-white"
                                                                value={formData.notificationTime}
                                                                onChange={e => setFormData({ ...formData, notificationTime: e.target.value })}
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="block text-xs text-gray-400">Site Engineer</label>
                                                            <input
                                                                type="text"
                                                                className="w-full bg-gray-800 border border-gray-600 p-2 rounded text-sm"
                                                                value={formData.siteEngineer}
                                                                onChange={e => setFormData({ ...formData, siteEngineer: e.target.value })}
                                                            />
                                                        </div>
                                                    </div>
                                                </>
                                            )}


                                            {/* Notes */}
                                            {targetStatus !== 'Live' && (
                                                <>
                                                    <div>
                                                        <label className="block text-xs text-gray-400">Notes</label>
                                                        <textarea
                                                            className="w-full bg-gray-800 border border-gray-600 p-2 rounded text-sm h-20"
                                                            value={formData.notes}
                                                            onChange={e => setFormData({ ...formData, notes: e.target.value })}
                                                        />
                                                    </div>

                                                    {/* Crosschecked By (Static) */}
                                                    <div>
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
                                                </>
                                            )}
                                        </div>

                                        {/* Buttons */}
                                        <div className="flex justify-end gap-3 mt-6">
                                            <button
                                                onClick={() => setIsModalOpen(false)}
                                                className="px-4 py-2 text-sm text-gray-300 hover:text-white"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                onClick={handleSubmit}
                                                disabled={loading}
                                                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded shadow-md disabled:opacity-50"
                                            >
                                                {loading ? 'Processing...' : (activeDowntimeId ? 'Update' : 'Submit')}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="bg-[var(--dtg-bg-card)]/50 rounded-lg p-3 border border-[var(--dtg-border-medium)]">
                            <div className="flex items-center gap-2 text-[var(--dtg-gray-500)] text-sm mb-1">
                                <TriangleAlert className="w-4 h-4" />
                                <span>Risk</span>
                            </div>
                            {/* The label only. The driving record's TARP level belongs on the
                                record, in the deformation list — printing it here put "TARP 3"
                                beside a risk line whose whole point is that its site does not
                                quote TARP numbers. */}
                            <div className="py-1.5">
                                <span className={`px-2 py-0.5 rounded text-sm border ${getBandColor(riskInfo.colour)}`}>
                                    {riskInfo.label}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* --- CONTENT BODY --- */}
                <div className="flex-1 overflow-y-auto p-6 bg-[var(--dtg-bg-primary)]">
                    {isLoading ? <PageLoader /> : (
                        <div className="max-w-5xl mx-auto">
                            {/* Tab headers (Requirement 1) */}
                            <Tab_Container activeTab={activeTab} onTabChange={setActiveTab} />

                            {/* Active tab content panel */}
                            <div className="mt-4 bg-[var(--dtg-bg-card)] rounded-lg border border-[var(--dtg-border-medium)] min-h-[300px]">
                                {activeTab === 'deformation' && (
                                    <DeformationTab
                                        sensor={sensor}
                                        timezone={timezone}
                                        crosscheckers={crosscheckers}
                                        userSite={userSite}
                                        alarmRegions={sharedRegions}
                                        activeTab={activeTab}
                                        onRainfallSaved={handleRainfallSaved}
                                    />
                                )}

                                {activeTab === 'alarm' && (
                                    <AlarmTab
                                        sensor={sensor}
                                        shift={shift}
                                        timezone={timezone}
                                        crosscheckers={crosscheckers}
                                        userSite={userSite}
                                        userID={userID}
                                        onRegionsLoaded={handleRegionsLoaded}
                                        activeTab={activeTab}
                                    />
                                )}

                                {activeTab === 'dqp' && (
                                    <DQPTab
                                        dqpList={dqpList}
                                        onUpdate={handleStatusRequest}
                                        isDQPModalOpen={isDQPModalOpen}
                                        pendingUpdate={pendingUpdate}
                                        onDQPModalClose={() => {
                                            setIsDQPModalOpen(false);
                                            setDqpModalDefaultSubject(null);
                                        }}
                                        onDQPModalSubmit={handleModalSubmit}
                                        sharedRegions={sharedRegions}
                                        isFeedbackModalOpen={isFeedbackModalOpen}
                                        feedbackModalData={feedbackModalData}
                                        onFeedbackSubmit={handleFeedbackSubmit}
                                        onFeedbackCancel={handleFeedbackCancel}
                                        sensor={sensor}
                                        dqpModalDefaultSubject={dqpModalDefaultSubject}
                                    />
                                )}

                                {activeTab === 'downtime' && (
                                    <DowntimeTab
                                        sensor={sensor}
                                        timezone={timezone}
                                        crosscheckers={crosscheckers}
                                        activeTab={activeTab}
                                    />
                                )}

                                {activeTab === 'tarp' && (
                                    <TarpTab
                                        sensor={sensor}
                                        userSite={userSite}
                                        activeTab={activeTab}
                                    />
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="border-t border-[var(--dtg-border-medium)] p-4 bg-[var(--dtg-bg-card)]/50">
                    <div className="flex items-center justify-between">
                        <div className="text-sm text-[var(--dtg-gray-500)]">
                            <span>Document ID: <LocalTime utcTime={now} format="telfer_report" /> Daily Report of {sensor.radar_number} - {sensor.site_name}</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <Button variant="brand" onClick={() => setShowReportModal(true)}><Download className="w-4 h-4 mr-2" /> Generate PDF</Button>
                        </div>
                        {showReportModal &&
                            <ReportTemplateModal onClose={() => setShowReportModal(false)} radarData={dqpList} sensor={{ ...sensor, wallfoldername: currentFolderName }} />}
                    </div>
                </div>
            </div>

            {/* Rainfall → Refractivity: dedicated ActionRequiredModal rendered at SensorDetail level
                so it is reachable from the Deformation tab (not gated by activeTab === 'dqp').
                Uses separate state from the DQP tab modal to avoid any cross-tab interference. */}
            <ActionRequiredModal
                isOpen={isRainfallModalOpen}
                onClose={() => {
                    setIsRainfallModalOpen(false);
                    setRainfallPendingUpdate(null);
                }}
                onSubmit={(formData, item, targetStatus) => {
                    setIsRainfallModalOpen(false);
                    setRainfallPendingUpdate(null);
                    handleModalSubmit(formData, item, targetStatus);
                }}
                item={rainfallPendingUpdate?.item}
                targetStatus={rainfallPendingUpdate?.newValue}
                alarmRegions={sharedRegions}
                defaultSubject="Service Impacted"
            />

            {/* Lost Connection / Scheduled Offline — raised against every sensor on
                the site the analyst ticks. */}
            <SiteWideStatusModal
                isOpen={Boolean(siteWideStatus)}
                status={siteWideStatus}
                sensor={sensor}
                timezone={timezone}
                crosscheckers={crosscheckers}
                userID={userID}
                userName={userName}
                onClose={() => setSiteWideStatus(null)}
                onSubmitted={handleSiteWideSubmitted}
            />
        </div >
    )
}

export default SensorDetail;