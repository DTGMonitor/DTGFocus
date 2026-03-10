import { useState, useEffect, useMemo, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"; // Verify your UI path
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { getSubjectOptions } from "@/config/formConfig";
import { Upload, Loader, AlertCircle, X, FileText, Image as ImageIcon } from 'lucide-react';
import toast, { Toaster } from 'react-hot-toast';

export const ActionRequiredModal = ({ isOpen, onClose, onSubmit, item, targetStatus, alarmRegions = [] }) => {
    const [formData, setFormData] = useState({
        subject: "",
        issue: "",
        action: "",
        alarmRegions: [], // Array of IDs
        notes: "",
        tempnotes: "",
        alarmMask: "",
        appendix: ""
    });

    const isAlarmItem = item?.parameter?.id === 20 || item?.parameter?.id === 21;
    const isMaskItem = item?.parameter?.id === 21;
    const [isDragging, setIsDragging] = useState(false);
    const [needImage, setNeedImage] = useState(false);
    const [needAppendix, setNeedAppendix] = useState(false);
    const [files, setFiles] = useState([]);
    const filesRef = useRef([]);

    // Keep ref in sync for cleanup
    useEffect(() => {
        filesRef.current = files;
    }, [files]);

    // Cleanup previews on unmount
    useEffect(() => {
        return () => {
            filesRef.current.forEach(file => URL.revokeObjectURL(file.preview));
        };
    }, []);

    const subjectOptions = useMemo(() => {
        return getSubjectOptions(item?.parameter);
    }, [item]);

    const handleSubjectChange = (selectedValue) => {
        // Find the full object from the config
        const selectedOption = subjectOptions.find(opt => opt.value === selectedValue);

        setFormData({
            ...formData,
            subject: selectedValue,
            // If the config has an issue/action, use it. Otherwise, keep existing or clear it.
            issue: selectedOption?.issue || "",
            action: selectedOption?.action || "",
            notes: selectedOption?.notes || "",
            tempnotes: selectedOption?.tempnotes || "",
            appendix: selectedOption?.notes || "",
        });
    };

    // Reset form when modal opens
    useEffect(() => {
        if (isOpen && subjectOptions.length === 1) {
            setFormData(prev => ({ ...prev, subject: subjectOptions[0].value, label: subjectOptions[0].label, issue: subjectOptions[0].issue, action: subjectOptions[0].action }));
        }
    }, [isOpen, subjectOptions]);

    const handleRegionToggle = (regionId) => {
        setFormData(prev => {
            const current = prev.alarmRegions;
            if (current.includes(regionId)) {
                return { ...prev, alarmRegions: current.filter(id => id !== regionId) };
            }
            return { ...prev, alarmRegions: [...current, regionId] };
        });
    };

    const addFiles = (newFiles) => {
        const filesWithPreview = newFiles.map(file => Object.assign(file, {
            preview: URL.createObjectURL(file)
        }));
        setFiles(prev => [...prev, ...filesWithPreview]);
    };

    const removeFile = (index) => {
        setFiles(prev => {
            const newFiles = [...prev];
            const removed = newFiles.splice(index, 1)[0];
            URL.revokeObjectURL(removed.preview);
            return newFiles;
        });
    };

    const handleSubmit = () => {
        // Basic validation
        if (!formData.subject || !formData.issue || !formData.action|| !formData.notes) {
            toast.error("Please fill in all general fields.");
            return;
        }
        if (isAlarmItem && formData.alarmRegions.length === 0) {
            toast.error("Please select at least one Alarm Region.");
            return;
        }

        onSubmit({ ...formData, files }, item, targetStatus);
    };

    const handleFileChange = (e) => {
        const selectedFiles = Array.from(e.target.files);
        addFiles(selectedFiles);
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragging(false);
        const droppedFiles = Array.from(e.dataTransfer.files);
        addFiles(droppedFiles);
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}> <Toaster position="top-center" reverseOrder={false} />
            <DialogContent className="sm:max-w-[500px] bg-[var(--dtg-bg-card)] text-[var(--dtg-text-primary)] border-[var(--dtg-border-medium)]">
                <DialogHeader>
                    <DialogTitle>Action Required: {item?.parameter?.name}</DialogTitle>
                    <p className="text-sm text-gray-500">
                        Changing status to <span className="font-bold text-red-500">{targetStatus}</span> requires an action plan.
                    </p>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    {/* --- GENERAL FIELDS --- */}
                    {/* SUBJECT: The Trigger */}
                    <div className="space-y-2">
                        <label>Subject</label>
                        <Select
                            value={formData.subject}
                            onValueChange={handleSubjectChange} // Call our smart handler
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select Subject" />
                            </SelectTrigger>
                            <SelectContent className="py-1.5 text-sm text-[var(--dtg-text-primary)] bg-[var(--dtg-bg-card)] outline-none border border-[var(--dtg-border-medium)] rounded">
                                {subjectOptions.map(opt => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* ISSUE: Auto-filled but editable if empty */}
                    <div className="space-y-2">
                        <label>Issue</label>
                        <div className="p-2 text-sm border border-[var(--dtg-border-medium)] rounded bg-[var(--dtg-bg-card)] min-h-[40px]">
                            {formData.issue || <span className="text-gray-400 italic">Select a subject...</span>}
                        </div>
                    </div>

                    {/* ACTION: Auto-filled, using Textarea for long text */}
                    <div className="space-y-2">
                        <label>Action</label>
                        <Textarea
                            value={formData.action}
                            onChange={(e) => setFormData({ ...formData, action: e.target.value })}
                            className="bg-[var(--dtg-bg-card)] text-[var(--dtg-text-primary)]"
                            placeholder="Action plan will appear here..."
                        />
                    </div>

                    {/* --- SPECIAL LOGIC: ALARMS (ID 20 & 21) --- */}
                    {isAlarmItem && (
                        <div className="border-t border-[var(--dtg-border-medium)] pt-4 mt-2 space-y-4">
                            <h4 className="font-semibold text-sm">Alarm Specifics</h4>

                            {/* Alarm Regions (Multi-Select) */}
                            <div className="space-y-2">
                                <label>Alarm Region(s)</label>
                                <div className="grid grid-cols-2 gap-2 border border-[var(--dtg-border-light)] p-2 rounded max-h-[150px] overflow-y-auto">
                                    {alarmRegions.map((region) => (
                                        <div key={region.id} className="flex items-center space-x-2">
                                            <Checkbox
                                                id={`region-${region.id}`}
                                                checked={formData.alarmRegions.includes(region.id)}
                                                onCheckedChange={() => handleRegionToggle(region.id)}
                                            />
                                            <label htmlFor={`region-${region.id}`} className="text-sm cursor-pointer select-none">
                                                {region.name}
                                            </label>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* --- SPECIAL LOGIC: MASK (ID 21 Only) --- */}
                            {isMaskItem && (
                                <div className="space-y-2">
                                    <label>Alarm Mask</label>
                                    <Input
                                        placeholder="Enter mask details..."
                                        value={formData.alarmMask}
                                        onChange={(e) => setFormData({ ...formData, alarmMask: e.target.value })}
                                    />
                                </div>
                            )}

                        </div>
                    )}

                    <div className="space-y-2">
                        <label>Notes</label>
                        <Input
                            placeholder="Describe the details..."
                            required
                            value={formData.notes}
                            onChange={(e) => setFormData({ ...formData, notes: e.target.value, appendix:e.target.value })}
                        />
                    </div>

                    {/* File Upload Area */}
                    <div className="mb-5">
                        <div className="flex gap-2">
                            <Checkbox
                                checked={needImage}
                                onCheckedChange={() => setNeedImage(!needImage)}
                                className={`w-5 h-5 ${needImage
                                    ? 'border-green-600 hover:border-green-500'
                                    : 'border-gray-600 hover:border-gray-500'
                                    }`}
                            />
                            <label>Image</label>
                        </div>
                        {needImage &&
                            <div>
                                <div className="space-y-3">
                                    <div
                                        className={`
                                    relative border-2 border-dashed rounded-[5px] p-5 text-center bg-[var(--dtg-bg-secondary)] cursor-pointer transition-colors duration-300
                                    ${isDragging ? 'border-teal-500' : 'border-[var(--dtg-border-medium)]'}
                                `}
                                        onDragOver={handleDragOver}
                                        onDragLeave={handleDragLeave}
                                        onDrop={handleDrop}
                                    >
                                        <input
                                            type="file"
                                            multiple
                                            onChange={handleFileChange}
                                            className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
                                        />
                                        <Upload size={32} className="text-[var(--dtg-gray-400)] mb-2.5 mx-auto" />
                                        <p className="text-[var(--dtg-gray-400)] m-0 text-sm">
                                            Click or drag files here
                                        </p>
                                        <p className="text-[var(--dtg-gray-500)] text-xs mt-1">
                                            Supports all image types • Multiple files allowed
                                        </p>
                                    </div>

                                    {files.length > 0 && (
                                        <div className="space-y-2">
                                            {files.map((file, index) => (
                                                <div key={index} className="flex items-center justify-between p-2 bg-[var(--dtg-bg-secondary)] rounded border border-[var(--dtg-border-medium)]">
                                                    <div className="flex items-center gap-3 overflow-hidden">
                                                        <div className="w-10 h-10 rounded overflow-hidden bg-gray-800 flex-shrink-0 border border-[var(--dtg-border-medium)]">
                                                            <img
                                                                src={file.preview}
                                                                alt={file.name}
                                                                className="w-full h-full object-cover"
                                                            />
                                                        </div>
                                                        <div className="flex flex-col min-w-0">
                                                            <span className="text-sm truncate text-[var(--dtg-text-primary)]">{file.name}</span>
                                                            <span className="text-xs text-[var(--dtg-gray-500)]">({(file.size / 1024).toFixed(0)} KB)</span>
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={() => removeFile(index)}
                                                        className="text-[var(--dtg-gray-400)] hover:text-red-500 transition-colors"
                                                    >
                                                        <X size={16} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <Input
                                    placeholder="Input the image caption"
                                    value={formData.caption}
                                    onChange={(e) => setFormData({ ...formData, caption: e.target.value })}
                                />
                            </div>
                        }
                    </div>
                    <div className="mb-5">
                        <div className="flex gap-2">
                            <Checkbox
                                checked={needAppendix}
                                onCheckedChange={() => setNeedAppendix(!needAppendix)}
                                className={`w-5 h-5 ${needAppendix
                                    ? 'border-green-600 hover:border-green-500'
                                    : 'border-gray-600 hover:border-gray-500'
                                    }`}
                            />
                            <label>Appendix</label>
                        </div>
                        {needAppendix &&
                            <div className="space-y-3">
                                <Input
                                    placeholder="Describe the details..."
                                    value={formData.appendix}
                                    onChange={(e) => setFormData({ ...formData, appendix: e.target.value })}
                                />
                            </div>
                        }
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button onClick={handleSubmit}>Submit & Update</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};