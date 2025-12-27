import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { X, FileText, Calendar, ArrowLeft } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useUserSite } from "../../Reusable/useUserSite";
import { InsarTemplate } from '@/components/admin/Reports/ReportTemplates';

// Report configuration
const REPORT_CONFIG = {
    Insar: {
        table: 'client_images',
        bucket: 'Insar',
        template: 'InsarTemplate',
        title: 'Monthly Insar Water Body Report',
        description: 'InSAR hydrological - water body monitoring'
    },
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
    const [showPreview, setShowPreview] = useState(false);
    const { user, userSite, loading: authLoading } = useUserSite();
    const [clientsList, setClientsList] = useState([]);
    const [loadingClients, setLoadingClients] = useState(true);

    const displayName = userSite?.displayname || user?.email;

    //Fetch Client Options
    useEffect(() => {
        const fetchClients = async () => {
            try {
                const { data, error } = await supabase
                    .from('clients')
                    .select('id, site_name, company,location')
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

    // 1. Helper to get "YYYY-MM-DD" string for inputs
    const formatDate = (dateObj) => dateObj.toLocaleDateString('en-CA');

    // 2. Calculate defaults
    const today = new Date();

    // Create a NEW date object for the start date so we don't modify 'today'
    const startDateObj = new Date();
    // Default is 'monthly', so we subtract 365 days (based on your logic)
    startDateObj.setDate(today.getDate() - 183);

    const [formData, setFormData] = useState({
        clientID: '',
        reportType: 'Insar',
        category: 'Water Body',
        frequency: 'monthly',
        startDate: formatDate(startDateObj), // "2024-12-26"
        endDate: formatDate(today),          // "2025-12-26"
    });

    const siteName = clientsList.find(s => String(s.id) === String(formData.clientID))?.site_name || 'Unknown';
    const company = clientsList.find(s => String(s.id) === String(formData.clientID))?.company || 'Unknown';
    const location = clientsList.find(s => String(s.id) === String(formData.clientID))?.location || 'Unknown';
    const completeSiteName = `${siteName}, ${location}`

    const frequencies = [
        { value: 'daily', label: 'Daily' },
        { value: 'weekly', label: 'Weekly' },
        { value: 'monthly', label: 'Monthly' }
    ];

    const reportTypes = Object.keys(REPORT_CONFIG);
    const categories = ['Water Body'];

    //filename
    const rawDate = formData.endDate || new Date().toISOString().split('T')[0];
    const compactDate = rawDate.replaceAll('-', '').slice(2);
    const freqLabel = frequencies.find(f => f.value === formData.frequency).label || 'Unknown';
    const fileName = `${compactDate}_${siteName}_${freqLabel}_${formData.reportType} ${formData.category} Report.pdf`;

    useEffect(() => {
        const handleEscape = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [onClose]);


    const getStartDateForFreq = (freq, cat) => {
        const d = new Date();
        if (freq === 'daily') d.setDate(d.getDate() - 1);
        else if (freq === 'weekly') d.setDate(d.getDate() - 7);
        else if (freq === 'monthly' && cat === 'Water Body') d.setDate(d.getDate() - 183);
        else if (freq === 'monthly') d.setDate(d.getDate() - 30)
        return d.toLocaleDateString('en-CA');
    };

    // Update your handleInputChange to use it
    const handleInputChange = (field, value) => {
        setFormData(prev => {
            const newData = { ...prev, [field]: value };

            // If they changed frequency, auto-update the start date
            if (field === 'frequency' || field === 'category') {
                newData.startDate = getStartDateForFreq(newData.frequency, newData.category);
            }

            return newData;
        });
    };

    const fetchDataFromSupabase = async () => {
        const config = REPORT_CONFIG[formData.reportType];
        const { data: tableData, error: tableError } = await supabase
            .from(config.table)
            .select('type, date, category, client_id,image_url,subcategory,tsf7,tsf8,rainfall')
            .gte('date', formData.startDate)
            .lte('date', formData.endDate)
            .eq('subcategory', 'MNDWI')
            .eq('client_id', formData.clientID);

        if (tableError) throw tableError;

        // Get signed URLs for private bucket access
        const dataWithUrls = await Promise.all(
            (tableData || []).map(async (item) => {
                if (item.image_url) {
                    const { data, error } = await supabase.storage
                        .from(config.bucket)
                        .createSignedUrl(item.image_url, 3600); // expires in 1 hour

                    return {
                        ...item,
                        fullImageUrl: data?.signedUrl || null
                    };
                }
                return { ...item, fullImageUrl: null };
            })
        );

        return { mndwi: dataWithUrls, files: [] };
    };

    //REPORT CONTENT
    const periodAdjustment = (dateVal) => {
        const dateObj = new Date(dateVal);
        if (formData.frequency === 'monthly') {
            return dateObj.toLocaleDateString('en-CA', { year: "numeric", month: "long" })
        };
        return dateVal;
    };

    const dateAdjustment = (dateVal) =>
        new Date(dateVal).toLocaleDateString('en-CA', { year: "2-digit", month: "short" });
    const latestField = (arr, prop) =>
        arr?.length ? arr[arr.length - 1][prop] : null;
    const maxField = (arr, prop) =>
        arr?.length ? Math.max(...arr.map(arr => arr[prop])) : null;
    const minField = (arr, prop) =>
        arr?.length ? Math.min(...arr.map(arr => arr[prop])) : null;
    const prevVal = (arr, prop) =>
        arr?.length ? arr[arr.length - 2][prop] : null;
    const fieldDate = (arr, prop, maxF, prop2) =>
        arr?.length ? arr.find(arr => arr[prop] === maxF)[prop2] : null;
    const getDateofMax = (data, valueFields, dateFields) => {
        if (!data || data.length === 0) return null;

        const winner = data.reduce((prev, curr) => {
            const validValues = valueFields
                .map(key => curr[key])
                .filter(v => v != null && !isNaN(v));

            const currentMax = validValues.length ? Math.max(...validValues) : -Infinity;

            if (currentMax > prev.highestValue) {
                return { highestValue: currentMax, resultDate: curr[dateFields] };
            }
            return prev;
        }, { highestValue: -Infinity, resultDate: null });

        return winner.resultDate;
    }


    const saveReportToSupabase = async () => {
        if (!generatedReport) return;

        try {
            setLoading(true);
            const config = REPORT_CONFIG[formData.reportType];
            const title = config.title;
            const description = config.description;
            const cleanFileName = `${formData.clientID}/${fileName}`;

            if (typeof window.html2pdf === 'undefined') {
                await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
                    script.onload = resolve;
                    script.onerror = reject;
                    document.head.appendChild(script);
                });
            }

            // --- OFF-SCREEN RENDERING ---
            const container = document.createElement('div');
            container.style.position = 'fixed';
            container.style.top = '0';
            container.style.left = '0';
            container.style.width = '1280px';
            container.style.zIndex = '-9999';
            container.style.opacity = '0';
            document.body.appendChild(container);

            const root = createRoot(container);
            // Use the same data and info from generatedReport
            root.render(
                <InsarTemplate
                    data={generatedReport.data}
                    reportInfo={generatedReport.info}
                    exportMode={true}
                />
            );

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
                    height: 3600,
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

            const fileSizeInBytes = pdfBlob.size;
            const fileSizeInKB = (fileSizeInBytes / 1024).toFixed(2);
            const fileSizeInMB = (fileSizeInBytes / (1024 * 1024)).toFixed(2);

            const formattedSize = fileSizeInBytes > 1024 * 1024 ?
                `${fileSizeInMB} MB` : `${fileSizeInKB} KB`;

            root.unmount();
            document.body.removeChild(container);

            const { data: metadata, error: metadataError } = await supabase.from('reports').insert({
                title: title,
                type: formData.reportType.toLowerCase(),
                category: formData.category.toLowerCase(),
                created_at: new Date().toISOString(),
                status: 'Completed',
                client_id: formData.clientID,
                filename: cleanFileName,
                description: description,
                generatedby: displayName,
                date: formData.endDate,
                size: formattedSize
            }).select().single();

            if (metadataError) throw metadataError;

            const { error: uploadError } = await supabase.storage.from('Reports').upload(
                cleanFileName,
                pdfBlob,
                { contentType: 'application/pdf', upsert: false }
            );

            if (uploadError) throw uploadError;

            setMessage('Report generated successfully!');
        } catch (error) {
            console.error('Error:', error);
            setMessage(`Error: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };
    const handleGenerateReport = async () => {
        if (!formData.startDate || !formData.endDate || !formData.clientID) return setMessage('Please select the required fields');
        setLoading(true);
        setMessage('');
        try {
            setMessage('Fetching data...');
            const fetchedData = await fetchDataFromSupabase();



            const highestRainfall = maxField(fetchedData.mndwi, 'rainfall');
            const lowestRainfall = minField(fetchedData.mndwi, 'rainfall');
            const currRainfall = latestField(fetchedData.mndwi, 'rainfall');
            const rainfallStatus = currRainfall === highestRainfall ? `(Highest in last ${fetchedData.mndwi.length} months)` :
                currRainfall === lowestRainfall ? `(Lowest in last ${fetchedData.mndwi.length} months)` : null;
            const currTSF7 = latestField(fetchedData.mndwi, 'tsf7');
            const currTSF8 = latestField(fetchedData.mndwi, 'tsf8');
            const prevTSF7 = prevVal(fetchedData.mndwi, 'tsf7');
            const prevTSF8 = prevVal(fetchedData.mndwi, 'tsf8');
            const tsfStatus = (curr, prev) =>
                curr === 0 ? 'Dry. No significant surface water detected' :
                    curr > prev ? 'Increasing. Water surface area has increased' :
                        curr < prev ? 'Decreasing. Water surface area has decreased' : null;
            const tsf7Status = tsfStatus(currTSF7, prevTSF7);
            const tsf8Status = tsfStatus(currTSF8, prevTSF8);
            const highesttsf7 = maxField(fetchedData.mndwi, 'tsf7');
            const highesttsf8 = maxField(fetchedData.mndwi, 'tsf8');
            const highestArea = Math.max(highesttsf7, highesttsf8);
            const highestRainfallDate = fieldDate(fetchedData.mndwi, 'rainfall', highestRainfall, 'date');
            const highestAreaDate = getDateofMax(fetchedData.mndwi, ['tsf7', 'tsf8'], 'date');

            setGeneratedReport({
                data: fetchedData,
                info: {
                    generatedBy: displayName,
                    type: formData.reportType,
                    category: formData.category,
                    frequency: formData.frequency,
                    period: `${periodAdjustment(formData.startDate)} to ${periodAdjustment(formData.endDate)}`,
                    latest: latestField(fetchedData.mndwi, 'date'),
                    rainfall: currRainfall,
                    rainfallStatus: rainfallStatus,
                    highestRainfall: highestRainfall,
                    highestRainfallDate: dateAdjustment(highestRainfallDate),
                    highestAreaDate: dateAdjustment(highestAreaDate),
                    tsf7: currTSF7,
                    tsf8: currTSF8,
                    tsf7Status: tsf7Status,
                    tsf8Status: tsf8Status,
                    highestArea: highestArea,
                    site: completeSiteName,
                    company: company
                }
            });
            setMessage('');
            setShowPreview(true);
        } catch (error) {
            setMessage(`Error: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleSavePDF = async () => {
        if (!generatedReport) return;
        setLoading(true);
        setMessage('Generating PDF...');
        try {
            await saveReportToSupabase(generatedReport.data);
            setTimeout(() => onClose(), 2000);
        } catch (error) {
            setMessage(`Error: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleBackToForm = () => {
        setShowPreview(false);
        setMessage('');
    };

    return (
        <div className="w-full z-[9999] h-full bg-[var(--dtg-gray-900)]/40 backdrop-blur-sm fixed top-0 left-0 flex items-center justify-center p-5" onClick={onClose}>
            <div className="max-w-8xl max-h-[90vh] overflow-y-auto bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                {showPreview && generatedReport ? (
                    <div className="mt-0">
                        <div className='flex items-start justify-between border-b mb-3'>
                            <h2 className="text-2xl font-bold mb-4 text-[var(--dtg-gray-800)]">Preview - {fileName}
                            </h2>
                            <button onClick={onClose}><X size={24} /></button>
                        </div>
                        <div className="overflow-x-auto">
                            <ReportTemplateRenderer reportType={formData.reportType} data={generatedReport.data} reportInfo={generatedReport.info} />
                        </div>
                        {message && (
                            <div className={`mx-6 p-4 rounded-lg ${message.includes('successfully') ? 'bg-green-50 text-green-800' :
                                message.includes('Error') ? 'bg-red-50 text-red-800' :
                                    'bg-blue-50 text-blue-800'
                                }`}>
                                {message}
                            </div>
                        )}<div className="flex gap-3 p-6 border-t mt-6">
                            <button
                                onClick={handleBackToForm}
                                className="flex items-center gap-2 flex-1 px-4 py-2 border border-[var(--dtg-gray-300)] text-[var(--dtg-gray-700)] rounded-lg hover:bg-gray-50 transition"
                                disabled={loading}
                            >
                                <ArrowLeft size={18} />
                                Back to Form
                            </button>
                            <button
                                onClick={handleSavePDF}
                                disabled={loading}
                                className="flex-1 px-4 py-2 bg-teal-600 text-[var(--dtg-text-primary)] rounded-lg hover:bg-teal-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {loading ? 'Generating PDF...' : 'Generate & Save PDF'}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="bg-[var(--dtg-bg-card)] rounded-lg shadow-xl overflow-y-auto w-full mt-4">
                        <div className="flex items-center justify-between p-6 border-b"><div className="flex items-center gap-3"><FileText className="text-[var(--dtg-primary-teal-dark)]" size={24} /><h2 className="text-2xl font-semibold text-[var(--dtg-gray-900)]">Create New Report</h2></div><button onClick={onClose}><X size={24} /></button></div>
                        <div className="p-6 space-y-6">
                            {/* Client Selection */}
                            <div className="mb-4">
                                <label className="text-[var(--dtg-gray-700)] block mb-1 text-sm">Client / Site *</label>
                                <select
                                    required
                                    value={formData.clientID}
                                    onChange={(e) => handleInputChange('clientID', e.target.value)}
                                    className="w-full text-[var(--dtg-gray-500)] px-4 py-2 border border-[var(--dtg-gray-300)] rounded-lg"
                                >
                                    <option value="">Select a Client</option>
                                    {clientsList.map((client) => (
                                        <option key={client.id} value={client.id}>
                                            {client.site_name}, {client.company}
                                        </option>
                                    ))}
                                </select>
                            </div>


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
                            <div className="flex gap-3 pt-4"><button onClick={onClose} className="flex-1 px-4 py-2 border border-[var(--dtg-gray-300)] text-[var(--dtg-gray-500)] rounded-lg">Cancel</button><button onClick={handleGenerateReport} disabled={loading || !formData.startDate} className="flex-1 px-4 py-2 bg-[var(--dtg-primary-teal-dark)] text-white rounded-lg">{loading ? 'Loading...' : 'Preview Report'}</button> </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}