// c:\Users\lintang\focus-dashboard\components\Reusable\HeaderComponents\ToolBar.tsx
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Eye,
  EyeOff,
  AlertTriangle,
  Radio,
  Maximize2,
  Droplet,
  Activity,
  Target,
  MapPin,
  Square,
  Minus,
  Hexagon,
  Eraser,
  Settings,
  ChevronUp,
  ChevronDown
} from 'lucide-react';

const SensorIcon = ({ type, size = 16 }: { type: string, size?: number }) => {
  switch (type) {
    case 'Radar': return <Radio size={size} />;
    case 'Prism': return <Maximize2 size={size} />;
    case 'Piezometer': return <Droplet size={size} />;
    case 'InSAR': return <Activity size={size} />;
    default: return <Target size={size} />;
  }
};

export interface ToolBarProps {
  isGlobalHidden: boolean;
  toggleAllVisibility: () => void;
  hazardOnly: boolean;
  setHazardOnly: (value: boolean) => void;
  visibleLayers: string[];
  toggleLayer: (layer: string) => void;
  activeTool: string | null;
  setActiveTool: (tool: string | null) => void;
}

export const ToolBar: React.FC<ToolBarProps> = ({
  isGlobalHidden,
  toggleAllVisibility,
  hazardOnly,
  setHazardOnly,
  visibleLayers,
  toggleLayer,
  activeTool,
  setActiveTool
}) => {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="w-full bg-[var(--dtg-bg-card)] relative flex flex-col items-center transition-all duration-300 z-20">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="flex items-center gap-3 px-3 py-2 overflow-hidden"
          >
            {/* Sensor Filters */}
            <div className="flex items-center gap-1">
              <button
                onClick={toggleAllVisibility}
                className={`w-8 h-8 rounded-md flex items-center justify-center transition-all
                    ${!isGlobalHidden
                    ? 'bg-[var(--dtg-gray-600)]/10 text-[#8EB69B]'
                    : 'bg-orange-500/10 text-orange-500 hover:bg-orange-500/20'}
                  `}
                title={isGlobalHidden ? 'Enable All Sensors' : 'Disable All Sensors'}
              >
                {isGlobalHidden ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>

              <button
                onClick={() => setHazardOnly(!hazardOnly)}
                className={`w-8 h-8 rounded-md flex items-center justify-center transition-all
                    ${hazardOnly
                    ? 'bg-red-600/20 text-red-500'
                    : 'text-[var(--dtg-text-primary)] hover:bg-[var(--dtg-gray-600)]/5'}
                  `}
                title={hazardOnly ? 'Show All' : 'Hazards Only'}
              >
                <AlertTriangle size={16} />
              </button>

              <div className="h-5 w-px bg-[var(--dtg-gray-600)]/10 mx-1" />

              {['Radar', 'Prism', 'InSAR', 'Piezometer'].map((type) => {
                const isActive = visibleLayers.includes(type);
                return (
                  <button
                    key={type}
                    onClick={() => toggleLayer(type)}
                    className={`w-8 h-8 rounded-md flex items-center justify-center transition-all
                        ${isActive
                        ? 'bg-[var(--dtg-gray-600)]/20 text-[#8EB69B]'
                        : 'text-[var(--dtg-text-primary)] hover:bg-[var(--dtg-gray-600)]/5'}
                      `}
                    title={`${isActive ? 'Hide' : 'Show'} ${type}`}
                  >
                    <SensorIcon type={type} size={16} />
                  </button>
                );
              })}
            </div>

            <div className="h-6 w-px bg-[var(--dtg-gray-600)]/20 mx-2" />

            {/* Annotation Tools */}
            <div className="flex items-center gap-1">
              {[
                { id: 'pin', icon: MapPin, label: 'Boundary Pin' },
                { id: 'rectangle', icon: Square, label: 'Draw Rectangle' },
                { id: 'line', icon: Minus, label: 'Draw Line' },
                { id: 'polygon', icon: Hexagon, label: 'Draw Polygon' },
                { id: 'erase', icon: Eraser, label: 'Eraser Tool' },
              ].map((tool) => (
                <button
                  key={tool.id}
                  onClick={() => setActiveTool(activeTool === tool.id ? null : tool.id)}
                  className={`w-8 h-8 rounded-md flex items-center justify-center transition-all
                      ${activeTool === tool.id
                      ? 'bg-[#8EB69B] text-black shadow-[0_0_15px_rgba(142,182,155,0.4)]'
                      : 'text-[var(--dtg-text-primary)] hover:bg-[var(--dtg-gray-600)]/5'}
                    `}
                  title={tool.label}
                >
                  <tool.icon size={16} />
                </button>
              ))}

              <div className="h-5 w-px bg-[var(--dtg-gray-600)]/10 mx-1" />

              <button className="w-8 h-8 rounded-md flex items-center justify-center text-[var(--dtg-text-primary)] hover:bg-[var(--dtg-gray-600)]/5 transition-all">
                <Settings size={16} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

{/* Toggle Handle - Seamless Attached Tab */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="absolute top-full right-4 bg-[var(--dtg-bg-card)] border-2 border-[var(--dtg-border-dark)] border-t-0 w-16 h-4 rounded-t-md flex items-center justify-center text-[var(--dtg-text-primary)] hover:text-[#8EB69B] hover:bg-[var(--dtg-bg-hover)] transition-all z-[60] -translate-y-[1px]"
        title={isOpen ? "Hide Toolbar" : "Show Toolbar"}
      >
        {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
    </div>
  );
};
