'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useUserSite } from '@/components/Reusable/useUserSite';
import {
    FileText, Download, Calendar, Eye, X, Loader, Search
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/LandingPage/ui/select";
import { Input } from "@/components/LandingPage/ui/input";

const ReportsList = () => {
    const { userSite, loading: siteLoading } = useUserSite();

    const clientId = userSite?.site?.id;
    const userRole = userSite?.role;

    const [reports, setReports] = useState([]);
    const [loading, setLoading] = useState(false);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [previewTitle, setPreviewTitle] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [reportType, setReportType] = useState('all');

    const BUCKET_NAME = 'Reports';

    useEffect(() => {
        if (clientId || userRole === 'admin') {
            fetchReports(clientId);
        }
    }, [clientId, userRole]);

    const fetchReports = async (id) => {
        try {
            setLoading(true);

            console.log(`Fetching reports. Role: ${userRole}, ClientID: ${id}`);

            let query = supabase
                .from('reports')
                .select('*')
                .eq('type', 'insar')
                .order('created_at', { ascending: false });

            if (userRole !== 'admin') {
                query = query.ilike('filename', `${id}/%`);
            }

            const { data, error } = await query;

            if (error) throw error;

            console.log("Reports Found:", data);
            setReports(data || []);
        } catch (error) {
            console.error('Error Fetching Reports:', error);
        } finally {
            setLoading(false);
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
            alert('Error downloading file: ' + error.message);
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
            alert('Could not generate preview: ' + error.message);
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

    if (loading) {
        return (
            <div className="flex justify-center items-center p-10 text-[var(--dtg-gray-400)]">
                <Loader size={24} className="animate-spin mr-2" />
                Loading reports...
            </div>
        );
    }

    if (reports.length === 0) {
        return (
            <div className="bg-[var(--dtg-bg-secondary)] border border-[var(--dtg-border-medium)] rounded-lg p-10 text-center">
                <FileText size={48} className="text-[var(--dtg-text-muted)] mx-auto mb-5" />
                <p className="text-[var(--dtg-gray-400)] m-0">
                    {clientId ? "No reports available for this client." : "No client site associated with this user."}
                </p>
            </div>
        );
    }

    return (
        <>
            {/* Search and Filter */}
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
                <Select value={reportType} onValueChange={setReportType}>
                    <SelectTrigger className="w-48 bg-[var(--dtg-bg-card)] border-[var(--dtg-border-medium)] text-[var(--dtg-text-primary)]">
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
            </div>

            <div className="flex flex-col border border-[var(--dtg-border-medium)] bg-[var(--dtg-bg-card)] rounded-lg overflow-hidden mt-5">
                <div className="p-2 border-b border-[var(--dtg-border-medium)]">
                    <h3 className="text-[var(--dtg-text-primary)] m-0 text-base not-italic">
                        Recent Reports
                    </h3>
                </div>

                <div className='divide-y divide-[var(--dtg-border-medium)]'>
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
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {previewUrl && (
                <div
                    className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-5"
                    onClick={() => setPreviewUrl(null)}
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