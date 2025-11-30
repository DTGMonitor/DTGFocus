import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import LogoSection from '@/components/Reusable/HeaderComponents/LogoSection';
import {
  Radio,
  Activity,
  Target,
  Layers,
  MapPin,
  AlertTriangle,
  Clock,
  ChevronRight,
  Bell,
  Settings,
  User,
  Home,
  Network,
  Shield,
  BarChart3,
  FileText,
  Wrench,
  TrendingUp,
  TrendingDown,
  Eye,
  EyeOff,
  Box,
  Map,
  Maximize2,
  Download,
  Share2,
  Filter,
  Zap,
  Brain,
  Wind,
  CloudRain,
  ThermometerSun,
  Compass,
  Ruler,
  Camera,
  Video,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  RefreshCw,
  Search,
  Grid3x3,
  Layers3,
  ScanLine,
  Workflow,
  GitBranch,
  Database,
  Cpu,
  Sparkles,
  Target as TargetIcon,
  ChevronDown,
  Info,
  DollarSign,
  Users,
  Truck,
  HardHat,
  Check,
  X,
  Crosshair
} from 'lucide-react';
import { Badge } from '@/components/LandingPage/ui/badge';
import { Button } from '@/components/LandingPage/ui/button';
import { Card } from '@/components/LandingPage/ui/card';
import pitImage from '@/src/images/pit/c395f9408d7dd0db6ddf017d784ae3d83d89623e.png';
import Image from 'next/image';

type TarpLevel = 1 | 2 | 3 | 4;
type InstrumentType = 'radar' | 'prism' | 'vwp' | 'extensometer' | 'crackometer' | 'piezometer';
type ViewMode = '3d' | '2d-top' | '2d-north' | '2d-east' | 'thermal' | 'deformation-heatmap';
type AnalysisMode = 'realtime' | 'predictive' | 'historical' | 'comparative';

interface Instrument {
  id: string;
  type: InstrumentType;
  name: string;
  x: number;
  y: number;
  easting: number;
  northing: number;
  elevation: number;
  status: 'online' | 'offline' | 'warning' | 'critical';
  tarpLevel: TarpLevel;
  deformation: number;
  velocity: number;
  acceleration: number;
  trend: 'up' | 'down' | 'stable' | 'accelerating';
  confidence: number;
  lastUpdate: string;
  battery?: number;
  signalStrength?: number;
  historicalData?: number[];
  predictedData?: number[];
}

interface TarpZone {
  id: string;
  name: string;
  level: TarpLevel;
  coordinates: { x: number; y: number }[];
  area: string;
  volume: string;
  avgDeformation: number;
  maxDeformation: number;
  instruments: number;
  probability?: number;
  timeframe?: string;
  riskScore: number;
  evacuationRequired: boolean;
  estimatedCost?: string;
}

interface WeatherData {
  temperature: number;
  humidity: number;
  windSpeed: number;
  rainfall: number;
  pressure: number;
}

interface MeasurementPoint {
  x: number;
  y: number;
}

// Enhanced TARP zones
const tarpZones: TarpZone[] = [
  {
    id: 'delta-7',
    name: 'Zone Delta-7 (East Wall)',
    level: 4,
    coordinates: [
      { x: 72, y: 20 }, { x: 78, y: 18 }, { x: 84, y: 20 }, { x: 88, y: 24 },
      { x: 91, y: 30 }, { x: 92, y: 38 }, { x: 90, y: 45 }, { x: 86, y: 50 },
      { x: 82, y: 52 }, { x: 78, y: 51 }, { x: 74, y: 48 }, { x: 70, y: 43 },
      { x: 68, y: 36 }, { x: 69, y: 28 }
    ],
    area: '2.1 ha',
    volume: '156,000 m³',
    avgDeformation: 63.11,
    maxDeformation: 78.4,
    instruments: 4,
    probability: 75,
    timeframe: '6-12 hours',
    riskScore: 94,
    evacuationRequired: true,
    estimatedCost: '$8.2M'
  },
  {
    id: 'charlie-3',
    name: 'Zone Charlie-3 (North Sector)',
    level: 3,
    coordinates: [
      { x: 25, y: 18 }, { x: 35, y: 16 }, { x: 45, y: 17 }, { x: 52, y: 20 },
      { x: 58, y: 25 }, { x: 62, y: 32 }, { x: 62, y: 40 }, { x: 58, y: 46 },
      { x: 52, y: 50 }, { x: 45, y: 51 }, { x: 38, y: 49 }, { x: 32, y: 44 },
      { x: 27, y: 38 }, { x: 24, y: 30 }, { x: 23, y: 24 }
    ],
    area: '3.2 ha',
    volume: '240,000 m³',
    avgDeformation: 28.5,
    maxDeformation: 35.2,
    instruments: 6,
    probability: 45,
    timeframe: '24-48 hours',
    riskScore: 68,
    evacuationRequired: false,
    estimatedCost: '$4.5M'
  },
  {
    id: 'bravo-2',
    name: 'Zone Bravo-2 (South Wall)',
    level: 2,
    coordinates: [
      { x: 32, y: 62 }, { x: 38, y: 60 }, { x: 44, y: 61 }, { x: 50, y: 64 },
      { x: 55, y: 68 }, { x: 58, y: 74 }, { x: 56, y: 80 }, { x: 52, y: 84 },
      { x: 46, y: 86 }, { x: 40, y: 85 }, { x: 35, y: 81 }, { x: 30, y: 74 },
      { x: 28, y: 68 }
    ],
    area: '1.8 ha',
    volume: '98,000 m³',
    avgDeformation: 12.3,
    maxDeformation: 16.8,
    instruments: 4,
    riskScore: 38,
    evacuationRequired: false,
    estimatedCost: '$1.2M'
  },
  {
    id: 'alpha-1',
    name: 'Zone Alpha-1 (Southeast)',
    level: 1,
    coordinates: [
      { x: 68, y: 58 }, { x: 75, y: 56 }, { x: 82, y: 58 }, { x: 87, y: 62 },
      { x: 90, y: 68 }, { x: 90, y: 75 }, { x: 87, y: 81 }, { x: 82, y: 85 },
      { x: 75, y: 87 }, { x: 70, y: 85 }, { x: 66, y: 80 }, { x: 64, y: 72 },
      { x: 64, y: 65 }
    ],
    area: '2.5 ha',
    volume: '175,000 m³',
    avgDeformation: 5.8,
    maxDeformation: 8.2,
    instruments: 5,
    riskScore: 18,
    evacuationRequired: false
  }
];

// Generate historical data for instruments
const generateHistoricalData = (baseValue: number, trend: string) => {
  const data: number[] = [];
  let current = baseValue * 0.5;
  for (let i = 0; i < 24; i++) {
    if (trend === 'accelerating') {
      current += (Math.random() * 2 + 1) * (1 + i * 0.05);
    } else if (trend === 'up') {
      current += Math.random() * 1.5 + 0.5;
    } else if (trend === 'down') {
      current += Math.random() * 0.5 - 0.3;
    } else {
      current += (Math.random() - 0.5) * 0.5;
    }
    data.push(Math.max(0, current));
  }
  return data;
};

// Generate predicted data
const generatePredictedData = (historicalData: number[], trend: string) => {
  const lastValue = historicalData[historicalData.length - 1];
  const data: number[] = [];
  let current = lastValue;
  for (let i = 0; i < 12; i++) {
    if (trend === 'accelerating') {
      current += (Math.random() * 3 + 2) * (1 + i * 0.08);
    } else if (trend === 'up') {
      current += Math.random() * 2 + 1;
    } else if (trend === 'down') {
      current += Math.random() * 0.3 - 0.2;
    } else {
      current += (Math.random() - 0.5) * 0.3;
    }
    data.push(Math.max(0, current));
  }
  return data;
};

