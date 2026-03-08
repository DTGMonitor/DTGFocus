import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabaseClient";
import { getCardColors, getStatusDotColors } from "@/config/statusConfig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Calendar, Search, Trash2
} from 'lucide-react';
import AddDeformationForm from "./AddDeformationForm";
import toast from "react-hot-toast";

const DeformationList = ({
    sensor,
    alarmRegion=[],
    rawList,
    filtered,
    search,
    onSearchChange,
    userSite,
    crosscheckers,
    onNewRecordClick,
    isExpanded,
    onClose,
    onSuccess
}) => {
    const [viewMode, setViewMode] = useState('list');
    const userID = userSite?.user_id;
    const userName = userSite?.displayname;
    const getDisplayName = (userid) =>
        crosscheckers.find(c => String(c.id) === String(userid))?.full_name
        ;
    const handleDeleteDeformation = async (item) => {
        if (!window.confirm("Are you sure you want to archive this deformation record?")) {
            return;
        }

        try {
            // 1. Archive the record
            const { error } = await supabase
                .from('def_records')
                .update({ isactive: 'No' })
                .eq('id', item.id);

            if (error) {
                throw error;
            }

            // 2. Create work log entry
            const workLogPayload = {
                created_at: new Date().toISOString(),
                subject: 7, 
                wallfolder: sensor.wallfolder_id,
                location: sensor.area,
                category: 'deformation',
                action: 'No action required',
                notes: `${item.def_type} record has been archived`,
                submitted_by: userID
            };

            const { error: logError } = await supabase.from('work_log').insert([workLogPayload]);
            if (logError) {
                console.error("Work Log Insert Failed:", logError);
                toast.error('Record archived, but failed to create log entry.');
            } else {
                toast.success('Deformation record archived.');
            }

            // 3. Refresh UI
            if (onSuccess) {
                onSuccess();
            }
        } catch (error) {
            console.error('Error archiving deformation:', error);
            toast.error('Could not archive the record.');
        }
    };

    const renderList = () => {
        if (rawList.length === 0) return <div className="text-sm text-gray-500 mt-4">No deformation observed on this radar.</div>;

        return (
            <>
                <div className="w-full relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[var(--dtg-gray-500)]" />
                    <Input
                        value={search}
                        onChange={onSearchChange}
                        placeholder="Search deformations..."
                        className="pl-10 bg-[var(--dtg-bg-card)] border-[var(--dtg-border-medium)] text-[var(--dtg-text-primary)]"
                    />
                </div>
                <div className="w-full max-h-[30vh] overflow-y-auto flex flex-col gap-2">
                    {filtered.map((item, index) => (
                        <div key={index} className={`flex justify-between items-center border rounded-lg p-3 ${getCardColors(item.def_type)}`}>
                            <div className="flex flex-col gap-1">
                                <div className="flex gap-3 items-center text-sm">
                                    <span className={`w-4 h-4 rounded-xl ${getStatusDotColors(item.tarp_level)}`}></span>
                                    <p><strong>{item.tarp_level}</strong> | {item.def_type} - {item.location}</p>
                                </div>
                                <div className="flex items-center gap-5 font-light text-xs text-[var(--dtg-text-secondary)]">
                                    <div className="flex items-center gap-1">
                                        <Calendar size={12} />
                                        <span>{new Date(item.created_at).toLocaleString()}</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <span>Reported by: {getDisplayName(item.detected_by)}</span>
                                    </div>
                                </div>
                            </div>
                            <button onClick={() => handleDeleteDeformation(item)} className="p-1 hover:text-red-400 rounded text-gray-400">
                                <Trash2 size={14} />
                            </button>
                        </div>
                    ))}
                </div>
            </>
        );
    };

    const renderContent = () => {
        if (viewMode === 'form')
            return (
                <AddDeformationForm
                    sensor={sensor}
                    alarmRegion={alarmRegion}
                    crosscheckers={crosscheckers}
                    userID={userID}
                    userName={userName}
                    onSuccess={onSuccess}
                    onClose={() => { onClose(), setViewMode('list') }}
                />
            )
        return renderList();
    };

    return (
        <div className="flex flex-col w-full gap-2 text-[var(--dtg-text-primary)]">
            <div className="flex w-full justify-between border-b border-[var(--dtg-border-medium)] mb-4 pb-2">
                <h2 className="text-xl">Deformation</h2>
                {!isExpanded ? (
                    <Button
                        className='text-sm'
                        variant='orange'
                        onClick={() => { onNewRecordClick(), setViewMode('form') }}
                    >+ New Record
                    </Button>) : (
                    <Button
                        className='text-sm'
                        variant='orange'
                        onClick={() => { onClose(), setViewMode('list') }}
                    >
                        ← Back to List
                    </Button>
                )}
            </div>
            {renderContent()}
        </div>)
};

export default DeformationList;