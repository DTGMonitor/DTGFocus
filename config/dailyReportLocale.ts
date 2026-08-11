// dailyReportLocale.ts
//
// Every word the Daily Radar Report prints, in the two languages DTG issues it
// in.
//
// The language follows the SITE, not the reader: an Indonesian client receives
// the report in Bahasa Indonesia and everyone else in English. That resolution
// already exists for the email drafts — `resolveEmailLocale` in
// config/emailLocale.ts reads the site's IANA timezone (and the per-site
// override map) — so this module reuses it rather than inventing a second
// notion of "which sites are Indonesian" that could drift from the first.
//
// Two conventions are inherited from emailLocale and are deliberate:
//
//   * Metric symbols and the radar software's own vocabulary do NOT translate.
//     TARP, VCP, "No Significant", "Progressive" are what the site engineer
//     reads on the radar screen, and the sample report DTG already issues to
//     PT. Vale prints them in English inside an otherwise Indonesian page.
//   * Units DO translate — mm/h -> mm/jam — via `translateUnit`.
//
// Everything here is pure data and pure functions, so the wording can be
// unit-tested without rendering a page.

import { EmailLocale, translateUnit, emailTimeZoneLabel } from './emailLocale';
import { NO_SIGNIFICANT, riskSentence, type RiskPresentation } from './riskDisplay';
import { getStatusDefinition } from './statusConfig';

export type DailyLocale = EmailLocale;

// ---------------------------------------------------------------------------
// Section, card and column labels
// ---------------------------------------------------------------------------

export interface DailyStrings {
    /** Page title. The radar number is appended by the header block. */
    reportTitle: string;

    // The four header cards.
    cardDate: string;
    cardDataUpdate: string;
    cardDataQuality: string;
    cardRisk: string;

    // Summary panel.
    summaryHeading: string;
    summaryDeformation: string;
    summaryDataQuality: string;
    summaryWeather: string;
    summaryFog: string;
    summaryRainfall: string;
    /**
     * The generator strip's heading. Carries the UNIT, because the cells are
     * bare numbers — a column of "612" against a date means nothing without it.
     */
    summaryGenerator: string;

    // Scan area.
    scanAreaHeading: string;
    scanAreaFigure: string;
    movementHeading: string;

    // Movement table columns.
    colArea: string;
    colTarp: string;
    colPattern: string;
    colRemarks: string;

    // Legend block.
    legendHeading: string;
    legendQualityHeading: string;
    legendRiskHeading: string;
    legendStatus: string;
    legendAction: string;
    legendCurrent: string;
    legendRiskLevel: string;

    // Area analysis.
    analysisHeading: string;
    /** "Grafik Deformasi pada <name>" — the caption above each graph. */
    analysisGraphCaption: (name: string) => string;
    /** Placeholder heading for an analysis area the analyst has not named. */
    analysisAreaFallback: (index: number) => string;

    // Glossary.
    glossaryHeading: string;
    glossaryIntro: string;
    glossaryTerm: string;
    glossaryDefinition: string;
    glossaryContext: string;

    // Footer.
    preparedBy: string;
    /** Always this, at every site — the role, not the person. */
    preparedByRole: string;
    disclaimer: string;

    /** The compass letter on a deformation figure: "U" (Utara) / "N" (North). */
    northLetter: string;

    /** Printed where a manual field was left blank. */
    notProvided: string;
    /** The "no active movement" remark. */
    noSignificantRemark: string;
    /**
     * The whole movement table when the wall folder has no monitoring points at
     * all. Distinct from "nothing is moving": that is a table full of No
     * Significant rows, this is a table with nothing to put in it.
     */
    noMonitoringPoints: string;
}

/**
 * The four data-quality tiers, best first, exactly as the legend table prints
 * them. Keyed by the label `dqp_values` stores, so a lookup can never disagree
 * with the classification the rest of the app resolved.
 */
export const DAILY_QUALITY_TIERS = ['Optimal', 'Acceptable', 'SubOptimal', 'Critical'] as const;
export type DailyQualityTier = (typeof DAILY_QUALITY_TIERS)[number];

