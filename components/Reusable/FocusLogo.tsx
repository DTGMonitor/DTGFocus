import React from 'react';

interface FocusLogoProps {
  className?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showTagline?: boolean;
  orientation?: 'vertical' | 'horizontal';
}

export function FocusLogo({
  className = '',
  size = 'md',
  showTagline = true,
  orientation = 'vertical',
}: FocusLogoProps) {
  // No TM size here: it derives from fontSizeFocus in `em` at the usage site, so
  // it stays proportional at every size rather than drifting per-entry.
  const dimensions = {
    xs: { fontSizeDTG: '1.2rem', fontSizeFocus: '1.2rem', fontSizeTagline: '0.5rem', iconWidth: 35, gap: 8 },
    sm: { fontSizeDTG: '1.6rem', fontSizeFocus: '1.6rem', fontSizeTagline: '0.7rem', iconWidth: 55, gap: 12 },
    md: { fontSizeDTG: '2.4rem', fontSizeFocus: '2.4rem', fontSizeTagline: '1rem', iconWidth: 80, gap: 16 },
    lg: { fontSizeDTG: '3.2rem', fontSizeFocus: '3.2rem', fontSizeTagline: '1.4rem', iconWidth: 110, gap: 20 },
    xl: { fontSizeDTG: '4rem', fontSizeFocus: '4rem', fontSizeTagline: '1.8rem', iconWidth: 140, gap: 24 }
  };

  const { fontSizeDTG, fontSizeFocus, fontSizeTagline, iconWidth, gap } = dimensions[size];
  const isVertical = orientation === 'vertical';

  // Get CSS variable values for the gradient
  const gradientFrom = 'var(--dtg-focus-gradient-from)';
  const gradientTo = 'var(--dtg-focus-gradient-to)';

  // Tailwind text gradient trick
  // Light Mode: Soft Blue to Dark Brand Blue
  // Dark Mode: Electric Cyan to Dark Brand Blue
  const textGradient = "bg-gradient-to-b from-[var(--dtg-focus-gradient-from)] to-[var(--dtg-focus-gradient-to)] text-transparent bg-clip-text inline-block";

  return (
    <div className={`flex flex-col ${isVertical ? 'items-center' : 'items-start'} ${className}`}>
      <div className='flex items-center justify-start py-0'>

        {/* Refined Hexagon Cluster Icon */}
        <div className="relative shrink-0" style={{ width: iconWidth }}>
          <svg
            viewBox="0 0 152 145"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="w-full h-auto"
          >
            {/* GRADIENT DEFINITIONS - Uses CSS variables that change with theme */}
            <defs>
              <linearGradient id="dtgGrad" x1="0" y1="0" x2="0" y2="145" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor={gradientFrom} />
                <stop offset="100%" stopColor={gradientTo} />
              </linearGradient>
            </defs>

            {/* SVG PATHS - Single set that adapts to theme via CSS variables */}
            <line x1="77" y1="65" x2="77" y2="75" stroke="url(#dtgGrad)" strokeWidth="6" strokeLinecap="round" />
            <line x1="49.5" y1="80" x2="62" y2="85" stroke="url(#dtgGrad)" strokeWidth="6" strokeLinecap="round" />
            <line x1="104.5" y1="80" x2="91" y2="85" stroke="url(#dtgGrad)" strokeWidth="6" strokeLinecap="round" />
            <path d="M 77 10 L 99 22 L 99 52 L 77 65 L 55 52 L 55 22 Z" stroke="url(#dtgGrad)" strokeWidth="6" strokeLinejoin="round" />
            <path d="M 27.5 50 L 49.5 62 L 49.5 92 L 27.5 105 L 5.5 92 L 5.5 62 Z" stroke="url(#dtgGrad)" strokeWidth="6" strokeLinejoin="round" />
            <path d="M 126.5 50 L 148.5 62 L 148.5 92 L 126.5 105 L 104.5 92 L 104.5 62 Z" stroke="url(#dtgGrad)" strokeWidth="6" strokeLinejoin="round" />
            <path d="M 77 75 L 91 84 L 91 103 L 77 112 L 63 103 L 63 84 Z" fill="url(#dtgGrad)" stroke="url(#dtgGrad)" strokeWidth="6" strokeLinejoin="round" />
          </svg>
        </div>

        {/* Typography */}
        <div className="flex flex-col justify-center items-start leading-none" style={{ marginLeft: gap }}>
          <div className={`flex ${isVertical ? 'flex-col gap-1 items-start' : 'flex-row items-baseline gap-2'}`}>
            <span
              style={{ fontSize: fontSizeDTG }}
              className={`font-bold tracking-tight uppercase leading-[0.9] ${textGradient}`}
            >
              DTG
            </span>
            {/* The TM is sized and offset in `em` so it tracks fontSizeFocus across
                every size. 0.06em lands its top on the cap height of "Focus" —
                retune only against the 0.9 line-height above, which it depends on. */}
            <div className="flex items-start leading-[0.9]" style={{ fontSize: fontSizeFocus }}>
              <span className={`font-bold tracking-tight ${textGradient}`}>
                Focus
              </span>
              <span
                style={{ fontSize: '0.35em', marginLeft: '0.1em', marginTop: '0.06em' }}
                className={`font-bold opacity-80 ${textGradient}`}
              >
                TM
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Tagline */}
      {showTagline && (
        <div
          style={{
            fontSize: fontSizeTagline,
            marginLeft: isVertical ? 0 : `calc(${iconWidth}px + ${gap}px)`
          }}
          className={`italic tracking-tight mt-0 md:mt-0 ${isVertical ? 'text-center' : 'text-left'} ${textGradient}`}
        >
          Focused Actionable Insight.
        </div>
      )}
    </div>
  );
}