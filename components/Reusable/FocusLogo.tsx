import React from 'react';
import { motion } from 'motion/react';

interface FocusLogoProps {
  className?: string;
  size?: 'xs'|'sm' | 'md' | 'lg' | 'xl';
  showTagline?: boolean;
  highlightColor?: string;
  orientation?: 'vertical' | 'horizontal';
}

export function FocusLogo({ 
  className = '', 
  size = 'md', 
  showTagline = false,
  orientation = 'vertical',
  highlightColor
}: FocusLogoProps) {
  const dimensions = {
    xs: { height: 20, fontSizeDTG: '1.2rem', fontSizeFocus: '1rem', fontSizeTM: '0.6rem',iconWidth: 30, gap: 8 },
    sm: { height: 40, fontSizeDTG: '1.4rem', fontSizeFocus: '1.6rem', fontSizeTM: '0.8rem',iconWidth: 50, gap: 12 },
    md: { height: 60, fontSizeDTG: '2rem', fontSizeFocus: '2.4rem', fontSizeTM: '1.2rem',iconWidth: 70, gap: 16 },
    lg: { height: 80, fontSizeDTG: '2.8rem', fontSizeFocus: '3.2rem', fontSizeTM: '1.6rem',iconWidth: 90, gap: 20 },
    xl: { height: 100, fontSizeDTG: '3.5rem', fontSizeFocus: '4rem', fontSizeTM: '2rem',iconWidth: 120, gap: 24 }
  };

  const { fontSizeDTG, fontSizeFocus, fontSizeTM,iconWidth, gap } = dimensions[size];
  const paleMint = "#DAF1DE";
  const seafoam = "#8EB69B";
  const isVertical = orientation === 'vertical';
  

  return (
    <div className={`flex items-center ${className}`}>
      {/* Refined Hexagon Cluster Icon */}
      <div className="relative" style={{ width: iconWidth }}>
        <svg 
          viewBox="0 0 140 140" 
          fill="none" 
          xmlns="http://www.w3.org/2000/svg" 
          className="w-full h-auto"
        >
 
          {/* Hexagon Layout - Based on Screenshot */}
          {/* Top Middle Outlined */}
          <path d="M70 20L88 30V50L70 60L52 50V30L70 20Z" stroke={paleMint} strokeWidth="2.5" />
          
          {/* Middle Left Outlined */}
          <path d="M38 55L56 65V85L38 95L20 85V65L38 55Z" stroke={paleMint} strokeWidth="2.5" />
          
          {/* Middle Right Outlined */}
          <path d="M102 55L120 65V85L102 95L84 85V65L102 55Z" stroke={paleMint} strokeWidth="2.5" />
          
          {/* Bottom Center Filled - Highlighted with optional color */}
          <path 
            d="M70 90L88 100V120L70 130L52 120V100L70 90Z" 
            fill={highlightColor || seafoam} 
            fillOpacity={highlightColor ? "0.8" : "0.6"} 
          />
        </svg>
      </div>

      {/* Typography - Matches "DTG Focus" */}
      <div className={`flex ${isVertical ? 'flex-col' : 'flex-row items-baseline gap-1'} justify-center leading-none`} style={{ marginLeft: gap }}>
        <span 
          style={{ fontSize: fontSizeDTG, color: paleMint }} 
          className="font-black tracking-[-0.02em] uppercase"
        >
          DTG
        </span>
        <div className="flex items-start">
          <span 
            style={{ fontSize: fontSizeFocus, color: paleMint }} 
            className="font-light tracking-[-0.02em]"
          >
            Focus
          </span>
          <span 
            style={{ fontSize: fontSizeTM, color: paleMint, marginLeft: '3px'}} 
            className="font-bold opacity-60"
          >
            TM
          </span>
        </div>
      </div>
    </div>
  );
}