// Enhanced instruments with historical data
const generateInstruments = (): Instrument[] => {
  const baseInstruments = [
    { id: 'VWP-401', type: 'vwp' as const, name: 'VWP-401', x: 80, y: 35, easting: 392145, northing: 7442563, elevation: 485, status: 'critical' as const, tarpLevel: 4 as const, deformation: 63.11, velocity: 2.4, acceleration: 0.12, trend: 'accelerating' as const, confidence: 94, lastUpdate: '2 min ago', battery: 87, signalStrength: 92 },
    { id: 'R-584', type: 'radar' as const, name: 'SSR-584', x: 75, y: 28, easting: 392098, northing: 7442598, elevation: 488, status: 'warning' as const, tarpLevel: 4 as const, deformation: 58.4, velocity: 2.1, acceleration: 0.08, trend: 'up' as const, confidence: 91, lastUpdate: '1 min ago', battery: 92, signalStrength: 88 },
    { id: 'P-223', type: 'prism' as const, name: 'PRM-223', x: 85, y: 40, easting: 392178, northing: 7442512, elevation: 482, status: 'online' as const, tarpLevel: 4 as const, deformation: 45.8, velocity: 1.8, acceleration: 0.04, trend: 'stable' as const, confidence: 96, lastUpdate: '3 min ago', battery: 95, signalStrength: 94 },
    { id: 'EXT-102', type: 'extensometer' as const, name: 'EXT-102', x: 78, y: 32, easting: 392122, northing: 7442578, elevation: 486, status: 'online' as const, tarpLevel: 4 as const, deformation: 52.3, velocity: 1.9, acceleration: 0.06, trend: 'up' as const, confidence: 89, lastUpdate: '4 min ago', battery: 78, signalStrength: 85 },
    { id: 'SPF-880', type: 'prism' as const, name: 'SPF-880', x: 45, y: 30, easting: 391876, northing: 7442678, elevation: 489, status: 'offline' as const, tarpLevel: 3 as const, deformation: 32.1, velocity: 1.2, acceleration: 0.02, trend: 'stable' as const, confidence: 0, lastUpdate: '35 min ago', battery: 12, signalStrength: 0 },
    { id: 'R-461', type: 'radar' as const, name: 'SSR-461XT', x: 38, y: 35, easting: 391812, northing: 7442645, elevation: 492, status: 'online' as const, tarpLevel: 3 as const, deformation: 28.3, velocity: 1.0, acceleration: -0.02, trend: 'down' as const, confidence: 93, lastUpdate: '1 min ago', battery: 88, signalStrength: 91 },
    { id: 'CRK-234', type: 'crackometer' as const, name: 'CRK-234', x: 50, y: 38, easting: 391932, northing: 7442628, elevation: 490, status: 'online' as const, tarpLevel: 3 as const, deformation: 24.7, velocity: 0.9, acceleration: 0.01, trend: 'stable' as const, confidence: 87, lastUpdate: '2 min ago', battery: 84, signalStrength: 89 },
    { id: 'VWP-897', type: 'vwp' as const, name: 'VWP-897', x: 42, y: 72, easting: 391712, northing: 7442234, elevation: 478, status: 'offline' as const, tarpLevel: 2 as const, deformation: 15.7, velocity: 0.6, acceleration: 0, trend: 'stable' as const, confidence: 0, lastUpdate: '45 min ago', battery: 8, signalStrength: 0 },
    { id: 'P-445', type: 'prism' as const, name: 'PRM-445', x: 48, y: 78, easting: 391768, northing: 7442198, elevation: 476, status: 'online' as const, tarpLevel: 2 as const, deformation: 11.5, velocity: 0.4, acceleration: -0.01, trend: 'down' as const, confidence: 95, lastUpdate: '4 min ago', battery: 91, signalStrength: 93 },
    { id: 'PIZ-567', type: 'piezometer' as const, name: 'PIZ-567', x: 44, y: 75, easting: 391734, northing: 7442212, elevation: 477, status: 'online' as const, tarpLevel: 2 as const, deformation: 13.2, velocity: 0.5, acceleration: 0, trend: 'stable' as const, confidence: 88, lastUpdate: '6 min ago', battery: 86, signalStrength: 87 },
    { id: 'R-844', type: 'radar' as const, name: 'SSR-844FX', x: 75, y: 70, easting: 392087, northing: 7442312, elevation: 488, status: 'online' as const, tarpLevel: 1 as const, deformation: 4.2, velocity: 0.15, acceleration: 0, trend: 'stable' as const, confidence: 97, lastUpdate: '1 min ago', battery: 94, signalStrength: 96 },
    { id: 'VWP-312', type: 'vwp' as const, name: 'VWP-312', x: 80, y: 78, easting: 392124, northing: 7442256, elevation: 483, status: 'online' as const, tarpLevel: 1 as const, deformation: 6.3, velocity: 0.22, acceleration: 0, trend: 'stable' as const, confidence: 96, lastUpdate: '8 min ago', battery: 89, signalStrength: 92 },
  ];

  return baseInstruments.map(inst => {
    const historicalData = generateHistoricalData(inst.deformation, inst.trend);
    const predictedData = generatePredictedData(historicalData, inst.trend);
    return { ...inst, historicalData, predictedData };
  });
};

const weatherData: WeatherData = {
  temperature: 32,
  humidity: 45,
  windSpeed: 18,
  rainfall: 2.3,
  pressure: 1013
};

