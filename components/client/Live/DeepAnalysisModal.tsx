import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { X, Download, Calendar } from 'lucide-react';
import { DateTime } from 'luxon';

interface Sensor {
  id: string;
  label: string;
  tarp: 1 | 2 | 3 | 4;
  type: 'Radar' | 'Prism' | 'Piezometer' | 'InSAR';
  latest_timestamp?: string;
}

interface DeepAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  primarySensor: Sensor;
  comparisonSensors: Sensor[];
  tarpColor: string;
  historyData?: any[]; // New prop for real data
}

// Generate time-series data for sensor analysis (Fallback if no real data)
const generateSensorTimeSeriesData = (sensorId: string, tarp: number, latestTimestamp?: string) => {
  const data = [];
  let end = DateTime.now();
  if (latestTimestamp) {
    // Handle timestamps that might use a space instead of 'T'
    const parsedEnd = DateTime.fromISO(latestTimestamp.replace(' ', 'T'));
    if (parsedEnd.isValid) {
      end = parsedEnd;
    }
  }
  const hoursBack = 168; // 7 days
  
  for (let i = hoursBack; i >= 0; i -= 0.5) { // Changed from 4 hours to 30 minutes for more realistic mock data
    const dt = end.minus({ hours: i });
    const timeStr = dt.toFormat("MMM d, h:mm a");
    
    let deformation = 0;
    let velocity = 0;
    
    if (tarp === 4) {
      const exponentialFactor = Math.pow((hoursBack - i) / hoursBack, 2);
      deformation = exponentialFactor * 120 + Math.random() * 5;
      velocity = exponentialFactor * 14 + Math.random() * 2;
    } else if (tarp === 3) {
      deformation = (hoursBack - i) * 0.3 + Math.random() * 3;
      velocity = 3 + Math.random() * 2;
    } else if (tarp === 2) {
      deformation = (hoursBack - i) * 0.1 + Math.random() * 1;
      velocity = 1.5 + Math.random() * 1;
    } else {
      deformation = (hoursBack - i) * 0.01 + Math.random() * 0.5;
      velocity = 0.1 + Math.random() * 0.2;
    }
    
    const inverseVelocity = velocity > 0.1 ? 1 / velocity : 10;
    const scanTime = 5 + Math.random() * 2 - 1;
    
    data.push({
      time: timeStr,
      timestamp: dt.toMillis(),
      deformation: Number(deformation.toFixed(2)),
      velocity: Number(velocity.toFixed(2)),
      inverseVelocity: Number(inverseVelocity.toFixed(3)),
      scanTime: Number(scanTime.toFixed(1))
    });
  }
  
  return data;
};

// This is the data point structure from generateSensorTimeSeriesData and mergedData
interface TimeSeriesDataPoint {
  time: string;
  timestamp: number;
  deformation: number;
  velocity: number;
  inverseVelocity: number;
  scanTime: number;
  [key: string]: any; // for comparison data like deformation_...
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: TimeSeriesDataPoint;
    name: string;
    value: string | number;
    color: string;
  }>;
  label?: string;
}

