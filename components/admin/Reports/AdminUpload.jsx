// src/components/AdminUpload.jsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from "@/lib/supabaseClient";
import { useUserSite } from "../../Reusable/useUserSite";
import { createReportRecord } from '../../../src/app/actions/reportActions';
import { Upload, Loader, AlertCircle, X, FileText, Image as ImageIcon } from 'lucide-react';

const AdminUpload = ({ onClose }) => {
    const { user, userSite, loading: authLoading } = useUserSite();
    const router = useRouter();
    const [uploading, setUploading] = useState(false);
    const [clientsList, setClientsList] = useState([]);
    const [loadingClients, setLoadingClients] = useState(true);

    const userRole = userSite?.role;
    const displayName = userSite?.displayname || user?.email;

    const [files, setFiles] = useState([]);
    const [isDragging, setIsDragging] = useState(false);
    const [selectedClientId, setSelectedClientId] = useState('');

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

    // Parse filename and auto-fill metadata
    const parseFileMetadata = (file) => {
        const filename = file.name;
        const extension = filename.split('.').pop().toLowerCase();
        const sizeInMB = (file.size / (1024 * 1024)).toFixed(2);
        // Parse date from filename format: "YYYY-MM_..." (e.g., "2025-08_...", "2026-01_...")
        const parseDate = (filename) => {
            const dateMatch = filename.match(/^(\d{4})-(\d{2})/);
            if (dateMatch) {
                const year = dateMatch[1];
                const month = dateMatch[2];

                // Get the last day of the month
                const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();

                // Return date in YYYY-MM-DD format (last day of the month)
                return `${year}-${month}-${lastDay.toString().padStart(2, '0')}`;
            }
            return null;
        };

        const imgdate = parseDate(filename);

        // Check if it's a monthly report PDF
        const monthlyReportRegex = /.*_Monthly_Report_.*\.pdf$/i;
        if (monthlyReportRegex.test(filename)) {
            return {
                file: file,
                recordType: 'reports',
                bucket: 'Reports',
                metadata: {
                    title: 'Monthly Deformation Report',
                    description: 'InSAR ground displacement monitoring',
                    type: 'insar',
                    status: 'Completed',
                    generatedby: 'Catalyst',
                    category: 'deformation',
                    size: `${sizeInMB} MB`,
                    filename: filename
                }
            };
        }

        // Check if it's an image with MNDWI, False Color, or True Color
        const imageKeywords = [
            { keyword: 'MNDWI', subcategory: 'MNDWI' },
            { keyword: 'False Color', subcategory: 'False Color' },
            { keyword: 'True Color', subcategory: 'True Color' }
        ];

        const matchedKeyword = imageKeywords.find(item => filename.includes(item.keyword));
        const isSpecialImage = extension === 'png' && matchedKeyword;

        if (isSpecialImage) {
            const metadata = {
                type: 'insar',
                category: 'waterbody',
                subcategory: matchedKeyword.subcategory,
                size: `${sizeInMB} MB`,
                filename: filename,
                uploadedby: displayName || '',
                date: imgdate,
            }

            if (matchedKeyword.subcategory === 'MNDWI') {
                metadata.tsf7 = null,
                    metadata.tsf8 = null,
                    metadata.rainfall = null
            }

            return {
                file: file,
                recordType: 'client_images',
                bucket: 'Insar',
                metadata: metadata
            };
        }

        // Default case - treat as report
        return {
            file: file,
            recordType: 'reports',
            bucket: 'Reports',
            metadata: {
                title: '',
                description: '',
                type: 'insar',
                status: 'Completed',
                generatedby: displayName || '',
                category: '',
                size: `${sizeInMB} MB`,
                filename: filename
            }
        };
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

    const addFiles = (newFiles) => {
        const parsedFiles = newFiles.map(file => parseFileMetadata(file));
        setFiles(prev => [...prev, ...parsedFiles]);
    };

    const removeFile = (index) => {
        setFiles(prev => prev.filter((_, i) => i !== index));
    };

    const updateFileMetadata = (index, field, value) => {
        setFiles(prev => prev.map((item, i) => {
            if (i === index) {
                return {
                    ...item,
                    metadata: {
                        ...item.metadata,
                        [field]: value
                    }
                };
            }
            return item;
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!selectedClientId) {
            alert('Please select a Client/Site.');
            return;
        }

        if (files.length === 0) {
            alert('Please select at least one file.');
            return;
        }

        setUploading(true);

        try {
            const results = [];

            for (const fileItem of files) {
                try {
                    // Determine bucket based on recordType and type
                    let bucket = fileItem.bucket;
                    if (fileItem.recordType === 'client_images') {
                        bucket = fileItem.metadata.type === 'radar' ? 'Radar' : 'Insar';
                    }

                    // Generate unique filename
                    const fileName = `${selectedClientId}/${fileItem.file.name}`;

                    // Upload to storage
                    const { error: uploadError } = await supabase.storage
                        .from(bucket)
                        .upload(fileName, fileItem.file, {
                            cacheControl: '3600',
                            upsert: false
                        });

                    if (uploadError) throw uploadError;

                    // Insert record based on type
                    if (fileItem.recordType === 'reports') {
                        const reportPayload = {
                            title: fileItem.metadata.title,
                            filename: fileName,
                            description: fileItem.metadata.description,
                            type: fileItem.metadata.type,
                            status: fileItem.metadata.status,
                            date: new Date().toISOString().split('T')[0],
                            generatedby: fileItem.metadata.generatedby,
                            size: fileItem.metadata.size,
                            category: fileItem.metadata.category,
                            client_id: selectedClientId
                        };

                        const result = await createReportRecord(reportPayload);
                        if (!result.success) throw new Error(result.error);
                    } else if (fileItem.recordType === 'client_images') {
                        // Insert into client_images table
                        const { error: dbError } = await supabase
                            .from('client_images')
                            .insert({
                                client_id: selectedClientId,
                                image_url: fileName,
                                type: fileItem.metadata.type,
                                category: fileItem.metadata.category,
                                uploaded_at: new Date().toISOString(),
                                uploadedby: fileItem.metadata.uploadedby,
                                size: fileItem.metadata.size,
                                date: fileItem.metadata.date,
                                subcategory: fileItem.metadata.subcategory || null,
                                rainfall: fileItem.metadata.rainfall,  // Make sure these are included
                                tsf7: fileItem.metadata.tsf7,
                                tsf8: fileItem.metadata.tsf8,
                            });

                        if (dbError) throw dbError;
                    }

                    results.push({ success: true, filename: fileItem.file.name });
                } catch (error) {
                    console.error(`Error uploading ${fileItem.file.name}:`, error);
                    results.push({ success: false, filename: fileItem.file.name, error: error.message });
                }
            }

            // Show results
            const successCount = results.filter(r => r.success).length;
            const failCount = results.filter(r => !r.success).length;

            if (failCount === 0) {
                alert(`Successfully uploaded ${successCount} file(s)!`);
            } else {
                alert(`Uploaded ${successCount} file(s). Failed: ${failCount}\n\nFailed files:\n${results.filter(r => !r.success).map(r => `- ${r.filename}: ${r.error}`).join('\n')}`);
            }

            // Reset form
            setFiles([]);
            setSelectedClientId('');
            router.refresh();

            if (failCount === 0) {
                onClose();
            }

        } catch (error) {
            console.error('Error uploading:', error);
            alert('Error uploading files: ' + error.message);
        } finally {
            setUploading(false);
        }
    };

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
                        <p className="m-0">You don't have permission to upload files. Contact your administrator.</p>
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

    const inputClasses = "w-full p-2.5 bg-[var(--dtg-bg-secondary)] border border-[var(--dtg-border-medium)] rounded-[5px] text-[var(--dtg-text-primary)] text-sm outline-none focus:border-teal-500 transition-colors";

    return (
        <div
            className="w-full z-[9999] h-full bg-gray-900/40 backdrop-blur-sm fixed top-0 left-0 flex items-center justify-center p-5"
            onClick={onClose}
        >
            <div
                className="w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-5 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-5 gap-2.5 md:gap-0">
                    <h2 className="text-[var(--dtg-text-primary)] m-0 flex items-center gap-2.5 text-lg">
                        <Upload size={24} />
                        Upload Files
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
                            value={selectedClientId}
                            onChange={(e) => setSelectedClientId(e.target.value)}
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

                    {/* File Upload Area */}
                    <div className="mb-5">
                        <label className="text-[var(--dtg-gray-400)] block mb-1 text-sm">Files *</label>
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
                                Supports all file types • Multiple files allowed
                            </p>
                        </div>
                    </div>

                    {/* Files List */}
                    {files.length > 0 && (
                        <div className="mb-5 space-y-3">
                            <h3 className="text-[var(--dtg-text-primary)] text-sm font-semibold mb-2">
                                Files to Upload ({files.length})
                            </h3>
                            {files.map((fileItem, index) => (
                                <div key={index} className="bg-[var(--dtg-bg-secondary)] border border-[var(--dtg-border-medium)] rounded-lg p-4">
                                    <div className="flex items-start justify-between mb-3">
                                        <div className="flex items-center gap-2 flex-1">
                                            {fileItem.recordType === 'reports' ? (
                                                <FileText size={20} className="text-teal-500 flex-shrink-0" />
                                            ) : (
                                                <ImageIcon size={20} className="text-blue-500 flex-shrink-0" />
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[var(--dtg-text-primary)] text-sm font-medium truncate">
                                                    {fileItem.file.name}
                                                </p>
                                                <p className="text-[var(--dtg-gray-500)] text-xs">
                                                    {fileItem.metadata.size} • {fileItem.recordType === 'reports' ? 'Report' : 'Image'} • {fileItem.bucket}
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => removeFile(index)}
                                            className="text-[var(--dtg-gray-400)] hover:text-red-500 transition-colors p-1"
                                        >
                                            <X size={16} />
                                        </button>
                                    </div>

                                    {/* Metadata fields for reports */}
                                    {fileItem.recordType === 'reports' && (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <div>
                                                <label className="text-[var(--dtg-gray-400)] block mb-1 text-xs">Title</label>
                                                <input
                                                    type="text"
                                                    value={fileItem.metadata.title}
                                                    onChange={(e) => updateFileMetadata(index, 'title', e.target.value)}
                                                    className={`${inputClasses} text-xs`}
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[var(--dtg-gray-400)] block mb-1 text-xs">Generated By</label>
                                                <input
                                                    type="text"
                                                    value={fileItem.metadata.generatedby}
                                                    onChange={(e) => updateFileMetadata(index, 'generatedby', e.target.value)}
                                                    className={`${inputClasses} text-xs`}
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[var(--dtg-gray-400)] block mb-1 text-xs">Type</label>
                                                <select
                                                    value={fileItem.metadata.type}
                                                    onChange={(e) => updateFileMetadata(index, 'type', e.target.value)}
                                                    className={`${inputClasses} text-xs cursor-pointer`}
                                                >
                                                    <option value="insar">InSAR</option>
                                                    <option value="radar">Radar</option>
                                                    <option value="prism">PRISM</option>
                                                    <option value="vwp">VWP</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="text-[var(--dtg-gray-400)] block mb-1 text-xs">Status</label>
                                                <select
                                                    value={fileItem.metadata.status}
                                                    onChange={(e) => updateFileMetadata(index, 'status', e.target.value)}
                                                    className={`${inputClasses} text-xs cursor-pointer`}
                                                >
                                                    <option value="Completed">Completed</option>
                                                    <option value="Pending">Pending</option>
                                                    <option value="Draft">Draft</option>
                                                </select>
                                            </div>
                                            <div className="md:col-span-2">
                                                <label className="text-[var(--dtg-gray-400)] block mb-1 text-xs">Description</label>
                                                <textarea
                                                    value={fileItem.metadata.description}
                                                    onChange={(e) => updateFileMetadata(index, 'description', e.target.value)}
                                                    rows={2}
                                                    className={`${inputClasses} text-xs resize-y font-inherit`}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* Metadata fields for images */}
                                    {fileItem.recordType === 'client_images' && (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <div>
                                                <label className="text-[var(--dtg-gray-400)] block mb-1 text-xs">Type</label>
                                                <select
                                                    value={fileItem.metadata.type}
                                                    onChange={(e) => updateFileMetadata(index, 'type', e.target.value)}
                                                    className={`${inputClasses} text-xs cursor-pointer`}
                                                >
                                                    <option value="insar">InSAR</option>
                                                    <option value="radar">Radar</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="text-[var(--dtg-gray-400)] block mb-1 text-xs">Category</label>
                                                <input
                                                    type="text"
                                                    value={fileItem.metadata.category}
                                                    onChange={(e) => updateFileMetadata(index, 'category', e.target.value)}
                                                    className={`${inputClasses} text-xs`}
                                                />
                                            </div>

                                            {/* Additional fields for MNDWI subcategory */}
                                            {fileItem.metadata.subcategory === 'MNDWI' && (
                                                <>
                                                    <div>
                                                        <label className="text-[var(--dtg-gray-400)] block mb-1 text-xs">Rainfall (mm) *</label>
                                                        <input
                                                            required
                                                            type="number"
                                                            value={fileItem.metadata.rainfall || ''}
                                                            onChange={(e) => updateFileMetadata(index, 'rainfall', e.target.value)}
                                                            className={`${inputClasses} text-xs`}
                                                            placeholder="Enter rainfall"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="text-[var(--dtg-gray-400)] block mb-1 text-xs">Water Surface Area - TSF7 (km2)*</label>
                                                        <input
                                                            required
                                                            type="number"
                                                            value={fileItem.metadata.tsf7 || ''}
                                                            onChange={(e) => updateFileMetadata(index, 'tsf7', e.target.value)}
                                                            className={`${inputClasses} text-xs`}
                                                            placeholder="Enter Number"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="text-[var(--dtg-gray-400)] block mb-1 text-xs">Water Surface Area - TSF8 (km2)*</label>
                                                        <input
                                                            required
                                                            type="number"
                                                            value={fileItem.metadata.tsf8 || ''}
                                                            onChange={(e) => updateFileMetadata(index, 'tsf8', e.target.value)}
                                                            className={`${inputClasses} text-xs`}
                                                            placeholder="Enter Number"
                                                        />
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

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
                            disabled={uploading || files.length === 0}
                            className={`
                                flex-1 p-3 text-white rounded-[5px] text-sm font-bold flex items-center justify-center gap-2.5 transition-colors duration-200
                                ${uploading || files.length === 0
                                    ? 'bg-[#525252] cursor-not-allowed'
                                    : 'bg-teal-500 hover:bg-teal-600 cursor-pointer'
                                }
                            `}
                        >
                            {uploading ? (
                                <>
                                    <Loader size={16} className="animate-spin" />
                                    Uploading {files.length} file(s)...
                                </>
                            ) : (
                                <>
                                    <Upload size={16} />
                                    Upload {files.length > 0 ? `${files.length} file(s)` : 'Files'}
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