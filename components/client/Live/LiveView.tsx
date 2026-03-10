import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Radio,
  Maximize2,
  Droplet,
  Square,
  Activity,
  ShieldCheck,
  ChevronRight,
  ChevronLeft,
  Download,
  FileText,
  AlertTriangle,
  Clock,
  Zap,
  CheckCircle2,
  X,
  Settings,
  Target,
  BellRing,
  History,
  Eye,
  EyeOff,
  Crosshair,
  TrendingUp,
  ChevronDown,
  MapPin,
  Minus,
  Plus,
  Hexagon,
  Eraser,
  Pencil,
  BarChart3,
  Info
} from 'lucide-react';
import { SensorAnalysisView } from './SensorAnalysisView';
import { DeepAnalysisModal } from './DeepAnalysisModal';
import { ToolBarProps } from '../../Reusable/HeaderComponents/ToolBar';
import { DateTime } from 'luxon';
import PitMap, { Sensor as PitMapSensor } from './PitMap';
import { supabase } from '@/lib/supabaseClient';

// --- Types & Mock Data ---
// Extended Sensor interface to match PitMap + LiveView needs
interface Sensor extends Partial<PitMapSensor> {
  id: string;
  label: string;
  x?: number; // Legacy for fusion lines if needed, or calculate from lat/lng
  y?: number;
  type: 'Radar' | 'Prism' | 'Piezometer' | 'InSAR';
  tarp: 1 | 2 | 3 | 4;
  status: 'online' | 'offline';
  metrics: Record<string, string>;
  details: string;
  correlatedSensors?: string[];
  forecast?: string;
  dataQuality: number;
  area: number;
  coordinates?: {
    easting: number;
    northing: number;
    elevation: number;
  };
}

const REPORTS = [
  { id: 'r1', title: 'Shift Summary', date: '17 Feb', icon: ShieldCheck },
  { id: 'r2', title: 'Stability PDF', date: '16 Feb', icon: FileText },
  { id: 'r3', title: 'TARP Log', date: '15 Feb', icon: AlertTriangle },
  { id: 'r4', title: 'Health Audit', date: '14 Feb', icon: Settings },
  { id: 'r5', title: 'Weekly Trend', date: '10 Feb', icon: History },
];

// --- Sub-components ---

const GlassPanel = ({ children, className }: { children: React.ReactNode, className?: string }) => (
  <div className={`bg-[#051F20]/5 backdrop-blur-sm border border-white/20 shadow-2xl overflow-hidden ${className}`}>
    {children}
  </div>
);

const SensorIcon = ({ type, size = 16 }: { type: string, size?: number }) => {
  switch (type) {
    case 'Radar': return <Radio size={size} />;
    case 'Prism': return <Maximize2 size={size} />;
    case 'Piezometer': return <Droplet size={size} />;
    case 'InSAR': return <Activity size={size} />;
    default: return <Target size={size} />;
  }
};

interface LiveViewProps extends Partial<ToolBarProps> {
  pageMode?: string;
}