/** The four TARP levels, best first, as the risk legend prints them. */
export const DAILY_TARP_LEVELS = ['TARP 1', 'TARP 2', 'TARP 3', 'TARP 4'] as const;

/**
 * `dqp_values` writes "Sub-Optimal"; the printed legend writes "SubOptimal".
 * Normalising here means the "Terkini" tick can be matched on one canonical
 * form rather than on whichever spelling reached the template.
 */
export const normaliseQualityTier = (label?: string | null): DailyQualityTier | null => {
    const s = String(label ?? '').trim().toLowerCase().replace(/[\s_-]/g, '');
    if (!s) return null;
    if (s === 'optimal') return 'Optimal';
    if (s === 'acceptable') return 'Acceptable';
    if (s === 'suboptimal') return 'SubOptimal';
    if (s === 'critical') return 'Critical';
    return null;
};

const EN: DailyStrings = {
    reportTitle: 'DAILY REPORT - RADAR',

    cardDate: 'DATE',
    cardDataUpdate: 'DATA UPDATE',
    cardDataQuality: 'DATA QUALITY',
    cardRisk: 'RISK LEVEL',

    summaryHeading: 'INFORMATION SUMMARY',
    summaryDeformation: 'Current Deformation',
    summaryDataQuality: 'Current Data Quality',
    summaryWeather: 'Weather Condition',
    summaryFog: 'Fog Condition',
    summaryRainfall: 'Rainfall Record',
    summaryGenerator: 'Generator Running Time (minutes)',

    scanAreaHeading: 'SCAN AREA',
    scanAreaFigure: 'Scan Area Deformation Image',
    movementHeading: 'Movement Status Information',

    colArea: 'Area',
    colTarp: 'Current TARP',
    colPattern: 'Deformation Pattern',
    colRemarks: 'Remarks',

    legendHeading: 'LEGEND',
    legendQualityHeading: 'Data Quality Level Description',
    legendRiskHeading: 'Risk Level Description',
    legendStatus: 'Status',
    legendAction: 'Action',
    legendCurrent: 'Current',
    legendRiskLevel: 'Risk Level',

    analysisHeading: 'AREA ANALYSIS',
    analysisGraphCaption: (name) => `Deformation Graph at ${name}`,
    analysisAreaFallback: (index) => `Area ${index}`,

    glossaryHeading: 'RADAR TERMINOLOGY GLOSSARY',
    glossaryIntro:
        'This glossary is intended to help the reader understand technical terminology that may be unfamiliar. It serves as a guide to the technical terms used in this document, so that the report can be followed without confusion.',
    glossaryTerm: 'Term',
    glossaryDefinition: 'Definition',
    glossaryContext: 'Context of Use in Radar',

    preparedBy: 'Prepared by:',
    preparedByRole: 'Geotechnical Engineer',
    disclaimer:
        'DISCLAIMER: DTG provides data analysis to support geotechnical decision-making without acting as a consultant or guaranteeing the outcome, accuracy, or fitness for any particular purpose; all use and interpretation of the data remain the responsibility of the Client.',

    northLetter: 'N',

    notProvided: '—',
    noSignificantRemark: 'No significant movement observed.',
    // "MAS dashboard" is the radar software's own name and is not translated.
    noMonitoringPoints: 'No monitoring points on the MAS dashboard',
};