export default function HomePage() {
  const router = useRouter();
  const params = useParams();
  const client = params?.client || "Default";
  const [instruments] = useState<Instrument[]>(generateInstruments());
  const [viewMode, setViewMode] = useState<ViewMode>('3d');
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('realtime');
  const [rotationX, setRotationX] = useState(55);
  const [rotationZ, setRotationZ] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [selectedInstrument, setSelectedInstrument] = useState<Instrument | null>(null);
  const [selectedZone, setSelectedZone] = useState<TarpZone | null>(null);
  const [activeSidebarItem, setActiveSidebarItem] = useState('sensor-network');
  const [showAIInsights, setShowAIInsights] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showEvacuationZones, setShowEvacuationZones] = useState(false);
  const [showWeatherOverlay, setShowWeatherOverlay] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [timelinePosition, setTimelinePosition] = useState(100);
  const [measurementMode, setMeasurementMode] = useState(false);
  const [measurementPoints, setMeasurementPoints] = useState<MeasurementPoint[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [snapshotTaken, setSnapshotTaken] = useState(false);
  const [visibleLayers, setVisibleLayers] = useState({
    terrain: true,
    contours: true,
    tarpZones: true,
    vwp: true,
    radar: true,
    prism: true,
    extensometer: true,
    crackometer: true,
    piezometer: true,
    geology: true,
    infrastructure: true,
    equipment: true
  });
  const [notifications, setNotifications] = useState<string[]>([
    'VWP-401 acceleration detected',
    'Zone Delta-7 TARP 4 activated',
    'SPF-880 offline for 35 minutes'
  ]);

  // Timeline playback effect
  useEffect(() => {
    if (isPlaying && timelinePosition < 100) {
      const interval = setInterval(() => {
        setTimelinePosition(prev => {
          const next = prev + (playbackSpeed * 0.5);
          if (next >= 100) {
            setIsPlaying(false);
            return 100;
          }
          return next;
        });
      }, 100);
      return () => clearInterval(interval);
    }
  }, [isPlaying, playbackSpeed, timelinePosition]);

  // Recording timer
  useEffect(() => {
    if (isRecording) {
      const interval = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
      return () => clearInterval(interval);
    } else {
      setRecordingDuration(0);
    }
  }, [isRecording]);

  const getTarpColor = (level: TarpLevel) => {
    switch (level) {
      case 1: return 'rgba(34, 197, 94, 0.35)';
      case 2: return 'rgba(251, 191, 36, 0.35)';
      case 3: return 'rgba(249, 115, 22, 0.35)';
      case 4: return 'rgba(239, 68, 68, 0.35)';
    }
  };

  const getTarpBorderColor = (level: TarpLevel) => {
    switch (level) {
      case 1: return '#22C55E';
      case 2: return '#FBBF24';
      case 3: return '#F97316';
      case 4: return '#EF4444';
    }
  };

  const getInstrumentColor = (type: InstrumentType) => {
    switch (type) {
      case 'radar': return '#3B82F6';
      case 'prism': return '#A855F7';
      case 'vwp': return '#F59E0B';
      case 'extensometer': return '#10B981';
      case 'crackometer': return '#EC4899';
      case 'piezometer': return '#06B6D4';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return '#22C55E';
      case 'warning': return '#FBBF24';
      case 'critical': return '#EF4444';
      case 'offline': return '#6B7280';
      default: return '#6B7280';
    }
  };

  const toggleLayer = (layer: keyof typeof visibleLayers) => {
    setVisibleLayers(prev => ({ ...prev, [layer]: !prev[layer] }));
  };

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    // Reset view for 2D modes
    if (mode !== '3d') {
      setRotationX(mode === '2d-top' ? 0 : mode === '2d-north' ? 90 : 45);
      setRotationZ(mode === '2d-east' ? 90 : 0);
    }
  };

  const handleSnapshot = () => {
    setSnapshotTaken(true);
    setNotifications(prev => [`Snapshot saved - ${new Date().toLocaleTimeString()}`, ...prev.slice(0, 4)]);
    setTimeout(() => setSnapshotTaken(false), 2000);
  };

  const handleRecord = () => {
    if (isRecording) {
      setNotifications(prev => [`Recording saved - Duration: ${recordingDuration}s`, ...prev.slice(0, 4)]);
    }
    setIsRecording(!isRecording);
  };

  const handleMeasurementClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!measurementMode) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    setMeasurementPoints(prev => {
      if (prev.length >= 2) return [{ x, y }];
      return [...prev, { x, y }];
    });
  };

  const calculateDistance = () => {
    if (measurementPoints.length !== 2) return 0;
    const dx = measurementPoints[1].x - measurementPoints[0].x;
    const dy = measurementPoints[1].y - measurementPoints[0].y;
    // Convert percentage to approximate meters (assuming 800m pit width)
    return Math.sqrt(dx * dx + dy * dy) * 8; // Approximate scale
  };

  const handleExportData = () => {
    setNotifications(prev => [`Data exported - ${new Date().toLocaleTimeString()}.csv`, ...prev.slice(0, 4)]);
  };

  const handleShareView = () => {
    setNotifications(prev => [`View link copied to clipboard`, ...prev.slice(0, 4)]);
  };

  const criticalZone = tarpZones.find(z => z.level === 4);
  const tarpStats = {
    level1: tarpZones.filter(z => z.level === 1).length,
    level2: tarpZones.filter(z => z.level === 2).length,
    level3: tarpZones.filter(z => z.level === 3).length,
    level4: tarpZones.filter(z => z.level === 4).length
  };

  const onlineCount = instruments.filter(i => i.status === 'online').length;
  const totalCount = instruments.length;
  const criticalCount = instruments.filter(i => i.status === 'critical').length;
  const offlineCount = instruments.filter(i => i.status === 'offline').length;

  const sidebarItems = [
    { id: 'dashboard', label: 'Dashboard', icon: Home, path: `/tools/${client}/device` },
    { id: 'sensor-network', label: 'Sensor Network', icon: Network, path: `/tools/${client}/home`, active: true },
    { id: 'risk-management', label: 'Risk Management', icon: Shield },
    { id: 'analytics', label: 'AI Analytics', icon: Brain },
    { id: 'reports', label: 'Reports', icon: BarChart3 },
    { id: 'operations', label: 'Operations', icon: Users },
    { id: 'maintenance', label: 'Maintenance', icon: Wrench },
  ];

  const getViewModeTransform = () => {
    switch (viewMode) {
      case '3d':
        return `rotateX(${rotationX}deg) rotateZ(${rotationZ}deg) scale(${zoom})`;
      case '2d-top':
        return `scale(${zoom})`;
      case '2d-north':
        return `rotateX(90deg) scale(${zoom})`;
      case '2d-east':
        return `rotateY(90deg) scale(${zoom})`;
      default:
        return `rotateX(${rotationX}deg) rotateZ(${rotationZ}deg) scale(${zoom})`;
    }
  };

  const getAnalysisData = (instrument: Instrument) => {
    switch (analysisMode) {
      case 'realtime':
        return instrument.historicalData?.slice(-12) || [];
      case 'predictive':
        return [...(instrument.historicalData?.slice(-6) || []), ...(instrument.predictedData?.slice(0, 6) || [])];
      case 'historical':
        return instrument.historicalData || [];
      case 'comparative':
        return instrument.historicalData?.slice(-12) || [];
      default:
        return [];
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen">
      {/* Snapshot Flash Effect */}
      {snapshotTaken && (
        <div className="fixed inset-0 bg-white z-[100] animate-[flash_0.3s_ease-out]"
          style={{ animation: 'flash 0.3s ease-out', pointerEvents: 'none' }} />
      )}
      {/* Logo Section */}
      <div className="sticky-header">
        <LogoSection Subtitle="Home" />
      </div>
      <div className="flex space-y-6 bg-[var(--dtg-bg-primary)]">

        {/* Left Sidebar */}
        <div className="pt-6 w-64 bg-[var(--dtg-bg-card)] border-r border-[var(--dtg-border-medium)]">

          <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
            {sidebarItems.map(item => {
              const Icon = item.icon;
              const isActive = activeSidebarItem === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveSidebarItem(item.id);
                    setNotifications(prev => [`Navigated to ${item.label}`, ...prev.slice(0, 4)]);
                    if (item.path) {
                      router.push(item.path);
                    }
                  }}
                  className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-lg transition-all ${isActive
                    ? 'bg-[rgba(var(--dtg-primary-teal-dark-rgb),0.5)] font-bold text-[var(--dtg-text-primary)]'
                    : 'text-[var(--dtg-text-muted)] hover:bg-[var(--dtg-bg-primary)] hover:text-[var(--dtg-text-muted)]'
                    }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-sm">{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* System Health */}
          <div className="p-4 border-t border-[var(--dtg-border-medium)] space-y-3">
            <div className="text-xs font-medium text-[var(--dtg-gray-400)] flex items-center justify-between">
              <span>System Status</span>
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center space-x-2">
                  <Database className="w-3 h-3 text-[var(--dtg-gray-500)]" />
                  <span className="text-[var(--dtg-gray-500)]">Data Integrity</span>
                </div>
                <span className="text-green-400 font-medium">99.8%</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center space-x-2">
                  <Cpu className="w-3 h-3 text-[var(--dtg-gray-500)]" />
                  <span className="text-[var(--dtg-gray-500)]">AI Processing</span>
                </div>
                <span className="text-green-400 font-medium">Active</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center space-x-2">
                  <Network className="w-3 h-3 text-[var(--dtg-gray-500)]" />
                  <span className="text-[var(--dtg-gray-500)]">Network</span>
                </div>
                <span className="text-green-400 font-medium">Optimal</span>
              </div>
            </div>
          </div>
          {/* Pit Health Summary */}
          <Card className="m-2 bg-gradient-to-br from-[var(--purple-from)] to-[var(--purple-to)]  border-[var(--purple-border)] p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold">Pit Health Index</h3>
              <Badge className="bg-blue-600 text-white text-xs">{analysisMode.toUpperCase()}</Badge>
            </div>

            {/* Circular Progress */}
            <div className="flex justify-center mb-4">
              <div className="relative w-36 h-36">
                <svg className="w-36 h-36 transform-rotate-90">
                  <circle
                    cx="64"
                    cy="64"
                    r="50"
                    stroke="#2a2a2a"
                    strokeWidth="14"
                    fill="none"
                  />
                  <circle
                    cx="64"
                    cy="64"
                    r="50"
                    stroke="url(#gradient)"
                    strokeWidth="14"
                    fill="none"
                    strokeDasharray="402"
                    strokeDashoffset="190"
                    strokeLinecap="round"
                  >
                    {isPlaying && (
                      <animate
                        attributeName="stroke-dashoffset"
                        from="80"
                        to="100"
                        dur="2s"
                        repeatCount="indefinite"
                      />
                    )}
                  </circle>
                  <defs>
                    <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#3B82F6" />
                      <stop offset="100%" stopColor="#8B5CF6" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">76</div>
                  <div className="text-xs text-[var(--dtg-gray-400)]">Stability Score</div>
                </div>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[var(--dtg-bg-card)] rounded-lg p-3">
                <div className="text-xs text-[var(--dtg-gray-400)] mb-1">Active Sensors</div>
                <div className="text-2xl font-bold text-green-400">{onlineCount}/{totalCount}</div>
              </div>
              <div className="bg-[var(--dtg-bg-card)] rounded-lg p-3">
                <div className="text-xs text-[var(--dtg-gray-400)] mb-1">Data Quality</div>
                <div className="text-2xl font-bold text-blue-400">99.8%</div>
              </div>
            </div>
          </Card>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col">
          {/* Top Bar */}
          <div className=" h-20 bg-[var(--dtg-bg-card)] border-b border-[var(--dtg-border-medium)] px-6 py-6 flex items-center justify-between">
            {/* Critical Alert */}
            {criticalZone && (
              <div className="flex items-center space-x-4 bg-gradient-to-r from-red-600/20 via-red-600/10 to-transparent px-4 py-2 rounded-lg border border-red-600/30">
                <div className="flex items-center space-x-2">
                  <div className="relative">
                    <AlertTriangle className="w-5 h-5 text-red-500" />
                    <div className="absolute inset-0 animate-ping">
                      <AlertTriangle className="w-5 h-5 text-red-500 opacity-75" />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-bold text-red-500">CRITICAL ALERT</span>
                      <Badge className="bg-red-600 text-white text-xs px-2 py-0">TARP 4</Badge>
                    </div>
                    <span className="text-xs text-[var(--dtg-gray-500)]">
                      {criticalZone.name} - {criticalZone.probability}% failure probability ({criticalZone.timeframe})
                    </span>
                  </div>
                </div>
                <Button
                  size="sm"
                  className="bg-red-600 hover:bg-red-700 text-white text-xs"
                  onClick={() => setNotifications(prev => ['Emergency protocol initiated', ...prev.slice(0, 4)])}
                >
                  Initiate Protocol
                </Button>
              </div>
            )}

            {/* Right Stats */}
            <div className="flex items-center space-x-4">
              {/* Sensor Status */}
              <div className="bg-[var(--dtg-bg-primary)] px-4 py-2 rounded-lg border border-[var(--dtg-border-light)]">
                <div className="flex items-center space-x-3">
                  <div className="flex items-center space-x-1.5">
                    <div className="w-2 h-2 bg-green-500 rounded-full" />
                    <span className="text-xs font-semibold text-green-400">{onlineCount}</span>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <div className="w-2 h-2 bg-red-500 rounded-full" />
                    <span className="text-xs font-semibold text-red-400">{criticalCount}</span>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <div className="w-2 h-2 bg-gray-500 rounded-full" />
                    <span className="text-xs font-semibold text-[var(--dtg-gray-400)]">{offlineCount}</span>
                  </div>
                  <span className="text-xs text-[var(--dtg-gray-500)]">/ {totalCount}</span>
                </div>
              </div>

              {/* Weather */}
              <div className="bg-[var(--dtg-bg-primary)] px-4 py-2 rounded-lg border border-[var(--dtg-border-light)] flex items-center space-x-3">
                <ThermometerSun className="w-4 h-4 text-orange-400" />
                <span className="text-sm font-semibold">{weatherData.temperature}°C</span>
                <Wind className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-semibold">{weatherData.windSpeed} km/h</span>
              </div>

              {/* Timestamp */}
              <div className="bg-[var(--dtg-bg-primary)] px-4 py-2 rounded-lg border border-[var(--dtg-border-light)] flex items-center space-x-2">
                <Clock className="w-4 h-4 text-[var(--dtg-gray-400)]" />
                <span className="text-xs font-mono text-[var(--dtg-gray-500)]">14:33:01 GMT+8</span>
              </div>

              {/* Actions */}
              <div className="flex items-center space-x-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-[var(--dtg-gray-400)] hover:text-white"
                  onClick={handleShareView}
                >
                  <Share2 className="w-4 h-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-[var(--dtg-gray-400)] hover:text-white"
                  onClick={handleExportData}
                >
                  <Download className="w-4 h-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-[var(--dtg-gray-400)] hover:text-white relative"
                  onClick={() => setNotifications([])}
                >
                  <Bell className="w-4 h-4" />
                  {notifications.length > 0 && (
                    <div className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
                  )}
                </Button>
              </div>
            </div>
          </div>

          <div className="flex-1 flex overflow-hidden">
            {/* Main Visualization */}
            <div className="flex-1 flex flex-col bg-[var(--dtg-bg-primary)] relative">
              {/* Advanced Control Bar */}
              <div className="bg-[var(--dtg-bg-card)] border-b border-[var(--dtg-border-medium)] px-6 py-3 flex items-center justify-between">
                {/* View Mode Selector */}
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-[var(--dtg-gray-400)] mr-2">View:</span>
                  {[
                    { mode: '3d' as const, icon: Box, label: '3D' },
                    { mode: '2d-top' as const, icon: Map, label: 'Top' },
                    { mode: '2d-north' as const, icon: Layers, label: 'North' },
                    { mode: '2d-east' as const, icon: Layers3, label: 'East' },
                    { mode: 'thermal' as const, icon: ThermometerSun, label: 'Thermal' },
                    { mode: 'deformation-heatmap' as const, icon: ScanLine, label: 'Heatmap' }
                  ].map(({ mode, icon: Icon, label }) => (
                    <Button
                      key={mode}
                      size="sm"
                      variant={viewMode === mode ? 'default' : 'ghost'}
                      onClick={() => handleViewModeChange(mode)}
                      className={`text-xs ${viewMode === mode ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
                    >
                      <Icon className="w-3 h-3 mr-1" />
                      {label}
                    </Button>
                  ))}
                </div>

                {/* Analysis Mode */}
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-[var(--dtg-gray-400)] mr-2">Analysis:</span>
                  {[
                    { mode: 'realtime' as const, icon: Zap, label: 'Real-time' },
                    { mode: 'predictive' as const, icon: Brain, label: 'Predictive AI' },
                    { mode: 'historical' as const, icon: Clock, label: 'Historical' },
                    { mode: 'comparative' as const, icon: GitBranch, label: 'Comparative' }
                  ].map(({ mode, icon: Icon, label }) => (
                    <Button
                      key={mode}
                      size="sm"
                      variant={analysisMode === mode ? 'default' : 'ghost'}
                      onClick={() => {
                        setAnalysisMode(mode);
                        setShowAIInsights(mode === 'predictive');
                      }}
                      className={`text-xs ${analysisMode === mode ? 'bg-purple-600 hover:bg-purple-700' : ''}`}
                    >
                      <Icon className="w-3 h-3 mr-1" />
                      {label}
                    </Button>
                  ))}
                </div>

                {/* Tools */}
                <div className="flex items-center space-x-2">
                  <Button
                    size="sm"
                    variant={measurementMode ? 'default' : 'ghost'}
                    onClick={() => {
                      setMeasurementMode(!measurementMode);
                      setMeasurementPoints([]);
                    }}
                    className={measurementMode ? 'bg-green-600 hover:bg-green-700' : ''}
                  >
                    <Ruler className="w-3 h-3 mr-1" />
                    Measure
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleSnapshot}
                  >
                    <Camera className="w-3 h-3 mr-1" />
                    Snapshot
                  </Button>
                  <Button
                    size="sm"
                    variant={isRecording ? 'default' : 'ghost'}
                    onClick={handleRecord}
                    className={isRecording ? 'bg-red-600 hover:bg-red-700 animate-pulse' : ''}
                  >
                    <Video className="w-3 h-3 mr-1" />
                    {isRecording ? formatTime(recordingDuration) : 'Record'}
                  </Button>
                </div>
              </div>

              {/* 3D View */}
              <div className="flex-1 relative" style={{ perspective: '2000px' }}>
                {/* Measurement Distance Display */}
                {measurementMode && measurementPoints.length === 2 && (
                  <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-30 bg-green-600/90 backdrop-blur-sm border border-green-400 rounded-lg px-4 py-2">
                    <div className="text-sm font-semibold text-white">
                      Distance: {calculateDistance().toFixed(2)} meters
                    </div>
                  </div>
                )}

                {/* Recording Indicator */}
                {isRecording && (
                  <div className="absolute top-4 right-4 z-30 bg-red-600/90 backdrop-blur-sm border border-red-400 rounded-lg px-4 py-2 flex items-center space-x-2">
                    <div className="w-3 h-3 bg-red-400 rounded-full animate-pulse" />
                    <span className="text-sm font-semibold text-white">REC {formatTime(recordingDuration)}</span>
                  </div>
                )}

                {/* AI Insights Panel */}
                {showAIInsights && analysisMode === 'predictive' && (
                  <div className="absolute top-4 right-4 z-20 w-80 bg-gradient-to-br from-purple-900/90 to-[#0f0f0f]/90 backdrop-blur-sm border border-purple-500/30 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center space-x-2">
                        <Brain className="w-5 h-5 text-purple-400" />
                        <span className="font-semibold text-purple-300">AI Predictive Analysis</span>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setShowAIInsights(false)}
                        className="h-6 w-6 p-0"
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-start space-x-2">
                        <Sparkles className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <div className="text-white font-medium">High Confidence Prediction (94%):</div>
                          <div className="text-[var(--dtg-gray-300)] text-xs">Zone Delta-7 will reach critical threshold within 8-10 hours based on current acceleration patterns.</div>
                        </div>
                      </div>
                      <div className="flex items-start space-x-2">
                        <TrendingUp className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <div className="text-white font-medium">Acceleration Detected:</div>
                          <div className="text-[var(--dtg-gray-300)] text-xs">VWP-401 showing 12% velocity increase in last 2 hours. Current rate: 2.4 mm/hr.</div>
                        </div>
                      </div>
                      <div className="flex items-start space-x-2">
                        <AlertTriangle className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <div className="text-white font-medium">Recommended Action:</div>
                          <div className="text-[var(--dtg-gray-300)] text-xs">Initiate evacuation procedures for eastern sector. Estimated window: 6 hours.</div>
                        </div>
                      </div>
                      <div className="mt-3 pt-3 border-t border-purple-500/30">
                        <Button
                          size="sm"
                          className="w-full bg-purple-600 hover:bg-purple-700"
                          onClick={() => setNotifications(prev => ['AI recommendations downloaded', ...prev.slice(0, 4)])}
                        >
                          <Download className="w-3 h-3 mr-2" />
                          Export AI Report
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Measurement Mode Instructions */}
                {measurementMode && measurementPoints.length === 0 && (
                  <div className="absolute top-4 left-4 z-20 bg-green-900/90 backdrop-blur-sm border border-green-500/30 rounded-lg p-3">
                    <div className="flex items-center space-x-2 text-green-300">
                      <Crosshair className="w-4 h-4" />
                      <span className="text-sm">Click two points to measure distance</span>
                    </div>
                  </div>
                )}

                <div
                  className="absolute top-4 left-100 flex items-center justify-center cursor-crosshair"
                  onClick={handleMeasurementClick}
                  style={{
                    transform: getViewModeTransform(),
                    transformStyle: 'preserve-3d',
                    transition: 'transform 0.3s ease'
                  }}
                >
                  {/* Pit Image */}
                  {visibleLayers.terrain && (
                    <div className="relative" style={{
                      filter: viewMode === 'thermal'
                        ? 'drop-shadow(0 20px 40px rgba(239, 68, 68, 0.5)) hue-rotate(45deg) saturate(2)'
                        : viewMode === 'deformation-heatmap'
                          ? 'drop-shadow(0 20px 40px rgba(59, 130, 246, 0.5)) saturate(1.5)'
                          : 'drop-shadow(0 20px 40px rgba(0,0,0,0.8))'
                    }}>
                      <Image
                        src={pitImage}
                        alt="Telfer Pit"
                        className="w-[800px] h-[450px]"
                        style={{
                          opacity: viewMode === 'thermal' ? 0.7 : viewMode === 'deformation-heatmap' ? 0.6 : 0.9,
                          filter: viewMode === 'thermal'
                            ? 'hue-rotate(20deg) saturate(1.5)'
                            : viewMode === 'deformation-heatmap'
                              ? 'hue-rotate(200deg) saturate(1.8)'
                              : 'none'
                        }}
                      />
                    </div>
                  )}

                  {/* SVG Overlays */}
                  <svg
                    className="absolute top-1/2 left-1/2 w-[800px] h-[450px] pointer-events-none"
                    style={{ transform: 'translate(-50%, -50%)' }}
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                  >
                    {/* TARP Zones */}
                    {visibleLayers.tarpZones && tarpZones.map(zone => (
                      <g key={zone.id}>
                        <polygon
                          points={zone.coordinates.map(c => `${c.x},${c.y}`).join(' ')}
                          fill={viewMode === 'deformation-heatmap'
                            ? `rgba(239, 68, 68, ${zone.avgDeformation / 100})`
                            : getTarpColor(zone.level)
                          }
                          stroke={getTarpBorderColor(zone.level)}
                          strokeWidth="0.4"
                          className="transition-all hover:opacity-70 cursor-pointer pointer-events-auto"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedZone(zone);
                          }}
                        />
                        {/* Zone Label */}
                        <text
                          x={zone.coordinates.reduce((sum, c) => sum + c.x, 0) / zone.coordinates.length}
                          y={zone.coordinates.reduce((sum, c) => sum + c.y, 0) / zone.coordinates.length}
                          fontSize="2.5"
                          fill={getTarpBorderColor(zone.level)}
                          textAnchor="middle"
                          fontWeight="bold"
                          className="pointer-events-none"
                        >
                          T{zone.level}
                        </text>
                      </g>
                    ))}

                    {/* Contour Lines */}
                    {visibleLayers.contours && (
                      <g opacity="0.25" stroke="#ffffff" strokeWidth="0.15" fill="none">
                        {[15, 25, 35, 45, 55, 65, 75, 85].map(radius => (
                          <ellipse
                            key={radius}
                            cx="50"
                            cy="50"
                            rx={radius * 0.6}
                            ry={radius * 0.4}
                          />
                        ))}
                      </g>
                    )}

                    {/* Evacuation Zones */}
                    {showEvacuationZones && (
                      <g opacity="0.5">
                        {tarpZones
                          .filter(z => z.evacuationRequired)
                          .map(zone => (
                            <polygon
                              key={`evac-${zone.id}`}
                              points={zone.coordinates.map(c => `${c.x + 2},${c.y + 2}`).join(' ')}
                              fill="none"
                              stroke="#FF0000"
                              strokeWidth="0.8"
                              strokeDasharray="2,2"
                            >
                              <animate
                                attributeName="stroke-dashoffset"
                                from="0"
                                to="4"
                                dur="1s"
                                repeatCount="indefinite"
                              />
                            </polygon>
                          ))}
                      </g>
                    )}

                    {/* Measurement Lines */}
                    {measurementMode && measurementPoints.length > 0 && (
                      <g>
                        {measurementPoints.map((point, i) => (
                          <circle
                            key={i}
                            cx={point.x}
                            cy={point.y}
                            r="1"
                            fill="#22C55E"
                            stroke="#ffffff"
                            strokeWidth="0.3"
                          />
                        ))}
                        {measurementPoints.length === 2 && (
                          <line
                            x1={measurementPoints[0].x}
                            y1={measurementPoints[0].y}
                            x2={measurementPoints[1].x}
                            y2={measurementPoints[1].y}
                            stroke="#22C55E"
                            strokeWidth="0.3"
                            strokeDasharray="1,1"
                          />
                        )}
                      </g>
                    )}
                  </svg>

                  {/* Instrument Markers */}
                  <div className="absolute top-1/2 left-1/2 w-[800px] h-[450px]" style={{ transform: 'translate(-50%, -50%)' }}>
                    {instruments.map(instrument => {
                      const shouldShow = visibleLayers[instrument.type];
                      if (!shouldShow) return null;

                      const Icon = instrument.type === 'radar' ? Radio :
                        instrument.type === 'prism' ? Target :
                          instrument.type === 'vwp' ? Activity :
                            instrument.type === 'extensometer' ? Ruler :
                              instrument.type === 'crackometer' ? GitBranch :
                                Layers;

                      return (
                        <div
                          key={instrument.id}
                          className="absolute cursor-pointer group pointer-events-auto"
                          style={{
                            left: `${instrument.x}%`,
                            top: `${instrument.y}%`,
                            transform: 'translate(-50%, -50%)'
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedInstrument(instrument);
                          }}
                        >
                          <div
                            className="relative w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all group-hover:scale-125"
                            style={{
                              backgroundColor: getInstrumentColor(instrument.type),
                              borderColor: getStatusColor(instrument.status),
                              boxShadow: `0 0 16px ${getStatusColor(instrument.status)}`
                            }}
                          >
                            <Icon className="w-3.5 h-3.5 text-white" />
                            {instrument.status === 'online' && (
                              <div
                                className="absolute inset-0 rounded-full animate-ping opacity-40"
                                style={{ backgroundColor: getStatusColor(instrument.status) }}
                              />
                            )}
                            {instrument.status === 'critical' && (
                              <div
                                className="absolute inset-0 rounded-full animate-pulse"
                                style={{ backgroundColor: getStatusColor(instrument.status), opacity: 0.5 }}
                              />
                            )}
                          </div>

                          {/* Enhanced Tooltip */}
                          <div className="absolute left-1/2 -translate-x-1/2 top-10 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                            <div className="bg-[var(--dtg-bg-card)]/95 backdrop-blur-sm border border-[var(--dtg-border-light)] rounded-lg p-3 shadow-2xl min-w-[240px]">
                              <div className="flex items-center justify-between mb-2">
                                <span className="font-bold text-white">{instrument.name}</span>
                                <Badge
                                  className="text-xs px-2 py-0"
                                  style={{
                                    backgroundColor: getStatusColor(instrument.status),
                                    border: 'none'
                                  }}
                                >
                                  {instrument.status.toUpperCase()}
                                </Badge>
                              </div>
                              <div className="space-y-1 text-xs">
                                <div className="flex justify-between">
                                  <span className="text-[var(--dtg-gray-400)]">Deformation:</span>
                                  <span className="text-white font-semibold">{instrument.deformation.toFixed(2)} mm</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-[var(--dtg-gray-400)]">Velocity:</span>
                                  <span className="text-white font-semibold">{instrument.velocity.toFixed(2)} mm/hr</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-[var(--dtg-gray-400)]">Acceleration:</span>
                                  <span className={instrument.acceleration > 0.05 ? "text-red-400 font-semibold" : "text-white font-semibold"}>
                                    {instrument.acceleration.toFixed(3)} mm/hr²
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-[var(--dtg-gray-400)]">Confidence:</span>
                                  <span className="text-white font-semibold">{instrument.confidence}%</span>
                                </div>
                                <div className="border-t border-[var(--dtg-border-light)] my-2 pt-2">
                                  <div className="flex justify-between">
                                    <span className="text-[var(--dtg-gray-400)]">Battery:</span>
                                    <span className={instrument.battery && instrument.battery < 20 ? "text-red-400" : "text-green-400"}>
                                      {instrument.battery}%
                                    </span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-[var(--dtg-gray-400)]">Signal:</span>
                                    <span className="text-green-400">{instrument.signalStrength}%</span>
                                  </div>
                                </div>
                                <div className="text-[var(--dtg-gray-500)] text-xs">
                                  E: {instrument.easting}, N: {instrument.northing}, Z: {instrument.elevation}m
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 3D Controls Overlay */}
                {viewMode === '3d' && (
                  <div className="absolute top-135 right-4 z-20 bg-[var(--dtg-bg-card)]/90 backdrop-blur-sm border border-[var(--dtg-border-light)] rounded-lg p-4">
                    <div className="text-xs font-semibold mb-3 text-[var(--dtg-gray-500)]">3D Controls</div>
                    <div className="space-y-3">
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-[var(--dtg-gray-500)]">Tilt</span>
                          <span className="text-white font-mono">{rotationX}°</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="75"
                          value={rotationX}
                          onChange={(e) => setRotationX(Number(e.target.value))}
                          className="w-full h-1 bg-[#2a2a2a] rounded-lg appearance-none cursor-pointer accent-blue-600"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-[var(--dtg-gray-500)]">Rotation</span>
                          <span className="text-white font-mono">{rotationZ}°</span>
                        </div>
                        <input
                          type="range"
                          min="-180"
                          max="180"
                          value={rotationZ}
                          onChange={(e) => setRotationZ(Number(e.target.value))}
                          className="w-full h-1 bg-[#2a2a2a] rounded-lg appearance-none cursor-pointer accent-blue-600"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-[var(--dtg-gray-500)]">Zoom</span>
                          <span className="text-white font-mono">{zoom.toFixed(1)}x</span>
                        </div>
                        <input
                          type="range"
                          min="0.5"
                          max="2"
                          step="0.1"
                          value={zoom}
                          onChange={(e) => setZoom(Number(e.target.value))}
                          className="w-full h-1 bg-[#2a2a2a] rounded-lg appearance-none cursor-pointer accent-blue-600"
                        />
                      </div>
                      <Button
                        size="sm"
                        className="w-full bg-[var(--dtg-bg-primary)] hover:bg-[#2a2a2a] text-xs"
                        onClick={() => {
                          setRotationX(55);
                          setRotationZ(0);
                          setZoom(1);
                        }}
                      >
                        <RotateCcw className="w-3 h-3 mr-1" />
                        Reset View
                      </Button>
                    </div>
                  </div>
                )}

                {/* Advanced Layer Controls */}
                <div className="absolute top-4 left-4 z-20 bg-[var(--dtg-bg-card)]/90 backdrop-blur-sm border border-[var(--dtg-border-light)] rounded-lg p-4 max-h-96 overflow-y-auto">
                  <div className="text-xs font-semibold mb-3 text-[var(--dtg-gray-500)]">Advanced Layers</div>
                  <div className="space-y-2">
                    {[
                      { key: 'terrain' as const, label: 'Terrain Model', icon: Layers },
                      { key: 'contours' as const, label: 'Contour Lines', icon: Grid3x3 },
                      { key: 'tarpZones' as const, label: 'TARP Zones', icon: MapPin },
                      { key: 'vwp' as const, label: 'VWP Sensors', icon: Activity },
                      { key: 'radar' as const, label: 'Radar Systems', icon: Radio },
                      { key: 'prism' as const, label: 'Prism Stations', icon: Target },
                      { key: 'extensometer' as const, label: 'Extensometers', icon: Ruler },
                      { key: 'crackometer' as const, label: 'Crackometers', icon: GitBranch },
                      { key: 'piezometer' as const, label: 'Piezometers', icon: Layers3 },
                      { key: 'geology' as const, label: 'Geology Overlay', icon: Layers },
                      { key: 'infrastructure' as const, label: 'Infrastructure', icon: HardHat },
                      { key: 'equipment' as const, label: 'Equipment', icon: Truck }
                    ].map(({ key, label, icon: Icon }) => (
                      <button
                        key={key}
                        onClick={() => toggleLayer(key)}
                        className="flex items-center justify-between w-full px-2 py-1.5 rounded hover:bg-[var(--dtg-bg-primary)] transition-colors group"
                      >
                        <div className="flex items-center space-x-2">
                          <Icon className="w-3.5 h-3.5 text-[var(--dtg-gray-500)]" />
                          <span className="text-xs text-[var(--dtg-gray-400)]">{label}</span>
                        </div>
                        <div
                          className={`w-9 h-5 rounded-full transition-colors ${visibleLayers[key] ? 'bg-blue-600' : 'bg-gray-600'
                            }`}
                        >
                          <div
                            className={`w-4 h-4 bg-white rounded-full mt-0.5 transition-transform ${visibleLayers[key] ? 'ml-4' : 'ml-0.5'
                              }`}
                          />
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="mt-4 pt-4 border-t border-[var(--dtg-border-light)] space-y-2">
                    <div className="text-xs font-semibold mb-2 text-[var(--dtg-gray-300)]">Overlays</div>
                    <button
                      onClick={() => setShowHeatmap(!showHeatmap)}
                      className="flex items-center justify-between w-full px-2 py-1.5 rounded hover:bg-[var(--dtg-bg-primary)] transition-colors"
                    >
                      <div className="flex items-center space-x-2">
                        <ScanLine className="w-3.5 h-3.5 text-[var(--dtg-gray-400)]" />
                        <span className="text-xs text-[var(--dtg-gray-300)]">Deformation Heatmap</span>
                      </div>
                      <div
                        className={`w-9 h-5 rounded-full transition-colors ${showHeatmap ? 'bg-orange-600' : 'bg-gray-600'
                          }`}
                      >
                        <div
                          className={`w-4 h-4 bg-white rounded-full mt-0.5 transition-transform ${showHeatmap ? 'ml-4' : 'ml-0.5'
                            }`}
                        />
                      </div>
                    </button>
                    <button
                      onClick={() => setShowEvacuationZones(!showEvacuationZones)}
                      className="flex items-center justify-between w-full px-2 py-1.5 rounded hover:bg-[var(--dtg-bg-primary)] transition-colors"
                    >
                      <div className="flex items-center space-x-2">
                        <Shield className="w-3.5 h-3.5 text-[var(--dtg-gray-400)]" />
                        <span className="text-xs text-[var(--dtg-gray-300)]">Evacuation Zones</span>
                      </div>
                      <div
                        className={`w-9 h-5 rounded-full transition-colors ${showEvacuationZones ? 'bg-red-600' : 'bg-gray-600'
                          }`}
                      >
                        <div
                          className={`w-4 h-4 bg-white rounded-full mt-0.5 transition-transform ${showEvacuationZones ? 'ml-4' : 'ml-0.5'
                            }`}
                        />
                      </div>
                    </button>
                    <button
                      onClick={() => setShowWeatherOverlay(!showWeatherOverlay)}
                      className="flex items-center justify-between w-full px-2 py-1.5 rounded hover:bg-[var(--dtg-bg-primary)] transition-colors"
                    >
                      <div className="flex items-center space-x-2">
                        <CloudRain className="w-3.5 h-3.5 text-[var(--dtg-gray-400)]" />
                        <span className="text-xs text-[var(--dtg-gray-300)]">Weather Overlay</span>
                      </div>
                      <div
                        className={`w-9 h-5 rounded-full transition-colors ${showWeatherOverlay ? 'bg-blue-600' : 'bg-gray-600'
                          }`}
                      >
                        <div
                          className={`w-4 h-4 bg-white rounded-full mt-0.5 transition-transform ${showWeatherOverlay ? 'ml-4' : 'ml-0.5'
                            }`}
                        />
                      </div>
                    </button>
                    {analysisMode === 'predictive' && (
                      <button
                        onClick={() => setShowAIInsights(!showAIInsights)}
                        className="flex items-center justify-between w-full px-2 py-1.5 rounded hover:bg-[var(--dtg-bg-primary)] transition-colors"
                      >
                        <div className="flex items-center space-x-2">
                          <Brain className="w-3.5 h-3.5 text-[var(--dtg-gray-400)]" />
                          <span className="text-xs text-[var(--dtg-gray-300)]">AI Insights</span>
                        </div>
                        <div
                          className={`w-9 h-5 rounded-full transition-colors ${showAIInsights ? 'bg-purple-600' : 'bg-gray-600'
                            }`}
                        >
                          <div
                            className={`w-4 h-4 bg-white rounded-full mt-0.5 transition-transform ${showAIInsights ? 'ml-4' : 'ml-0.5'
                              }`}
                          />
                        </div>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Right Panel - Enhanced Insights */}
            <div className="w-96 bg-[var(--dtg-bg-card)] border-l border-[var(--dtg-border-medium)] flex flex-col overflow-hidden">
              <div className="p-4 border-b border-[var(--dtg-border-medium)] flex items-center justify-between">
                <h2 className="font-semibold text-white">Detailed Insights</h2>
                <Button size="sm" variant="ghost">
                  <Maximize2 className="w-4 h-4" />
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Selected Instrument Detail */}
                {selectedInstrument && (
                  <Card className="bg-gradient-to-br from-[var(--blue-from)] to-[var(--blue-to)]  border-[var(--blue-border)] p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-blue-300">{selectedInstrument.name} Details</h3>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedInstrument(null)}
                        className="h-6 w-6 p-0"
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>

                    {/* Chart based on analysis mode */}
                    <div className="mb-3">
                      <div className="text-xs text-[var(--dtg-gray-400)] mb-2">
                        {analysisMode === 'predictive' && 'Predictive Trend (6hr history + 6hr forecast)'}
                        {analysisMode === 'realtime' && 'Real-time Trend (Last 12 hours)'}
                        {analysisMode === 'historical' && 'Historical Trend (Last 24 hours)'}
                        {analysisMode === 'comparative' && 'Comparative Analysis'}
                      </div>
                      <svg className="w-full h-24" viewBox="0 0 120 48">
                        <defs>
                          <linearGradient id="chartGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.5" />
                            <stop offset="100%" stopColor="#3B82F6" stopOpacity="0" />
                          </linearGradient>
                        </defs>
                        <polyline
                          points={getAnalysisData(selectedInstrument).map((val, i) =>
                            `${i * (120 / getAnalysisData(selectedInstrument).length)},${48 - (val / Math.max(...getAnalysisData(selectedInstrument)) * 40)}`
                          ).join(' ')}
                          fill="none"
                          stroke={selectedInstrument.trend === 'accelerating' ? '#EF4444' : '#3B82F6'}
                          strokeWidth="2"
                        />
                        <polygon
                          points={[
                            '0,48',
                            ...getAnalysisData(selectedInstrument).map((val, i) =>
                              `${i * (120 / getAnalysisData(selectedInstrument).length)},${48 - (val / Math.max(...getAnalysisData(selectedInstrument)) * 40)}`
                            ),
                            '120,48'
                          ].join(' ')}
                          fill="url(#chartGradient)"
                        />
                        {/* Prediction divider for predictive mode */}
                        {analysisMode === 'predictive' && (
                          <line
                            x1="60"
                            y1="0"
                            x2="60"
                            y2="48"
                            stroke="#FBBF24"
                            strokeWidth="1"
                            strokeDasharray="2,2"
                          />
                        )}
                      </svg>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-[var(--dtg-bg-card)] rounded p-2">
                        <div className="text-[var(--dtg-gray-400)]">Current</div>
                        <div className="text-lg font-bold text-[var(--dtg-text-primary)]">{selectedInstrument.deformation.toFixed(1)}</div>
                        <div className="text-[var(--dtg-gray-500)]">mm</div>
                      </div>
                      <div className="bg-[var(--dtg-bg-card)] rounded p-2">
                        <div className="text-[var(--dtg-gray-400)]">Velocity</div>
                        <div className="text-lg font-bold text-[var(--dtg-text-primary)]">{selectedInstrument.velocity.toFixed(2)}</div>
                        <div className="text-[var(--dtg-gray-500)]">mm/hr</div>
                      </div>
                    </div>

                    {analysisMode === 'predictive' && selectedInstrument.predictedData && (
                      <div className="mt-3 p-2 bg-purple-900/30 rounded border border-purple-500/30">
                        <div className="text-xs text-purple-300 font-medium">AI Prediction (6hrs)</div>
                        <div className="text-sm text-white mt-1">
                          Expected: {(selectedInstrument.predictedData[5] || 0).toFixed(1)} mm
                          <span className="text-xs text-[var(--dtg-gray-400)] ml-2">
                            (+{((selectedInstrument.predictedData[5] || 0) - selectedInstrument.deformation).toFixed(1)} mm)
                          </span>
                        </div>
                      </div>
                    )}
                  </Card>
                )}

                {/* Max Deformation Card */}
                <Card className="bg-gradient-to-br from-[var(--red-from)] to-[var(--red-to)]  border-[var(--red-border)] p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-2">
                        <AlertTriangle className="w-4 h-4 text-red-400" />
                        <h3 className="text-sm font-semibold text-red-300">Maximum Deformation</h3>
                      </div>
                      <div className="flex items-center space-x-2">
                        <div className="text-3xl font-bold text-red-400">63.11</div>
                        <div className="text-sm text-[var(--dtg-gray-400)]">mm</div>
                      </div>
                      <div className="flex items-center space-x-1 mt-1">
                        <TrendingUp className="w-3 h-3 text-red-400" />
                        <span className="text-xs text-red-400">+2.4 mm/hr</span>
                        <span className="text-xs text-[var(--dtg-gray-400)]">• Accelerating</span>
                      </div>
                    </div>
                    {/* Mini Chart */}
                    <svg className="w-24 h-16" viewBox="0 0 96 64">
                      <defs>
                        <linearGradient id="chartGradient2" x1="0%" y1="0%" x2="0%" y2="100%">
                          <stop offset="0%" stopColor="#EF4444" stopOpacity="0.5" />
                          <stop offset="100%" stopColor="#EF4444" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      <polyline
                        points="0,50 12,48 24,46 36,43 48,38 60,34 72,28 84,22 96,16"
                        fill="none"
                        stroke="#EF4444"
                        strokeWidth="2"
                      />
                      <polygon
                        points="0,50 12,48 24,46 36,43 48,38 60,34 72,28 84,22 96,16 96,64 0,64"
                        fill="url(#chartGradient2)"
                      />
                    </svg>
                  </div>
                  <div className="bg-[var(--dtg-bg-card)]/50 rounded p-2 text-xs text-[var(--dtg-gray-500)]">
                    <div className="flex justify-between">
                      <span>Location:</span>
                      <span className="text-white">VWP-401 (Zone Delta-7)</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Threshold:</span>
                      <span className="text-red-400">40.00 mm (EXCEEDED)</span>
                    </div>
                  </div>
                </Card>

                {/* Critical Zone Alert */}
                {criticalZone && (
                  <Card className="bg-gradient-to-br from-[var(--red-from)] to-[var(--red-to)]  border-[var(--red-border)] p-4">
                    <div className="flex items-start space-x-3 mb-3">
                      <div className="w-10 h-10 rounded-full bg-red-600/20 flex items-center justify-center flex-shrink-0">
                        <Shield className="w-5 h-5 text-red-400" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-sm font-semibold text-white mb-1">{criticalZone.name}</h3>
                        <div className="text-xs text-[var(--dtg-gray-300)] space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[var(--dtg-gray-400)]">Failure Risk:</span>
                            <Badge className="bg-red-600 text-white text-xs">{criticalZone.probability}%</Badge>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[var(--dtg-gray-400)]">Timeframe:</span>
                            <span className="text-red-400 font-semibold">{criticalZone.timeframe}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[var(--dtg-gray-400)]">Volume at Risk:</span>
                            <span className="text-white">{criticalZone.volume}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Risk Score Bar */}
                    <div className="mb-3">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-[var(--dtg-gray-400)]">Risk Score</span>
                        <span className="text-red-400 font-bold">{criticalZone.riskScore}/100</span>
                      </div>
                      <div className="h-2 bg-[#2a2a2a] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-red-600 to-red-400 rounded-full transition-all duration-1000"
                          style={{ width: `${criticalZone.riskScore}%` }}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs bg-transparent border-red-600/30 hover:bg-red-600/10"
                        onClick={() => setSelectedZone(criticalZone)}
                      >
                        View Details
                      </Button>
                      <Button
                        size="sm"
                        className="text-xs bg-red-600 hover:bg-red-700 text-white"
                        onClick={() => setNotifications(prev => ['Emergency response initiated', ...prev.slice(0, 4)])}
                      >
                        Initiate Response
                      </Button>
                    </div>
                  </Card>
                )}

                {/* Active Watchlist */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold">Active Watchlist</h3>
                    <Button size="sm" variant="ghost" className="text-xs">
                      View All ({instruments.filter(i => i.tarpLevel >= 3).length})
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {instruments
                      .filter(i => i.tarpLevel >= 3 || i.status === 'critical' || i.status === 'offline')
                      .slice(0, 5)
                      .map(instrument => (
                        <Card
                          key={instrument.id}
                          className={`bg-[var(--dtg-bg-primary)] border-[var(--dtg-border-light)] p-3 cursor-pointer hover:border-blue-600/50 transition-all ${selectedInstrument?.id === instrument.id ? 'ring-1 ring-blue-600' : ''
                            }`}
                          onClick={() => setSelectedInstrument(instrument)}
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center space-x-2">
                              <div
                                className="w-2 h-2 rounded-full"
                                style={{ backgroundColor: getStatusColor(instrument.status) }}
                              />
                              <span className="text-sm font-semibold text-[var(--dtg-text-primary)]">{instrument.name}</span>
                            </div>
                            <Badge
                              className="text-xs px-2 py-0"
                              style={{
                                backgroundColor: getTarpBorderColor(instrument.tarpLevel),
                                border: 'none'
                              }}
                            >
                              T{instrument.tarpLevel}
                            </Badge>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-xs mb-2">
                            <div>
                              <div className="text-[var(--dtg-gray-400)]">Deformation</div>
                              <div className="text-[var(--dtg-text-primary)] font-semibold">{instrument.deformation.toFixed(1)} mm</div>
                            </div>
                            <div>
                              <div className="text-[var(--dtg-gray-400)]">Velocity</div>
                              <div className={instrument.velocity > 2 ? "text-red-400 font-semibold" : "text-[var(--dtg-text-primary)] font-semibold"}>
                                {instrument.velocity.toFixed(2)} mm/hr
                              </div>
                            </div>
                          </div>

                          {/* Mini trend */}
                          <svg className="w-full h-6" viewBox="0 0 120 24" preserveAspectRatio="none">
                            <polyline
                              points={(instrument.historicalData?.slice(-12) || []).map((val, i) =>
                                `${i * 10},${24 - (val / Math.max(...(instrument.historicalData || [])) * 20)}`
                              ).join(' ')}
                              fill="none"
                              stroke={instrument.trend === 'accelerating' ? '#EF4444' : '#3B82F6'}
                              strokeWidth="1.5"
                            />
                          </svg>

                          {instrument.status === 'offline' && (
                            <div className="mt-2 flex items-center space-x-1 text-xs text-[var(--dtg-gray-500)]">
                              <AlertTriangle className="w-3 h-3" />
                              <span>Offline for {instrument.lastUpdate}</span>
                            </div>
                          )}
                        </Card>
                      ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes flash {
          0%, 100% { opacity: 0; }
          50% { opacity: 0.8; }
        }
      `}</style>
    </div>
  );
}
