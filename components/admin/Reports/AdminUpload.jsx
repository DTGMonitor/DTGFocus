// src/components/AdminUpload.jsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from "@/lib/supabaseClient";
import { useUserSite } from "../../Reusable/useUserSite";
import { createReportRecord } from '../../../src/app/actions/reportActions';
import { Upload, Loader, AlertCircle, X, FileText, Image as ImageIcon, RefreshCw } from 'lucide-react';
import toast, { Toaster } from 'react-hot-toast';

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
    // Existing client_images rows keyed by storage path, for the images currently
    // queued. Populated by the lookup effect below; drives the "Replace" toggle.
    const [existingImages, setExistingImages] = useState({});
    const [checkingExisting, setCheckingExisting] = useState(false);

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

    // Storage path an image will occupy — the same key the upload and the
    // client_images lookup both use.
    const storagePathFor = (filename) => `${selectedClientId}/${filename}`;

    // Names of the queued images, joined so the lookup effect only re-runs when
    // the queue itself changes — editing metadata must not refire the query.
    const queuedImageNames = files
        .filter((item) => item.recordType === 'client_images')
        .map((item) => item.file.name)
        .join('|');

    // Find out which queued images already exist for the selected client, so the
    // user can choose to replace them instead of hitting a duplicate error.
    useEffect(() => {
        if (!selectedClientId || !queuedImageNames) {
            setExistingImages({});
            return;
        }

        let cancelled = false;
        const paths = queuedImageNames.split('|').map((name) => `${selectedClientId}/${name}`);

        const lookup = async () => {
            setCheckingExisting(true);
            try {
                const { data, error } = await supabase
                    .from('client_images')
                    .select('id, image_url, type, category, subcategory, date, uploaded_at, uploadedby')
                    .eq('client_id', selectedClientId)
                    .in('image_url', paths);

                if (error) throw error;
                if (cancelled) return;

                const byPath = {};
                (data || []).forEach((row) => {
                    // Keep the newest row when a path somehow has duplicates, so a
                    // replace updates the record the app is actually showing.
                    const current = byPath[row.image_url];
                    if (!current || (row.uploaded_at || '') > (current.uploaded_at || '')) {
                        byPath[row.image_url] = row;
                    }
                });
                setExistingImages(byPath);
            } catch (error) {
                console.error('Error checking for existing images:', error);
                if (!cancelled) setExistingImages({});
            } finally {
                if (!cancelled) setCheckingExisting(false);
            }
        };

        lookup();
        return () => { cancelled = true; };
    }, [selectedClientId, queuedImageNames]);

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
                const formatDate = (dateObj) => dateObj.toLocaleDateString('en-CA');
                const dayThisMonth = formatDate(new Date());
                const thisMonth = new Date().getMonth() + 1;

                if (parseInt(month) === thisMonth)
                    return dayThisMonth;

                return `${year}-${month}-${lastDay.toString().padStart(2, '0')}`;
            }
            return null;
        };

        const imgdate = parseDate(filename);

        // Check if it's a monthly report PDF
        const monthlyReportRegex = /.*_Monthly_Report_.*\.pdf$/i;
        const bulletinRegex = /.*_InSAR_Bulletin.*\.pdf$/i;
        if (monthlyReportRegex.test(filename) || bulletinRegex.test(filename)) {
            return {
                file: file,
                recordType: 'reports',
                bucket: 'Reports',
                metadata: {
                    title: bulletinRegex.test(filename) ? 'Bulletin' : 'Monthly Deformation Report',
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

    // Opt a single queued image into overwriting the copy already in storage.
    const toggleReplaceExisting = (index) => {
        setFiles(prev => prev.map((item, i) => (
            i === index ? { ...item, replaceExisting: !item.replaceExisting } : item
        )));
    };

    // Overwrite the stored object and refresh the client_images row that points at
    // it, keeping the same path so every existing reference stays valid.
    const replaceExistingImage = async (fileItem, existing, bucket, path) => {
        const { error: uploadError } = await supabase.storage
            .from(bucket)
            .upload(path, fileItem.file, {
                cacheControl: '3600',
                upsert: true
            });

        if (uploadError) throw uploadError;

        const { error: dbError } = await supabase
            .from('client_images')
            .update({
                type: fileItem.metadata.type,
                category: fileItem.metadata.category,
                uploaded_at: new Date().toISOString(),
                uploadedby: fileItem.metadata.uploadedby || displayName || '',
                size: fileItem.metadata.size,
                date: fileItem.metadata.date,
                subcategory: fileItem.metadata.subcategory || null,
                rainfall: fileItem.metadata.rainfall,
                tsf7: fileItem.metadata.tsf7,
                tsf8: fileItem.metadata.tsf8,
            })
            .eq('id', existing.id);

        if (dbError) throw dbError;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!selectedClientId) {
            toast.error('Please select a Client/Site.');
            return;
        }

        if (files.length === 0) {
            toast.error('Please select at least one file.');
            return;
        }

        setUploading(true);

        try {
            const results = [];
            const uploadedFiles = [];
            const client = clientsList.find(c => String(c.id) === String(selectedClientId));

            for (const fileItem of files) {
                try {
                    // Determine bucket based on recordType and type
                    let bucket = fileItem.bucket;
                    if (fileItem.recordType === 'client_images') {
                        bucket = fileItem.metadata.type === 'radar' ? 'Radar' : 'Insar';
                    }

                    // Generate unique filename
                    const fileName = storagePathFor(fileItem.file.name);

                    const existing = fileItem.recordType === 'client_images'
                        ? existingImages[fileName]
                        : null;

                    // Replacing swaps the stored object in place and updates the
                    // existing row, so nothing downstream has to be re-pointed.
                    if (existing) {
                        if (!fileItem.replaceExisting) {
                            throw new Error('An image with this name already exists. Tick "Replace existing image" to overwrite it.');
                        }

                        await replaceExistingImage(fileItem, existing, bucket, fileName);
                        uploadedFiles.push({ ...fileItem, replaced: true });
                        results.push({ success: true, filename: fileItem.file.name, replaced: true });
                        continue;
                    }

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

                    uploadedFiles.push(fileItem);
                    results.push({ success: true, filename: fileItem.file.name });
                } catch (error) {
                    console.error(`Error uploading ${fileItem.file.name}:`, error);
                    results.push({ success: false, filename: fileItem.file.name, error: error.message });
                }
            }

            if (uploadedFiles.length > 0) {
                const uploadsByCategory = uploadedFiles.reduce((acc, item) => {
                    const cat = item.metadata.category || 'Uncategorized';
                    if (!acc[cat]) acc[cat] = { uploaded: [], replaced: [] };
                    acc[cat][item.replaced ? 'replaced' : 'uploaded'].push(item.file.name);
                    return acc;
                }, {});

                for (const [category, { uploaded, replaced }] of Object.entries(uploadsByCategory)) {
                    try {
                        const describe = (filenames, verb) => {
                            if (filenames.length === 0) return null;
                            return filenames.length === 1
                                ? `${filenames[0]} has been ${verb}`
                                : `${filenames.length} files ${verb}: ${filenames.join(', ')}`;
                        };

                        const notes = [describe(uploaded, 'uploaded'), describe(replaced, 'replaced')]
                            .filter(Boolean)
                            .join('. ');

                        const workLogPayload = {
                            created_at: new Date().toISOString(),
                            subject: 1,
                            location: client?.site_name || 'Unknown',
                            category: category,
                            action: 'No action required',
                            type: 'insar',
                            notes: notes,
                            submitted_by: user?.id
                        };

                        const { error: logError } = await supabase.from('work_log').insert([workLogPayload]);
                        if (logError) console.error("Work Log Insert Failed:", logError);
                    } catch (logErr) {
                        console.warn("Failed to create work log.", logErr);
                    }
                }
            }

            // Show results
            const successCount = results.filter(r => r.success).length;
            const failCount = results.filter(r => !r.success).length;
            const replacedCount = results.filter(r => r.success && r.replaced).length;

            if (failCount === 0) {
                const replacedNote = replacedCount > 0 ? ` (${replacedCount} replaced)` : '';
                toast.success(`Successfully uploaded ${successCount} file(s)${replacedNote}!`);
            } else {
                toast.error(`Uploaded ${successCount} file(s). Failed: ${failCount}\n\nFailed files:\n${results.filter(r => !r.success).map(r => `- ${r.filename}: ${r.error}`).join('\n')}`);
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
            toast.error('Error uploading files: ' + error.message);
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
            <Toaster position="top-center" reverseOrder={false} />
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
                            <h3 className="text-[var(--dtg-text-primary)] text-sm font-semibold mb-2 flex items-center gap-2">
                                Files to Upload ({files.length})
                                {checkingExisting && (
                                    <span className="text-[var(--dtg-gray-500)] text-xs font-normal flex items-center gap-1">
                                        <Loader size={12} className="animate-spin" />
                                        Checking for existing images...
                                    </span>
                                )}
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
                                                    {fileItem.replaceExisting && <span className="text-amber-500"> • Replacing</span>}
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
                                            {existingImages[storagePathFor(fileItem.file.name)] && (
                                                <div className="md:col-span-2 bg-amber-500/10 border border-amber-500/30 rounded-md p-3">
                                                    <div className="flex gap-2 items-start text-amber-500">
                                                        <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                                                        <div className="flex-1">
                                                            <p className="m-0 text-xs">
                                                                This image already exists for the selected client
                                                                {existingImages[storagePathFor(fileItem.file.name)].uploaded_at &&
                                                                    ` (uploaded ${new Date(existingImages[storagePathFor(fileItem.file.name)].uploaded_at).toLocaleDateString('en-CA')})`}.
                                                            </p>
                                                            <label className="flex items-center gap-2 mt-2 cursor-pointer text-xs text-[var(--dtg-text-primary)]">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={Boolean(fileItem.replaceExisting)}
                                                                    onChange={() => toggleReplaceExisting(index)}
                                                                    className="cursor-pointer accent-amber-500"
                                                                />
                                                                <RefreshCw size={12} />
                                                                Replace existing image
                                                            </label>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
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