// The Indonesian wording is transcribed from the report DTG already issues to
// PT. Vale Indonesia, so a client sees the phrasing they are used to.
const ID: DailyStrings = {
    reportTitle: 'LAPORAN HARIAN - RADAR',

    cardDate: 'TANGGAL',
    cardDataUpdate: 'DATA UPDATE',
    cardDataQuality: 'KUALITAS DATA',
    cardRisk: 'TINGKAT RISIKO',

    summaryHeading: 'RANGKUMAN INFORMASI',
    summaryDeformation: 'Deformasi Terkini',
    summaryDataQuality: 'Kualitas Data Terkini',
    summaryWeather: 'Kondisi Cuaca',
    summaryFog: 'Kondisi Kabut',
    summaryRainfall: 'Rekaman Curah Hujan',
    summaryGenerator: 'Waktu Operasi Genset (menit)',

    scanAreaHeading: 'AREA PEMINDAIAN',
    scanAreaFigure: 'Gambar Deformasi Area Pemindaian',
    movementHeading: 'Informasi Status Pergerakan',

    colArea: 'Area',
    colTarp: 'TARP Terkini',
    colPattern: 'Pola Deformasi',
    colRemarks: 'Keterangan',

    legendHeading: 'KETERANGAN',
    legendQualityHeading: 'Penjelasan Tingkat Kualitas Data',
    legendRiskHeading: 'Penjelasan Tingkat Risiko',
    legendStatus: 'Status',
    legendAction: 'Tindakan',
    legendCurrent: 'Terkini',
    legendRiskLevel: 'Tingkat Risiko',

    analysisHeading: 'ANALISIS AREA',
    analysisGraphCaption: (name) => `Grafik Deformasi pada ${name}`,
    analysisAreaFallback: (index) => `Area ${index}`,

    glossaryHeading: 'GLOSSARIUM TERMINOLOGI RADAR',
    glossaryIntro:
        'Glosarium bertujuan membantu pembaca memahami terminologi teknis yang mungkin belum familiar. Dalam konteks ini, glosarium berfungsi sebagai panduan untuk menjelaskan istilah-istilah teknis agar lebih mudah dipahami, sehingga pembaca dapat mengikuti isi dokumen tanpa kebingungan.',
    glossaryTerm: 'Istilah',
    glossaryDefinition: 'Definisi',
    glossaryContext: 'Konteks Penggunaan dalam Radar',

    preparedBy: 'Penyusun:',
    preparedByRole: 'Geotechnical Engineer',
    disclaimer:
        'DISCLAIMER: DTG menyediakan analisis data guna mendukung keputusan geoteknik tanpa bertindak sebagai konsultan maupun menjamin hasil, akurasi, atau kesesuaian untuk tujuan tertentu; seluruh pemanfaatan dan interpretasi data menjadi tanggung jawab Klien.',

    northLetter: 'U',

    notProvided: '—',
    noSignificantRemark: 'Tidak teramati pergerakan signifikan.',
    noMonitoringPoints: 'Tidak ada point monitoring pada MAS dashboard',
};

export const dailyStrings = (locale: DailyLocale = 'en'): DailyStrings =>
    locale === 'id' ? ID : EN;

// ---------------------------------------------------------------------------
// The legend tables
// ---------------------------------------------------------------------------

/**
 * The action each data-quality tier calls for, as the legend prints it.
 *
 * NOT taken from `getStatusDefinition().action` in config/statusConfig.ts: that
 * wording is a full sentence written for the Data Quality Assessment's
 * definition table ("Some action is required due to an apparent unacceptable
 * risk"), and this legend is a four-row box with a column barely wide enough
 * for three words. Same four tiers, same meaning, printed short.
 */
const QUALITY_ACTIONS: Record<DailyLocale, Record<DailyQualityTier, string>> = {
    en: {
        Optimal: 'No action required',
        Acceptable: 'No action required',
        SubOptimal: 'Action required',
        Critical: 'Immediate response required',
    },
    id: {
        Optimal: 'Tidak memerlukan tindakan',
        Acceptable: 'Tidak memerlukan tindakan',
        SubOptimal: 'Diperlukan tindakan',
        Critical: 'Diperlukan respon tindakan segera',
    },
};

export const qualityActionText = (tier: DailyQualityTier, locale: DailyLocale = 'en'): string =>
    QUALITY_ACTIONS[locale === 'id' ? 'id' : 'en'][tier];

// ---------------------------------------------------------------------------
// The "Keterangan" column
// ---------------------------------------------------------------------------

/** A velocity pulled off `def_records.properties`, already unit-resolved. */
export interface DailyRemarkVelocity {
    /** Single velocity (Linear) or the low end of a range (Progressive). */
    from?: string | null;
    /** High end of a range. Absent for a single velocity. */
    to?: string | null;
    /** 'mm/h' | 'mm/d' — translated to mm/jam / mm/hari on the Indonesian path. */
    unit?: string | null;
}

