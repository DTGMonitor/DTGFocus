import { useState, useCallback, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { supabase } from '@/lib/supabaseClient';
import {
    Bell, Clock, MapPin, User, X, Download
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatFromUTC } from "@/utils/timezoneUtils";
import Head from 'next/head';

// --- SAFE COLOR PALETTE (HEX ONLY) ---
// We use these instead of CSS variables for the PDF export to prevent 'oklab' errors.
const C = {
    white: '#ffffff',
    black: '#000000',
    slate900: '#0f172a', // text-primary
    gray800: '#1f2937',
    gray700: '#374151', // text-secondary
    gray600: '#4b5563', // muted text
    gray500: '#6b7280',
    gray300: '#d1d5db',
    gray200: '#e5e7eb', // borders
    gray50: '#f9fafb',  // background-alt
    teal900: '#134e4a',
    teal700: '#0f766e',
    dtgDark: '#0D3036',
    dtgLight: '#4AD0C4',
    // Severity Colors (Safe Hex)
    redBg: '#fee2e2', redText: '#991b1b', redBorder: '#fca5a5',
    orangeBg: '#ffedd5', orangeText: '#9a3412', orangeBorder: '#fdba74',
    yellowBg: '#feffd5', yellowText: '#919a12', yellowBorder: '#fdf474',
    greenBg: '#dcfce7', greenText: '#166534', greenBorder: '#86efac',
    blueBg: '#dbeafe', blueText: '#1e40af', blueBorder: '#93c5fd',
};

const openOutlookDraft = (
    subject,
    body,
    toGroup,
    ccGroup
) => {
    const safeSubject = encodeURIComponent(subject);
    const safeBody = encodeURIComponent(body);

    const safeTo = encodeURIComponent(toGroup);
    const safeCc = encodeURIComponent(ccGroup);

    // Construct Link
    let mailtoLink = `mailto:${safeTo}?subject=${safeSubject}&body=${safeBody}`;

    if (safeCc) {
        mailtoLink += `&cc=${safeCc}`;
    }

    window.location.href = mailtoLink;
};

export const Header = ({ header, longDate, userName, gradientPage1 }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 40px', background: gradientPage1 }}>
        <div>
            <GradientTitle text={header} />
            <p style={{ fontSize: '16px', color: C.white, fontWeight: 'bold', margin: 0 }}>{`${longDate} | ${userName}`}</p>
        </div>
        <img src='/logo/DTG/DTGlogo.png' alt="DTG" style={{ height: "50px" }} />
    </div>
);

const getShiftMeta = (shift) => {
    // Compute dates fresh on every call so a long-open browser tab
    // doesn't hold a stale "today"/"yesterday" across the day boundary.
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    switch (shift) {
        case 'DS': return { label: 'Day Shift', date: today, indices: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18] };
        case 'NS': return { label: 'Night Shift', date: yesterday, indices: [19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6] };
        case 'C': return { label: 'Cross Shift', date: today, indices: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22] };
        default: return { label: 'Shift', date: today, indices: [] };
    }
};

// --- HELPER: Resolve Risk/Severity to HEX Styles ---
// This bypasses Tailwind classes entirely for the export
const getSafeBadgeStyle = (statusOrRisk) => {
    const s = statusOrRisk?.toLowerCase() || '';

    // Risks / Statuses
    if (['high', 'critical', 'offline', 'error', 'insar', '4', 'down'].some(k => s.includes(k)))
        return { backgroundColor: C.redBg, color: C.redText, borderColor: C.redBorder };

    if (['moderate', 'warning', 'action required', 'prism', '3', 'sub-optimal'].some(k => s.includes(k)))
        return { backgroundColor: C.orangeBg, color: C.orangeText, borderColor: C.orangeBorder };
    if (['update', '2', 'acceptable'].some(k => s.includes(k)))
        return { backgroundColor: C.yellowBg, color: C.yellowText, borderColor: C.yellowBorder };

    if (['low', 'online', 'optimal', 'completed', 'emesent', '1', 'live'].some(k => s.includes(k)))
        return { backgroundColor: C.greenBg, color: C.greenText, borderColor: C.greenBorder };
    if (['update', 'radar'].some(k => s.includes(k)))
        return { backgroundColor: C.blueBg, color: C.blueText, borderColor: C.blueBorder };

    // Default / Info
    return { backgroundColor: C.gray50, color: C.gray700, borderColor: C.gray200 };
};

