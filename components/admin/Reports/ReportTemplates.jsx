import { useState} from 'react';
import WaterChartReport from "@/components/InSar/ChartWaterReport";
import { TbNavigationNorth } from "react-icons/tb";
import ColorBar from "@/components/InSar/colorBar";
import ScaleBar from "@/components/InSar/scaleBar";
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

// --- 1. THE TEMPLATE ---
export const InsarTemplate = ({ data, reportInfo, exportMode = false }) => {
    const [currentPage, setCurrentPage] = useState(1);
    const totalPages = 5;

    // GRADIENTS (Using Standard Degrees)
    // 90deg = Left to Right (Page 1)
    const gradientPage1 = `linear-gradient(90deg, ${C.dtgLight} 0%, ${C.dtgDark} 78%)`;
    // 0deg = Bottom to Top (Page 5)
    const gradientPage5 = `linear-gradient(180deg, ${C.dtgLight} 0%, ${C.dtgDark} 78%)`;
    const arrows = (latestStatus) => {
        if (!latestStatus) return "";

        const status = latestStatus.toLowerCase();

        if (status.includes('increase') || status.includes('highest')) {
            return <span style={{ fontWeight: "bold", fontSize: '0.875rem', color: '#DC2626' }}>▲ </span>;
        }
        if (status.includes('decrease') || status.includes('highest')) {
            return <span style={{ fontWeight: "bold", fontSize: '0.875rem', color: '#16A34A' }}>▼ </span>;
        }

        return "";
    };

    const arrowRainfall = arrows(reportInfo.rainfallStatus);
    const arrowTSF7 = arrows(reportInfo.tsf7Status);
    const arrowTSF8 = arrows(reportInfo.tsf8Status);

    const pages = [
        // Page 1 - Cover Page
        <div key="page-1" style={{ background: gradientPage1, width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '80px' }}>
            <div style={{ position: 'absolute', right: 0, top: 0 }}>
                <img src='/images/template/SlideMasterPage1.jpg' alt="" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'space-between', height: '100%', maxWidth: '42rem', position: 'relative', zIndex: 10 }}>
                <img src='/logo/DTG/DTGlogo.png' alt="DTG" style={{ height: "80px" }} />
                <div>
                    <h1 style={{ fontSize: '3.75rem', lineHeight: 1, color: C.white, fontWeight: 'bold', marginBottom: '1.5rem' }} className='uppercase'>{reportInfo.frequency} {reportInfo.type} {reportInfo.category} report</h1>
                    <div style={{ width: '42rem', height: '4px', backgroundColor: C.white, marginBottom: '2rem' }}></div>
                </div>
                <div>
                    <p style={{ fontSize: '1.875rem', color: C.dtgDark, fontWeight: 'bold' }}>{reportInfo.site}</p>
                    <p style={{ fontSize: '1.875rem', color: C.dtgDark, fontWeight: 'bold', marginBottom: '1rem' }}>{reportInfo.company}</p>
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
                            <p><span style={{ fontWeight: 'bold' }}>Generated by:</span> {reportInfo.generatedBy}</p>
                            <p><span style={{ fontWeight: 'bold' }}>Methodology:</span> Modified Normalized Difference Water Index (MNDWI)</p>
                            <p><span style={{ fontWeight: 'bold' }}>Period:</span> {reportInfo.period}</p>
                        </div>
                    </div>
                    {/* Box 2 */}
                    <div style={{ backgroundColor: C.teal50, padding: '1.5rem', borderRadius: '0.5rem', border: `1px solid ${C.teal200}` }}>
                        <h3 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '1rem', color: C.teal900 }}>Data Availability</h3>
                        <div style={{ color: C.teal700, fontSize: '1.125rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <p><span style={{ fontWeight: 'bold' }}>Processed Scenes:</span> {data?.mndwi?.length || 0}</p>
                            <p><span style={{ fontWeight: 'bold' }}>Latest Update:</span> {reportInfo.latest}</p>
                            <p><span style={{ fontWeight: 'bold' }}>Satellite Source:</span> Sentinel-2 MSI (Level 2A)</p>
                            <p><span style={{ fontWeight: 'bold' }}>Data Provider:</span> Copernicus Browser (ESA)</p>
                        </div>
                    </div>
                </div>
                <div style={{ marginTop: '2rem', backgroundColor: C.white, padding: '1.5rem', borderRadius: '0.5rem', border: `2px solid ${C.gray200}`, width: '100%' }}>
                    <h3 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '1rem', color: C.gray800 }}>Key Metrics</h3>
                    <ul style={{ color: C.gray600, fontSize: '1.125rem', listStyleType: 'disc', listStylePosition: 'inside', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <li><span style={{ fontWeight: 'bold' }}>Rainfall: </span>{reportInfo.rainfall} mm {reportInfo.rainfallStatus}</li>
                        <li><span style={{ fontWeight: 'bold' }}>TSF-7: </span>{reportInfo.tsf7Status}</li>
                        <li><span style={{ fontWeight: 'bold' }}>TSF-8: </span>{reportInfo.tsf8Status}</li>
                    </ul>
                </div>
            </div>
            <img src='/logo/DTG/DTGlogo.png' style={{ height: "40px" }} alt="DTG" />
        </div>,

        // Page 3 - Data Overview
        <div key="page-3" style={{ padding: '48px', backgroundColor: '#EFEBEA', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'center', position: 'relative' }}>
            <div style={{ marginBottom: '1rem', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                <h2 style={{ fontSize: '2.25rem', fontWeight: 'bold', color: C.gray800, marginBottom: '0.5rem' }}>Spatial Water Body Mapping</h2>
                <div style={{ width: '6rem', height: '4px', backgroundColor: C.dtgLight }}></div>
            </div>
            {data?.mndwi && data.mndwi.length > 0 ? (
                <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <div style={{ display: 'grid', flex: 1, gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', overflowY: 'auto', width: '100%' }}>
                        {data.mndwi.slice(0, 7).map((img, idx) => (
                            <div
                                key={idx}
                                style={{
                                    backgroundColor: C.gray50,
                                    borderRadius: '0.5rem',
                                    border: `1px solid ${C.gray200}`,
                                    position: 'relative',       // Context for the absolute date
                                    width: '100%',              // Responsive width
                                    aspectRatio: '7.55 / 6.17', // Enforce the specific ratio (Width / Height)
                                    overflow: 'hidden'          // Clips the image to the border radius
                                }}
                            >
                                {/* Date Overlay (Top Left) */}
                                <div style={{
                                    position: 'absolute',
                                    top: '0.5rem',
                                    left: '0.5rem',
                                    backgroundColor: '#0A3C4A',
                                    borderRadius: '0.5rem',
                                    padding: '0.25rem 0.75rem',
                                    zIndex: 10
                                }}>
                                    <p style={{
                                        fontWeight: '600',
                                        color: 'white',
                                        fontSize: '0.875rem',
                                        margin: 0,
                                        whiteSpace: 'nowrap'
                                    }}>
                                        {img.date ? new Date(img.date).toLocaleDateString('en-CA', { year: '2-digit', month: 'short' }) : 'N/A'}
                                    </p>
                                </div>

                                {/* Image */}
                                <img
                                    src={img.fullImageUrl || '/placeholder.png'}
                                    alt={`MNDWI ${img.date}`}
                                    style={{
                                        width: '100%',
                                        height: '100%',
                                        objectFit: 'cover', // Ensures image fills the ratio without stretching
                                        display: 'block'
                                    }}
                                />
                            </div>
                        ))}
                        <div style={{
                            backgroundColor: C.gray50,
                            borderRadius: '0.5rem',
                            border: `1px solid ${C.gray200}`,
                            position: 'relative',       // Context for the absolute date
                            width: '100%',              // Responsive width
                            aspectRatio: '7.55 / 6.17', // Enforce the specific ratio (Width / Height)
                            overflow: 'hidden',
                            padding: 10
                        }}>
                            <div style={{
                                position: 'absolute',
                                top: '0.5rem',
                                left: '0.5rem',
                                backgroundColor: '#0A3C4A',
                                borderRadius: '0.5rem',
                                padding: '0.25rem 0.75rem',
                                zIndex: 10
                            }}>
                                <p style={{
                                    fontWeight: '600',
                                    color: 'white',
                                    fontSize: '0.875rem',
                                    margin: 0,
                                    whiteSpace: 'nowrap'
                                }}>
                                   Legend
                                </p>
                            </div>
                            <div style={{ display: 'flex', height:"100%", flexDirection: 'column', alignItems: 'center', justifyContent:"space-between", padding: '5px' }}>
                                <TbNavigationNorth color='black' size={60} />
                                <p style={{ fontSize: '0.6rem', color: C.gray600, textAlign: 'center' }}>Modified Normalized Difference Water Index (MNDWI)</p>
                                <ScaleBar scaleWidth={3.98} mapWidth={7.55} />
                                <ColorBar
                                    min={-0.8}
                                    max={0.8}
                                    gradient="linear-gradient(to right, #008000, #ffffff, #d2691e, #00bfff, #00008b)"
                                    units=""
                                    orientation="horizontal"
                                />
                                <p style={{ fontSize: '0.6rem', color: C.gray600, textAlign: 'center' }}>{reportInfo.latest ? new Date(reportInfo.latest).toLocaleDateString('en-CA', { year: '2-digit', month: 'short' }) : 'N/A'} Ortho | GDA 1994 (EPSG:4283) - Latitude/Longitude</p>
                            </div>
                        </div>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%', height: '100%' }}>
                <WaterChartReport chartData={data.mndwi} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 27rem)', gap: '5rem', alignItems: "center", justifyContent: 'center' }}>
                    {/*Peak Event*/}
                    <div style={{ backgroundColor: C.white, overflow: "hidden", padding: '0px', borderRadius: '0.5rem', border: `1px solid ${C.gray200}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", height: "100%" }}>
                        <div style={{ backgroundColor: "#0c1d23", width: "100%", textAlign: "center", padding: "5px 0px" }}>
                            <p style={{ fontSize: '0.875rem', color: "white", marginBottom: '0.25rem' }}>Peak Event</p>
                        </div>
                        <div style={{ width: "100%", display: "grid", gridTemplateColumns: "repeat(2,1fr)", padding: 10, columnGap: 10, alignItems: "baseline" }}>
                            <p style={{ fontSize: '1.25rem', color: "black", fontWeight: "bold", marginBottom: '0.25rem', textAlign: "end" }}>{reportInfo.highestRainfall} mm - <span style={{ fontWeight: "bold", fontSize: '0.875rem' }}>{reportInfo.highestRainfallDate}</span></p>
                            <p style={{ fontSize: '0.875rem', color: "black", marginBottom: '0.25rem' }}>Peak Rainfall Event</p>
                            <p style={{ fontSize: '1.25rem', color: "black", fontWeight: "bold", marginBottom: '0.25rem', textAlign: "end" }}>{reportInfo.highestArea} km² - <span style={{ fontWeight: "bold", fontSize: '0.875rem' }}>{reportInfo.highestAreaDate}</span></p>
                            <p style={{ fontSize: '0.875rem', color: "black", marginBottom: '0.25rem' }}>Peak Surface Water Area </p>
                        </div>
                        <div style={{ padding: '0px 5px' }}>
                            <p style={{ fontSize: '0.875rem', color: "black", marginBottom: '0.25rem', textAlign: "center" }}><span style={{ fontWeight: "bold" }}>Note:</span> This represents the maximum precipitation event for the selected period.</p>
                        </div>
                    </div>
                    {/*Current Event*/}
                    <div style={{ backgroundColor: C.white, overflow: "hidden", padding: '0px', borderRadius: '0.5rem', border: `1px solid ${C.gray200}`, display: "flex", flexDirection: "column", alignItems: "center", JustifyContent: "space-between", height: "100%" }}>
                        <div style={{ backgroundColor: "#ffc000", width: "100%", textAlign: "center", padding: "5px 0px" }}>
                            <p style={{ fontSize: '0.875rem', color: "white", marginBottom: '0.25rem' }}>Current Period</p>
                        </div>
                        <div style={{ width: "100%", display: "grid", gridTemplateColumns: "repeat(2,1fr)", padding: 10, columnGap: 10, alignItems: "baseline" }}>
                            <p style={{ fontSize: '1.25rem', color: "black", fontWeight: "bold", marginBottom: '0.25rem', textAlign: "end" }}>{arrowRainfall} {reportInfo.rainfall} mm</p>
                            <p style={{ fontSize: '0.875rem', color: "black", marginBottom: '0.25rem' }}>Rainfall Event</p>
                            <p style={{ fontSize: '1.25rem', color: "black", fontWeight: "bold", marginBottom: '0.25rem', textAlign: "end" }}>{arrowTSF7} {reportInfo.tsf7} km²</p>
                            <p style={{ fontSize: '0.875rem', color: "black", marginBottom: '0.25rem' }}>TSF 7</p>
                            <p style={{ fontSize: '1.25rem', color: "black", fontWeight: "bold", marginBottom: '0.25rem', textAlign: "end" }}>{arrowTSF8} {reportInfo.tsf8} km²</p>
                            <p style={{ fontSize: '0.875rem', color: "black", marginBottom: '0.25rem' }}>TSF 8</p>
                        </div>
                        <div style={{ padding: '0px 5px' }}>
                            <p style={{ fontSize: '0.875rem', color: "black", marginBottom: '0.25rem', textAlign: "center" }}><span style={{ fontWeight: "bold" }}>Note:</span> {reportInfo.tsf8Status} compare to the previous data</p>
                        </div>
                    </div>
                </div>
            </div>
            <img src='/logo/DTG/DTGlogo.png' style={{ height: "40px" }} alt="DTG" />
        </div>,

        // Page 5 - Thank you
        <div key="page-5" style={{ background: gradientPage5, height: '100%', justifyContent: "space-between", display: 'flex', flexDirection: 'column', padding: '48px', position: 'relative' }}>
            <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                <div style={{ marginBottom: '2rem', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <h1 style={{ fontSize: '3rem', fontWeight: 'bold', color: C.white }}>Thank You</h1>
                    <div style={{ width: '6rem', height: '4px', backgroundColor: C.dtgDark }}></div>
                </div>
                <img src='/logo/DTG/DTGlogo.png' style={{ height: "40px" }} alt="DTG" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: "repeat(2,27rem)", height: '10rem', justifyContent: 'center', alignItems: 'center' }}>
                <div style={{ color: "white", display: "flex", alignItems: "center", gap: 30 }}>
                    <Globe size={40} />
                    <div>
                        <p style={{ color: "lightgray", fontSize: '1rem' }}>Website</p>
                        <p style={{ fontSize: '1rem' }}>www.digitaltwingeotechnical.com</p>
                    </div>
                </div>
                <div style={{ color: "white",display: "flex", alignItems: "center", gap: 30 }}>
                    <Mail size={40} />
                    <div>
                        <p style={{ color: "lightgray", fontSize: '1rem' }}>Email</p>
                        <p style={{ fontSize: '1rem' }}>dtgmonitor@dtgeotech.com</p>
                    </div>
                </div>
                <div style={{color: "white", display: "flex", alignItems: "center", gap: 30 }}>
                    <Phone size={40} />
                    <div>
                        <p style={{ color: "lightgray", fontSize: '1rem' }}>Phone</p>
                        <p style={{ fontSize: '1rem' }}>+62-811-2701-2630</p>
                    </div>
                </div>
                <div style={{ color: "white",display: "flex", alignItems: "center", gap: 30 }}>
                    <Linkedin size={40} />
                    <div>
                        <p style={{ color: "lightgray", fontSize: '1rem' }}>LinkedIn</p>
                        <p style={{ fontSize: '1rem' }}>Digital Twin Geotechnical</p>
                    </div>
                </div>
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
                <div className="absolute bottom-4 right-4 bg-[var(--dtg-gray-300)] text-white px-4 py-2 rounded-lg">
                    <span className="font-medium">{currentPage} / {totalPages}</span>
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