const CustomTooltip = ({ active, payload }: CustomTooltipProps) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-black/95 backdrop-blur-md border border-white/30 rounded-xl px-4 py-3 shadow-2xl">
        <p className="text-[10px] font-black text-white/60 uppercase mb-2">{payload[0].payload.time}</p>
        {payload.map((p, idx) => (
          <p key={idx} className="text-[11px] font-bold mb-1">
            <span style={{ color: p.color }}>{p.name}:</span> <span className="text-white ml-1">{p.value}</span>
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export const DeepAnalysisModal: React.FC<DeepAnalysisModalProps> = ({ 
  isOpen, 
  onClose, 
  primarySensor, 
  comparisonSensors,
  tarpColor,
  historyData
}) => {
  const allSensors = [primarySensor, ...comparisonSensors];
  
  // Merge all sensor data
  const mergedData = React.useMemo(() => {
    // Use real history data if available, otherwise fallback to mock
    const primaryData = historyData && historyData.length > 0 
      ? historyData 
      : generateSensorTimeSeriesData(primarySensor.id, primarySensor.tarp, primarySensor.latest_timestamp);
      
    const baseData: TimeSeriesDataPoint[] = primaryData.map(d => ({ ...d }));
    
    // For comparison sensors, we still use mock data for now as we only fetch history for selected
    comparisonSensors.forEach((compSensor) => {
      const compData = generateSensorTimeSeriesData(compSensor.id, compSensor.tarp, compSensor.latest_timestamp);
      compData.forEach((cd, idx) => {
        if (baseData[idx]) {
          baseData[idx][`deformation_${compSensor.id}`] = cd.deformation;
          baseData[idx][`velocity_${compSensor.id}`] = cd.velocity;
          baseData[idx][`inverseVelocity_${compSensor.id}`] = cd.inverseVelocity;
          baseData[idx][`scanTime_${compSensor.id}`] = cd.scanTime;
        }
      });
    });
    
    return baseData;
  }, [primarySensor, comparisonSensors, historyData]);
  
  const comparisonColors = ['#60a5fa', '#a78bfa', '#f472b6', '#fb923c', '#34d399'];
  
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] bg-[#020d0d]/95 backdrop-blur-xl flex items-center justify-center p-8"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full h-full max-w-[1600px] bg-white/[0.08] backdrop-blur-[40px] border border-white/20 rounded-[3rem] overflow-hidden shadow-2xl flex flex-col"
          >
            {/* Header */}
            <div className="px-10 py-6 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-[#051F20]/50 to-transparent">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: tarpColor }} />
                  <h2 className="text-[12px] font-black uppercase tracking-[0.3em] text-white/40">Deep Analysis Mode</h2>
                </div>
                <h1 className="text-[24px] font-black uppercase text-white">
                  {primarySensor.label}
                  {comparisonSensors.length > 0 && (
                    <span className="text-[#8EB69B] ml-3">
                      +{comparisonSensors.length} Comparison{comparisonSensors.length > 1 ? 's' : ''}
                    </span>
                  )}
                </h1>
              </div>
              <div className="flex items-center gap-3">
                <button className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all">
                  <Calendar size={14} className="text-white/70" />
                  <span className="text-[10px] font-black uppercase tracking-wider text-white/70">7 Days</span>
                </button>
                <button className="flex items-center gap-2 px-4 py-2 bg-[#8EB69B]/10 hover:bg-[#8EB69B]/20 border border-[#8EB69B]/30 rounded-xl transition-all">
                  <Download size={14} className="text-[#8EB69B]" />
                  <span className="text-[10px] font-black uppercase tracking-wider text-[#8EB69B]">Export Data</span>
                </button>
                <button 
                  onClick={onClose}
                  className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-all"
                >
                  <X size={18} className="text-white/70" />
                </button>
              </div>
            </div>
            
            {/* Content Grid */}
            <div className="flex-1 overflow-y-auto p-10 grid grid-cols-2 gap-8">
              {/* 1. Deformation vs Time */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[12px] font-black uppercase tracking-wider text-white">Deformation vs Time</h3>
                  <span className="text-[10px] font-bold text-white/40">mm</span>
                </div>
                <div className="h-[400px] bg-white/5 border border-white/10 rounded-3xl p-6">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={mergedData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                      <XAxis 
                        dataKey="time" 
                        stroke="rgba(255,255,255,0.4)" 
                        style={{ fontSize: '10px' }} 
                        tick={{ fill: 'rgba(255,255,255,0.6)' }}
                      />
                      <YAxis 
                        stroke="rgba(255,255,255,0.4)" 
                        style={{ fontSize: '10px' }} 
                        tick={{ fill: 'rgba(255,255,255,0.6)' }}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend 
                        wrapperStyle={{ fontSize: '10px', paddingTop: '15px' }}
                        iconType="line"
                      />
                      <Line 
                        type="monotone" 
                        dataKey="deformation" 
                        stroke={tarpColor} 
                        strokeWidth={3} 
                        dot={false} 
                        name={primarySensor.id}
                      />
                      {comparisonSensors.map((cs, idx) => (
                        <Line
                          key={cs.id}
                          type="monotone"
                          dataKey={`deformation_${cs.id}`}
                          stroke={comparisonColors[idx % comparisonColors.length]}
                          strokeWidth={3}
                          dot={false}
                          name={cs.id}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* 2. Velocity vs Time */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[12px] font-black uppercase tracking-wider text-white">Velocity vs Time</h3>
                  <span className="text-[10px] font-bold text-white/40">mm/d</span>
                </div>
                <div className="h-[400px] bg-white/5 border border-white/10 rounded-3xl p-6">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={mergedData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                      <XAxis 
                        dataKey="time" 
                        stroke="rgba(255,255,255,0.4)" 
                        style={{ fontSize: '10px' }} 
                        tick={{ fill: 'rgba(255,255,255,0.6)' }}
                      />
                      <YAxis 
                        stroke="rgba(255,255,255,0.4)" 
                        style={{ fontSize: '10px' }} 
                        tick={{ fill: 'rgba(255,255,255,0.6)' }}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend 
                        wrapperStyle={{ fontSize: '10px', paddingTop: '15px' }}
                        iconType="line"
                      />
                      <Line 
                        type="monotone" 
                        dataKey="velocity" 
                        stroke={tarpColor} 
                        strokeWidth={3} 
                        dot={false} 
                        name={primarySensor.id}
                      />
                      {comparisonSensors.map((cs, idx) => (
                        <Line
                          key={cs.id}
                          type="monotone"
                          dataKey={`velocity_${cs.id}`}
                          stroke={comparisonColors[idx % comparisonColors.length]}
                          strokeWidth={3}
                          dot={false}
                          name={cs.id}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* 3. Inverse Velocity vs Time */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[12px] font-black uppercase tracking-wider text-white">Inverse Velocity vs Time</h3>
                  <span className="text-[10px] font-bold text-white/40">d/mm</span>
                </div>
                <div className="h-[400px] bg-white/5 border border-white/10 rounded-3xl p-6">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={mergedData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                      <XAxis 
                        dataKey="time" 
                        stroke="rgba(255,255,255,0.4)" 
                        style={{ fontSize: '10px' }} 
                        tick={{ fill: 'rgba(255,255,255,0.6)' }}
                      />
                      <YAxis 
                        stroke="rgba(255,255,255,0.4)" 
                        style={{ fontSize: '10px' }} 
                        tick={{ fill: 'rgba(255,255,255,0.6)' }}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend 
                        wrapperStyle={{ fontSize: '10px', paddingTop: '15px' }}
                        iconType="line"
                      />
                      <Line 
                        type="monotone" 
                        dataKey="inverseVelocity" 
                        stroke={tarpColor} 
                        strokeWidth={3} 
                        dot={false} 
                        name={primarySensor.id}
                      />
                      {comparisonSensors.map((cs, idx) => (
                        <Line
                          key={cs.id}
                          type="monotone"
                          dataKey={`inverseVelocity_${cs.id}`}
                          stroke={comparisonColors[idx % comparisonColors.length]}
                          strokeWidth={3}
                          dot={false}
                          name={cs.id}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-start gap-2 px-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-yellow-500 mt-2 flex-shrink-0" />
                  <p className="text-[10px] text-white/50 leading-relaxed italic">
                    Inverse velocity trending toward zero indicates accelerating failure. Linear trend suggests time-to-failure prediction.
                  </p>
                </div>
              </div>

              {/* 4. Time Per Scan */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[12px] font-black uppercase tracking-wider text-white">Time Per Scan</h3>
                  <span className="text-[10px] font-bold text-white/40">min</span>
                </div>
                <div className="h-[400px] bg-white/5 border border-white/10 rounded-3xl p-6">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={mergedData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                      <XAxis 
                        dataKey="time" 
                        stroke="rgba(255,255,255,0.4)" 
                        style={{ fontSize: '10px' }} 
                        tick={{ fill: 'rgba(255,255,255,0.6)' }}
                      />
                      <YAxis 
                        stroke="rgba(255,255,255,0.4)" 
                        style={{ fontSize: '10px' }} 
                        tick={{ fill: 'rgba(255,255,255,0.6)' }}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend 
                        wrapperStyle={{ fontSize: '10px', paddingTop: '15px' }}
                        iconType="line"
                      />
                      <Line 
                        type="monotone" 
                        dataKey="scanTime" 
                        stroke={tarpColor} 
                        strokeWidth={3} 
                        dot={false} 
                        name={primarySensor.id}
                      />
                      {comparisonSensors.map((cs, idx) => (
                        <Line
                          key={cs.id}
                          type="monotone"
                          dataKey={`scanTime_${cs.id}`}
                          stroke={comparisonColors[idx % comparisonColors.length]}
                          strokeWidth={3}
                          dot={false}
                          name={cs.id}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-start gap-2 px-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-2 flex-shrink-0" />
                  <p className="text-[10px] text-white/50 leading-relaxed italic">
                    Scan duration variations may indicate data quality issues or atmospheric interference patterns.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
