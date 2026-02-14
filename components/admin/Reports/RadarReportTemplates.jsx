import { useMemo, Fragment, useState } from "react";
import { Checkbox } from "@/components/LandingPage/ui/checkbox";
import { getRiskColorSolid } from "@/config/statusConfig";
import { PARAMETER_CONFIG } from "@/config/parameterConfig";
import { ExternalLink } from 'lucide-react';


const C = {
    white: '#ffffff',
    slate900: '#0f172a',
    gray800: '#1f2937',
    gray700: '#374151',
    gray600: '#4b5563',
    gray200: '#e5e7eb',
    gray50: '#f9fafb',
    teal900: '#134e4a',
    teal700: '#0f766e',
    teal200: '#99f6e4',
    teal50: '#f0fdfa',
    blue600: '#2563eb',
    blue200: '#bfdbfe',
    blue50: '#eff6ff',
    indigo50: '#eef2ff',
    dtgDark: '#0D3036',
    dtgLight: '#A7D3D0',
    // Severity Colors (Safe Hex)
    redBg: '#C00000',
    orangeBg: '#F78E1E',
    yellowBg: '#FFC000',
    greenBg: '#008000',
    blueBg: '#1e40af',
};

const getStatusStyle = (statusOrRisk) => {
    const s = statusOrRisk?.toLowerCase() || '';

    // Risks / Statuses
    if (['high', 'critical', 'offline', 'error', 'insar', '4', 'down'].some(k => s.includes(k)))
        return { backgroundColor: C.redBg, color: C.redBg };

    if (['moderate', 'warning', 'action required', 'prism', '3', 'sub-optimal'].some(k => s.includes(k)))
        return { backgroundColor: C.orangeBg, color: C.orangeBg };
    if (['update', '2', 'acceptable'].some(k => s.includes(k)))
        return { backgroundColor: C.yellowBg, color: C.yellowBg };

    if (['low', 'online', 'optimal', 'completed', 'emesent', '1', 'live'].some(k => s.includes(k)))
        return { backgroundColor: C.greenBg, color: C.greenBg };
    if (['update', 'radar'].some(k => s.includes(k)))
        return { backgroundColor: C.blueBg, color: C.blueBg };

    // Default / Info
    return { backgroundColor: C.white, color: C.slate900, borderColor: C.slate900 };
};

export const Header = ({ header, longDate, userName, gradientPage1 }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 40px', background: gradientPage1 }}>
        <div>
            <GradientTitle text1={header} text2='TELFER - SSR460XT' text3={longDate} />
        </div>
        <img src='/logo/DTG/DTGlogo.png' alt="DTG" style={{ height: "40px" }} />
    </div>
);

const GradientTitle = ({ text1, text2, text3 }) => (
    <svg width="600" height="55" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
        <defs>
            <linearGradient id="textGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#94a3b8" stopOpacity="1" />      {/* White start */}
                <stop offset="100%" stopColor="#ffffff" stopOpacity="1" />    {/* Slate-400 end (Metallic fade) */}
            </linearGradient>
        </defs>
        <text
            x="0"
            y="22"
            fontFamily="Arial, sans-serif"
            fontWeight="900"
            fontSize="20"
            fill="url(#textGradient)" // Apply the gradient here
            style={{ textTransform: 'uppercase' }}
        >
            {text1}
        </text>
        <text
            x="0"
            y="48"
            fontFamily="Arial, sans-serif"
            fontWeight="900"
            fontSize="14"
            fill="url(#textGradient)" // Apply the gradient here
            style={{ textTransform: 'uppercase' }}
        >
            {text2} | {text3}
        </text>
    </svg>
);

const getSummary = (overall) => {
    const cleanStatus = overall?.toLowerCase();

    switch (cleanStatus) {
        case 'optimal': return 'Monitoring data for this period is considered optimal for decision-making. No significant quality-related concerns affect slope stability monitoring.';
        case 'acceptable': return '';
        case 'sub-optimal': return '';
        case 'critical': return '';
    }
}

