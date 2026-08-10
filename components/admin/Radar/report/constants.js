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

/**
 * The daily report signs and disclaims EVERY page, so its footer is roughly
 * twice the standard strip. Passed to useReportPagination as `usableHeight`;
 * without it the paginator packs blocks into space the footer then covers.
 * Measured against DailyFooter — keep the two in step.
 */
export const DAILY_FOOTER_RESERVE = 108;
export const DAILY_USABLE_H = PAGE_H - PAD_TOP - DAILY_FOOTER_RESERVE;

/** Cap on any single figure so its block always fits one page. */
export const IMAGE_MAX_H = 560;

// Palette
export const NAVY = '#142850';
export const DARK = '#0D3036';
/** The pale teal that closes the DTG masthead gradient. */
export const DTG_LIGHT = '#A7D3D0';

/**
 * The DTG masthead band: dark teal at the left, pale teal at the right.
 *
 * Copied from `gradientPage1` in components/admin/Reports/RadarReportTemplates.jsx
 * — the Data Quality Assessment's header — so the two radar reports a site
 * receives on the same morning wear the same masthead. `270deg` is "to left",
 * so the 0% stop sits at the RIGHT edge; that is what puts the dark end under
 * the title and the pale end under the client logo.
 *
 * html2canvas 1.x parses linear-gradient, which is why this can be a gradient at
 * all where every other colour in these reports has to be a flat hex.
 */
export const HEADER_GRADIENT = `linear-gradient(270deg, ${DTG_LIGHT} 0%, ${DARK} 78%)`;
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
