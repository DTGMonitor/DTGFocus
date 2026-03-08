import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Plus, Maximize2, X } from 'lucide-react';

interface Sensor {
  id: string;
  label: string;
  tarp: 1 | 2 | 3 | 4;
  type: 'Radar' | 'Prism' | 'Piezometer' | 'InSAR';
}

interface SensorAnalysisProps {
  sensor: Sensor;
  tarpColor: string;
  onFullScreen?: () => void;
  allSensors?: Sensor[];
  comparisonSensors?: Sensor[];
  onAddComparison?: (sensor: Sensor) => void;
  onRemoveComparison?: (sensorId: string) => void;
}

// Generate time-series data for sensor analysis
const generateSensorTimeSeriesData = (sensorId: string, tarp: number) => {
  const data = [];
  const now = Date.now();
  const hoursBack = 168; // 7 days
  
  for (let i = hoursBack; i >= 0; i -= 4) {
    const timestamp = new Date(now - i * 60 * 60 * 1000);
    const timeStr = timestamp.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    
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
      timestamp: timestamp.getTime(),
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
  [key: string]: string | number; // for comparison data like deformation_...
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: TimeSeriesDataPoint;
    name: string;
    value: string | number;
    color: string; // Recharts provides this
  }>;
  label?: string; // Recharts provides this
}

