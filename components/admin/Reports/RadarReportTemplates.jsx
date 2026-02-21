import { useMemo, Fragment, useState } from "react";
import { getStatusDefinition } from "@/config/statusConfig";
import { getGlossaryForRadar } from "@/config/glossaryConfig";

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

export const Header = ({ header, longDate, sensor, gradientPage1 }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 40px', background: gradientPage1 }}>
        <div>
            <GradientTitle text1={header} text2={`${sensor?.site_name} - ${sensor?.radar_number}`} text3={longDate} />
        </div>
        <img src='/logo/DTG/DTGlogo.png' alt="DTG" style={{ height: "60px" }} />
    </div>
);

export const Footer = ({ wallfolder }) => (
    <div style={{
        position: 'absolute',
        bottom: '30px',
        left: '30px',
        fontSize: 14,
        fontStyle: 'italic',
        color: C.slate900
    }}>
        Wall Folder: {wallfolder}
    </div>
)

export const Disclaimer = () => (
    <div>
        <h2 style={{ fontWeight: 'bold', fontSize: '20px', color: C.slate900 }}>Disclaimer</h2>
        <p style={{ textAlign: 'justify', color: C.teal900 }}>
            While DTG takes all practical steps to ensure that the services are provided with reasonable care, skill, and professionalism, no guarantees are given regarding the outcome, accuracy, or suitability of the services for any specific purpose. For the avoidance of doubt, DTG’s role is limited to providing geotechnical monitoring services; DTG does not act as a consultant and does not provide direct advice or decision-making services for the Client. The Client acknowledges and accepts full responsibility for the use and interpretation of the data and services provided.
        </p>
    </div>
)

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
            fontSize="26"
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
            fontSize="20"
            fill="url(#textGradient)" // Apply the gradient here
            style={{ textTransform: 'uppercase' }}
        >
            {text2} | {text3}
        </text>
    </svg>
);

