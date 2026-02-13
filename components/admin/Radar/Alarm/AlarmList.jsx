import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/lib/supabaseClient"; // Adjust path as needed
import { getAlarmStatusColors } from "@/config/statusConfig"; // Adjust path as needed
import { Button } from "@/components/LandingPage/ui/button";
import { Input } from "@/components/LandingPage/ui/input";
import { Search, Trash2, CirclePlus } from 'lucide-react';
import AddAlarmForm from "./AddAlarmForm";
import { BatchAlarmImport } from "./BatchAlarmImport";

const AlarmList = ({
    sensor,
    shift,
    timezone,
    userID,
    crosscheckers,
    onBatchInsertClick,
    isExpanded,
    onClose,
    onRegionsLoaded
}) => {
    // ---state---
    const [alarmRegionList, setAlarmRegionList] = useState([]);
    const [isLoading, setIsLoading] = useState(false);

    // Alarm Records
    const [viewMode, setViewMode] = useState('list');
    const [isAddingAlarm, setIsAddingAlarm] = useState(false);
    const [selectedRegion, setSelectedRegion] = useState(null);

    // --- Alarm Management States ---
    const [showAddAlarmRegion, setShowAddAlarmRegion] = useState(false);
    const [showRegionMenu, setShowRegionMenu] = useState(false);
    const [isEditingRegion, setIsEditingRegion] = useState(false);

    // Alarm Region for inputs
    const [newRegionInput, setNewRegionInput] = useState("");
    const [newTypeInput, setNewTypeInput] = useState("");

    // Search
    const [searchAlarmRegion, setSearchAlarmRegion] = useState('');

    const alarmRegionMenuRef = useRef(null);

    const fetchAlarmRegions = useCallback(async () => {
        // specific check to ensure we have the ID before fetching
        if (!sensor?.wallfolder_id) return;

        try {
            const { data, error } = await supabase
                .rpc('get_alarm_stats_by_shift', {
                    _wallfolder_id: sensor.wallfolder_id,
                    _shift: shift,
                    _user_timezone: 'Asia/Jakarta'  // UTC+7
                });

            if (error) throw error;
            const regions = data || []; // Safety check
            setAlarmRegionList(regions);

            // --- NEW CODE: PASS DATA UP TO PARENT ---
            if (onRegionsLoaded) {
                onRegionsLoaded(regions);
            }
            // ----------------------------------------

            console.log(regions);
        } catch (error) {
            console.error('Error fetching alarm region list:', error);
        }
    }, [sensor?.wallfolder_id, shift, onRegionsLoaded]);

    useEffect(() => {
        fetchAlarmRegions();
    }, [fetchAlarmRegions]);

    // Handle Delete (RPC Call)
    const handleDeleteAlarmRegion = async (regionID) => {
        if (!window.confirm("Are you sure you want to delete this region?")) return;
        const { error } = await supabase
            .from('alarm_regions')
            .update({ isactive: 'Inactive' })
            .eq('id', regionID);

        if (!error) {
            await fetchAlarmRegions();
        } else {
            alert("Error deleting alarm region");
            console.error(error);
        }
    };


    // Handle Create New (RPC Call)
    const handleNewAlarmRegion = async () => {
        if (!newTypeInput || !newRegionInput) {
            alert("Please enter both Alarm Type and Region");
            return;
        }

        const { data, error } = await supabase
            .rpc('add_alarm_regions', {
                _wallfolder_id: sensor.wallfolder_id, // Ensure this matches your radar ID type (int vs uuid)
                _name: newRegionInput,
                _type: newTypeInput   // <--- Passed here
            });

        if (!error) {
            alert(`Alarm "${newRegionInput}" region created successfully!`);
            setNewRegionInput("");
            setNewTypeInput(""); // Reset area
            setShowAddAlarmRegion(false);

            await fetchAlarmRegions();
        } else {
            console.error(error);
            alert("Error adding region. Check console.");
        }
    };

    // Close menu when clicking outside
    useEffect(() => {
        function handleClickOutside(event) {

            if (alarmRegionMenuRef.current && !alarmRegionMenuRef.current.contains(event.target)) {
                setShowAddAlarmRegion(false);
                setShowRegionMenu(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [alarmRegionMenuRef]);

    const filteredAlarmRegions = useMemo(() => {
        return alarmRegionList.filter(ar =>
            ar.name?.toLowerCase().includes(searchAlarmRegion.toLowerCase()))
    }, [alarmRegionList, searchAlarmRegion]);


    const renderList = () => {
        if (alarmRegionList.length === 0) return <div className="text-sm text-gray-500 mt-4">No alarm region set on this radar.</div>;

        return (
            <>
                <div className="sticky top-0 z-10 flex bg-[var(--dtg-bg-card)] items-center gap-4 justify-between p-2 text-sm text-gray-400 border-b border-[var(--dtg-border-medium)]">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[var(--dtg-gray-500)]" />
                        <Input
                            value={searchAlarmRegion}
                            onChange={(e) => setSearchAlarmRegion(e.target.value)}
                            placeholder="Search alarm regions..."
                            className="pl-10 bg-[var(--dtg-bg-card)] border-none outline-none text-[var(--dtg-text-primary)]"
                        />
                    </div>
                    <p>Valid / Total</p>
                </div>
                <div className="max-h-[20vh] overflow-y-auto flex flex-col gap-2 p-2">
                    {filteredAlarmRegions.map((item, index) => {
                        const totalAlarms = item.total_count;
                        const percentageValid = totalAlarms > 0 ? (item.valid_count / totalAlarms * 100).toFixed(2) : 0;
                        return (
                            <div key={index}>
                                <div className={`flex justify-between mb-2 text-${totalAlarms > 0 ? 'white' : 'gray-500'}`}>
                                    <div className="flex gap-3 items-center text-sm">
                                        <span className={`w-3 h-3 rounded-xl ${getAlarmStatusColors(item.priority)}`}></span>
                                        <strong>{item.name}</strong>
                                        {isEditingRegion ? (
                                            <button onClick={() => handleDeleteAlarmRegion(item.alarm_region_id)} className="p-1 hover:text-red-400 rounded text-gray-400">
                                                <Trash2 size={14} />
                                            </button>
                                        ) : (
                                            <button onClick={() => { setIsAddingAlarm(true); setSelectedRegion({ id: item.alarm_region_id, name: item.name }) }} className="p-1 hover:text-green-400 rounded text-gray-400">
                                                <CirclePlus size={14} />
                                            </button>
                                        )}
                                    </div>
                                    <p className="text-xs">{item.valid_count} / <strong>{totalAlarms}</strong></p>
                                </div>
                                <div className="w-full h-2 bg-[var(--dtg-gray-200)] rounded-full overflow-hidden">
                                    <div className={`h-full ${getAlarmStatusColors(item.priority)} transition-all duration-500 ease-out rounded-full`}
                                        style={{ width: `${percentageValid}%` }}>
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </>
        );
    };

    // 2. Main Render Content Switcher
    const renderContent = () => {
        if (viewMode === 'import') {
            return (
                <div className="h-[600px] p-4">
                    <BatchAlarmImport
                        wallFolderId={sensor.wallfolder_id}
                        existingRegions={alarmRegionList}
                        clientTimezone={timezone}
                        userSiteId={userID}
                        onClose={() => setViewMode('list')}
                        onSuccess={() => {
                            fetchAlarmRegions();
                            setViewMode('list');
                        }}
                    />
                </div>
            );
        }

        if (isAddingAlarm) {
            return (
                <AddAlarmForm
                    selectedRegion={selectedRegion}
                    wallFolderId={sensor.wallfolder_id}
                    clientTimezone={timezone}
                    crosscheckers={crosscheckers}
                    userSite={userID}
                    onClose={() => { setSelectedRegion(null); setIsAddingAlarm(false); fetchAlarmRegions() }}
                    onSuccess={() => { console.log("Record added!"); }}
                />
            );
        }

        return renderList();
    };

    return (
        <div className="flex flex-col w-full min-h-[200px] gap-2 text-[var(--dtg-text-primary)]">
            {/* Header */}
            <div className="flex w-full justify-between border-b border-[var(--dtg-border-medium)] mb-4 pb-2">
                <h2 className="text-xl">Alarm</h2>
                <div className="flex gap-2 text-sm">

                    {/* Popover Menu for Edit/Add Region */}
                    <div className="relative" ref={alarmRegionMenuRef}>
                        <Button
                            variant='outline'
                            onClick={() => { setShowRegionMenu(!showRegionMenu); setIsEditingRegion(false) }}
                        >{isEditingRegion ? 'Cancel' : 'Edit Region'}</Button>

                        {showRegionMenu &&
                            <div className="absolute top-10 right-0 w-64 bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] shadow-xl rounded-lg z-50 p-2 flex flex-col gap-1">
                                {!showAddAlarmRegion ? (
                                    <>
                                        <button onClick={() => { setShowAddAlarmRegion(true) }} className="flex items-center gap-2 text-left px-3 py-2 hover:bg-[var(--dtg-bg-primary)] rounded text-sm text-[var(--dtg-text-primary)]">
                                            <span>Add New Region</span>
                                        </button>
                                        <button onClick={() => { setIsEditingRegion(true); setShowRegionMenu(false) }} className="flex items-center gap-2 text-left px-3 py-2 hover:bg-[var(--dtg-bg-primary)] rounded text-sm text-[var(--dtg-text-primary)]">
                                            <span>Delete Alarm Region</span>
                                        </button>
                                    </>
                                ) : (
                                    <div className="p-2 bg-[var(--dtg-bg-primary)] rounded animate-in fade-in zoom-in-95 duration-200">
                                        <div className="mb-2">
                                            <label className="text-xs font-semibold text-[var(--dtg-gray-500)] mb-1 block">New Alarm Type</label>
                                            <select value={newTypeInput} onChange={(e) => setNewTypeInput(e.target.value)} className="py-1.5 text-sm text-[var(--dtg-text-primary)] bg-[var(--dtg-bg-card)] outline-none border border-[var(--dtg-border-medium)] rounded w-full">
                                                <option value=""></option>
                                                <option value="Red">Red</option>
                                                <option value="Orange">Orange</option>
                                                <option value="Yellow">Yellow</option>
                                                <option value="Purple">Purple</option>
                                                <option value="Blue">Blue</option>
                                            </select>
                                        </div>
                                        <div className="mb-3">
                                            <label className="text-xs font-semibold text-[var(--dtg-gray-500)] mb-1 block">New Alarm Region Name</label>
                                            <input className="w-full bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded p-1.5 text-sm text-[var(--dtg-text-primary)] outline-none focus:border-[var(--dtg-brand-orange)]"
                                                placeholder="e.g. Open Pit"
                                                value={newRegionInput}
                                                onChange={(e) => setNewRegionInput(e.target.value)}
                                            />
                                        </div>
                                        <div className="flex justify-end gap-2">
                                            <Button onClick={handleNewAlarmRegion} variant="brand" size="sm" className="h-7 text-xs">Add</Button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        }
                    </div>

                    {/* Batch Insert Toggle */}

                    {!isExpanded ? (
                        <Button
                            className='text-sm'
                            variant='orange'
                            onClick={() => { onBatchInsertClick(), setViewMode('import') }}
                        >Batch Input
                        </Button>) : (
                        <Button
                            className='text-sm'
                            variant='orange'
                            onClick={() => { onClose(), setViewMode('list') }}
                        >
                            ← View List
                        </Button>
                    )}
                </div>
            </div>

            {/* Dynamic Body */}
            {renderContent()}
        </div>
    );
};

export default AlarmList;