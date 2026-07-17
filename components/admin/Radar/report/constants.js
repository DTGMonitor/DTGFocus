/**
 * Shared report geometry and palette.
 *
 * Extracted from PostBlastReportModal so the Post-Blast and Comprehensive radar
 * reports share one page frame. Values are unchanged from the original.
 *
 * Colours are inline hex on purpose: html2canvas 1.x cannot resolve CSS custom
 * properties, Tailwind classes, or modern colour functions (oklch/color-mix),
 * and silently rasterizes them as transparent.
 */

// A4 @ 96dpi
export const PAGE_W = 794;
export const PAGE_H = 1123;
export const PAD_X = 34;
export const PAD_TOP = 28;
export const FOOTER_RESERVE = 64; // space kept at the bottom for the footer
export const BLOCK_GAP = 10; // vertical gap between stacked blocks
export const CONTENT_W = PAGE_W - PAD_X * 2;
export const USABLE_H = PAGE_H - PAD_TOP - FOOTER_RESERVE;

/** Cap on any single figure so its block always fits one page. */
export const IMAGE_MAX_H = 560;

// Palette
export const NAVY = '#142850';
export const DARK = '#0D3036';
export const ACCENT = '#F78E1E';
export const INK = '#1f2937';
export const MUTED = '#6b7280';
export const LINE = '#d1d5db';
export const ZEBRA = '#f5f7f9';

export const FALLBACK_LOGO = '/logo/DTG/DTGlogo.png';

/**
 * Title for the availability + alarm section (Requirement 8).
 * Deliberately a single constant so it can be renamed without touching layout.
 */
export const SECTION_TITLE_SYSTEM_PERFORMANCE = 'System Performance';
