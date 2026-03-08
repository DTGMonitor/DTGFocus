import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { FocusLogo } from "./Reusable/FocusLogo";

interface TransitionScreenProps {
  onComplete: () => void;
}

export function TransitionScreen({ onComplete }: TransitionScreenProps) {
  const [progress, setProgress] = useState(0);
  const [statusIndex, setStatusIndex] = useState(0);
  const [isExiting, setIsExiting] = useState(false);

  const statusMessages = [
    "Establishing encrypted satellite uplink...",
    "Calibrating geotechnical sensor arrays...",
    "Synchronizing 3D pit topography...",
    "Initializing AI predictive models...",
    "Securing data transmission protocol...",
    "System check: Nominal."
  ];

  useEffect(() => {
    // Progress bar animation
    const duration = 4000; // 4 seconds total
    const interval = 50;
    const step = 100 / (duration / interval);
    
    const timer = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          clearInterval(timer);
          return 100;
        }
        return prev + step;
      });
    }, interval);

    // Status message cycling
    const messageInterval = duration / statusMessages.length;
    const statusTimer = setInterval(() => {
      setStatusIndex(prev => {
        if (prev >= statusMessages.length - 1) {
          clearInterval(statusTimer);
          return prev;
        }
        return prev + 1;
      });
    }, messageInterval);

    // Exit transition
    const exitTimer = setTimeout(() => {
      setIsExiting(true);
      setTimeout(onComplete, 800);
    }, duration + 500);

    return () => {
      clearInterval(timer);
      clearInterval(statusTimer);
      clearTimeout(exitTimer);
    };
  }, [onComplete]);

  return (
    <motion.div 
      initial={{ opacity: 1 }}
      animate={{ opacity: isExiting ? 0 : 1 }}
      transition={{ duration: 0.8 }}
      className="fixed inset-0 bg-[#051F20] z-[100] flex flex-col items-center justify-center overflow-hidden font-sans"
    >
      {/* Background: Vertical Data Flux Streams (Mission Control Feel) */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {/* Vertical Flux Lines */}
        {Array.from({ length: 20 }).map((_, i) => (
          <motion.div
            key={`flux-${i}`}
            initial={{ y: "-100%", x: `${Math.random() * 100}%`, opacity: 0 }}
            animate={{ 
              y: "200%", 
              opacity: [0, 0.3, 0],
              height: [100, 300, 100]
            }}
            transition={{ 
              duration: 2 + Math.random() * 4, 
              repeat: Infinity, 
              ease: "linear",
              delay: Math.random() * 5 
            }}
            className="absolute w-[1px] bg-gradient-to-b from-transparent via-[#FF4D00]/40 to-transparent"
          />
        ))}

        {/* Vertical Data Particles */}
        {Array.from({ length: 40 }).map((_, i) => (
          <motion.div
            key={`particle-${i}`}
            initial={{ y: "110%", x: `${Math.random() * 100}%`, opacity: 0 }}
            animate={{ 
              y: "-10%", 
              opacity: [0, 0.4, 0] 
            }}
            transition={{ 
              duration: 4 + Math.random() * 6, 
              repeat: Infinity, 
              ease: "linear",
              delay: Math.random() * 8 
            }}
            className={`absolute w-[2px] h-[2px] rounded-full ${Math.random() > 0.7 ? 'bg-[#FF4D00]' : 'bg-[#DAF1DE]'}`}
            style={{ boxShadow: Math.random() > 0.7 ? '0 0 8px #FF4D00' : 'none' }}
          />
        ))}

        {/* Subtle Grid Background */}
        <div 
          className="absolute inset-0 opacity-[0.03]" 
          style={{ 
            backgroundImage: 'linear-gradient(#DAF1DE 1px, transparent 1px), linear-gradient(90deg, #DAF1DE 1px, transparent 1px)', 
            backgroundSize: '80px 80px' 
          }} 
        />
        
        {/* Radar Ring Effect (Orange Highlight) */}
        <motion.div 
          animate={{ scale: [1, 1.8], opacity: [0.15, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeOut" }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] border border-orange-500/20 rounded-full"
        />
      </div>
      
      {/* Central Content */}
      <div className="relative z-10 flex flex-col items-center gap-16 max-w-2xl w-full px-12">
        
        {/* Branding reveal */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1 }}
          className="flex flex-col items-center"
        >
          {/* Logo with Orange Highlight */}
          <FocusLogo size="xl" showTagline={false} highlightColor="#FF4D00" />
          
          <motion.div 
            initial={{ width: 0 }}
            animate={{ width: "100%" }}
            transition={{ duration: 2, delay: 0.5 }}
            className="h-px bg-gradient-to-r from-transparent via-[#FF4D00]/30 to-transparent mt-6"
          />
        </motion.div>

        {/* Sophisticated Data Stream Visualization */}
        <div className="w-full space-y-10">
          <div className="flex flex-col items-center gap-6">
            <AnimatePresence mode="wait">
              <motion.p
                key={statusIndex}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.4 }}
                className="text-[10px] font-black text-[#DAF1DE] uppercase tracking-[0.6em] text-center h-4 drop-shadow-[0_0_8px_rgba(218,241,222,0.3)]"
              >
                {statusMessages[statusIndex]}
              </motion.p>
            </AnimatePresence>
            
            <div className="w-full max-w-lg h-[4px] bg-[#0B2B26] rounded-full overflow-hidden border border-white/5 relative">
              <motion.div 
                className="h-full bg-gradient-to-r from-[#8EB69B] via-[#DAF1DE] to-[#FF4D00] shadow-[0_0_20px_rgba(255,77,0,0.3)]"
                animate={{ width: `${progress}%` }}
                transition={{ ease: "linear" }}
              />
              
              {/* Scanning Glow Effect */}
              <motion.div 
                animate={{ left: ["-20%", "120%"] }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                className="absolute top-0 bottom-0 w-32 bg-gradient-to-r from-transparent via-white/10 to-transparent"
              />
            </div>
          </div>

          {/* Decorative Terminal-style Data Bits (With Orange Highlights) */}
          <div className="grid grid-cols-3 gap-16 pt-2">
            <div className="flex flex-col gap-2">
              <span className="text-[9px] font-black text-[#8EB69B]/40 uppercase tracking-[0.2em]">SATELLITE_LINK</span>
              <div className="flex gap-1.5">
                {[...Array(5)].map((_, i) => (
                  <motion.div 
                    key={i}
                    animate={{ 
                      opacity: progress > (i + 1) * 20 ? 1 : 0.2,
                      backgroundColor: progress > (i + 1) * 20 && i === 4 ? '#FF4D00' : '#DAF1DE'
                    }}
                    className="w-5 h-1.5 bg-[#DAF1DE] rounded-sm transition-colors duration-500"
                  />
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2 items-center">
              <span className="text-[9px] font-black text-[#8EB69B]/40 uppercase tracking-[0.2em]">SIGNAL_STRENGTH</span>
              <span className={`text-[12px] font-black tracking-[0.3em] transition-colors duration-500 ${progress > 80 ? 'text-[#FF4D00]' : 'text-[#DAF1DE]'}`}>
                {Math.min(100, Math.floor(progress * 0.9 + 10))}%
              </span>
            </div>
            <div className="flex flex-col gap-2 items-end">
              <span className="text-[9px] font-black text-[#8EB69B]/40 uppercase tracking-[0.2em]">GRID_COORDINATE</span>
              <span className="text-[12px] font-black text-[#DAF1DE] tracking-widest">
                {progress < 100 ? `REF_${(progress * 123.4).toFixed(0)}` : <span className="text-[#FF4D00]">STABLE_Z_44</span>}
              </span>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        body { background-color: #051F20; }
      `}</style>
    </motion.div>
  );
}
