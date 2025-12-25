import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { X, FileText, Calendar, Layers } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';

// Report configuration
const REPORT_CONFIG = {
    Insar: {
        table: 'client_images',
        bucket: 'Insar',
        template: 'InsarTemplate',
    },
};

// --- COLORS (Hardcoded to prevent "Lab" crash) ---
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

// --- 1. THE TEMPLATE ---
const InsarTemplate = ({ data, reportInfo, exportMode = false }) => {
    const [currentPage, setCurrentPage] = useState(1);
    const totalPages = 5;

    // GRADIENTS (Using Standard Degrees)
    // 90deg = Left to Right (Page 1)
    const gradientPage1 = `linear-gradient(90deg, ${C.dtgLight} 0%, ${C.dtgDark} 78%)`;
    // 0deg = Bottom to Top (Page 5)
    const gradientPage5 = `linear-gradient(180deg, ${C.dtgLight} 0%, ${C.dtgDark} 78%)`;

    const pages = [
        // Page 1 - Cover Page
        <div key="page-1" style={{ background: gradientPage1, width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '80px' }}>
            <div style={{ position: 'absolute', right: 0, top: 0 }}>
                <img src='/images/template/SlideMasterPage1.jpg' alt="" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'space-between', height: '100%', maxWidth: '42rem', position: 'relative', zIndex: 10 }}>
                <img src='/logo/DTG/DTGlogo.png' alt="DTG" style={{ height: "80px" }} />
                <div>
                    <h1 style={{ fontSize: '3.75rem', lineHeight: 1, color: C.white, fontWeight: 'bold', marginBottom: '1.5rem' }}>MONTHLY INSAR HYDROLOGICAL MONITORING REPORT</h1>
                    <div style={{ width: '42rem', height: '4px', backgroundColor: C.white, marginBottom: '2rem' }}></div>
                </div>
                <div>
                    <p style={{ fontSize: '1.875rem', color: C.dtgDark, fontWeight: 'bold', marginBottom: '1rem' }}>Telfer Mine, Western Australia</p>
                    <div style={{ marginTop: '3rem', color: C.dtgDark, fontSize: '1.5rem', opacity: 0.75 }}>
                        <p style={{ marginTop: '0.5rem' }}>{new Date().toLocaleDateString("en-US", { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                    </div>
                </div>
            </div>
        </div>,

        // Page 2 - Executive Summary
        <div key="page-2" style={{ padding: '48px', backgroundColor: '#EFEBEA', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'center', position: 'relative' }}>
            <div style={{ marginBottom: '2rem', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                <h2 style={{ fontSize: '2.25rem', fontWeight: 'bold', color: C.gray800, marginBottom: '0.5rem' }}>Executive Summary</h2>
                <div style={{ width: '6rem', height: '4px', backgroundColor: C.dtgLight }}></div>
            </div>
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '2rem', width: '100%' }}>
                    {/* Box 1 */}
                    <div style={{ backgroundColor: C.gray50, padding: '1.5rem', borderRadius: '0.5rem', border: `1px solid ${C.gray200}` }}>
                        <h3 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '1rem', color: C.gray800 }}>Report Details</h3>
                        <div style={{ color: C.gray600, fontSize: '1.125rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <p><span style={{ fontWeight: 'bold' }}>Type/Category:</span> {reportInfo.type}/{reportInfo.category}</p>
                            <p><span style={{ fontWeight: 'bold' }}>Satellite Source:</span> Sentinel-2 MSI (Level 2A)</p>
                            <p><span style={{ fontWeight: 'bold' }}>Methodology:</span> Modified Normalized Difference Water Index (MNDWI)</p>
                            <p><span style={{ fontWeight: 'bold' }}>Period:</span> {reportInfo.period}</p>
                        </div>
                    </div>
                    {/* Box 2 */}
                    <div style={{ backgroundColor: C.teal50, padding: '1.5rem', borderRadius: '0.5rem', border: `1px solid ${C.teal200}` }}>
                        <h3 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '1rem', color: C.teal900 }}>Data Availability</h3>
                        <div style={{ color: C.teal700, fontSize: '1.125rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <p><span style={{ fontWeight: 'bold' }}>Processed Scenes:</span> {data?.images?.length || 0}</p>
                            <p><span style={{ fontWeight: 'bold' }}>Latest Update:</span> {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
                            <p><span style={{ fontWeight: 'bold' }}>Data Provider:</span> Copernicus Browser (ESA)</p>
                        </div>
                    </div>
                </div>
                <div style={{ marginTop: '2rem', backgroundColor: C.white, padding: '1.5rem', borderRadius: '0.5rem', border: `2px solid ${C.gray200}`, width: '100%' }}>
                    <h3 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '1rem', color: C.gray800 }}>Key Metrics</h3>
                    <ul style={{ color: C.gray600, fontSize: '1.125rem', listStyleType: 'disc', listStylePosition: 'inside', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <li><span style={{ fontWeight: 'bold' }}>Rainfall: </span>42.7 mm (Highest intensity in the last 10 months)</li>
                        <li><span style={{ fontWeight: 'bold' }}>TSF-7: </span>Dry. No significant surface water detected</li>
                        <li><span style={{ fontWeight: 'bold' }}>TSF-8: </span>Increasing. Water surface area has increased</li>
                    </ul>
                </div>
            </div>
            <img src='/logo/DTG/DTGlogo.png' style={{ height: "40px" }} alt="DTG" />
        </div>,

        // Page 3 - Data Overview
        <div key="page-3" style={{ padding: '48px', backgroundColor: '#EFEBEA', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'center', position: 'relative' }}>
            <div style={{ marginBottom: '2rem', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                <h2 style={{ fontSize: '2.25rem', fontWeight: 'bold', color: C.gray800, marginBottom: '0.5rem' }}>Spatial Water Body Mapping</h2>
                <div style={{ width: '6rem', height: '4px', backgroundColor: C.dtgLight }}></div>
            </div>
            {data?.images && data.images.length > 0 ? (
                <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <p style={{ fontSize: '1.25rem', color: C.gray700, marginBottom: '1.5rem' }}>Retrieved {data.images.length} image records from the database</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1.5rem', overflowY: 'auto', maxHeight: '24rem', width: '100%' }}>
                        {data.images.slice(0, 8).map((img, idx) => (
                            <div key={idx} style={{ backgroundColor: C.gray50, padding: '1rem', borderRadius: '0.5rem', border: `1px solid ${C.gray200}` }}>
                                <p style={{ fontWeight: '600', color: C.gray800, fontSize: '1.125rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: '0.5rem' }}>{img.name || `Image ${idx + 1}`}</p>
                                <div style={{ fontSize: '0.875rem', color: C.gray600, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                    <p><span style={{ fontWeight: '500' }}>Date:</span> {img.created_at ? new Date(img.created_at).toLocaleDateString() : 'N/A'}</p>
                                    <p><span style={{ fontWeight: '500' }}>ID:</span> {img.id || 'N/A'}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '24rem', backgroundColor: C.gray50, borderRadius: '0.5rem', width: '100%' }}>
                    <p style={{ fontSize: '1.5rem', color: C.gray600 }}>No data available for the selected period</p>
                </div>
            )}
            <img src='/logo/DTG/DTGlogo.png' style={{ height: "40px" }} alt="DTG" />
        </div>,

        // Page 4 - Analysis
        <div key="page-4" style={{ padding: '48px', backgroundColor: '#EFEBEA', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'center', position: 'relative' }}>
            <div style={{ marginBottom: '2rem', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                <h2 style={{ fontSize: '2.25rem', fontWeight: 'bold', color: C.gray800, marginBottom: '0.5rem' }}>Water Body Spatial Trend</h2>
                <div style={{ width: '6rem', height: '4px', backgroundColor: C.dtgLight }}></div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%', height: '100%' }}>
                <div style={{ background: `linear-gradient(to right, ${C.blue50}, ${C.indigo50})`, padding: '2rem', borderRadius: '0.5rem', border: `1px solid ${C.blue200}`, height: '18rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ textAlign: 'center' }}>
                        <p style={{ fontSize: '1.5rem', color: C.gray700, marginBottom: '1rem' }}>Main Visualization Area</p>
                        <p style={{ color: C.gray600 }}>Charts, maps, and visual analysis will be displayed here</p>
                    </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                    {[1, 2, 3].map((m) => (
                        <div key={m} style={{ backgroundColor: C.white, padding: '1rem', borderRadius: '0.5rem', border: `1px solid ${C.gray200}`, textAlign: 'center' }}>
                            <p style={{ fontSize: '0.875rem', color: C.gray600, marginBottom: '0.25rem' }}>Metric {m}</p>
                            <p style={{ fontSize: '1.875rem', fontWeight: 'bold', color: C.blue600 }}>--</p>
                        </div>
                    ))}
                </div>
            </div>
            <img src='/logo/DTG/DTGlogo.png' style={{ height: "40px" }} alt="DTG" />
        </div>,

        // Page 5 - Conclusions
        <div key="page-5" style={{ background: gradientPage5, height: '100%', display: 'flex', flexDirection: 'column', padding: '48px', alignItems: 'flex-end', position: 'relative' }}>
            <img src='/logo/DTG/DTGlogo.png' style={{ height: "40px" }} alt="DTG" />
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'flex-start' }}>
                <h1 style={{ fontSize: '3.75rem', color: C.white, fontWeight: 'bold', marginBottom: '1.5rem' }}>Thank You</h1>
            </div>
        </div>
    ];

    // --- PDF EXPORT VIEW ---
    if (exportMode) {
        return (
            <div style={{ width: '1280px', height: '3600px', margin: 0, padding: 0, backgroundColor: 'white', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {pages.map((page, index) => (
                    <div key={index} style={{ width: '1280px', height: '720px', overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>
                        {page}
                    </div>
                ))}
            </div>
        );
    }

    // --- SLIDER VIEW ---
    return (
        <div className="space-y-4">
            <div className="bg-white shadow-2xl mx-auto relative overflow-hidden" style={{ width: '1280px', height: '720px' }}>
                {pages[currentPage - 1]}
                <div className="absolute bottom-4 right-4 bg-[var(--dtg-gray-800)] text-white px-4 py-2 rounded-lg">
                    <span className="font-medium">{currentPage} / {totalPages}</span>
                </div>
            </div>
            <div className="flex items-center justify-center gap-4">
                <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-6 py-2 bg-[var(--dtg-primary-teal-dark)] text-white rounded-lg hover:bg-blue-700 disabled:bg-[var(--dtg-gray-300)] transition">Previous</button>
                <div className="flex gap-2">
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                        <button key={page} onClick={() => setCurrentPage(page)} className={`w-10 h-10 rounded-lg transition ${currentPage === page ? 'bg-[var(--dtg-primary-teal-dark)] text-white' : 'bg-gray-200 text-[var(--dtg-gray-700)] hover:bg-[var(--dtg-gray-300)]'}`}>{page}</button>
                    ))}
                </div>
                <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="px-6 py-2 bg-[var(--dtg-primary-teal-dark)] text-white rounded-lg hover:bg-blue-700 disabled:bg-[var(--dtg-gray-300)] transition">Next</button>
            </div>
        </div>
    );
};

const ReportTemplateRenderer = ({ reportType, data, reportInfo }) => {
    const config = REPORT_CONFIG[reportType];
    return config?.template === 'InsarTemplate' ? <InsarTemplate data={data} reportInfo={reportInfo} /> : <div>Template not found</div>;
};

// --- 2. THE MODAL COMPONENT ---
export default function ReportGeneratorModal({ onClose }) {
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [generatedReport, setGeneratedReport] = useState(null);

    const [formData, setFormData] = useState({
        reportType: 'Insar',
        category: 'Water Body',
        frequency: 'monthly',
        startDate: '',
        endDate: '',
    });

    const reportTypes = Object.keys(REPORT_CONFIG);
    const categories = ['Water Body'];
    const frequencies = [{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }];

    useEffect(() => {
        const handleEscape = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [onClose]);

    const handleInputChange = (field, value) => setFormData(prev => ({ ...prev, [field]: value }));

    const fetchDataFromSupabase = async () => {
        const config = REPORT_CONFIG[formData.reportType];
        const { data: tableData, error: tableError } = await supabase.from(config.table).select('*').gte('date', formData.startDate).lte('date', formData.endDate);
        if (tableError) throw tableError;
        const { data: bucketData, error: bucketError } = await supabase.storage.from(config.bucket).list('', { limit: 100, offset: 0 });
        if (bucketError) throw bucketError;
        return { images: tableData || [], files: bucketData || [] };
    };

    const saveReportToSupabase = async (reportData) => {
        try {
            setLoading(true);
            const timestamp = Date.now();
            const dateStr = formData.endDate || new Date().toISOString().split('T')[0];
            const cleanFileName = `1/${dateStr}_${formData.reportType}_Report_${timestamp}.pdf`;

            const { data: metadata, error: metadataError } = await supabase.from('reports').insert({
                title: 'Monthly Hydrological Report', type: formData.reportType.toLowerCase(), category: formData.category.toLowerCase(), created_at: new Date().toISOString(), status: 'Completed',
                client_id: '1', filename: cleanFileName, description: 'InSAR hydrological monitoring', generatedby: 'DTG', date: formData.endDate, size: '3.7 MB'
            }).select().single();
            if (metadataError) throw metadataError;

            if (typeof window.html2pdf === 'undefined') {
                await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
                    script.onload = resolve; script.onerror = reject; document.head.appendChild(script);
                });
            }

            // --- OFF-SCREEN RENDERING ---
            const container = document.createElement('div');
            container.style.position = 'fixed'; container.style.top = '0'; container.style.left = '0'; container.style.width = '1280px'; container.style.zIndex = '-9999'; container.style.opacity = '0';
            document.body.appendChild(container);

            const root = createRoot(container);
            root.render(<InsarTemplate data={reportData} reportInfo={{ type: formData.reportType, category: formData.category, frequency: formData.frequency, period: `${formData.startDate} to ${formData.endDate}` }} exportMode={true} />);
            
            await new Promise(resolve => setTimeout(resolve, 1500)); 

            // PDF Generation
            const opt = {
                margin: 0,
                filename: cleanFileName.split('/').pop(),
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: {
                    scale: 2,
                    useCORS: true,
                    logging: false,
                    backgroundColor: '#ffffff',
                    width: 1280,
                    height: 3600, // 5 pages * 720
                    windowWidth: 1280,
                    windowHeight: 3600,
                    scrollY: 0,
                    scrollX: 0,
                    x: 0,
                    y: 0,
                },
                pagebreak: { mode: ['avoid-all', 'css'] },
                jsPDF: { unit: 'px', format: [1280, 720], orientation: 'landscape' }
            };

            const elementToCapture = container.firstChild;
            const pdfBlob = await window.html2pdf().set(opt).from(elementToCapture).output('blob');

            root.unmount();
            document.body.removeChild(container);

            const { error: uploadError } = await supabase.storage.from('Reports').upload(cleanFileName, pdfBlob, { contentType: 'application/pdf', upsert: false });
            if (uploadError) throw uploadError;

            setMessage('Report generated successfully!');
            setTimeout(() => { if (onClose) onClose(); }, 1500);
        } catch (error) {
            console.error('Error:', error);
            setMessage(`Error: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleGenerateReport = async () => {
        if (!formData.startDate || !formData.endDate) return setMessage('Please select start and end dates');
        setLoading(true);
        setMessage('');
        try {
            setMessage('Fetching data...');
            const fetchedData = await fetchDataFromSupabase();
            setGeneratedReport({ data: fetchedData, info: { type: formData.reportType, category: formData.category, frequency: formData.frequency, period: `${formData.startDate} to ${formData.endDate}` } });
            setMessage('Generating PDF...');
            setTimeout(async () => { await saveReportToSupabase(fetchedData); }, 100);
        } catch (error) {
            setMessage(`Error: ${error.message}`);
            setLoading(false);
        }
    };

    return (
        <div className="w-full z-[9999] h-full bg-[var(--dtg-gray-900)]/40 backdrop-blur-sm fixed top-0 left-0 flex items-center justify-center p-5" onClick={onClose}>
            <div className="w-full max-w-8xl max-h-[90vh] overflow-y-auto bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                {generatedReport && <div className="mt-8"><h2 className="text-2xl font-bold mb-4 text-[var(--dtg-gray-800)]">Preview</h2><div className="overflow-x-auto"><ReportTemplateRenderer reportType={formData.reportType} data={generatedReport.data} reportInfo={generatedReport.info} /></div></div>}
                <div className="bg-[var(--dtg-bg-card)] rounded-lg shadow-xl overflow-y-auto w-full mt-4">
                    <div className="flex items-center justify-between p-6 border-b"><div className="flex items-center gap-3"><FileText className="text-[var(--dtg-primary-teal-dark)]" size={24} /><h2 className="text-2xl font-semibold text-[var(--dtg-gray-900)]">Create New Report</h2></div><button onClick={onClose}><X size={24} /></button></div>
                    <div className="p-6 space-y-6">
                        <div className="grid grid-cols-2 gap-6">
                            <div><label className="block text-sm font-medium text-[var(--dtg-gray-700)] mb-2">Report Type</label><select value={formData.reportType} onChange={(e) => handleInputChange('reportType', e.target.value)} className="w-full text-[var(--dtg-gray-500)] px-4 py-2 border border-[var(--dtg-gray-300)] rounded-lg">{reportTypes.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
                            <div><label className="block text-sm font-medium text-[var(--dtg-gray-700)] mb-2">Category</label><select value={formData.category} onChange={(e) => handleInputChange('category', e.target.value)} className="w-full text-[var(--dtg-gray-500)] px-4 py-2 border border-[var(--dtg-gray-300)] rounded-lg">{categories.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                        </div>
                        
                        {/* RESTORED FREQUENCY SELECTOR */}
                        <div>
                            <label className="block text-sm font-medium text-[var(--dtg-gray-700)] mb-2"><Calendar size={16} className="inline mr-2" />Frequency</label>
                            <div className="grid grid-cols-3 gap-3">
                                {frequencies.map(freq => (
                                    <button key={freq.value} type="button" onClick={() => handleInputChange('frequency', freq.value)} className={`px-4 py-2 rounded-lg border-2 transition-colors ${formData.frequency === freq.value ? 'border-[var(--dtg-primary-teal-dark)] bg-teal text-[var(--dtg-primary-teal-dark)]' : 'border-[var(--dtg-gray-300)] text-[var(--dtg-gray-500)] hover:border-gray-400'}`} disabled={loading}>
                                        {freq.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div><label className="block text-sm font-medium text-[var(--dtg-gray-700)] mb-2">Start Date</label><input type="date" value={formData.startDate} onChange={(e) => handleInputChange('startDate', e.target.value)} className="w-full px-4 py-2 border border-[var(--dtg-gray-300)] rounded-lg" /></div>
                            <div><label className="block text-sm font-medium text-[var(--dtg-gray-700)] mb-2">End Date</label><input type="date" value={formData.endDate} onChange={(e) => handleInputChange('endDate', e.target.value)} className="w-full px-4 py-2 border border-[var(--dtg-gray-300)] rounded-lg" /></div>
                        </div>
                        {message && <div className={`p-4 rounded-lg ${message.includes('successfully') ? 'bg-green-50 text-green-800' : 'bg-blue-50 text-blue-800'}`}>{message}</div>}
                        <div className="flex gap-3 pt-4"><button onClick={onClose} className="flex-1 px-4 py-2 border border-[var(--dtg-gray-300)] text-[var(--dtg-gray-500)] rounded-lg">Cancel</button><button onClick={handleGenerateReport} disabled={loading || !formData.startDate} className="flex-1 px-4 py-2 bg-[var(--dtg-primary-teal-dark)] text-white rounded-lg">{loading ? 'Generating...' : 'Generate'}</button></div>
                    </div>
                </div>
            </div>
        </div>
    );
}