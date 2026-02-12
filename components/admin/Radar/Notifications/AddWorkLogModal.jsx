import { useState, useEffect, useMemo, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/LandingPage/ui/dialog"; // Verify your UI path
import { Button } from "@/components/LandingPage/ui/button";
import { Input } from "@/components/LandingPage/ui/input";
import { Textarea } from "@/components/LandingPage/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/LandingPage/ui/select";
import toast, { Toaster } from 'react-hot-toast';
import { supabase } from '@/lib/supabaseClient';

export const AddWorkLog = ({ isOpen, onClose, userID, onSuccess }) => {
    const [formData, setFormData] = useState({
        subject: "",
        type: "",
        location: "",
        category: "",
        action: "",
        notes: ""
    });

    const subjectOptions = [
        { id: 1, label: "NOTIFICATION ONLY" },
        { id: 2, label: "ACTION REQUIRED" },
        { id: 3, label: "SERVICE OFFLINE" },
        { id: 5, label: "MODERATE RISK" },
        { id: 6, label: "CRITICAL" },
        { id: 7, label: "UPDATE" }];

    const typeOptions = [
        { value: 'radar', label: "Radar" },
        { value: 'insar', label: "Insar" },
        { value: 'emesent', label: "Emesent" },
        { value: 'prism', label: "Prism" },
        { value: 'dashboard', label: "Dashboard" },
        { value: 'other', label: "Other" }]

    const handleSubmit = async () => {
            if (!formData.subject || !formData.type || !formData.location || !formData.category) {
                alert("Please fill in all required fields.");
                return;
            }
            try {
                // 2. Prepare Log Payload
                const workLogPayload = {
                    created_at: new Date().toISOString(),
                    subject: formData.subject,
                    type: formData.type,
                    location: formData.location,
                    category: formData.category,
                    action: formData.action,
                    notes: formData.notes,
                    submitted_by: userID
                };

                // 3. Insert Log (Non-blocking: if log fails, we still consider the import a success)
                const { error: logError } = await supabase.from('work_log').insert([workLogPayload]);
                if (logError) throw logError;

                toast.success("Work log saved successfully!");
                if (onSuccess) onSuccess();

            } catch (logErr) {
                console.error("Failed to create work log.", logErr);
                toast.error("Failed to save work log");
            }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <Toaster position="top-center" reverseOrder={false} />
            <DialogContent className="sm:max-w-[500px] bg-[var(--dtg-bg-card)] text-[var(--dtg-text-primary)] border-[var(--dtg-border-medium)]">
                <DialogHeader>
                    <DialogTitle>Work Log Entry</DialogTitle>
                    <p className="text-sm text-gray-500">
                        What else did you do today?
                    </p>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    {/* --- GENERAL FIELDS --- */}
                    {/* SUBJECT: The Trigger */}
                    <div className="space-y-2">
                        <label>Type/Project</label>
                        <Select
                            value={formData.type}
                            onValueChange={(value)=>setFormData({ ...formData, type: value })}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select Type/Project" />
                            </SelectTrigger>
                            <SelectContent className="py-1.5 text-sm text-[var(--dtg-text-primary)] bg-[var(--dtg-bg-card)] outline-none border border-[var(--dtg-border-medium)] rounded">
                                {typeOptions.map((opt) => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <label>Subject</label>
                        <Select
                            value={formData.subject}
                            onValueChange={(value)=>setFormData({ ...formData, subject: value })}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select Subject" />
                            </SelectTrigger>
                            <SelectContent className="py-1.5 text-sm text-[var(--dtg-text-primary)] bg-[var(--dtg-bg-card)] outline-none border border-[var(--dtg-border-medium)] rounded">
                                {subjectOptions.map((opt) => (
                                    <SelectItem key={opt.id} value={opt.id}>
                                        {opt.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* CATEGORY: using Textarea for long text */}
                    <div className="space-y-2">
                        <label>Category</label>
                        <Textarea
                            value={formData.category}
                            onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                            className="bg-[var(--dtg-bg-card)] text-[var(--dtg-text-primary)]"
                            placeholder="Type the category (e.g. deformation, meeting, alarm, etc.)..."
                        />
                    </div>

                    {/* LOCATION: using Textarea for long text */}
                    <div className="space-y-2">
                        <label>Location</label>
                        <Textarea
                            value={formData.location}
                            onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                            className="bg-[var(--dtg-bg-card)] text-[var(--dtg-text-primary)]"
                            placeholder="Type the location..."
                        />
                    </div>

                    {/* ACTION: using Textarea for long text */}
                    <div className="space-y-2">
                        <label>Action</label>
                        <Textarea
                            value={formData.action}
                            onChange={(e) => setFormData({ ...formData, action: e.target.value })}
                            className="bg-[var(--dtg-bg-card)] text-[var(--dtg-text-primary)]"
                            placeholder="Type the action needed..."
                        />
                    </div>

                    <div className="space-y-2">
                        <label>Notes</label>
                        <Input
                            placeholder="Describe the details..."
                            value={formData.notes}
                            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                        />
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