const CustomTooltip = ({ active, payload }: CustomTooltipProps) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-black/90 backdrop-blur-md border border-white/20 rounded-xl px-3 py-2">
        <p className="text-[9px] font-black text-white/60 uppercase mb-1">{payload[0].payload.time}</p>
        {payload.map((p, idx) => (
          <p key={idx} className="text-[11px] font-bold text-white">
            <span style={{ color: p.color }}>{p.name}:</span> <span className="text-white ml-1">{p.value}</span>
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export const SensorAnalysisView: React.FC<SensorAnalysisProps> = ({ 
  sensor, 
  tarpColor, 
  onFullScreen, 
  allSensors = [], 
  comparisonSensors = [], 
  onAddComparison, 
  onRemoveComparison 
}) => {
  const [showSensorPicker, setShowSensorPicker] = React.useState(false);
  
  const primaryData = React.useMemo(() => generateSensorTimeSeriesData(sensor.id, sensor.tarp), [sensor.id, sensor.tarp]);
  
  // Merge all sensor data into unified dataset
  const mergedData = React.useMemo(() => {
    const baseData: TimeSeriesDataPoint[] = primaryData.map(d => ({ ...d }));
    
    comparisonSensors.forEach((compSensor) => {
      const compData = generateSensorTimeSeriesData(compSensor.id, compSensor.tarp);
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
  }, [primaryData, comparisonSensors]);
  
  // Color palette for comparison sensors
  const comparisonColors = ['#60a5fa', '#a78bfa', '#f472b6', '#fb923c', '#34d399'];
  
  const availableSensors = allSensors.filter(s => 
    s.id !== sensor.id && !comparisonSensors.find(cs => cs.id === s.id)
  );
  
  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <div className="flex items-center justify-between gap-3 pb-4">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Add Comparison Sensor */}
          {onAddComparison && availableSensors.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowSensorPicker(!showSensorPicker)}
                className="flex items-center gap-2 px-3 py-2 bg-[#8EB69B]/10 hover:bg-[#8EB69B]/20 border border-[#8EB69B]/30 rounded-xl transition-all"
              >
                <Plus size={12} className="text-[#8EB69B]" />
                <span className="text-[9px] font-black uppercase tracking-wider text-[#8EB69B]">Compare</span>
              </button>
              
              {/* Sensor Picker Dropdown */}
              {showSensorPicker && (
                <div className="absolute top-full left-0 mt-2 w-64 bg-white/[0.08] backdrop-blur-[40px] border border-white/20 rounded-2xl shadow-2xl p-2 max-h-64 overflow-y-auto scrollbar-hide z-50">
                  <p className="text-[8px] font-black uppercase tracking-wider text-white/40 px-3 py-2">Add Sensor to Compare</p>
                  {availableSensors.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        onAddComparison(s);
                        setShowSensorPicker(false);
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/10 rounded-xl transition-all group"
                    >
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-2 h-2 rounded-full" 
                          style={{ 
                            backgroundColor: s.tarp === 1 ? '#22c55e' : s.tarp === 2 ? '#facc15' : s.tarp === 3 ? '#f97316' : '#ef4444' 
                          }} 
                        />
                        <span className="text-[10px] font-bold text-white">{s.id}</span>
                      </div>
                      <span className="text-[8px] text-white/40 group-hover:text-white/70">{s.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          
          {/* Active Comparison Tags */}
          {comparisonSensors.map((cs, idx) => (
            <div 
              key={cs.id}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border"
              style={{ 
                backgroundColor: `${comparisonColors[idx % comparisonColors.length]}20`,
                borderColor: `${comparisonColors[idx % comparisonColors.length]}50`
              }}
            >
              <span className="text-[9px] font-bold" style={{ color: comparisonColors[idx % comparisonColors.length] }}>
                {cs.id}
              </span>
              {onRemoveComparison && (
                <button 
                  onClick={() => onRemoveComparison(cs.id)}
                  className="hover:opacity-70 transition-opacity"
                >
                  <X size={10} style={{ color: comparisonColors[idx % comparisonColors.length] }} />
                </button>
              )}
            </div>
          ))}
        </div>
        
        {/* Full Screen Button */}
        {onFullScreen && (
          <button
            onClick={onFullScreen}
            className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all flex-shrink-0"
          >
            <Maximize2 size={12} className="text-white/70" />
            <span className="text-[9px] font-black uppercase tracking-wider text-white/70">Deep Analysis</span>
          </button>
        )}
      </div>

      {/* Graphs Container with better spacing */}
      <div className="space-y-6 pr-2">
      {/* 1. Deformation vs Time */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-[10px] font-black uppercase tracking-wider text-white/70">Deformation vs Time</h3>
          <span className="text-[8px] font-bold text-white/40">mm</span>
        </div>
        <div className="h-44 bg-white/5 border border-white/10 rounded-2xl p-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={mergedData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis 
                dataKey="time" 
                stroke="rgba(255,255,255,0.3)" 
                style={{ fontSize: '8px' }} 
                tick={{ fill: 'rgba(255,255,255,0.5)' }}
              />
              <YAxis 
                stroke="rgba(255,255,255,0.3)" 
                style={{ fontSize: '8px' }} 
                tick={{ fill: 'rgba(255,255,255,0.5)' }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend 
                wrapperStyle={{ fontSize: '8px', paddingTop: '8px' }}
                iconType="line"
              />
              <Line 
                type="monotone" 
                dataKey="deformation" 
                stroke={tarpColor} 
                strokeWidth={2} 
                dot={false} 
                name={sensor.id}
              />
              {comparisonSensors.map((cs, idx) => (
                <Line
                  key={cs.id}
                  type="monotone"
                  dataKey={`deformation_${cs.id}`}
                  stroke={comparisonColors[idx % comparisonColors.length]}
                  strokeWidth={2}
                  dot={false}
                  name={cs.id}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 2. Velocity vs Time */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-[10px] font-black uppercase tracking-wider text-white/70">Velocity vs Time</h3>
          <span className="text-[8px] font-bold text-white/40">mm/d</span>
        </div>
        <div className="h-44 bg-white/5 border border-white/10 rounded-2xl p-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={mergedData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis 
                dataKey="time" 
                stroke="rgba(255,255,255,0.3)" 
                style={{ fontSize: '8px' }} 
                tick={{ fill: 'rgba(255,255,255,0.5)' }}
              />
              <YAxis 
                stroke="rgba(255,255,255,0.3)" 
                style={{ fontSize: '8px' }} 
                tick={{ fill: 'rgba(255,255,255,0.5)' }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend 
                wrapperStyle={{ fontSize: '8px', paddingTop: '8px' }}
                iconType="line"
              />
              <Line 
                type="monotone" 
                dataKey="velocity" 
                stroke={tarpColor} 
                strokeWidth={2} 
                dot={false} 
                name={sensor.id}
              />
              {comparisonSensors.map((cs, idx) => (
                <Line
                  key={cs.id}
                  type="monotone"
                  dataKey={`velocity_${cs.id}`}
                  stroke={comparisonColors[idx % comparisonColors.length]}
                  strokeWidth={2}
                  dot={false}
                  name={cs.id}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 3. Inverse Velocity vs Time */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-[10px] font-black uppercase tracking-wider text-white/70">Inverse Velocity vs Time</h3>
          <span className="text-[8px] font-bold text-white/40">d/mm</span>
        </div>
        <div className="h-44 bg-white/5 border border-white/10 rounded-2xl p-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={mergedData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis 
                dataKey="time" 
                stroke="rgba(255,255,255,0.3)" 
                style={{ fontSize: '8px' }} 
                tick={{ fill: 'rgba(255,255,255,0.5)' }}
              />
              <YAxis 
                stroke="rgba(255,255,255,0.3)" 
                style={{ fontSize: '8px' }} 
                tick={{ fill: 'rgba(255,255,255,0.5)' }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend 
                wrapperStyle={{ fontSize: '8px', paddingTop: '8px' }}
                iconType="line"
              />
              <Line 
                type="monotone" 
                dataKey="inverseVelocity" 
                stroke={tarpColor} 
                strokeWidth={2} 
                dot={false} 
                name={sensor.id}
              />
              {comparisonSensors.map((cs, idx) => (
                <Line
                  key={cs.id}
                  type="monotone"
                  dataKey={`inverseVelocity_${cs.id}`}
                  stroke={comparisonColors[idx % comparisonColors.length]}
                  strokeWidth={2}
                  dot={false}
                  name={cs.id}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-start gap-2 px-1">
          <div className="w-1 h-1 rounded-full bg-yellow-500 mt-1.5 flex-shrink-0" />
          <p className="text-[9px] text-white/50 leading-relaxed italic">
            Inverse velocity trending toward zero indicates accelerating failure. Linear trend suggests time-to-failure.
          </p>
        </div>
      </div>

      {/* 4. Time Per Scan */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-[10px] font-black uppercase tracking-wider text-white/70">Time Per Scan</h3>
          <span className="text-[8px] font-bold text-white/40">min</span>
        </div>
        <div className="h-44 bg-white/5 border border-white/10 rounded-2xl p-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={mergedData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis 
                dataKey="time" 
                stroke="rgba(255,255,255,0.3)" 
                style={{ fontSize: '8px' }} 
                tick={{ fill: 'rgba(255,255,255,0.5)' }}
              />
              <YAxis 
                stroke="rgba(255,255,255,0.3)" 
                style={{ fontSize: '8px' }} 
                tick={{ fill: 'rgba(255,255,255,0.5)' }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend 
                wrapperStyle={{ fontSize: '8px', paddingTop: '8px' }}
                iconType="line"
              />
              <Line 
                type="monotone" 
                dataKey="scanTime" 
                stroke={tarpColor} 
                strokeWidth={2} 
                dot={false} 
                name={sensor.id}
              />
              {comparisonSensors.map((cs, idx) => (
                <Line
                  key={cs.id}
                  type="monotone"
                  dataKey={`scanTime_${cs.id}`}
                  stroke={comparisonColors[idx % comparisonColors.length]}
                  strokeWidth={2}
                  dot={false}
                  name={cs.id}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-start gap-2 px-1">
          <div className="w-1 h-1 rounded-full bg-blue-500 mt-1.5 flex-shrink-0" />
          <p className="text-[9px] text-white/50 leading-relaxed italic">
            Scan duration variations may indicate data quality issues or atmospheric interference.
          </p>
        </div>
      </div>
      </div>
    </div>
  );
};