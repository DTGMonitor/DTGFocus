// src/components/AdminUpload.jsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from "@/lib/supabaseClient";
import { useUserSite } from "../../Reusable/useUserSite";
import { createReportRecord } from '../../../src/app/actions/reportActions';
import { Upload, Loader, AlertCircle, X } from 'lucide-react';

const AdminUpload = ({ onClose }) => {  // Add onClose prop
    const { user, userSite, loading: authLoading } = useUserSite();

    const router = useRouter();
    const [uploading, setUploading] = useState(false);
    const [clientsList, setClientsList] = useState([]);
    const [loadingClients, setLoadingClients] = useState(true);

    const userRole = userSite?.role;
    const displayName = userSite?.displayname || user?.email;

    const [formData, setFormData] = useState({
        title: '',
        description: '',
        type: 'insar',
        status: 'Completed',
        generatedBy: '',
        clientId: ''
    });

    const [file, setFile] = useState(null);
    const [isDragging, setIsDragging] = useState(false);

    // Handle ESC key press
    useEffect(() => {
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };

        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [onClose]);

    // Prevent body scroll when modal is open
    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, []);

    // Set Display Name when loaded
    useEffect(() => {
        if (displayName) {
            setFormData(prev => ({ ...prev, generatedBy: displayName }));
        }
    }, [displayName]);

    // Fetch List of Clients for the Dropdown
    useEffect(() => {
        const fetchClients = async () => {
            try {
                const { data, error } = await supabase
                    .from('clients')
                    .select('id, site_name, company')
                    .order('site_name');

                if (error) throw error;
                setClientsList(data || []);
            } catch (error) {
                console.error('Error fetching clients:', error);
            } finally {
                setLoadingClients(false);
            }
        };

        if (user) {
            fetchClients();
        }
    }, [user]);

    // Loading State
    if (authLoading || loadingClients) {
        return (
            <div className="w-full z-[9999] h-full bg-gray-900/40 backdrop-blur-sm fixed top-0 left-0 flex items-center justify-center">
                <div className="p-5 text-[var(--dtg-gray-400)]">Loading permissions and clients...</div>
            </div>
        );
    }

    // Permission Check
    if (!user || !['admin'].includes(userRole)) {
        return (
            <div className="w-full z-[9999] h-full bg-gray-900/40 backdrop-blur-sm fixed top-0 left-0 flex items-center justify-center"
                onClick={onClose}>
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-5 mb-5 max-w-md"
                    onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-2.5 items-center text-yellow-500">
                        <AlertCircle size={20} />
                        <p className="m-0">You don't have permission to upload reports. Contact your administrator.</p>
                    </div>
                    <button 
                        onClick={onClose}
                        className="mt-4 px-4 py-2 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-500 rounded-md w-full transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        );
    }

    const handleFileChange = (e) => {
        const selectedFile = e.target.files[0];
        validateAndSetFile(selectedFile);
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
        const droppedFile = e.dataTransfer.files[0];
        validateAndSetFile(droppedFile);
    };

    const validateAndSetFile = (selectedFile) => {
        if (selectedFile && selectedFile.type === 'application/pdf') {
            setFile(selectedFile);
            const sizeInMB = (selectedFile.size / (1024 * 1024)).toFixed(2);
            setFormData(prev => ({ ...prev, size: `${sizeInMB} MB` }));
        } else {
            alert('Please select a PDF file');
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!formData.clientId) {
            alert('Please select a Client/Site.');
            return;
        }

        if (!file) {
            alert('Please select a file.');
            return;
        }

        setUploading(true);

        try {
            const getUniqueFilename = async (clientId, originalName) => {
                const baseName = originalName.replace(/\.[^/.]+$/, "");
                const ext = originalName.split('.').pop();
                let fileName = `${clientId}/${originalName}`;
                let counter = 1;

                const { data } = await supabase.storage
                    .from('reports')
                    .list(clientId, {
                        search: originalName
                    });

                while (data && data.some(f => f.name === originalName)) {
                    fileName = `${clientId}/${baseName}_${counter}.${ext}`;
                    counter++;
                }

                return fileName;
            };

            const fileName = await getUniqueFilename(formData.clientId, file.name);

            const { error: uploadError } = await supabase.storage
                .from('Reports')
                .upload(fileName, file, {
                    cacheControl: '3600',
                    upsert: false
                });

            if (uploadError) throw uploadError;

            const reportPayload = {
                title: formData.title,
                filename: fileName,
                description: formData.description,
                type: formData.type,
                status: formData.status,
                date: new Date().toISOString().split('T')[0],
                generatedby: formData.generatedBy,
                size: formData.size,
                category: formData.type,
                client_id: formData.clientId
            };

            const result = await createReportRecord(reportPayload);

            if (!result.success) throw new Error(result.error);

            alert('Report uploaded successfully!');

            setFormData({
                title: '',
                description: '',
                type: 'insar',
                status: 'Completed',
                generatedBy: displayName || '',
                clientId: ''
            });
            setFile(null);
            e.target.reset();

            router.refresh();
            onClose(); // Close modal after successful upload

        } catch (error) {
            console.error('Error uploading:', error);
            alert('Error uploading report: ' + error.message);
        } finally {
            setUploading(false);
        }
    };

    const inputClasses = "w-full p-2.5 bg-[var(--dtg-bg-secondary)] border border-[var(--dtg-border-medium)] rounded-[5px] text-[var(--dtg-text-primary)] text-sm outline-none focus:border-teal-500 transition-colors";

    return (
        <div 
            className="w-full z-[9999] h-full bg-gray-900/40 backdrop-blur-sm fixed top-0 left-0 flex items-center justify-center p-5"
            onClick={onClose} // Close when clicking outside
        >
            <div 
                className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-5 shadow-2xl"
                onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside
            >
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-5 gap-2.5 md:gap-0">
                    <h2 className="text-[var(--dtg-text-primary)] m-0 flex items-center gap-2.5 text-lg">
                        <Upload size={24} />
                        Upload New Report
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-[var(--dtg-gray-400)] hover:text-[var(--dtg-text-primary)] transition-colors p-1 rounded hover:bg-[var(--dtg-bg-secondary)]"
                        type="button"
                    >
                        <X size={24} />
                    </button>
                </div>

                <form onSubmit={handleSubmit}>
                    {/* Client Selection */}
                    <div className="mb-4">
                        <label className="text-[var(--dtg-gray-400)] block mb-1 text-sm">Client / Site *</label>
                        <select
                            required
                            value={formData.clientId}
                            onChange={(e) => setFormData({ ...formData, clientId: e.target.value })}
                            className={`${inputClasses} cursor-pointer`}
                        >
                            <option value="">Select a Client</option>
                            {clientsList.map((client) => (
                                <option key={client.id} value={client.id}>
                                    {client.site_name}, {client.company}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="mb-4">
                        <label className="text-[var(--dtg-gray-400)] block mb-1 text-sm">Title *</label>
                        <input
                            type="text"
                            required
                            value={formData.title}
                            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                            placeholder="e.g., Monthly Deformation Analysis"
                            className={inputClasses}
                        />
                    </div>

                    <div className="mb-4">
                        <label className="text-[var(--dtg-gray-400)] block mb-1 text-sm">Description</label>
                        <textarea
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            placeholder="Brief description of the report"
                            rows={3}
                            className={`${inputClasses} resize-y font-inherit`}
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="text-[var(--dtg-gray-400)] block mb-1 text-sm">Type *</label>
                            <select
                                required
                                value={formData.type}
                                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                                className={`${inputClasses} cursor-pointer`}
                            >
                                <option value="insar">InSAR</option>
                                <option value="radar">Radar</option>
                                <option value="prism">PRISM</option>
                                <option value="vwp">VWP</option>
                            </select>
                        </div>

                        <div>
                            <label className="text-[var(--dtg-gray-400)] block mb-1 text-sm">Status *</label>
                            <select
                                required
                                value={formData.status}
                                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                                className={`${inputClasses} cursor-pointer`}
                            >
                                <option value="Completed">Completed</option>
                                <option value="Pending">Pending</option>
                                <option value="Draft">Draft</option>
                            </select>
                        </div>
                    </div>

                    <div className="mb-4">
                        <label className="text-[var(--dtg-gray-400)] block mb-1 text-sm">Generated By *</label>
                        <input
                            type="text"
                            required
                            value={formData.generatedBy}
                            onChange={(e) => setFormData({ ...formData, generatedBy: e.target.value })}
                            placeholder="Your name"
                            className={inputClasses}
                        />
                    </div>

                    <div className="mb-5">
                        <label className="text-[var(--dtg-gray-400)] block mb-1 text-sm">PDF File *</label>
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
                                accept=".pdf"
                                required
                                onChange={handleFileChange}
                                className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
                            />
                            <Upload size={32} className="text-[var(--dtg-gray-400)] mb-2.5 mx-auto" />
                            <p className="text-[var(--dtg-gray-400)] m-0 text-sm">
                                {file ? file.name : "Click or drag PDF file here"}
                            </p>
                            {file && (
                                <p className="text-teal-500 text-xs mt-2.5 m-0">
                                    ✓ {formData.size}
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 p-3 bg-[var(--dtg-bg-secondary)] hover:bg-[var(--dtg-border-medium)] text-[var(--dtg-text-primary)] rounded-[5px] text-sm font-bold transition-colors duration-200"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={uploading}
                            className={`
                                flex-1 p-3 text-white rounded-[5px] text-sm font-bold flex items-center justify-center gap-2.5 transition-colors duration-200
                                ${uploading
                                    ? 'bg-[#525252] cursor-not-allowed'
                                    : 'bg-teal-500 hover:bg-teal-600 cursor-pointer'
                                }
                            `}
                        >
                            {uploading ? (
                                <>
                                    <Loader size={16} className="animate-spin" />
                                    Uploading...
                                </>
                            ) : (
                                <>
                                    <Upload size={16} />
                                    Upload Report
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AdminUpload;