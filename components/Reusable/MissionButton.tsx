import React from 'react';
import { motion } from 'motion/react';
import { ChevronRight, Loader2 } from 'lucide-react';

interface MissionButtonProps {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  type?: "button" | "submit" | "reset";
}

export function MissionButton({ 
  label, 
  onClick, 
  disabled = false, 
  loading = false,
  className = "",
  type = "button"
}: MissionButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`
        relative w-full max-w-xl h-14 md:h-16 rounded-full font-black text-[10px] md:text-[12px] uppercase tracking-[1em] transition-all duration-500 overflow-hidden group shadow-[0_10px_40px_rgb(var(--auth-accent-rgb)/0.25)]
        ${!disabled && !loading
          ? 'bg-gradient-to-r from-[var(--auth-btn-from)] to-[var(--auth-btn-to)] text-[var(--auth-btn-fg)] hover:scale-[1.02] cursor-pointer'
          : 'bg-[rgb(var(--auth-muted-rgb)/0.08)] text-[rgb(var(--auth-fg-rgb)/0.25)] border border-[var(--auth-hairline)] cursor-not-allowed opacity-40'
        }
        ${className}
      `}
    >
      {/* Dynamic Glow Effect */}
      {!disabled && !loading && (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.4),transparent_70%)] opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
      )}

      {/* Content Wrapper */}
      <div className="flex items-center justify-center gap-4 relative z-10 w-full h-full px-8">
        {loading ? (
          <div className="flex items-center gap-3">
            <Loader2 className="animate-spin" size={20} />
            <span className="ml-[1em]">PROCESSING...</span>
          </div>
        ) : (
          <>
            <span className="ml-[1em] text-center flex-1">{label}</span>
            <ChevronRight 
              size={20} 
              className="group-hover:translate-x-2 transition-transform duration-500 flex-shrink-0" 
            />
          </>
        )}
      </div>

      {/* Animated Shine Streak (as seen in the design) */}
      {!disabled && !loading && (
        <motion.div 
          initial={{ left: '-100%' }}
          animate={{ left: '200%' }} 
          transition={{ 
            duration: 3, 
            repeat: Infinity, 
            ease: "easeInOut",
            repeatDelay: 1 
          }} 
          className="absolute inset-0 bg-white/30 skew-x-[35deg] pointer-events-none w-1/3 blur-sm" 
        />
      )}

      {/* Subtle Inner Glow */}
      {!disabled && !loading && (
        <div className="absolute inset-px rounded-full border border-white/20 pointer-events-none" />
      )}
    </button>
  );
}
