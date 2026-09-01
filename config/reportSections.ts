// config/reportSections.ts
//
// The catalogue of DEFAULT sections each block-composed report is made of.
//
// Both the Tabulation (daily) and Comprehensive reports are assembled from
// measured blocks (components/admin/Radar/report/pageFrame + useReportPagination),
// and each template's file header documents its block order in prose. This file
// is that prose made addressable: one stable KEY per section, in the order the
// template has always emitted them.
//
// Why a catalogue and not just the template's own array:
//
//   A site's layout is stored as a list of keys (utils/reportLayout.js). The
//   stored list is the ONLY thing that survives between reports, so the keys
//   have to outlive refactors of the template — renaming `movement` here
//   silently drops that section from every site that saved a layout. Add new
//   keys freely; never rename or reuse an old one.
//
// GRANULARITY. A key names a section, not a block. `movement` is one entry even
// though a roster table is emitted as several blocks, and `analysis` is one
// entry however many figures and graphs the analyst attached. The number of
// blocks a section produces is decided at render time by the data; the number
// of entries a site can reorder must not be, or a layout saved on a quiet day
// would not describe a busy one.

export type ReportLayoutCategory = 'Tabulation' | 'Comprehensive';

export interface DefaultSectionDef {
    /** Stable identity. Stored in report_layouts.sections — never rename. */
    key: string;
    /** What the section is called in the layout editor. */
    label: string;
    /** One line under the label, so an analyst can tell two sections apart. */
    hint?: string;
}

/**
 * The Tabulation report — "LAPORAN HARIAN / DAILY REPORT".
 * Mirrors the block order in components/admin/Reports/DailyRadarTemplate.jsx.
 */
export const TABULATION_SECTIONS: DefaultSectionDef[] = [
    { key: 'header', label: 'Header & status cards', hint: 'Masthead, date, data update, quality and risk cards' },
    { key: 'summary', label: 'Daily summary', hint: 'Deformation and quality verdict, weather, fog, rainfall' },
    { key: 'scan', label: 'Scan area figure', hint: 'The annotated radar view' },
    { key: 'movement', label: 'Movement table', hint: 'One row per active chain, or per monitoring point' },
    { key: 'legend', label: 'Legend', hint: 'Quality and risk explanation tables' },
    { key: 'analysis', label: 'Area analysis', hint: 'Zoomed figures and their deformation graphs' },
    { key: 'glossary', label: 'Glossary', hint: 'Term definitions, grouped by letter' },
    { key: 'appendix', label: 'Appendix', hint: 'Data-quality evidence figures' },
];

/**
 * The Comprehensive report — "… Radar Reporting Services".
 * Mirrors the block order in components/admin/Reports/ComprehensiveRadarTemplate.jsx.
 */
export const COMPREHENSIVE_SECTIONS: DefaultSectionDef[] = [
    { key: 'header', label: 'Header', hint: 'Masthead, edition, author, sensor' },
    { key: 'executive', label: 'Executive summary', hint: 'Risk, quality, uptime and alarm KPIs' },
    { key: 'findings', label: 'Key findings', hint: 'The period’s headline observations' },
    { key: 'deformation', label: 'Deformation figure & timeline', hint: 'Annotated figure and the chain timeline under it' },
    { key: 'dataQuality', label: 'Data quality', hint: 'DQP parameter status groups' },
    { key: 'systemPerformance', label: 'System performance', hint: 'Availability and alarm causes' },
    { key: 'alarmImprovements', label: 'Alarm improvement', hint: 'Recommendations raised and resolved this period' },
    { key: 'tarpUpdates', label: 'Procedural updates', hint: 'TARP changes inside the window' },
    { key: 'glossary', label: 'Glossary', hint: 'Term definitions' },
    { key: 'appendix', label: 'Appendix', hint: 'Data-quality evidence figures' },
    { key: 'disclaimer', label: 'Disclaimer', hint: 'The closing legal block' },
];

/**
 * The catalogue for a report category, or null for a category that is not
 * block-composed.
 *
 * The Data Quality, InSAR and Handover templates are fixed-page layouts on a
 * different rendering path — they have no measured blocks to reorder, so they
 * get no layout editor rather than a broken one.
 */
export function sectionsForCategory(category: string | null | undefined): DefaultSectionDef[] | null {
    if (category === 'Tabulation') return TABULATION_SECTIONS;
    if (category === 'Comprehensive') return COMPREHENSIVE_SECTIONS;
    return null;
}

/** Whether a category supports custom sections at all. */
export function supportsCustomSections(category: string | null | undefined): boolean {
    return sectionsForCategory(category) !== null;
}
