import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const FeedbackModal = ({ isOpen, onClose, data, onSubmit, regions }) => {
    const [itemData, setItemData] = useState({});

    useEffect(() => {
        if (isOpen && data) {
            // Default all items to 'Modified' on load
            const initialData = {};
            data.forEach(item => {
                initialData[item.id] = {
                    status: 'Modified',
                    site_engineer: ''
                };
            });
            setItemData(initialData);
        }
    }, [isOpen, data]);

    if (!isOpen) return null;

    const handleItemChange = (id, field, value) => {
        setItemData(prev => ({
            ...prev,
            [id]: { ...prev[id], [field]: value }
        }));
    };

    const handleSubmit = () => {
        onSubmit(itemData);
    };

    const getRegionName = (item) => {
        const regionId = item.alarm_records?.alarm_region;
        if (!regionId || !regions) return 'Unknown Region';

        const foundRegion = regions.find(r => r.id === regionId);
        return foundRegion ? foundRegion.name : `Region ${regionId}`;
    };

    const getRegionColor = (item) => {
        const regionId = item.alarm_records?.alarm_region;
        if (!regionId || !regions) return 'bg-gray-100 text-gray-800';

        const foundRegion = regions.find(r => r.id === regionId);
        const cleanType = foundRegion?.type?.toLowerCase();

        const colorMap = {
            red: 'bg-red-100 text-red-800',
            orange: 'bg-orange-100 text-orange-800',
            yellow: 'bg-yellow-100 text-yellow-800',
            purple: 'bg-purple-100 text-purple-800',
            blue: 'bg-blue-100 text-blue-800',
        };

        return colorMap[cleanType] || 'bg-gray-100 text-gray-800';
    };


    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--dtg-bg-primary)]/80 backdrop-blur-sm overflow-y-auto">
            <div className="bg-[var(--dtg-bg-card)] text-[var(--dtg-text-primary)] border-[var(--dtg-border-medium)] rounded-lg shadow-xl w-full max-w-2xl p-6 m-4 max-h-[90vh] flex flex-col">

                {/* Header */}
                <div className="mb-4 border-b pb-4">
                    <h2 className="text-xl font-bold text-[var(--dtg-gray-800]">Pending Alarm Improvements</h2>
                    <p className="text-sm text-[var(--dtg-gray-600] mt-1">
                        Setting this parameter to Optimal requires clearing out the following items currently "Awaiting Feedback".
                    </p>
                </div>

                {/* List of pending items */}
                <div className="flex-1 overflow-y-auto mb-4 space-y-3">
                    {data.map((item) => (
                        <div
                            key={item.id}
                            className="flex flex-col p-4 border rounded bg-[var(--dtg-gray-50]"
                        >
                            <div className="flex justify-between items-start mb-3">
                                <div>
                                    <p className="font-semibold text-[var(--dtg-gray-800]">{item.issue || 'Unknown Issue'}</p>
                                    {item.notes && (
                                        <p className="text-sm text-[var(--dtg-gray-500] mt-1 italic">"{item.notes}"</p>
                                    )}
                                </div>
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getRegionColor(item)}`}>
                                    {getRegionName(item)}
                                </span>
                            </div>
                            {/* [NEW] The Status Dropdown */}
                            <div className="mt-2 border-t pt-3">
                                <label className="block text-sm font-medium text-[var(--dtg-gray-700] mb-1">
                                    Resolution Status
                                </label>
                                <Select
                                    value={itemData[item.id]?.status || 'Modified'}
                                    onValueChange={(value) => handleItemChange(item.id, 'status', value)}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select Status" />
                                    </SelectTrigger>
                                    <SelectContent className="py-1.5 text-sm text-[var(--dtg-text-primary)] bg-[var(--dtg-bg-card)] outline-none border border-[var(--dtg-border-medium)] rounded">
                                            <SelectItem value="Modified">Modified</SelectItem>
                                            <SelectItem value="Not Implemented">Not Implemented</SelectItem>                                        
                                    </SelectContent>
                                </Select>
                            </div>
                            {itemData[item.id]?.status === 'Modified' &&
                                <div className="mt-2 border-t pt-3">
                                    <label className="block text-sm font-medium text-[var(--dtg-gray-700] mb-1">
                                        Site Engineer
                                    </label>
                                    <Input
                                        type="text"
                                        placeholder="Site Engineer"
                                        value={itemData[item.id]?.site_engineer || ''}
                                        onChange={(e) => handleItemChange(item.id, 'site_engineer', e.target.value)}
                                    />
                                </div>
                            }
                        </div>
                    ))}
                </div>

                {/* Footer Actions */}
                <div className="flex justify-end space-x-3 pt-4 border-t mt-auto">
                    <Button
                        onClick={onClose}
                        variant='outline'
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        variant='brand'
                    >
                        Submit
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default FeedbackModal;