// --- 1. THE TEMPLATE ---
export const RadarTemplate = ({ data, reportInfo, exportMode = false }) => {
    const [currentPage, setCurrentPage] = useState(1);
    const today = new Date();
    const totalPages = 3;
    const header = `24h Data Quality Assessment`;
    const userID = 1;
    const userName = 'Lintang Sadewa';
    const longDate = today.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const gradientPage1 = `linear-gradient(270deg, ${C.dtgLight} 0%, ${C.dtgDark} 78%)`;
    const tableHeaderStyle = { padding: '8px 12px', textAlign: 'left', fontSize: '14px', color: C.white, backgroundColor: C.dtgDark, borderBottom: `1px solid ${C.gray200}` };
    const tableCellStyle = { fontSize: '14px', color: C.slate900, border: `2px solid ${C.white}` };
    const centerCellStyle = { ...tableCellStyle, textAlign: 'center' };
    const tableStyle = {
        width: '100%',
        borderCollapse: 'collapse', // <--- CRITICAL FIX: Removes the gap
        borderSpacing: 0            // <--- CRITICAL FIX: Ensures 0px space
    };

    const processedGroups = useMemo(() => {
        if (!data || data.length === 0) return [];

        const groups = {};
        const parentStatusMap = {};

        // PASS 1: Find all Level 1 (Parent) values and store them
        data.forEach((item) => {
            if (item.parameter?.level === 1) {
                parentStatusMap[item.parameter.id] = item.value;
            }
        });

        // PASS 2: Group the Children
        data.forEach((item) => {
            const param = item.parameter;

            // Skip invalid data
            if (!param) return;

            // Skip Level 1 items (we don't want them as rows)
            if (param.level === 1 || param.level === 0) return;

            const groupId = param.parent_id || param.parent?.id || 0;
            const groupName = param.parent?.name || "General";

            if (!groups[groupId]) {
                groups[groupId] = {
                    id: groupId,
                    name: groupName,
                    // HERE IS THE FIX: Attach the parent's status to the group
                    status: parentStatusMap[groupId],
                    items: []
                };
            }
            groups[groupId].items.push(item);
        });

        // Sort groups and items
        return Object.values(groups)
            .sort((a, b) => a.id - b.id)
            .map(group => {
                group.items.sort((a, b) => a.parameter.id - b.parameter.id);
                return group;
            });
    }, [data]);

    // Get Overall Status (Level 0)
    const overallStatus = useMemo(() => {
        if (!data || data.length === 0) return null;
        return data.find(item => item.parameter?.level === 0)?.value;
    }, [data]);
    const overallColor = useMemo(() => {
        return getStatusStyle(overallStatus).backgroundColor;
    }, [overallStatus]);

    // Safe early return after hooks
    if (!data || data.length === 0) return null;

    const pages = [
        // --- PAGE 1 ---
        <div key="page-1" style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', backgroundColor: C.white }}>
            {/* Header */}
            <Header header={header} longDate={longDate} userName={userName} gradientPage1={gradientPage1} />

            {/* Content */}
            <div style={{ padding: 20, gap: 20, display: 'flex', flexDirection: 'column', }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr>
                            <th colSpan={2} style={{ ...tableHeaderStyle, textAlign: 'center', textTransform: 'uppercase' }}>Current Data Quality Assessment</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr style={{ borderTop: '3px solid white' }}>
                            <td style={{ borderRight: '3px solid white', textAlign: 'center', fontSize: '16px', textTransform: 'uppercase', width: '250px', height: '100px', fontWeight: 'bold', backgroundColor: overallColor }}>{overallStatus}</td>
                            <td style={{ borderBottom: '3px solid black', padding: 10, color: 'black', fontWeight: 'bold', fontSize: '16px' }}>{getSummary(overallStatus)}</td>
                        </tr>
                    </tbody>
                </table>
                <div>
                    <table className="w-full border-collapse">
                        <thead>
                            <tr>
                                {/* The Group Header Column (Vertical) */}
                                <th colSpan={3} style={{ ...tableHeaderStyle, textAlign: 'center', textTransform: 'uppercase' }}>Data Quality Parameter</th>
                            </tr>
                        </thead>
                        <tbody>
                            {processedGroups.map((group) => {
                                const groupStyle = getStatusStyle(group.status);

                                // Defines the thick divider line
                                const middleBorderStyle = {
                                    borderTop: '2px solid black',
                                    borderBottom: '3px solid black',
                                    borderLeft: '3px solid white',
                                    borderRight: '3px solid white',
                                };

                                const itemsWithNotes = group.items.filter(item => item.notes !== null && item.notes.trim() !== "");

                                return (
                                    <Fragment key={group.id}>
                                        {/* ROW 1: Header and Main Description */}
                                        <tr style={{ height: '100px' }}>

                                            {/* Vertical Colour Bar 
                   FIX: added padding: 0 to ensure colour touches the edge 
                */}
                                            <td
                                                rowSpan={2}
                                                style={{
                                                    ...groupStyle,
                                                    width: '15px',
                                                    padding: 0,
                                                    borderBottom: '3px solid white',
                                                    borderRight: '3px solid white'
                                                }}
                                            />

                                            {/* Parameter Name */}
                                            <td className="px-3 py-4 font-bold uppercase" style={{ color: groupStyle.color, width: '20%' }}>
                                                {group.name}
                                            </td>

                                            {/* Description Column */}
                                            <td className="px-3 py-4" style={{ color: C.slate900 }}> {/* C.slate900 approx */}
                                                {itemsWithNotes.length > 0 ? (
                                                    <ul className="list-inside">
                                                        {itemsWithNotes.map((item) => (
                                                            <li key={item.parameter.id} className="text-sm py-1">
                                                                ➤ {item.notes}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                ) : (
                                                    <p className="text-sm py-1" style={{ color: C.slate900 }}>
                                                        ➤ {group.name !== 'Alarms' ? `${group.name} setup is optimal.` : 'No alarm applied in the system.'}
                                                    </p>
                                                )}
                                            </td>
                                        </tr>

                                        {/* ROW 2: Sub-Parameter Status Bar */}
                                        <tr>
                                            <td
                                                className="px-3 py-2 text-xs italic font-medium"
                                                style={{ ...middleBorderStyle, color: C.slate900 }}
                                            >
                                                Sub-Parameter Status
                                            </td>

                                            <td
                                                className="px-3 py-2"
                                                style={{ ...middleBorderStyle, color: C.slate900 }}
                                            >
                                                <div className="flex flex-wrap gap-4">
                                                    {group.items.map((item) => (
                                                        <div key={item.parameter.id} className="flex items-center gap-2 text-xs" style={{ width: '170px' }}>
                                                            <span style={{
                                                                display: 'inline-block',
                                                                width: '10px',
                                                                height: '10px',
                                                                backgroundColor: getStatusStyle(item.value).backgroundColor,
                                                                border: `1px solid ${getStatusStyle(item.value).borderColor}`
                                                            }} />
                                                            {item.parameter.name}
                                                        </div>
                                                    ))}
                                                </div>
                                            </td>
                                        </tr>
                                    </Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>,

        // --- DYNAMIC WORK LOG PAGES ---

        <div key={`page-2`} style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', backgroundColor: C.white }}>
            <Header header={header} longDate={longDate} userName={userName} gradientPage1={gradientPage1} />


        </div>,

        <div key={`page-3`} style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', backgroundColor: C.white }}>
            <Header header={header} longDate={longDate} userName={userName} gradientPage1={gradientPage1} />



        </div>

    ];

    // --- PDF EXPORT VIEW ---
    // RadarReportTemplates.jsx
    if (exportMode) {
        return (
            <div style={{ width: '794px', height: '3369px', margin: 0, padding: 0, backgroundColor: 'white', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {pages.map((page, index) => (
                    <div key={index} style={{ width: '794px', height: '1123px', overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>
                        {page}
                    </div>
                ))}
            </div>
        );
    }

    // --- SLIDER VIEW ---
    return (
        <div className="space-y-4">
            <div className="bg-white shadow-2xl mx-auto relative overflow-y-auto overflow-x-hidden" style={{ width: '1240px', height: '60vh' }}>
                <div style={{ width: '100%', height: '1754px', position: 'relative' }}>
                    {pages[currentPage - 1]}
                    <div className="absolute bottom-4 right-4 bg-[var(--dtg-gray-300)] text-white px-4 py-2 rounded-lg">
                        <span className="font-medium">{currentPage} / {totalPages}</span>
                    </div>
                </div>
            </div>
            <div className="flex items-center justify-center gap-4">
                <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-6 py-2 bg-[var(--dtg-primary-teal-dark)] text-white rounded-lg hover:bg-blue-700 disabled:bg-[var(--dtg-gray-300)] transition">Previous</button>
                <div className="flex gap-2">
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                        <button key={page} onClick={() => setCurrentPage(page)} className={`w-10 h-10 rounded-lg transition ${currentPage === page ? 'bg-[var(--dtg-primary-teal-dark)] text-white' : 'bg-[var(--dtg-gray-300)] text-[var(--dtg-gray-700)] hover:bg-[var(--dtg-gray-800)]'}`}>{page}</button>
                    ))}
                </div>
                <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="px-6 py-2 bg-[var(--dtg-primary-teal-dark)] text-white rounded-lg hover:bg-blue-700 disabled:bg-[var(--dtg-gray-300)] transition">Next</button>
            </div>
        </div>
    );
};
