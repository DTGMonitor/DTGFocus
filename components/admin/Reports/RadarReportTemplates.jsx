import { useState } from 'react';
import { TbNavigationNorth } from "react-icons/tb";
import { Globe, Mail, Phone, Linkedin } from 'lucide-react';


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
    dtgLight: '#4AD0C4',
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
// --- 1. THE TEMPLATE ---
export const RadarTemplate = ({ data, reportInfo, exportMode = false }) => {
    const [currentPage, setCurrentPage] = useState(1);
    const today = new Date();
    const totalPages = 3;
    const header = `24h Data Quality Assessment`;
    const userID = 1;
    const userName = 'Lintang Sadewa';
    const longDate = today.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    // GRADIENTS (Using Standard Degrees)
    // 90deg = Left to Right (Page 1)
    const gradientPage1 = `linear-gradient(270deg, ${C.dtgLight} 0%, ${C.dtgDark} 78%)`;
    // 0deg = Bottom to Top (Page 5)
    const gradientPage5 = `linear-gradient(180deg, ${C.dtgLight} 0%, ${C.dtgDark} 78%)`;
    // --- SHARED STYLES ---
    // We define these here to ensure we use exact hex codes in the render
    const tableHeaderStyle = { padding: '8px 12px', textAlign: 'left', fontSize: '12px', color: C.gray700, backgroundColor: C.gray50, borderBottom: `1px solid ${C.gray200}` };
    const tableCellStyle = { padding: '12px', fontSize: '14px', color: C.slate900, borderBottom: `1px solid ${C.gray200}` };
    const centerCellStyle = { ...tableCellStyle, textAlign: 'center' };


    const pages = [
        // --- PAGE 1 ---
        <div key="page-1" style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', backgroundColor: C.white }}>
            {/* Header */}
            <Header header={header} longDate={longDate} userName={userName} gradientPage1={gradientPage1} />

            {/* Content */}

            {/* Content */}
            <div style={{ padding: '40px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <h2 style={{ fontSize: '24px', color: C.slate900, fontWeight: 'bold', borderBottom: `2px solid ${C.slate900}`, paddingBottom: '10px', margin: 0 }}>Radar Monitoring Checklist</h2>
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
    if (exportMode) {
        return (
            <div style={{ width: '3600px', height: '1280px', margin: 0, padding: 0, backgroundColor: 'white', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {pages.map((page, index) => (
                    <div key={index} style={{ width: '720px', height: '1280px', overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>
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
