'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useUserSite } from '@/components/Reusable/useUserSite';
import {
    FileText, Download, Calendar, Eye, X, Loader, Search, Trash2
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import toast, { Toaster } from 'react-hot-toast';
import {
    PRESETS, DEFAULT_SELECTION, CUSTOM_ERRORS,
    formatDay, resolveRange, validateCustom, toQueryBounds,
    parseSearch, toSearch, formatRangeLabel,
} from '@/utils/reportListRange';

/**
 * The report library, shared by the admin Report Management board and the
 * client Reports tabs. Reports are fetched for one `created_at` range at a time
 * (Last 7 days by default, never longer than 6 months — see
 * utils/reportListRange.js); the range lives in the URL so a reload keeps it.
 *
 * @param page  Optional `reports.type` to pin the list to ('radar', 'insar', …).
 *   The client dashboard gives each sensor family its own Reports tab, so the
 *   tab has to narrow the library the way the deployed build does. Omitted (the
 *   admin board) means every type, with the type dropdown left free.
 * @param refreshTrigger  Bump to refetch the current range.
 * @param reportData  Optional callback receiving the fetched rows.
 */
const ReportsList = ({ refreshTrigger, page = null, reportData = null }) => {
    const { userSite, loading: siteLoading } = useUserSite();

    const clientId = userSite?.site?.id;
    const userRole = userSite?.role;

    const [reports, setReports] = useState([]);
    const [loading, setLoading] = useState(false);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [previewTitle, setPreviewTitle] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [reportType, setReportType] = useState('all');

    // `selection` is the APPLIED range. The picker can sit on "custom" with
    // unapplied dates while the list still shows the previous range. Null until
    // the URL has been read, so the first fetch is the right one.
    const [selection, setSelection] = useState(null);
    const [picker, setPicker] = useState(DEFAULT_SELECTION.preset);
    const [draftFrom, setDraftFrom] = useState('');
    const [draftTo, setDraftTo] = useState('');
    const fetchSeq = useRef(0);

    const today = formatDay(new Date());
    const range = selection ? resolveRange(selection, today) : null;
    const draftError = picker === 'custom' ? validateCustom(draftFrom, draftTo, today) : null;

    const BUCKET_NAME = 'Reports';

    // Read on mount rather than in the initial state, so the server render and
    // the first client render agree.
    useEffect(() => {
        const initial = parseSearch(window.location.search, formatDay(new Date()));
        setSelection(initial);
        setPicker(initial.preset);
        if (initial.preset === 'custom') {
            setDraftFrom(initial.from);
            setDraftTo(initial.to);
        }
    }, []);

    useEffect(() => {
        if (range && (clientId || userRole === 'admin')) {
            fetchReports(clientId, range);
        }
    }, [clientId, userRole, refreshTrigger, page, range?.from, range?.to]);

    const applySelection = (next) => {
        setSelection(next);
        // replaceState, not the router: this is local UI state, and it must not
        // add history entries or re-render the page.
        window.history.replaceState(
            window.history.state,
            '',
            `${window.location.pathname}${toSearch(next, window.location.search)}${window.location.hash}`
        );
    };

    const handlePickerChange = (value) => {
        setPicker(value);
        if (value === 'custom') {
            // Start the custom inputs from what's on screen.
            setDraftFrom(range?.from ?? '');
            setDraftTo(range?.to ?? '');
        } else {
            applySelection({ preset: value });
        }
    };

    const applyCustom = () => {
        if (draftError) return;
        const next = { preset: 'custom', from: draftFrom, to: draftTo < today ? draftTo : today };
        setDraftTo(next.to);
        applySelection(next);
    };

    const fetchReports = async (id, { from, to }) => {
        // A slower earlier range must not overwrite a newer one.
        const seq = ++fetchSeq.current;
        try {
            setLoading(true);

            const { gte, lt } = toQueryBounds({ from, to });

            let query = supabase
                .from('reports')
                .select('*')
                .gte('created_at', gte)
                .lt('created_at', lt);

            if (page) {
                query = query.eq('type', page);
            }

            query = query.order('created_at', { ascending: false });

            if (userRole !== 'admin') {
                query = query.ilike('filename', `${id}/%`);
            }

            const { data, error } = await query;

            if (seq !== fetchSeq.current) return;
            if (error) throw error;

            setReports(data || []);

            if (reportData) {
                reportData(data || []);
            }
        } catch (error) {
            console.error('Error Fetching Reports:', error);
            toast.error('Error fetching reports: ' + error.message);
        } finally {
            if (seq === fetchSeq.current) setLoading(false);
        }
    };

    const getCleanFilename = (fullPath) => {
        if (!fullPath) return 'Unknown File';
        return fullPath.split('/').pop();
    };

    const downloadPDF = async (fullPath) => {
        try {
            const { data, error } = await supabase.storage
                .from(BUCKET_NAME)
                .download(fullPath);

            if (error) throw error;

            const url = URL.createObjectURL(data);
            const link = document.createElement('a');
            link.href = url;
            link.download = getCleanFilename(fullPath);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Error downloading:', error);
            toast.error('Error downloading file: ' + error.message);
        }
    };

    const handlePreview = async (fullPath) => {
        try {
            const { data, error } = await supabase.storage
                .from(BUCKET_NAME)
                .createSignedUrl(fullPath, 3600);

            if (error) throw error;

            setPreviewTitle(getCleanFilename(fullPath));
            setPreviewUrl(data.signedUrl);
        } catch (error) {
            console.error('Error generating preview:', error);
            toast.error('Could not generate preview: ' + error.message);
        }
    };

    const handleDeleteReport = async (report) => {
        if (!window.confirm(`Are you sure you want to delete "${report.title || getCleanFilename(report.filename)}"?`)) {
            return;
        }

        try {
            // 1. Delete from Storage
            const { error: storageError } = await supabase.storage
                .from(BUCKET_NAME)
                .remove([report.filename]);

            if (storageError) {
                console.error('Storage delete error:', storageError);
                throw new Error('Failed to delete file from storage');
            }

            // 2. Delete from Database
            const { error: dbError } = await supabase
                .from('reports')
                .delete()
                .eq('id', report.id);

            if (dbError) throw dbError;

            // 3. Update Local State
            const updatedReports = reports.filter(r => r.id !== report.id);
            setReports(updatedReports);
            if (reportData) {
                reportData(updatedReports);
            }

        } catch (error) {
            console.error('Error deleting report:', error);
            toast.error('Error deleting report: ' + error.message);
        }
    };

    const filteredReports = reports.filter(report => {
        const matchesSearch = report.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            getCleanFilename(report.filename).toLowerCase().includes(searchQuery.toLowerCase());
        const matchesType = reportType === 'all' || report.type === reportType;
        return matchesSearch && matchesType;
    });

    const getTypeColorClass = (type) => {
        switch (type) {
            case 'radar': return 'bg-red-500/10 text-red-500 border border-red-500/20';
            case 'insar': return 'bg-blue-500/10 text-blue-500 border border-blue-500/20';
            case 'prism': return 'bg-green-500/10 text-green-500 border border-green-500/20';
            case 'vwp': return 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20';
            default: return 'bg-gray-500/10 text-gray-500 border border-gray-500/20';
        }
    };

    const getStatusBadgeClass = (status) => {
        const statusLower = status?.toLowerCase() || '';
        switch (statusLower) {
            case 'completed': return 'bg-green-500/10 text-green-500 border border-green-500/20';
            case 'pending': return 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20';
            case 'draft': return 'bg-gray-500/10 text-gray-500 border border-gray-500/20';
            default: return null;
        }
    };

    if (siteLoading) {
        return (
            <div className="flex justify-center items-center p-10 text-[var(--dtg-gray-400)]">
                <Loader size={24} className="animate-spin mr-2" />
                Checking user permissions...
            </div>
        );
    }

    // No site means nothing to filter, so this one replaces the whole list.
    if (!clientId && userRole !== 'admin') {
        return (
            <div className="bg-[var(--dtg-bg-secondary)] border border-[var(--dtg-border-medium)] rounded-lg p-10 text-center">
                <FileText size={48} className="text-[var(--dtg-text-muted)] mx-auto mb-5" />
                <p className="text-[var(--dtg-gray-400)] m-0">
                    No client site associated with this user.
                </p>
            </div>
        );
    }

    const listBody = () => {
        if (loading || !range) {
            return (
                <div className="flex justify-center items-center p-10 text-[var(--dtg-gray-400)]">
                    <Loader size={24} className="animate-spin mr-2" />
                    Loading reports...
                </div>
            );
        }

        if (filteredReports.length === 0) {
            return (
                <div className="p-10 text-center">
                    <FileText size={48} className="text-[var(--dtg-text-muted)] mx-auto mb-5" />
                    <p className="text-[var(--dtg-gray-400)] m-0">
                        No reports in this range.
                    </p>
                </div>
            );
        }

        return (
            <div className='divide-y divide-[var(--dtg-border-medium)] max-h-[400px] overflow-y-auto'>
                {filteredReports.map((report) => (
                    <div key={report.id} className="p-2">
                        <div className="flex items-start justify-between">
                            <div className="flex-1">
                                <div className="flex items-start gap-2 mb-0.5">
                                    <FileText size={20} className="text-teal-500" />

                                    <h4 className="m-0 text-sm font-normal text-[var(--dtg-text-primary)]">
                                        {getCleanFilename(report.filename)}
                                    </h4>

                                    <span className={`text-xs px-1.5 py-0.5 rounded ${getTypeColorClass(report.type)}`}>
                                        {report.type ? report.type.replace('-', ' ').toUpperCase() : 'UNKNOWN'}
                                    </span>

                                    {getStatusBadgeClass(report.status) && (
                                        <span className={`text-xs px-1.5 py-0.5 rounded ${getStatusBadgeClass(report.status)}`}>
                                            {report.status}
                                        </span>
                                    )}
                                </div>

                                {report.description && (
                                    <p className="my-1 ml-7 text-xs text-[var(--dtg-gray-400)]">
                                        {report.description}
                                    </p>
                                )}

                                <div className="flex items-center gap-2 font-light text-xs text-[var(--dtg-gray-400)] ml-7">
                                    <div className="flex items-center gap-1">
                                        <Calendar size={12} />
                                        <span>{report.date}</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <span>Generated by: {report.generatedby}</span>
                                    </div>
                                    {report.size && (
                                        <div className="flex items-center gap-1">
                                            <span>Size: {report.size}</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-center gap-1">
                                {(report.status?.toLowerCase() === 'completed') && (
                                    <>
                                        <button
                                            onClick={() => handlePreview(report.filename)}
                                            className="p-1 rounded border-none bg-transparent text-[var(--dtg-gray-400)] outline-none cursor-pointer hover:text-[var(--dtg-text-primary)]"
                                            title="Preview Report"
                                        >
                                            <Eye size={15} />
                                        </button>
                                        <button
                                            onClick={() => downloadPDF(report.filename)}
                                            className="p-1 rounded border-none bg-transparent text-[var(--dtg-gray-400)] outline-none cursor-pointer hover:text-[var(--dtg-text-primary)]"
                                            title="Download Report"
                                        >
                                            <Download size={15} />
                                        </button>
                                        <button
                                            onClick={() => handleDeleteReport(report)}
                                            className="p-1 rounded border-none bg-transparent text-[var(--dtg-gray-400)] outline-none cursor-pointer hover:text-red-500"
                                            title="Delete Report"
                                        >
                                            <Trash2 size={15} />
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    return (
        <>
            <Toaster position="top-center" reverseOrder={false} />

            {/* Search and Filter — always rendered, so an empty range can be changed. */}
            <div className="flex flex-col gap-2">
                <div className="flex items-center gap-4">
                    <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[var(--dtg-gray-500)]" />
                        <Input
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search reports..."
                            className="pl-10 bg-[var(--dtg-bg-card)] border-[var(--dtg-border-medium)] text-[var(--dtg-text-primary)]"
                        />
                    </div>
                    {/* A tab that already pins the type has nothing to offer here —
                        every other choice would come back empty. */}
                    {!page && (
                        <Select value={reportType} onValueChange={setReportType}>
                            <SelectTrigger aria-label="Report type" className="w-48 bg-[var(--dtg-bg-card)] border-[var(--dtg-border-medium)] text-[var(--dtg-text-primary)]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-[var(--dtg-bg-card)] border-[var(--dtg-border-medium)] text-[var(--dtg-text-primary)]">
                                <SelectItem value="all">All Types</SelectItem>
                                <SelectItem value="radar">Radar</SelectItem>
                                <SelectItem value="insar">InSAR</SelectItem>
                                <SelectItem value="prism">Prism</SelectItem>
                                <SelectItem value="vwp">VWP</SelectItem>
                            </SelectContent>
                        </Select>
                    )}
                    <Select value={picker} onValueChange={handlePickerChange}>
                        <SelectTrigger aria-label="Date range" className="w-48 bg-[var(--dtg-bg-card)] border-[var(--dtg-border-medium)] text-[var(--dtg-text-primary)]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-[var(--dtg-bg-card)] border-[var(--dtg-border-medium)] text-[var(--dtg-text-primary)]">
                            {PRESETS.map((p) => (
                                <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>
                            ))}
                            <SelectItem value="custom">Custom…</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {picker === 'custom' && (
                    <div className="flex items-center gap-2 justify-end text-sm text-[var(--dtg-text-primary)]">
                        <input
                            type="date"
                            aria-label="From"
                            value={draftFrom}
                            max={today}
                            onChange={(e) => setDraftFrom(e.target.value)}
                            className="px-2 py-1 rounded bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] text-[var(--dtg-text-primary)]"
                        />
                        <span className="text-[var(--dtg-gray-400)]">→</span>
                        <input
                            type="date"
                            aria-label="To"
                            value={draftTo}
                            max={today}
                            onChange={(e) => setDraftTo(e.target.value)}
                            className="px-2 py-1 rounded bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] text-[var(--dtg-text-primary)]"
                        />
                        <button
                            onClick={applyCustom}
                            disabled={!!draftError}
                            className="px-3 py-1 rounded border-none bg-teal-600 text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Apply
                        </button>
                        {draftError && (
                            <span role="alert" className="text-xs text-red-500">{CUSTOM_ERRORS[draftError]}</span>
                        )}
                    </div>
                )}
            </div>

            <div className="flex flex-col border border-[var(--dtg-border-medium)] bg-[var(--dtg-bg-card)] rounded-lg overflow-hidden mt-5">
                <div className="p-2 border-b border-[var(--dtg-border-medium)]">
                    <h3 className="text-[var(--dtg-text-primary)] m-0 text-base not-italic">
                        Reports
                        {range && (
                            <span className="text-[var(--dtg-gray-400)] text-sm">
                                {' · '}{formatRangeLabel(range)}
                                {!loading && <>{' · '}{filteredReports.length} results</>}
                            </span>
                        )}
                    </h3>
                </div>

                {listBody()}
            </div>

            {previewUrl && (
                <div
                    className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-5"
                >
                    <div
                        className="w-11/12 h-5/6 bg-[var(--dtg-bg-secondary)] rounded-lg overflow-hidden flex flex-col relative"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="px-5 py-4 border-b border-[var(--dtg-border-medium)] flex justify-between items-center bg-neutral-900">
                            <h3 className="m-0 text-[var(--dtg-text-primary)] text-base">
                                Preview: {previewTitle}
                            </h3>
                            <button
                                onClick={() => setPreviewUrl(null)}
                                className="bg-transparent border-none text-[var(--dtg-gray-400)] cursor-pointer p-1 flex items-center hover:text-[var(--dtg-text-primary)]"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <iframe
                            src={`${previewUrl}#toolbar=0`}
                            className="w-full h-full border-none"
                            title={`Preview ${previewTitle}`}
                        />
                    </div>
                </div>
            )}
        </>
    );
};

export default ReportsList;