// --- 1. THE TEMPLATE ---
export const RadarTemplate = ({ data, sensor, exportMode = false }) => {
    const [currentPage, setCurrentPage] = useState(1);
    const today = new Date();
    const header = `24h Data Quality Assessment`;
    const STATUS_TYPES = ['Optimal', 'Acceptable', 'Sub-Optimal', 'Critical'];
    const longDate = today.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const gradientPage1 = `linear-gradient(270deg, ${C.dtgLight} 0%, ${C.dtgDark} 78%)`;
    const tableHeaderStyle = {
        textTransform: 'uppercase',
        padding: '8px',
        textAlign: 'center',
        fontSize: '18px',
        fontWeight: 'bold',
        color: C.white,
        backgroundColor: C.dtgDark,
        margin: 0
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

            // Filter out parameter 26
            if (param.id === 26) return;

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

    // Get non optimal status
    const nonOptimalParams = useMemo(() => {
        if (!data || data.length === 0) return [];
        return data.filter(item => item.value !== 'Optimal' && item.value !== 'N/A' && item.value !== null && item.parameter?.level !== 0 && item.parameter?.level !== 1);
    }, [data]);

    // Filter Appendix Items
    const appendixItems = useMemo(() => {
        if (!data) return [];
        return data.filter(item =>
            item.notes && (item.image || item.appendix)
        ).sort((a, b) => (a.parameter?.id || 0) - (b.parameter?.id || 0));
    }, [data]);

    const ITEMS_PER_PAGE = 2;
    const appendixChunks = useMemo(() => {
        const chunks = [];
        for (let i = 0; i < appendixItems.length; i += ITEMS_PER_PAGE) {
            chunks.push(appendixItems.slice(i, i + ITEMS_PER_PAGE));
        }
        return chunks;
    }, [appendixItems]);

    const hasAppendices = appendixItems.length > 0;
    const totalPages = 2 + (appendixChunks.length > 0 ? appendixChunks.length : 0);
    const getLetter = (i) => String.fromCharCode(65 + i);

    const formatParamName = (name) => {
        if (!name) return '';
        let lower = name.toLowerCase();
        const abbreviations = ['SSR', 'EDM', 'DSRA', 'SRA', '3D-DTM'];
        abbreviations.forEach(abbr => {
            const regex = new RegExp(`\\b${abbr.toLowerCase()}\\b`, 'g');
            lower = lower.replace(regex, abbr);
        });
        return lower;
    };

    const formatParamList = (items) => {
        if (!items || items.length === 0) return '';
        const names = items.map(item => formatParamName(item.parameter?.name));
        if (names.length === 1) return names[0];
        if (names.length === 2) return `${names[0]} and ${names[1]}`;
        const last = names[names.length - 1];
        const initial = names.slice(0, -1).join(', ');
        return `${initial}, and ${last}`;
    };

    // Safe early return after hooks
    if (!data || data.length === 0) return null;

    const pages = [
        // --- PAGE 1 ---
        <div key="page-1" style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', backgroundColor: C.white }}>
            {/* Header */}
            <Header header={header} longDate={longDate} sensor={sensor} gradientPage1={gradientPage1} />

            {/* Content */}
            <div style={{
                padding: '20px 40px',
                gap: 20,
                display: 'flex',
                flex: 1,
                flexDirection: 'column',
                justifyContent: 'flex-start' // <--- Forces content to stay at the top
            }}>
                {/* 1. Current Data Quality Assessment */}
                <div style={{ width: '100%', overflow: 'hidden' }}>
                    <div style={tableHeaderStyle}>Current Data Quality Assessment</div>
                    <div style={{ display: 'flex', borderTop: '3px solid white', backgroundColor: C.white }}>
                        <div style={{
                            width: '250px',
                            height: '80px',
                            backgroundColor: overallColor,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '18px',
                            fontWeight: 'bold',
                            textTransform: 'uppercase',
                            color: 'white',
                            borderRight: '3px solid white'
                        }}>
                            {overallStatus}
                        </div>
                        <div style={{
                            flex: 1,
                            padding: 10,
                            display: 'flex',
                            alignItems: 'center',
                            color: 'black',
                            fontWeight: 'bold',
                            fontSize: '18px',
                            borderBottom: '2px solid black'
                        }}>
                            Monitoring data for this period is considered {overallStatus.toLowerCase()} {nonOptimalParams.length === 0 ? '' : `due to ${formatParamList(nonOptimalParams)}`}. {getStatusDefinition(overallStatus)?.summary}
                            </div>
                    </div>
                </div>

                {/* 2. Data Quality Parameter */}
                <div>
                    <div style={tableHeaderStyle}>Data Quality Parameter</div>
                    <div>
                        {processedGroups.map((group, index) => {
                            const groupStyle = getStatusStyle(group.status);
                            const itemsWithNotes = group.items.filter(item => item.notes !== null && item.notes.trim() !== "");

                            return (
                                <div key={group.id} style={{ display: 'flex' }}>
                                    {/* Left: Color Bar */}
                                    <div style={{
                                        width: '15px',
                                        backgroundColor: groupStyle.backgroundColor,
                                        borderRight: '3px solid white',
                                        borderBottom: '3px solid white' // Matches original look
                                    }} />

                                    {/* Right: Content */}
                                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                                        {/* Top Row: Name & Description */}
                                        <div style={{ display: 'flex', minHeight: '100px', borderBottom: '1px solid black' }}>
                                            <div style={{
                                                width: '20%',
                                                display: 'flex',
                                                alignItems: 'center',
                                                padding: '0 12px',
                                                fontWeight: 'bold',
                                                textTransform: 'uppercase',
                                                color: groupStyle.color,
                                                fontSize: '18px'
                                            }}>
                                                {group.name}
                                            </div>
                                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', padding: '0 12px', color: C.slate900 }}>
                                                {itemsWithNotes.length > 0 ? (
                                                    <ul className="list-inside" style={{ margin: 0, padding: 0 }}>
                                                        {itemsWithNotes.map((item) => {
                                                            const appIndex = appendixItems.findIndex(ai => ai.parameter?.id === item.parameter?.id);
                                                            const letter = appIndex !== -1 ? getLetter(appIndex) : null;
                                                            return (
                                                                <li key={item.parameter.id} className="py-1" style={{ fontSize: '16px' }}>
                                                                    ➤ {item.notes} {letter && <a href={`#appendix-${letter}`} style={{ fontWeight: 'bold', color: 'inherit', textDecoration: 'none' }}>(Appendix {letter})</a>}
                                                                </li>
                                                            );
                                                        })}
                                                    </ul>
                                                ) : (
                                                    <p className="py-1" style={{ color: C.slate900, fontSize: '16px', margin: 0 }}>
                                                        ➤ {group.name !== 'Alarms'
                                                            ? `${group.name} setup is optimal.`
                                                            : group.items.some(i => (i.parameter?.id === 20 || i.parameter?.id === 21) && i.value && i.value.toLowerCase() !== 'n/a')
                                                                ? 'Alarms setup is optimal.'
                                                                : 'No alarm applied in the system.'}
                                                    </p>
                                                )}
                                            </div>
                                        </div>

                                        {/* Bottom Row: Sub-Parameter Status */}
                                        <div style={{ display: 'flex', borderBottom: '2px solid black' }}>
                                            <div style={{
                                                width: '20%',
                                                padding: '8px 12px',
                                                fontStyle: 'italic',
                                                fontWeight: '500',
                                                color: C.slate900,
                                                fontSize: '14px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                borderRight: '3px solid white', // Matches original middleBorderStyle
                                                borderLeft: '3px solid white'
                                            }}>
                                                Sub-Parameter Status
                                            </div>
                                            <div style={{ flex: 1, padding: '8px 12px', color: C.slate900, display: 'flex', alignItems: 'center' }}>
                                                <div className="flex gap-2">
                                                    {group.items.map((item) => (
                                                        <div key={item.parameter.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginRight: 20, fontSize: '14px' }}>
                                                            <span style={{
                                                                display: 'inline-block',
                                                                width: '10px',
                                                                height: '10px',
                                                                backgroundColor: getStatusStyle(item.value).backgroundColor,
                                                        border: `1px solid ${getStatusStyle(item.value).borderColor}`                                                    
                                                    }} /><span>{item.parameter.name}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* 3. Definition Table */}
                <div style={{ width: '100%' }}>
                    <div style={tableHeaderStyle}>Definition</div>
                    <div style={{ borderBottom: '2px solid black' }}>
                        {/* Row 1: Headers */}
                        <div style={{ display: 'flex'}}>
                            {STATUS_TYPES.map((status, i) => (
                                <div key={status} style={{
                                    width: '25%',
                                    padding: '10px 5px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    backgroundColor: getStatusStyle(status).backgroundColor,
                                    color: 'white',
                                    fontWeight: 'bold',
                                    textTransform: 'uppercase',
                                    fontSize: '16px',
                                    borderRight: i < 3 ? '3px solid white' : 'none',
                                    borderTop: '3px solid white'
                                }}>
                                    {status}
                                </div>
                            ))}
                        </div>
                        {/* Row 2: Actions */}
            <div style={{ display: 'flex', alignItems: 'center' }}>
                            {STATUS_TYPES.map((status, i) => (
                                <div key={status} style={{
                                    width: '25%',
                                    padding: '10px 5px',
                                    color: 'black',
                                    fontWeight: 'bold',
                                    fontStyle: 'italic',
                                    fontSize: '14px',
                                    borderRight: i < 3 ? '3px solid white' : 'none'
                                }}>
                                    {getStatusDefinition(status).action}
                                </div>
                            ))}
                        </div>
                        {/* Row 3: Definitions */}
            <div style={{ display: 'flex', alignItems: 'center' }}>
                            {STATUS_TYPES.map((status, i) => (
                                <div key={status} style={{
                                    width: '25%',
                                    padding: '10px 5px',
                                    color: C.gray600,
                                    fontStyle: 'italic',
                                    fontSize: '13px',
                                    textAlign: 'justify',
                                    borderRight: i < 3 ? '3px solid white' : 'none'
                                }}>
                                    {getStatusDefinition(status).definition}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
            <Footer wallfolder={sensor?.wallfoldername} />
        </div>,

        // --- DYNAMIC WORK LOG PAGES ---

        <div key={`page-2`} style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', backgroundColor: C.white }}>
            <Header header={header} longDate={longDate} sensor={sensor} gradientPage1={gradientPage1} />
            <div style={{ padding: '20px 40px 80px', display: 'flex', flex: 1, flexDirection: 'column', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    <div style={tableHeaderStyle}>Glossary</div>
                    {getGlossaryForRadar(sensor?.radar_number).map(item => (
                        <div key={item.term} style={{ color: 'black' }}>
                            <h2 style={{ fontWeight: 'bold', textTransform: 'uppercase' }}>{item.term}</h2>
                            <p style={{ textAlign: 'justify' }}>{item.definition}</p>
                        </div>
                    ))}
                </div>
                {!hasAppendices && (
                    <div style={{ marginTop: 'auto', paddingTop: 20, paddingBottom: 60 }}>
                        <Disclaimer />
                    </div>
                )}
            </div>
            <Footer wallfolder={sensor?.wallfoldername} />
        </div>,

        // --- DYNAMIC APPENDIX PAGES ---
        ...appendixChunks.map((chunk, pageIndex) => (
            <div key={`page-appendix-${pageIndex}`} style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', backgroundColor: C.white }}>
                <Header header={header} longDate={longDate} sensor={sensor} gradientPage1={gradientPage1} />
                <div style={{ padding: '20px 40px 60px', display: 'flex', flex: 1, flexDirection: 'column', gap: 20 }}>
                    
                    {chunk.map((item, itemIndex) => {
                        const globalIndex = pageIndex * ITEMS_PER_PAGE + itemIndex;
                        const letter = getLetter(globalIndex);
                        return (
                            <div key={item.parameter?.id || globalIndex} id={`appendix-${letter}`} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {/* Appendix Title */}
                                <h2 style={{ fontWeight: 'bold', fontSize: '18px', color: C.slate900, textTransform: 'uppercase', borderBottom: `2px solid ${C.dtgDark}`, paddingBottom: '5px' }}>
                                    APPENDIX {letter}
                                </h2>

                                {/* Appendix Content */}
                                {item.appendix && (
                                    <p style={{ textAlign: 'justify', color: C.slate900, fontSize: '14px', whiteSpace: 'pre-wrap' }}>
                                        {item.appendix}
                                    </p>
                                )}

                                {/* Image */}
                                {item.fullImageUrl && (
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10, marginTop: 10 }}>
                                        <img 
                                            src={item.fullImageUrl} 
                                            alt={`Appendix ${getLetter(globalIndex)}`} 
                                            style={{ maxWidth: '100%', maxHeight: '450px', objectFit: 'contain', border: `1px solid ${C.gray200}` }} 
                                        />
                                        <p style={{ fontStyle: 'italic', fontSize: '14px', color: C.gray600 }}>
                                            <strong>Figure {globalIndex + 1}. </strong>{item.caption || item.parameter?.name}
                                        </p>
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {/* Disclaimer only on the very last page */}
                    {pageIndex === appendixChunks.length - 1 && (
                        <div style={{ marginTop: 'auto', paddingTop: 20 }}>
                            <Disclaimer />
                        </div>
                    )}
                </div>
                <Footer wallfolder={sensor?.wallfoldername} />
            </div>
        ))

    ];

    // --- PDF EXPORT VIEW ---
    // RadarReportTemplates.jsx
    // Inside the exportMode condition
    if (exportMode) {
        return (
            <div style={{ width: '1240px', margin: 0, padding: 0, backgroundColor: 'white', display: 'flex', flexDirection: 'column', fontFamily: 'Arial, sans-serif' }}>
                {pages.map((page, index) => (
                    <div key={index} style={{
                        width: '1240px', // MATCH THE PREVIEW WIDTH
                        height: '1754px', // Scale the height proportionally (1123 / 0.64)
                        overflow: 'hidden',
                        position: 'relative',
                        display: 'flex',
                        flexDirection: 'column',
                    }}>
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
                    <div className="absolute bottom-4 right-4 bg-[var(--dtg-gray-300)] text-white px-4 py-1 rounded-lg">
                        <span className="font-medium">{currentPage} / {totalPages}</span>
                    </div>
                </div>
            </div>
            <div className="flex items-center justify-center gap-4">
                <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-6 py-1 bg-[var(--dtg-primary-teal-dark)] text-white rounded-lg hover:bg-blue-700 disabled:bg-[var(--dtg-gray-300)] transition">Previous</button>
                <div className="flex gap-2">
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                        <button key={page} onClick={() => setCurrentPage(page)} className={`w-10 h-10 rounded-lg transition ${currentPage === page ? 'bg-[var(--dtg-primary-teal-dark)] text-white' : 'bg-[var(--dtg-gray-300)] text-[var(--dtg-gray-700)] hover:bg-[var(--dtg-gray-800)]'}`}>{page}</button>
                    ))}
                </div>
                <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="px-6 py-1 bg-[var(--dtg-primary-teal-dark)] text-white rounded-lg hover:bg-blue-700 disabled:bg-[var(--dtg-gray-300)] transition">Next</button>
            </div>
        </div>
    );
};