export function LiveView({ pageMode, visibleLayers = ['Radar', 'Prism', 'InSAR', 'Piezometer'], toggleLayer, isGlobalHidden = false, toggleAllVisibility, hazardOnly = false, setHazardOnly, activeTool, setActiveTool }: LiveViewProps) {
  const [activeView, setActiveView] = useState<'LIVE' | 'ANALYSIS' | 'SUMMARY'>('LIVE');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedSensor, setSelectedSensor] = useState<Sensor | null>(null);
  const [sensorHistory, setSensorHistory] = useState<any[]>([]);
  const [dateRange, setDateRange] = useState<{ start: string | null, end: string | null }>({ start: null, end: null });
  const [sensorView, setSensorView] = useState<'DETAILS' | 'ANALYSIS'>('DETAILS');
  const [comparisonSensors, setComparisonSensors] = useState<Sensor[]>([]);
  const [isDeepAnalysisOpen, setIsDeepAnalysisOpen] = useState(false);
  const [hiddenSensors, setHiddenSensors] = useState<string[]>([]);
  const [showDeformationMap, setShowDeformationMap] = useState(true);
  const [deformationOpacity, setDeformationOpacity] = useState(0.65);
  const [dronePhotoOpacity, setDronePhotoOpacity] = useState(1);
  const [deformationRange, setDeformationRange] = useState({
    min: -10,
    max: 10,
  });
  const [colorInvert, setColorInvert] = useState(false);
  const [isLegendMinimized, setIsLegendMinimized] = useState(false);

  useEffect(() => {
    if (pageMode === 'DeformationAnalysis') {
      setActiveView('ANALYSIS');
      setIsDrawerOpen(false);
      setIsDeepAnalysisOpen(false);
    } else if (pageMode === 'AISummary') {
      setIsDrawerOpen(true);
      setActiveView('SUMMARY');
      setIsDeepAnalysisOpen(false);
    } else if (pageMode === 'CustomAnalysis') {
      // If no sensor selected, we might want to prompt user or select one
      setIsDeepAnalysisOpen(true);
      setIsDrawerOpen(false);
    } else if (pageMode === 'LiveView') {
      setActiveView('LIVE');
      setIsDrawerOpen(false);
      setIsDeepAnalysisOpen(false);
    }
  }, [pageMode]);

  const toggleSensorVisibility = (id: string) => {
    setHiddenSensors(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleAddComparison = (sensor: Sensor) => {
    setComparisonSensors(prev => [...prev, sensor]);
  };

  const handleRemoveComparison = (sensorId: string) => {
    setComparisonSensors(prev => prev.filter(s => s.id !== sensorId));
  };

  const handleOpenDeepAnalysis = () => {
    setIsDeepAnalysisOpen(true);
  };

  // Fetch history from Supabase
  const fetchSensorHistory = async (sensorId: string, startDate: string, endDate: string) => {
    if (!startDate || !endDate) return;

    const { data, error } = await supabase
      .from('sensor_readings')
      .select('timestamp, deformation')
      .eq('sensor_id', sensorId)
      .gte('timestamp', startDate)
      .lte('timestamp', endDate)
      .order('timestamp', { ascending: false }) // 1. Fetch newest first to beat the limit
      .limit(15000); // Try to grab as much as the server allows

    if (error) {
      console.error('Error fetching history:', error);
      return;
    }

    if (data) {
      // 2. Flip the array right-side up for Recharts
      // Using the spread operator [...] creates a copy so we don't mutate the original data
      const chronologicalData = [...data].reverse();

      // 3. Map over the correctly ordered data
      const processedData = chronologicalData.map((reading: any, index: number) => {
        const currentDef = reading.deformation;
        const dt = DateTime.fromISO(reading.timestamp);
        const currentTime = dt.toMillis();
        let velocity = 0;

        // Your existing velocity calc works perfectly here because 
        // the array is already back in chronological order!
        if (index > 0) {
          // IMPORTANT: Update this variable to reference chronologicalData, not 'data'
          const prev = chronologicalData[index - 1];
          const prevDef = prev.deformation;
          const prevTime = DateTime.fromISO(prev.timestamp).toMillis();
          const timeDiffDays = (currentTime - prevTime) / (1000 * 3600 * 24);

          if (timeDiffDays > 0) {
            velocity = (currentDef - prevDef) / timeDiffDays;
          }
        }

        return {
          time: dt.toFormat("MMM d, h:mm a"),
          timestamp: currentTime,
          deformation: Number(currentDef.toFixed(2)),
          velocity: Number(velocity.toFixed(2)),
          inverseVelocity: velocity !== 0 ? Number((1 / velocity).toFixed(3)) : 0,
          scanTime: 5
        };
      });

      setSensorHistory(processedData);
    }
  };

  useEffect(() => {
    if (selectedSensor && dateRange.start && dateRange.end) {
      setSensorHistory([]); // Clear old history while new one is fetching
      fetchSensorHistory(selectedSensor.id, dateRange.start, dateRange.end);
    }
  }, [selectedSensor?.id, dateRange]);

  const handleSensorClick = (pitMapSensor: PitMapSensor) => {
    // Adapt PitMap sensor to LiveView Sensor interface
    // We assume the DB sensor has enough info, or we provide defaults
    const sensor: Sensor = {
      ...pitMapSensor,
      label: pitMapSensor.label || `Sensor ${pitMapSensor.id}`,
      type: pitMapSensor.type || 'Prism',
      tarp: pitMapSensor.tarp || 1,
      status: 'online', // Default
      metrics: {
        velocity: 'Calculating...', // Will be updated after history fetch?
        def: `${pitMapSensor.latest_deformation.toFixed(2)} mm`
      },
      details: 'Live data from Supabase',
      dataQuality: 95, // Mock
      area: 0,
      coordinates: {
        easting: pitMapSensor.easting,
        northing: pitMapSensor.northing,
        elevation: 0
      },
      ...pitMapSensor
    };

    // When sensor changes, reset date range to its default
    let end = DateTime.now();
    if (sensor.latest_timestamp) {
      const parsedEnd = DateTime.fromISO(sensor.latest_timestamp.replace(' ', 'T'));
      if (parsedEnd.isValid) {
        end = parsedEnd;
      }
    }
    const start = end.minus({ days: 7 }); // Default to 7 days
    setDateRange({ start: start.toISO(), end: end.toISO() });
    setSelectedSensor(sensor);

    // Auto-set view based on active section
    if (activeView === 'ANALYSIS') {
      setSensorView('ANALYSIS');
    } else if (activeView === 'LIVE') {
      setSensorView('DETAILS');
    }
  };

  return (
    <div className="relative h-full w-full bg-[#020d0d] overflow-hidden font-sans text-white selection:bg-[#8EB69B]/30">

      {/* 100% FULL-SCREEN MAP LAYER */}
      <div className="absolute inset-0 z-0" style={{ opacity: dronePhotoOpacity }}>
        <PitMap onSensorSelect={handleSensorClick} />
        {/* We keep the gradient overlay so your UI panels still pop */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/80 pointer-events-none z-10" />
      </div>

      {/* DEFORMATION HEATMAP OVERLAY (Only visible in Analysis mode) */}
      <AnimatePresence>
        {activeView === 'ANALYSIS' && showDeformationMap && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: deformationOpacity }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="absolute inset-0 z-[5] pointer-events-none"
          >
            <svg className="w-full h-full">
              {/* ... (Keep existing SVG defs/gradients for visual flair if desired, or remove if not matching real data) ... */}
            </svg>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- INSIGHT DRAWER (RIGHT SIDE OVERLAY) --- */}
      <AnimatePresence>
        {isDrawerOpen && (
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="absolute right-0 top-0 bottom-0 w-[420px] z-[150] p-8"
          >
            {/* ... (Keep existing Drawer Content) ... */}
            <GlassPanel className="h-full rounded-[3rem] flex flex-col">
              <div className="p-8 pb-4 border-b border-white/5 flex items-center justify-between">
                <div>
                  <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-white/70">AI Analytics Engine</h3>
                  <h2 className="text-[18px] font-black uppercase text-white mt-1">Network Intelligence</h2>
                </div>
                <button onClick={() => setIsDrawerOpen(false)} className="w-10 h-10 rounded-full bg-black/10 flex items-center justify-center hover:bg-black/20 transition-colors">
                  <X size={18} />
                </button>
              </div>
              {/* Placeholder content for drawer */}
              <div className="p-8 text-white/50 text-sm">AI Insights loading...</div>
            </GlassPanel>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- SENSOR DETAILS CARD (WHEN SELECTED) --- */}
      <AnimatePresence>
        {selectedSensor && !isDrawerOpen && (() => {
          // Dynamic TARP color mapping - more subtle
          const tarpColor = selectedSensor.tarp === 1 ? '#22c55e' :
            selectedSensor.tarp === 2 ? '#facc15' :
              selectedSensor.tarp === 3 ? '#f97316' :
                '#ef4444';

          const tarpColorLight = selectedSensor.tarp === 1 ? 'rgba(34, 197, 94, 0.05)' :
            selectedSensor.tarp === 2 ? 'rgba(250, 204, 21, 0.05)' :
              selectedSensor.tarp === 3 ? 'rgba(249, 115, 22, 0.05)' :
                'rgba(239, 68, 68, 0.05)';

          const tarpBorder = selectedSensor.tarp === 1 ? 'rgba(34, 197, 94, 0.2)' :
            selectedSensor.tarp === 2 ? 'rgba(250, 204, 21, 0.2)' :
              selectedSensor.tarp === 3 ? 'rgba(249, 115, 22, 0.2)' :
                'rgba(239, 68, 68, 0.2)';

          return (
            <motion.div
              initial={{ x: 100, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 100, opacity: 0 }}
              className="absolute right-8 top-8 bottom-8 z-50 w-[450px]"
            >
              <GlassPanel className={`rounded-[2.5rem] h-full flex flex-col border border-${tarpBorder}`}>
                <div
                  className="px-6 py-4 flex items-center justify-between border-b border-white/5"
                  style={{ backgroundColor: tarpColorLight }}
                >
                  <div className="flex items-center gap-3">
                    <Target size={14} style={{ color: tarpColor }} />
                    <span className="text-[10px] font-black uppercase tracking-widest">Sensor: {selectedSensor.id}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleSensorVisibility(selectedSensor.id)}
                      className="text-white/50 hover:text-white transition-colors p-1"
                    >
                      {hiddenSensors.includes(selectedSensor.id) ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                    <button onClick={() => setSelectedSensor(null)} className="text-white/50 hover:text-white transition-colors p-1">
                      <X size={18} />
                    </button>
                  </div>
                </div>

                {/* Content Area */}
                <div className="flex-1 overflow-y-auto scrollbar-hide">
                  {/* In Live Network: show Details. In Analysis: show Analysis graphs directly */}
                  {activeView === 'LIVE' ? (
                    <div className="p-8 space-y-6">
                      <div>
                        <h2 className="text-[18px] font-black uppercase text-white leading-tight">{selectedSensor.label}</h2>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        {/* TARP LEVEL */}
                        <div
                          className="p-4 border rounded-2xl"
                          style={{
                            backgroundColor: tarpColorLight,
                            borderColor: tarpBorder
                          }}
                        >
                          <p className="text-[8px] font-black text-white/70 uppercase mb-1">TARP LEVEL</p>
                          <p className="text-[14px] font-black" style={{ color: tarpColor }}>LEVEL {selectedSensor.tarp}</p>
                        </div>

                        {/* DATA QUALITY */}
                        <div className="p-4 bg-black/5 border border-white/20 rounded-2xl">
                          <p className="text-[8px] font-black text-white/70 uppercase mb-1">DATA QUALITY</p>
                          <p className="text-[14px] font-black text-[#8EB69B]">{selectedSensor.dataQuality}%</p>
                        </div>

                        {/* VELOCITY */}
                        <div
                          className="p-4 bg-black/5 border border-white/20 rounded-2xl"
                        >
                          <p className="text-[8px] font-black text-white/70 uppercase mb-1">VELOCITY</p>
                          <p className="text-[14px] font-black" style={{
                            color: selectedSensor.tarp >= 3 ? tarpColor : '#8EB69B'
                          }}>
                            {/* Use the last calculated velocity from history if available */}
                            {sensorHistory.length > 0 ? `${sensorHistory[sensorHistory.length - 1].velocity} mm/d` : 'Loading...'}
                          </p>
                        </div>

                        {/* AREA SIZE */}
                        <div className="p-4 bg-black/5 border border-white/20 rounded-2xl">
                          <p className="text-[8px] font-black text-white/70 uppercase mb-1">AREA SIZE</p>
                          <p className="text-[14px] font-black text-white">{selectedSensor.area.toLocaleString()} m²</p>
                        </div>
                      </div>

                      {/* Coordinates Section */}
                      {selectedSensor.coordinates && (
                        <div
                          className="p-4 bg-black/5 border border-white/20 rounded-2xl space-y-3"
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <Crosshair size={12} className="text-white/50" />
                            <p className="text-[8px] font-black text-white/70 uppercase tracking-wider">Geodetic Position</p>
                          </div>
                          <div className="grid grid-cols-3 gap-3">
                            <div>
                              <p className="text-[7px] font-black text-white/60 uppercase mb-1">Easting</p>
                              <p className="text-[11px] font-bold text-white">
                                {selectedSensor.coordinates.easting.toLocaleString()} m
                              </p>
                            </div>
                            <div>
                              <p className="text-[7px] font-black text-white/60 uppercase mb-1">Northing</p>
                              <p className="text-[11px] font-bold text-white">
                                {selectedSensor.coordinates.northing.toLocaleString()} m
                              </p>
                            </div>
                            <div>
                              <p className="text-[7px] font-black text-white/60 uppercase mb-1">Elevation</p>
                              <p className="text-[11px] font-bold text-white">
                                {selectedSensor.coordinates.elevation.toLocaleString()} m
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="p-8">
                      {/* Pass real history data to SensorAnalysisView if it supports it, otherwise it might need update too */}
                      <SensorAnalysisView
                        sensor={selectedSensor}
                        tarpColor={tarpColor}
                        onFullScreen={handleOpenDeepAnalysis}
                        allSensors={[]} // We don't have full list here easily unless we fetch all
                        comparisonSensors={comparisonSensors}
                        onAddComparison={handleAddComparison as any}
                        onRemoveComparison={handleRemoveComparison}
                        historyData={sensorHistory}
                        dateRange={dateRange}
                        setDateRange={setDateRange}
                      />
                    </div>
                  )}
                </div>
              </GlassPanel>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Deep Analysis Modal - Now fed with real history data */}
      {selectedSensor && (
        <DeepAnalysisModal
          isOpen={isDeepAnalysisOpen}
          onClose={() => setIsDeepAnalysisOpen(false)}
          primarySensor={selectedSensor}
          comparisonSensors={comparisonSensors}
          tarpColor={selectedSensor.tarp === 1 ? '#22c55e' : selectedSensor.tarp === 2 ? '#facc15' : selectedSensor.tarp === 3 ? '#f97316' : '#ef4444'}
          historyData={sensorHistory} // Pass the fetched history
        />
      )}

      {/* DEFORMATION MAP CONTROLS & LEGEND */}
      <AnimatePresence>
        {activeView === 'ANALYSIS' && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="absolute bottom-8 left-1/2 -translate-x-1/2 z-[100] pointer-events-auto"
          >
            {/* ... (Keep existing Legend) ... */}
            <GlassPanel className={`rounded-2xl transition-all ${isLegendMinimized ? 'p-2.5 w-[240px]' : 'p-5 w-[420px]'}`}>
              <div className="flex items-center justify-center text-white/50 text-xs">Legend Controls</div>
            </GlassPanel>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}

export default LiveView;