const GradientTitle = ({ text }) => (
    <svg width="600" height="36" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
        <defs>
            <linearGradient id="textGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />      {/* White start */}
                <stop offset="100%" stopColor="#94a3b8" stopOpacity="1" />    {/* Slate-400 end (Metallic fade) */}
            </linearGradient>
        </defs>
        <text 
            x="0" 
            y="28" 
            fontFamily="Arial, sans-serif" 
            fontWeight="900" 
            fontSize="28" 
            fill="url(#textGradient)" // Apply the gradient here
            style={{ textTransform: 'uppercase' }}
        >
            {text}
        </text>
    </svg>
);

export const HandoverTemplate = ({ data, reportInfo, exportMode = false, onClose, preloadedNotifications = null }) => {
    const [currentPage, setCurrentPage] = useState(1);
    const currentShift = getShiftMeta(reportInfo.shift);
    const compactDate = currentShift.date.toLocaleDateString('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).split('T')[0].replaceAll('-', '');
    const longDate = currentShift.date.toLocaleDateString('en-CA', { day: 'numeric', month: 'long', year: 'numeric' });
    const header = `${currentShift.label} Handover Report`;
    const fileName = `${header} - ${compactDate}.pdf`;
    const [notifications, setNotifications] = useState(preloadedNotifications || []);
    const userID = reportInfo.user?.user_id;
    const userName = reportInfo.user?.displayname;
    const [crosscheckers, setCrosscheckers] = useState([]);
    const [isGenerating, setIsGenerating] = useState(false);

    const gradientPage1 = `linear-gradient(270deg, ${C.dtgLight} 0%, ${C.dtgDark} 78%)`;

    const ITEMS_PER_PAGE = 5;
    const notificationChunks = [];
    if (notifications.length === 0) {
        notificationChunks.push([]);
    } else {
        for (let i = 0; i < notifications.length; i += ITEMS_PER_PAGE) {
            notificationChunks.push(notifications.slice(i, i + ITEMS_PER_PAGE));
        }
    }

    // The page box is a fixed 720px with overflow hidden, so the checklist has to be
    // chunked or it pushes the Monitoring Summary off the bottom of the page.
    // ~42px per row: a checklist-only page fits 9, and 6 still leaves room for the summary.
    const CHECKLIST_ROWS_PER_PAGE = 9;
    const CHECKLIST_ROWS_WITH_SUMMARY = 6;

    const sensors = data || [];
    const sensorChunks = [];
    if (sensors.length === 0) {
        sensorChunks.push([]);
    } else {
        for (let i = 0; i < sensors.length; i += CHECKLIST_ROWS_PER_PAGE) {
            sensorChunks.push(sensors.slice(i, i + CHECKLIST_ROWS_PER_PAGE));
        }
    }
    // Only tuck the summary under the final chunk if that chunk is short enough.
    const summaryFitsOnLastChunk = sensorChunks[sensorChunks.length - 1].length <= CHECKLIST_ROWS_WITH_SUMMARY;

    const totalPages = sensorChunks.length + (summaryFitsOnLastChunk ? 0 : 1) + notificationChunks.length;

    // ... (fetchNotifications and fetchUsers effects remain the same) ...
    const fetchNotifications = useCallback(async () => {
        try {
            const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
            const { data, error } = await supabase
                .from('work_log')
                .select('id, created_at,subject:subject(subject),wallfolder:radar_wall_folders(radar_id:radars(site_id:clients(site_name,timezone))),location,category,action,notes,type, submitted_by')
                .gte('created_at', twelveHoursAgo)
                .order('id', { ascending: false })
                .eq('submitted_by', userID);
            if (error) throw error;
            setNotifications(data);
        } catch (error) {
            console.error('Error fetching data:', error);
        }
    }, [userID]);

    useEffect(() => {
        if (!preloadedNotifications) fetchNotifications();
    }, [fetchNotifications, preloadedNotifications]);

    useEffect(() => {
        const fetchUsers = async () => {
            const targetNames = ['Adib Izzuddin', 'Lintang Sadewa', 'Nurhuda Santoso', 'Nessy Salsabilita'];
            const { data } = await supabase.rpc('get_safe_crosscheckers', { target_names: targetNames });
            if (data) setCrosscheckers(data);
        };
        fetchUsers();
    }, []);

    const getDisplayName = (userid) => {
        const user = crosscheckers.find((c) => String(c.id) === String(userid));
        return user ? user.full_name : 'Unknown';
    };

    const emailSubject = `${header} - ${longDate}`;

    const emailBody = `Dear All,

Please find attached the ${currentShift.label} handover period of ${longDate}.

Regards,
${userName}`;

    const handleDownload = async () => {
        setIsGenerating(true);
        try {
            let html2pdf = window.html2pdf;
            if (typeof html2pdf === 'undefined') {
                await new Promise((resolve) => {
                    const script = document.createElement('script');
                    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
                    script.onload = () => { html2pdf = window.html2pdf; resolve(); };
                    document.head.appendChild(script);
                });
            }

            const element = document.createElement('div');
            // We force standard font in styles to avoid custom font loading issues
            element.style.cssText = 'width: 1280px; font-family: Arial, sans-serif;';
            document.body.appendChild(element);

            const root = createRoot(element);
            root.render(
                <HandoverTemplate
                    data={data}
                    reportInfo={reportInfo}
                    exportMode={true}
                    preloadedNotifications={notifications}
                />
            );

            await new Promise(resolve => setTimeout(resolve, 1500)); // Increased wait time slightly

            const opt = {
                margin: 0,
                filename: fileName,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2, useCORS: true, logging: false },
                jsPDF: { unit: 'px', format: [1280, 720], orientation: 'landscape' }
            };

            await html2pdf().set(opt).from(element).toPdf().get('pdf').then(function (pdf) {
                const totalPages = pdf.internal.getNumberOfPages();
                for (let i = 1; i <= totalPages; i++) {
                    pdf.setPage(i);
                    pdf.setFontSize(14); // Font size in px since unit is px
                    pdf.setTextColor(150);
                    const pageNumText = `Page ${i} of ${totalPages}`;
                    const textX = pdf.internal.pageSize.getWidth() - 40; // 40px from right
                    const textY = pdf.internal.pageSize.getHeight() - 30; // 30px from bottom
                    pdf.text(pageNumText, textX, textY, { align: 'right' });
                }
            }).save();

            root.unmount();
            document.body.removeChild(element);
            openOutlookDraft(emailSubject, emailBody, "DTG Engineers", "");
        } catch (e) {
            console.error("Export failed", e);
        }
        setIsGenerating(false);
    };

    // --- SHARED STYLES ---
    // We define these here to ensure we use exact hex codes in the render
    const tableHeaderStyle = { padding: '8px 12px', textAlign: 'left', fontSize: '12px', color: C.gray700, backgroundColor: C.gray50, borderBottom: `1px solid ${C.gray200}` };
    const tableCellStyle = { padding: '12px', fontSize: '14px', color: C.slate900, borderBottom: `1px solid ${C.gray200}` };
    const centerCellStyle = { ...tableCellStyle, textAlign: 'center' };


    const summarySection = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
            <h2 style={{ fontSize: '24px', color: C.slate900, fontWeight: 'bold', borderBottom: `2px solid ${C.slate900}`, paddingBottom: '10px', margin: 0 }}>Monitoring Summary</h2>
            <div style={{ display: 'flex', gap: '100px', fontSize: '14px', color: C.slate900 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    <div><strong>Total Event:</strong> {reportInfo.totalevent}</div>
                    <div><strong>Total Alarm:</strong> {reportInfo.totalalarm}</div>
                    <div><strong>Online Devices:</strong> {(reportInfo.onlinedevice * 100).toFixed(0)}%</div>
                    <div><strong>Overall Quality:</strong> {reportInfo.quality}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    <div><strong>Completed Checks:</strong> {reportInfo.completedcheck}</div>
                    <div><strong>Missed Checks:</strong> {reportInfo.misscheck}</div>
                    <div><strong>Completion Rate:</strong> {reportInfo.completion}%</div>
                    <div><strong>Attention Required:</strong> {reportInfo.attentionreq}</div>
                </div>
            </div>
        </div>
    );

    const pages = [
        // --- CHECKLIST PAGES ---
        ...sensorChunks.map((sensorChunk, chunkIndex) => (
        <div key={`page-checklist-${chunkIndex}`} style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', backgroundColor: C.white }}>
            {/* Header */}
            <Header header={header} longDate={longDate} userName={userName} gradientPage1={gradientPage1} />

            {/* Content */}
            <div style={{ padding: '40px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <h2 style={{ fontSize: '24px', color: C.slate900, fontWeight: 'bold', borderBottom: `2px solid ${C.slate900}`, paddingBottom: '10px', margin: 0 }}>
                    Radar Monitoring Checklist {sensorChunks.length > 1 ? `(${chunkIndex + 1}/${sensorChunks.length})` : ''}
                </h2>

                {/* Table - Explicit Styles (No Classes) */}
                <div style={{ border: `1px solid ${C.gray200}`, width: '100%' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr>
                                <th style={{ ...tableHeaderStyle, borderRight: `1px solid ${C.gray200}` }}>SSR</th>
                                <th style={tableHeaderStyle}>Site Name</th>
                                <th style={tableHeaderStyle}>Area</th>
                                <th style={{ ...tableHeaderStyle, textAlign: 'center' }}>Risk</th>
                                <th style={{ ...tableHeaderStyle, textAlign: 'center' }}>Status</th>
                                <th style={{ ...tableHeaderStyle, textAlign: 'center' }}>Quality</th>
                                <th style={{ ...tableHeaderStyle, textAlign: 'center', borderLeft: `1px solid ${C.gray200}` }} colSpan={12}>Hourly Verification</th>
                            </tr>
                            <tr>
                                <th style={{ borderRight: `1px solid ${C.gray200}`, backgroundColor: C.gray50 }}></th>
                                <th colSpan={5} style={{ backgroundColor: C.gray50 }}></th>
                                {currentShift.indices.map((hour) => (
                                    <th key={hour} style={{ padding: '4px', textAlign: 'center', fontSize: '10px', color: C.gray500, borderLeft: `1px solid ${C.gray200}`, backgroundColor: C.gray50 }}>
                                        {hour}:00
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {sensorChunk.map((sensor) => {
                                const allChecks = sensor.hourlychecks || Array(24).fill(false);
                                const shiftChecks = currentShift.indices.map(idx => allChecks[idx]);

                                return (
                                    <tr key={sensor.radar_number}>
                                        <td style={{ ...tableCellStyle, fontWeight: 'bold', borderRight: `1px solid ${C.gray200}` }}>{sensor.radar_number}</td>
                                        <td style={tableCellStyle}>{sensor.site_name}</td>
                                        <td style={tableCellStyle}>{sensor.area}</td>

                                        <td style={centerCellStyle}>
                                            <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '12px', border: '1px solid', ...getSafeBadgeStyle(sensor.risk) }}>
                                                {sensor.risk}
                                            </span>
                                        </td>
                                        <td style={centerCellStyle}>
                                            <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '12px', border: '1px solid', ...getSafeBadgeStyle(sensor.status) }}>
                                                {sensor.status}
                                            </span>
                                        </td>
                                        <td style={centerCellStyle}>
                                            <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '12px', border: '1px solid', ...getSafeBadgeStyle(sensor.quality) }}>
                                                {sensor.quality}
                                            </span>
                                        </td>

                                        {shiftChecks.map((checked, hourIdx) => (
                                            <td key={hourIdx} style={{ padding: '8px', textAlign: 'center', borderLeft: `1px solid ${C.gray200}`, borderBottom: `1px solid ${C.gray200}` }}>
                                                <div style={{
                                                    width: '18px', height: '18px', margin: '0 auto', borderRadius: '4px',
                                                    border: `1px solid ${checked ? '#22c55e' : C.gray600}`,
                                                    backgroundColor: checked ? 'rgba(34, 197, 94, 0.2)' : 'transparent', // Explicit RGBA
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                                                }}>
                                                    {checked && <div style={{ width: '10px', height: '10px', backgroundColor: '#22c55e', borderRadius: '2px' }}></div>}
                                                </div>
                                            </td>
                                        ))}
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>

                {chunkIndex === sensorChunks.length - 1 && summaryFitsOnLastChunk && summarySection}
            </div>
        </div>
        )),

        // --- STANDALONE SUMMARY PAGE (when the last checklist page is too full) ---
        ...(summaryFitsOnLastChunk ? [] : [
            <div key="page-summary" style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', backgroundColor: C.white }}>
                <Header header={header} longDate={longDate} userName={userName} gradientPage1={gradientPage1} />
                <div style={{ padding: '40px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    {summarySection}
                </div>
            </div>
        ]),

        // --- DYNAMIC WORK LOG PAGES ---
        ...notificationChunks.map((chunk, pageIndex) => (
            <div key={`page-log-${pageIndex}`} style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', backgroundColor: C.white }}>
                <Header header={header} longDate={longDate} userName={userName} gradientPage1={gradientPage1} />

                <div style={{ padding: '40px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <h2 style={{ fontSize: '24px', color: C.slate900, fontWeight: 'bold', borderBottom: `2px solid ${C.slate900}`, paddingBottom: '10px', margin: 0 }}>
                        Work Log {notificationChunks.length > 1 ? `(${pageIndex + 1}/${notificationChunks.length})` : ''}
                    </h2>

                    <div style={{ border: `1px solid ${C.gray200}`, borderRadius: '8px', overflow: 'hidden', backgroundColor: C.white }}>
                        {chunk.length === 0 ? (
                            <div style={{ padding: '40px', textAlign: 'center', color: C.gray600 }}>
                                <p style={{ fontSize: '18px' }}>No notifications found</p>
                            </div>
                        ) : (
                            chunk.map((notification) => {
                                const LocalTime = formatFromUTC(notification.created_at, "Asia/Jakarta");
                                const actionBadge = notification.action?.length > 16 ? "Action Required" : notification.action;

                                // Safe Styles
                                const subjectStyle = getSafeBadgeStyle(notification?.subject?.subject);
                                const actionStyle = getSafeBadgeStyle('warning');
                                const typeStyle = getSafeBadgeStyle(notification.type);

                                return (
                                    <div key={notification.id} style={{ padding: '16px', borderBottom: `1px solid ${C.gray200}`, backgroundColor: C.white }}>
                                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                            {/* Icon Box */}
                                            <div style={{
                                                width: '60px',
                                                padding: 5, borderRadius: '6px',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                                fontSize: '10px', fontWeight: 'bold', ...typeStyle
                                            }}>
                                                {notification.type?.toUpperCase()}
                                            </div>

                                            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                                                {/* Header Row */}
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <span style={{ fontSize: '14px', fontWeight: 'bold', color: C.slate900 }}>
                                                            {notification.category.toUpperCase()}
                                                        </span>
                                                        <span style={{
                                                            padding: '1px 6px', borderRadius: '4px', fontSize: '10px', border: '1px solid',
                                                            ...subjectStyle
                                                        }}>
                                                            {notification.subject?.subject}
                                                        </span>
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: C.gray500 }}>
                                                        <Clock size={12} /> <span>{LocalTime}</span>
                                                    </div>
                                                </div>

                                                {/* Notes */}
                                                <p style={{ fontSize: '13px', color: C.gray700, margin: '0 0 8px 0', lineHeight: '1.4' }}>
                                                    {notification.notes}
                                                </p>

                                                {/* Footer Row */}
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '11px', color: C.gray500 }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <MapPin size={12} /> <span>{notification.location}</span>
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <User size={12} /> <span>{getDisplayName(notification.submitted_by)}</span>
                                                    </div>

                                                    {notification.action !== 'No action required' && (
                                                        <div style={{ marginLeft: 'auto' }}>
                                                            <span style={{
                                                                padding: '1px 6px', borderRadius: '4px', fontSize: '10px', border: '1px solid',
                                                                ...actionStyle
                                                            }}>
                                                                {actionBadge}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>
        ))
    ];

    if (exportMode) {
        return (
            <div style={{ width: '1280px', margin: 0, padding: 0, backgroundColor: 'white', display: 'flex', flexDirection: 'column' }}>
                {pages.map((page, index) => (
                    <div key={index} style={{ width: '1280px', height: '720px', overflow: 'hidden', position: 'relative' }}>
                        {page}
                    </div>
                ))}
            </div>
        );
    }

    // --- PREVIEW / SLIDER VIEW (Standard Tailwind Allowed Here) ---
    return (
        <div className="w-full z-[9999] h-full bg-[var(--dtg-gray-900)]/40 backdrop-blur-sm fixed top-0 left-0 flex items-center justify-center p-5" onClick={onClose}>
            <div className="max-w-8xl max-h-[90vh] overflow-y-auto bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="space-y-4">
                    <div className='flex items-start justify-between border-b mb-3'>
                        <h2 className="text-2xl font-bold mb-4 text-[var(--dtg-gray-800)]">Preview - {fileName}</h2>
                        <div className="flex gap-2">
                            <Button onClick={handleDownload} variant='brand' title="Download PDF">
                                {isGenerating ? 'Generating...' : 'Export & Send'}
                            </Button>
                            <button onClick={onClose}><X size={24} /></button>
                        </div>
                    </div>
                    <div className="bg-white shadow-2xl mx-auto relative overflow-hidden" style={{ width: '1280px', height: '720px' }}>
                        {pages[currentPage - 1]}
                        <div className="absolute bottom-4 right-4 bg-gray-600 text-white px-4 py-2 rounded-lg">
                            <span className="font-medium">{currentPage} / {totalPages}</span>
                        </div>
                    </div>
                    <div className="flex items-center justify-center gap-4">
                        <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-6 py-2 bg-[var(--dtg-primary-teal-dark)] text-white rounded-lg hover:opacity-80 disabled:opacity-50 transition">Previous</button>
                        <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="px-6 py-2 bg-[var(--dtg-primary-teal-dark)] text-white rounded-lg hover:opacity-80 disabled:opacity-50 transition">Next</button>
                    </div>
                </div>
            </div>
        </div>
    );
};