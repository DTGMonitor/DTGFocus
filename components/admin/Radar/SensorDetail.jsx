import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { getCardColors, getStatusDotColors, getStatusColor, getRiskColor, getAlarmStatusColors, getOverallColor } from "@/config/statusConfig";
import { Button } from "@/components/LandingPage/ui/button";
import { Input } from "@/components/LandingPage/ui/input";
import {
    X, Download, Mail, Printer, Calendar, ListChecks, Wifi, TriangleAlert, Search
} from 'lucide-react';
import { LocalTime } from "@/components/Reusable/Formatting";
import { QualityTable } from "./DqpTable";


const SensorDetail = ({
    sensor,
    onClose
}) => {
    const [deformationList, setDeformationList] = useState([]);
    const [alarmRegionList, setAlarmRegionList] = useState([]);
    const [dqpList, setDqpList] = useState([]);
    const [searchAlarmRegion, setSearchAlarmRegion] = useState('');
    const [searchDeformation, setSearchDeformation] = useState('');
    const now = new Date();

    useEffect(() => {
        const fetchData = async () => {
            try {
                const { data, error } = await supabase
                    .from('def_records')
                    .select('created_at, location,precursor, def_type, tarp_level, isactive, start, reported_by')
                    .eq('wallfolder_id', sensor.wallfolder_id)
                    .eq('isactive', "Yes")
                    .order('created_at', { ascending: false });

                if (error) throw error;
                setDeformationList(data || [])
            } catch (error) {
                console.error('error fetching deformation list', error)
            }
        }
        fetchData()
    }, [sensor.wallfolder_id]
    );

    useEffect(() => {
        const fetchData = async () => {
            try {
                const { data, error } = await supabase
                    .from('alarm_regions')
                    .select('name, isactive, alarmtype, priority ')
                    .eq('wallfolder', sensor.wallfolder_id)
                    .neq('isactive', "Inactive")
                    .order('priority', { ascending: true });

                if (error) throw error;
                setAlarmRegionList(data || [])
            } catch (error) {
                console.error('error fetching alarm region list', error)
            }
        }
        fetchData()
    }, [sensor.wallfolder_id]
    );

    useEffect(() => {
        const fetchData = async () => {
            try {
                const { data, error } = await supabase
                    .from('dqp_values')
                    .select('value,parameter:parameters!inner(id,name),notes')
                    .eq('dqp_record_id', sensor.dqp_record_id)
                    .order('parameter_id', { ascending: true })

                if (error) throw error;
                setDqpList(data || [])
            } catch (error) {
                console.error('error fetching dqp list', error)
            }
        }
        fetchData()
    }, [sensor.dqp_record_id]
    );

    const wallFolder = sensor.wallfolder?.find(
        wf => wf.id === sensor.wallfolder_id
    );

    const filteredAlarmRegions = alarmRegionList.filter(ar => {
        const matchesSearch = ar.name?.toLowerCase().includes(searchAlarmRegion.toLowerCase())
        return matchesSearch
    }
    );

    const filteredDeformation = deformationList.filter(d => {
        const matchesLocation = d.location?.toLowerCase().includes(searchDeformation.toLowerCase());
        const matchesType = d.def_type?.toLowerCase().includes(searchDeformation.toLowerCase());
        const matchesTarp = d.tarp_level?.toLowerCase().includes(searchDeformation.toLowerCase());
        const matchesUser = d.reported_by?.toLowerCase().includes(searchDeformation.toLowerCase());
        return matchesLocation || matchesTarp || matchesType || matchesUser
    }
    );

    const overallColConfig = getOverallColor(sensor.status, sensor.quality, sensor.risk);
    // 1. Define which parameters go into the FIRST table (Data Quality)
    const primaryParams = [9, 11, 14, 6, 25];
    const staticParams = [10, 12, 13, 15, 16, 17, 18, 19, 22, 27, 28];

    // 2. Filter the data
    const dataQualityData = dqpList.filter(item =>
        primaryParams.includes(item.parameter?.id)
    );

    // 3. Put everything else into the SECOND table (System Quality)
    const systemQualityData = dqpList.filter(item =>
        staticParams.includes(item.parameter?.id)
    );


    return (
        <div
            className="w-full z-[9999] h-full bg-gray-900/40 backdrop-blur-sm fixed top-0 left-0 flex items-center justify-center p-5"
            onClick={onClose}
        >
            <div className="fixed inset-0 bg-[var(--dtg-bg-primary)]/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="bg-[var(--dtg-bg-primary)] rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col border border-[var(--dtg-border-medium)]">
                    {/* Header */}
                    <div className={`bg-gradient-to-r ${overallColConfig.bgGradient} border-b border-[var(--dtg-border-medium)] p-6`}>
                        <div className="flex items-start justify-between mb-4">
                            <div className="flex-1">
                                <div className="flex items-center gap-3 mb-2">
                                    <div
                                        className={`w-2 h-12 rounded-full bg-${overallColConfig.bg}`}
                                    />
                                    <div>
                                        <h1 className="text-3xl text-[var(--dtg-text-primary)]">{sensor.radar_number} - {sensor.area}, {sensor.site_name}</h1>
                                        <p className="text-[var(--dtg-gray-500)] text-sm mt-1">{wallFolder?.name || "NA"}</p>
                                    </div>
                                </div>
                            </div>
                            <button
                                onClick={onClose}
                                className="p-2 hover:bg-white/10 rounded-lg transition-all"
                            >
                                <X className="w-6 h-6 text-[var(--dtg-gray-500)] hover:text-[var(--dtg-text-primary)]" />
                            </button>
                        </div>

                        {/* Report Metadata */}
                        <div className="grid grid-cols-4 gap-4">
                            <div className="bg-[var(--dtg-bg-card)]/50 rounded-lg p-3 border border-[var(--dtg-border-medium)]">
                                <div className="flex items-center gap-2 text-[var(--dtg-gray-500)] text-sm mb-1">
                                    <Calendar className="w-4 h-4" />
                                    <span>Latest Check</span>
                                </div>
                                <p className="text-[var(--dtg-text-primary)] text-sm py-1.5"><LocalTime utcTime={sensor.created_time} format="full" /></p>
                            </div>
                            <div className="bg-[var(--dtg-bg-card)]/50 rounded-lg p-3 border border-[var(--dtg-border-medium)]">
                                <div className="flex items-center gap-2 text-[var(--dtg-gray-500)] text-sm mb-1">
                                    <ListChecks className="w-4 h-4" />
                                    <span>Data Quality</span>
                                </div>
                                <p className={`text-${getRiskColor(sensor.quality)} text-sm py-1.5`}>{sensor.quality}</p>
                            </div>
                            <div className="bg-[var(--dtg-bg-card)]/50 rounded-lg p-3 border border-[var(--dtg-border-medium)]">
                                <div className="flex items-center gap-2 text-[var(--dtg-gray-500)] text-sm mb-1">
                                    <Wifi className="w-4 h-4" />
                                    <span>Status</span>
                                </div>
                                <select
                                    value={sensor.status}
                                    className={`py-1.5 text-sm text-${getStatusColor(sensor.status)} bg-[var(--dtg-bg-card)] outline-none border-none w-full`}
                                >
                                    <option value="Live" className="text-[var(--dtg-text-primary)]">Live</option>
                                    <option value="Link Down" className="text-[var(--dtg-text-primary)]">Link Down</option>
                                    <option value="Lost Connection" className="text-[var(--dtg-text-primary)]">Lost Connection</option>
                                    <option value="Intermittent Link Down" className="text-[var(--dtg-text-primary)]">Intermittent</option>
                                </select>
                            </div>
                            <div className="bg-[var(--dtg-bg-card)]/50 rounded-lg p-3 border border-[var(--dtg-border-medium)]">
                                <div className="flex items-center gap-2 text-[var(--dtg-gray-500)] text-sm mb-1">
                                    <TriangleAlert className="w-4 h-4" />
                                    <span>Risk</span>
                                </div>
                                <p className={`text-${getRiskColor(sensor.risk)} text-sm py-1.5`}>{sensor.risk}</p>
                            </div>
                        </div>
                    </div>

                    {/* Report Content */}
                    <div className="flex-1 overflow-y-auto p-6 bg-[var(--dtg-bg-primary)]">
                        <div className="max-w-5xl mx-auto space-y-6">
                            <div className="flex gap-6">
                                <div className="flex flex-col w-full gap-2 text-[var(--dtg-text-primary)]">
                                    <div className="flex w-full justify-between border-b border-[var(--dtg-border-medium)] mb-4 pb-2">
                                        <h2 className="text-xl">Deformation</h2>
                                        <Button variant='orange'>+ New Record</Button>
                                    </div>
                                    {deformationList.length > 0 ?
                                        <>
                                            <div className="flex-1 relative">
                                                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[var(--dtg-gray-500)]" />
                                                <Input
                                                    value={searchAlarmRegion}
                                                    onChange={(e) => setSearchDeformation(e.target.value)}
                                                    placeholder="Search alarm regions..."
                                                    className="pl-10 bg-[var(--dtg-bg-card)] border-[var(--dtg-border-medium)] text-[var(--dtg-text-primary)]"
                                                />
                                            </div>
                                            {filteredDeformation.map((item, index) => (
                                                <div key={index} className={`flex flex-col gap-1 border rounded-lg p-3 ${getCardColors(item.def_type)}`}>
                                                    <div className="flex gap-3 items-center text-sm">
                                                        <span className={`w-4 h-4 rounded-xl ${getStatusDotColors(item.tarp_level)}`}></span>
                                                        <p><strong>{item.tarp_level}</strong> | {item.def_type} - {item.location}</p>
                                                    </div>

                                                    <div className="flex items-center gap-5 font-light text-xs text-[var(--dtg-text-secondary)]">
                                                        <div className="flex items-center gap-1">
                                                            <Calendar size={12} />
                                                            <span>{new Date(item.created_at).toLocaleString()}</span>
                                                        </div>
                                                        <div className="flex items-center gap-1">
                                                            <span>Reported by: {item.reported_by}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </>
                                        : "No deformation recorded on this radar."}
                                </div>

                                <div className="flex flex-col w-full gap-2 text-[var(--dtg-text-primary)]">
                                    <div className="flex w-full justify-between border-b border-[var(--dtg-border-medium)] mb-4 pb-2">
                                        <h2 className="text-xl">Alarm</h2>
                                        <Button variant='orange'>+ New Region</Button>
                                    </div>
                                    {alarmRegionList.length > 0 ?
                                        <>
                                            <div className="flex-1 relative">
                                                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[var(--dtg-gray-500)]" />
                                                <Input
                                                    value={searchAlarmRegion}
                                                    onChange={(e) => setSearchAlarmRegion(e.target.value)}
                                                    placeholder="Search alarm regions..."
                                                    className="pl-10 bg-[var(--dtg-bg-card)] border-[var(--dtg-border-medium)] text-[var(--dtg-text-primary)]"
                                                />
                                            </div>
                                            <div className="max-h-[20vh] overflow-y-auto flex flex-col gap-2">
                                                {filteredAlarmRegions.map((item, index) => (
                                                    <div key={index} className={`border rounded-lg p-2`}>
                                                        <div className="flex gap-3 items-center">
                                                            <span className={`w-2 h-2 rounded-xl ${getAlarmStatusColors(item.priority)}`}>
                                                            </span>
                                                            <p className="text-sm"><strong>{item.name}</strong> | {item.isactive}</p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </>
                                        : "No alarm region set on this radar."
                                    }
                                </div>
                            </div>

                            <div className="flex flex-col w-full gap-2 text-[var(--dtg-text-primary)]">
                                <h2 className="text-xl font-medium border-b border-[var(--dtg-border-medium)] mb-4 pb-2">Data Quality</h2>
                                <QualityTable data={dataQualityData} />
                            </div>
                            <div className="flex flex-col w-full gap-2 text-[var(--dtg-text-primary)]">
                                <h2 className="text-xl font-medium border-b border-[var(--dtg-border-medium)] mb-4 pb-2">System Quality</h2>
                                <QualityTable data={systemQualityData} />
                            </div>
                        </div>

                    </div>

                    {/* Footer Actions */}
                    <div className="border-t border-[var(--dtg-border-medium)] p-4 bg-[var(--dtg-bg-card)]/50">
                        <div className="flex items-center justify-between">
                            <div className="text-sm text-[var(--dtg-gray-500)]">
                                <span>Document ID: <LocalTime utcTime={now} format="telfer_report"/> Daily Report of {sensor.radar_number} - {sensor.site_name}</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <Button
                                    variant="outline">
                                    <Printer className="w-4 h-4 mr-2" />
                                    Print
                                </Button>
                                <Button
                                    variant="outline">
                                    <Mail className="w-4 h-4 mr-2" />
                                    Email
                                </Button>
                                <Button
                                    variant="brand"
                                >
                                    <Download className="w-4 h-4 mr-2" />
                                    Download PDF
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div >
    )

}

export default SensorDetail;