const REMARKS: Record<
    DailyLocale,
    {
        noSignificant: string;
        linear: (v: string) => string;
        progressive: (range: string) => string;
        regressive: string;
        rapid: string;
        /** Anything the five rules above do not name — the type speaks for itself. */
        fallback: (type: string) => string;
    }
> = {
    en: {
        noSignificant: 'No significant movement observed.',
        linear: (v) => `Constant movement, velocity ${v}.`,
        progressive: (range) => `Accelerating movement, velocity ${range}.`,
        regressive: 'Movement returning to a stable condition.',
        rapid: 'Movement exceeds the radar reading limitation.',
        fallback: (type) => `${type} recorded.`,
    },
    id: {
        noSignificant: 'Tidak teramati pergerakan signifikan.',
        linear: (v) => `Pergerakan konstan, kecepatan ${v}.`,
        progressive: (range) => `Pergerakan akseleratif, kecepatan ${range}.`,
        regressive: 'Pergerakan menuju stabil.',
        rapid: 'Pergerakan melebihi limitasi radar.',
        fallback: (type) => `${type} teramati.`,
    },
};

const hasValue = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== '';

/**
 * The Keterangan sentence for one movement row.
 *
 * A velocity the record does not carry is simply left out of the sentence
 * rather than printed as a dash: "velocity — mm/jam" reads as a measurement
 * that failed, when the truth is that this record type never carried one.
 *
 * @param defType   `def_records.def_type`, verbatim.
 * @param velocity  Resolved by `dailyStatusRows.js` from `properties`.
 */
export function dailyRemark(
    defType: string | null | undefined,
    velocity: DailyRemarkVelocity | null | undefined,
    locale: DailyLocale = 'en'
): string {
    const t = REMARKS[locale === 'id' ? 'id' : 'en'];
    const type = String(defType ?? '').trim();
    const key = type.toLowerCase();

    if (!type || key === 'no significant') return t.noSignificant;
    if (key === 'rapid movement') return t.rapid;
    if (key === 'regressive') return t.regressive;

    const unit = hasValue(velocity?.unit) ? translateUnit(String(velocity!.unit), locale) : '';
    const withUnit = (value: string) => (unit ? `${value} ${unit}` : value);

    if (key === 'linear') {
        return hasValue(velocity?.from)
            ? t.linear(withUnit(String(velocity!.from)))
            : t.linear(locale === 'id' ? 'tidak tercatat' : 'not recorded');
    }

    if (key === 'progressive' || key === 'linear accelerating') {
        const lo = hasValue(velocity?.from) ? String(velocity!.from) : null;
        const hi = hasValue(velocity?.to) ? String(velocity!.to) : null;
        if (lo && hi) return t.progressive(withUnit(`${lo} - ${hi}`));
        if (lo || hi) return t.progressive(withUnit(String(lo ?? hi)));
        return t.progressive(locale === 'id' ? 'tidak tercatat' : 'not recorded');
    }

    return t.fallback(type);
}

// ---------------------------------------------------------------------------
// The two verdict sentences
//
// English delegates to the shared derivations — `riskSentence` in riskDisplay
// and `getStatusDefinition().summary` in statusConfig — so an English daily
// report and the Comprehensive report state the same day in exactly the same
// words. Indonesian is a translation of those same sentences, keyed by the
// English they produce, so a phrase added there degrades to English here rather
// than to nothing.
// ---------------------------------------------------------------------------

/**
 * Plain-language severity, as the risk card's sub-line prints it.
 *
 * Keyed by `COLOUR_SUBTITLE`'s output in riskDisplay. 'Moderate Risk' takes the
 * wording emailLocale already uses for the same band, so a client reads the
 * same phrase in the notification email and on the report it accompanies.
 */
const SUBTITLES_ID: Record<string, string> = {
    Critical: 'Kritis',
    'Moderate Risk': 'Risiko Menengah',
    'Intermediate Risk': 'Risiko Sedang',
    'Event Recorded': 'Kejadian Tercatat',
    'No Significant': 'Tidak Signifikan',
};

