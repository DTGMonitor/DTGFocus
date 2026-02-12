// src/hooks/useStatusLogic.js
import { useState } from 'react';
import { supabase } from "@/lib/supabaseClient";
import { toUTC, fromUTC } from "@/utils/timezoneUtils";
import { getWorkLogDetails, generateEmailBodyOthers } from '../Deformation/formConfig';

export const useStatusLogic = (sensor, timezone, user, onUpdateComplete) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [targetStatus, setTargetStatus] = useState('');
    const [activeDowntimeId, setActiveDowntimeId] = useState(null);

    const [formData, setFormData] = useState({
        reason: 'Radar System Issue',
        action: 'Check Fuel',
        notes: '',
        from: '',
        to: '',
        notificationTime: '',
        siteEngineer: '',
        crosscheckedBy: '',
    });

    // Helper: Format for input
    const formatForInput = (isoString) => isoString ? new Date(isoString).toISOString().slice(0, 16) : '';

    const initiateStatusChange = async (newStatus) => {
        setTargetStatus(newStatus);
        const currentTime = new Date().toISOString().slice(0, 16);

        // Default Form
        let initialForm = {
            ...formData,
            from: fromUTC(currentTime),
            to: newStatus === 'Live' ? currentTime : '',
        };

        // If we aren't currently Live, check for an existing open record to edit
        if (sensor.status !== 'Live') {
            const { data: activeRecord } = await supabase
                .from('downtime_records')
                .select('*')
                .eq('wallfolder', sensor.wallfolder_id)
                .is('to', null)
                .order('from', { ascending: false })
                .limit(1)
                .single();

            if (activeRecord) {
                setActiveDowntimeId(activeRecord.id);
                initialForm = {
                    reason: activeRecord.reason || 'Radar System Issue',
                    action: activeRecord.action || 'Check Fuel',
                    notes: activeRecord.notes || '',
                    from: formatForInput(activeRecord.from),
                    to: newStatus === 'Live' ? currentTime : '',
                    notificationTime: formatForInput(activeRecord.notification_time),
                    siteEngineer: activeRecord.site_engineer || '',
                    crosscheckedBy: activeRecord.crosschecked_by || ''
                };
            } else {
                setActiveDowntimeId(null);
            }
        } else {
            setActiveDowntimeId(null);
        }

        setFormData(initialForm);
        setIsModalOpen(true);
    };

    const submitStatusChange = async () => {
        setLoading(true);
        try {
            const utcFrom = formData.from ? toUTC(formData.from, timezone) : null;
            const utcTo = formData.to ? toUTC(formData.to, timezone) : null;
            const utcNotify = formData.notificationTime ? toUTC(formData.notificationTime, timezone) : null;
            const submissionTime = new Date().toISOString();

            // 1. Snapshot Logic (DQP)
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
                    alert("Error renaming folder");
                }
            };

            const handleCreateFolder = async () => {
                if (!newFolderInput || !newAreaInput) {
                    alert("Please enter both Name and Area");
                    return;
                }
                const { data, error } = await supabase
                    .rpc('create_wall_folder_with_defaults', {
                        _radar_id: sensor.id,
                        _name: newFolderInput,
                        _area: newAreaInput
                    });

                if (!error) {
                    alert(`Folder "${newFolderInput}" created successfully!`);
                    setNewFolderInput("");
                    setNewAreaInput("");
                    setIsCreating(false);
                    setShowWrenchMenu(false);
                    if (onRefresh) await onRefresh();
                } else {
                    console.error(error);
                    alert("Error creating folder. Check console.");
                }
            };


            // 2. Downtime Record Logic
            const payload = {
                wallfolder: sensor.wallfolder_id,
                type: targetStatus,
                reason: formData.reason,
                action: formData.action,
                notes: formData.notes,
                from: utcFrom,
                to: targetStatus === 'Live' ? (utcTo || submissionTime) : null,
                detected_by: user?.user_id,
                crosschecked_by: formData.crosscheckedBy || null,
                notification_time: targetStatus === 'Live' ? null : utcNotify,
                site_engineer: targetStatus === 'Live' ? null : formData.siteEngineer,
                submission: submissionTime,
            };

            // Logic for Insert vs Update (Scenario 1, 2, 3 from your original code)
            if (activeDowntimeId && targetStatus !== 'Live' && targetStatus !== sensor.status) {
                // Scenario 1: Switch (e.g. Lost -> Link Down) - Close old, open new
                await supabase.from('downtime_records').update({ to: utcFrom }).eq('id', activeDowntimeId);
                await supabase.from('downtime_records').insert([payload]);
            }
            else if (targetStatus === 'Live' && activeDowntimeId) {
                // Scenario 2: Close record
                await supabase.from('downtime_records').update({ to: utcTo || submissionTime }).eq('id', activeDowntimeId);
            }
            else if (activeDowntimeId) {
                // Scenario 3: Edit existing
                await supabase.from('downtime_records').update(payload).eq('id', activeDowntimeId);
            } else {
                // New record
                await supabase.from('downtime_records').insert([payload]);
            }

            // 3. Update Wallfolder
            await supabase.from('radar_wall_folders').update({ type: targetStatus }).eq('id', sensor.wallfolder_id);

            // 4. Work Log
            const logDetails = getWorkLogDetails(targetStatus, formData.notificationTime);
            await supabase.from('work_log').insert([{
                created_at: submissionTime,
                subject: logDetails.id,
                wallfolder: sensor.wallfolder_id,
                location: sensor.area, // Assuming area maps to location
                category: 'downtime',
                action: formData.action,
                notes: `${targetStatus} record submitted`
            }]);

            // Success
            setIsModalOpen(false);
            if (onUpdateComplete) onUpdateComplete(targetStatus);

        } catch (error) {
            console.error("Status Update Failed", error);
            alert("Failed to update status");
        } finally {
            setLoading(false);
        }
    };

    return {
        isModalOpen,
        setIsModalOpen,
        loading,
        targetStatus,
        activeDowntimeId,
        formData,
        setFormData,
        initiateStatusChange,
        submitStatusChange
    };
};