export const dailySubtitle = (subtitle: string | null | undefined, locale: DailyLocale = 'en'): string => {
    const text = String(subtitle ?? '').trim();
    if (locale !== 'id' || !text) return text;
    return SUBTITLES_ID[text] ?? text;
};

/** The "Deformasi Terkini" sentence. */
export function dailyRiskSentence(
    presentation: RiskPresentation | null | undefined,
    locale: DailyLocale = 'en'
): string {
    if (!presentation) return '';
    if (locale !== 'id') return riskSentence(presentation);

    if (presentation.label === NO_SIGNIFICANT) {
        return 'Tidak teramati risiko deformasi signifikan pada periode ini.';
    }
    // The LABEL is not translated — 'TARP 4' and 'Progressive' are what the
    // radar software and the site's own TARP chart say.
    return `Risiko keseluruhan berada pada ${presentation.label} — kondisi ${dailySubtitle(
        presentation.subtitle,
        locale
    )}.`;
}

/** Keyed by `getStatusDefinition().summary`, so a miss degrades to English. */
const QUALITY_SUMMARIES_ID: Record<string, string> = {
    'No significant quality-related concerns affect slope stability monitoring.':
        'Tidak terdapat kendala kualitas data yang signifikan terhadap pemantauan stabilitas lereng.',
    'Minor limitations are present, but monitoring effectiveness is maintained.':
        'Terdapat keterbatasan minor, namun efektivitas pemantauan tetap terjaga.',
    'Monitoring performance is reduced, limiting risk management confidence.':
        'Performa pemantauan menurun sehingga membatasi tingkat keyakinan manajemen risiko.',
    'Monitoring capability is lost or unreliable.':
        'Kemampuan pemantauan hilang atau tidak dapat diandalkan.',
};

/** The "Kualitas Data Terkini" sentence for a DQP classification. */
export function dailyQualitySummary(
    label: string | null | undefined,
    locale: DailyLocale = 'en'
): string {
    const text = String(label ?? '').trim();
    if (!text) return '';
    // getStatusDefinition returns undefined for anything outside the four tiers.
    const summary = getStatusDefinition(text)?.summary;
    if (!summary) return '';
    return locale === 'id' ? QUALITY_SUMMARIES_ID[summary] ?? summary : summary;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const NAIVE_LOCAL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

/**
 * The Data Update card's timestamp: "01/05/2026 18:06 WITA".
 *
 * Read COMPONENT-WISE, never through `new Date()`. The analyst types this while
 * reading the site's clock, so the value is already site wall time and carries
 * no zone; parsing it as an instant would re-project it through the browser's
 * timezone and print a Makassar 18:06 as 17:06 to an analyst in Jakarta. The
 * zone abbreviation is appended rather than converted — same reasoning as
 * `formatEmailTimestamp`, and the same source of truth for the label.
 */
export const formatDataUpdate = (
    value: string | null | undefined,
    timeZone?: string | null
): string => {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const m = NAIVE_LOCAL.exec(raw);
    if (!m) return raw;
    const zone = emailTimeZoneLabel(timeZone);
    const stamped = `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
    return zone ? `${stamped} ${zone}` : stamped;
};

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * "7 August 2026" / "7 Agustus 2026" — the Tanggal card and the summary.
 *
 * A bare 'YYYY-MM-DD' is built component-wise in LOCAL time. `new Date()` reads
 * it as UTC midnight, which renders as the previous day anywhere west of
 * Greenwich — the report would be dated 6 August for a 7 August report day.
 */
export const dailyLongDate = (value: Date | string, locale: DailyLocale = 'en'): string => {
    let d: Date;
    if (value instanceof Date) {
        d = value;
    } else {
        const m = DATE_ONLY.exec(String(value ?? '').trim());
        d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
    }
    if (Number.isNaN(d.getTime())) return String(value);
    return new Intl.DateTimeFormat(locale === 'id' ? 'id-ID' : 'en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    }).format(d);
};
