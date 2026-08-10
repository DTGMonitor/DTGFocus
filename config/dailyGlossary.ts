// dailyGlossary.ts
//
// The glossary page of the Daily Radar Report.
//
// This is NOT config/glossaryConfig.ts. That module answers a different
// question — "which of DTG's radar-model terms apply to an SSR-FX?" — and its
// entries are single English definitions of hardware concepts (DSRA, Sky Mask,
// Wall Percentage). The daily report's glossary is a client-facing explanation
// of the ANALYSIS vocabulary the page above it uses: the movement patterns, the
// TARP scale, inverse velocity. The two overlap in nothing, so they are kept
// apart rather than merged behind a flag.
//
// Structure mirrors the printed page exactly: entries grouped under an initial
// letter, three columns (term / definition / context in radar), and the three
// movement patterns carrying a small line-shape sketch in the context column.
// The Indonesian text is transcribed verbatim from the report DTG already
// issues; the English is the translation for every other site.

import type { DailyLocale } from './dailyReportLocale';

/**
 * The sketch printed beside a movement pattern's context text.
 *
 * A named shape rather than an image path: these are drawn as inline SVG in the
 * block, because html2canvas cannot fetch an external asset during
 * rasterization and a missing sketch would silently print as a blank cell.
 */
export type PatternShape = 'linear' | 'progressive' | 'regressive';

export interface DailyGlossaryEntry {
    /** Term, as printed. Never translated — these are the radar's own words. */
    term: string;
    definition: string;
    context: string;
    shape?: PatternShape;
}

export interface DailyGlossaryGroup {
    /** The initial letter the printed page groups under. */
    letter: string;
    entries: DailyGlossaryEntry[];
}

const ID_GROUPS: DailyGlossaryGroup[] = [
    {
        letter: 'A',
        entries: [
            {
                term: 'Alarm',
                definition: 'Sistem peringatan otomatis, aktif jika telah melebihi ambang batas tertentu.',
                context: 'Mengaktifkan level TARP dan instruksi mitigasi.',
            },
            {
                term: 'Area Pemindaian',
                definition:
                    'Wilayah yang dipindai radar untuk mendeteksi pergerakan lereng. Ditampilkan dalam bentuk peta berwarna (heatmap deformasi).',
                context: 'Menunjukkan cakupan pemantauan; warna hijau stabil, merah kritis.',
            },
        ],
    },
    {
        letter: 'D',
        entries: [
            {
                term: 'Deformasi',
                definition: 'Perubahan posisi atau bentuk massa batuan akibat gaya internal / eksternal.',
                context: 'Digunakan untuk mendeteksi potensi longsor. Diukur dalam mm/jam.',
            },
        ],
    },
    {
        letter: 'P',
        entries: [
            {
                term: 'Pola Longsoran',
                definition:
                    'Pola pergerakan yang memperlihatkan percepatan (accelerating) hingga mencapai titik kritis sebelum terjadi failure.',
                context:
                    'Umumnya terdeteksi melalui pergerakan progresif yang berlanjut sampai melebihi ambang batas pergerakan yang dapat dibaca radar, dan terbaca sebagai pola yang tidak beraturan.',
            },
            {
                term: 'Pola Pergerakan Cepat (Ambigu)',
                definition:
                    'Pola pergerakan yang melebihi kapasitas pembacaan radar, sehingga data menjadi tidak dapat diandalkan. Maksimum kapasitas pembacaan radar ialah 3.1 mm per satu waktu pemindaian (1-4 menit).',
                context:
                    'Umum terjadi pada soft material dan material yang berasosiasi dengan lumpur. Umum juga terjadi sebagai lanjutan pergerakan progresif, saat lereng semakin berakselerasi dan kecepatan pergerakan tidak mampu dibaca radar.',
            },
            {
                term: 'Pola Pergerakan Linear',
                definition:
                    'Pola pergerakan lereng yang cenderung stabil/konstan dengan kecepatan relatif sama sepanjang waktu.',
                context: 'Pergerakan konstan menyerupai garis miring',
                shape: 'linear',
            },
            {
                term: 'Pola Pergerakan Progresif',
                definition:
                    'Pola pergerakan dengan kecepatan meningkat (accelerating), menandakan lereng semakin tidak stabil.',
                context: 'Pergerakan melengkung menuju garis vertikal',
                shape: 'progressive',
            },
            {
                term: 'Pola Pergerakan Regresif',
                definition:
                    'Pola pergerakan dengan kecepatan menurun (decelerating). Lereng cenderung kembali stabil setelah sempat bergerak.',
                context: 'Pergerakan melengkung menuju garis horizontal',
                shape: 'regressive',
            },
        ],
    },
    {
        letter: 'S',
        entries: [
            {
                term: 'Speed Reciprocal (Inverse Velocity Method)',
                definition:
                    'Metode analisis deformasi dengan membalik nilai kecepatan (1/v) untuk memprediksi waktu kegagalan (failure time).',
                context:
                    'Metode prediksi waktu longsor dengan menarik garis lurus sampai hampir menuju angka 0 pada data speed reciprocal.',
            },
        ],
    },
    {
        letter: 'T',
        entries: [
            {
                term: 'TARP (Trigger Action Response Plan)',
                definition:
                    'Protokol manajemen risiko yang mengatur level bahaya dan tindakan mitigasi.\n• TARP 1 = risiko rendah > • TARP 4 = risiko kritis',
                context: 'Menjadi acuan tindakan emergency di lapangan berdasarkan hasil radar.',
            },
        ],
    },
    {
        letter: 'V',
        entries: [
            {
                term: 'Velocity (Kecepatan)',
                definition: 'Besarnya laju pergerakan lereng dalam satuan waktu tertentu.',
                context: 'Indikator dasar dalam analisis radar; dinyatakan dalam mm/jam atau mm/d.',
            },
        ],
    },
];

const EN_GROUPS: DailyGlossaryGroup[] = [
    {
        letter: 'A',
        entries: [
            {
                term: 'Alarm',
                definition: 'An automatic warning system, triggered once a defined threshold is exceeded.',
                context: 'Activates the TARP level and its mitigation instructions.',
            },
            {
                term: 'Scan Area',
                definition:
                    'The region the radar scans to detect slope movement. Presented as a colour map (deformation heatmap).',
                context: 'Shows the monitoring coverage; green is stable, red is critical.',
            },
        ],
    },
    {
        letter: 'D',
        entries: [
            {
                term: 'Deformation',
                definition:
                    'A change in the position or shape of a rock mass caused by internal or external forces.',
                context: 'Used to detect slope failure potential. Measured in mm/h.',
            },
        ],
    },
    {
        letter: 'F',
        entries: [
            {
                term: 'Failure Pattern',
                definition:
                    'A movement pattern showing acceleration up to a critical point before failure occurs.',
                context:
                    'Usually detected as progressive movement that continues beyond the movement threshold the radar can read, and is then seen as an irregular pattern.',
            },
            {
                term: 'Rapid Movement Pattern (Ambiguous)',
                definition:
                    'A movement pattern that exceeds the radar reading capacity, making the data unreliable. The maximum the radar can read is 3.1 mm per scan interval (1-4 minutes).',
                context:
                    'Common in soft material and material associated with mud. Also common as a continuation of progressive movement, when the slope accelerates beyond the velocity the radar can read.',
            },
        ],
    },
    {
        letter: 'L',
        entries: [
            {
                term: 'Linear Movement Pattern',
                definition:
                    'A slope movement pattern that is stable or constant, with a relatively even velocity over time.',
                context: 'Constant movement resembling a straight incline',
                shape: 'linear',
            },
        ],
    },
    {
        letter: 'P',
        entries: [
            {
                term: 'Progressive Movement Pattern',
                definition:
                    'A movement pattern with increasing velocity (accelerating), indicating a slope becoming less stable.',
                context: 'Movement curving toward the vertical',
                shape: 'progressive',
            },
        ],
    },
    {
        letter: 'R',
        entries: [
            {
                term: 'Regressive Movement Pattern',
                definition:
                    'A movement pattern with decreasing velocity (decelerating). The slope tends to return to stability after having moved.',
                context: 'Movement curving toward the horizontal',
                shape: 'regressive',
            },
        ],
    },
    {
        letter: 'S',
        entries: [
            {
                term: 'Speed Reciprocal (Inverse Velocity Method)',
                definition:
                    'A deformation analysis method that inverts velocity (1/v) to predict the failure time.',
                context:
                    'Failure time is predicted by projecting a straight line on the speed reciprocal data toward zero.',
            },
        ],
    },
    {
        letter: 'T',
        entries: [
            {
                term: 'TARP (Trigger Action Response Plan)',
                definition:
                    'A risk management protocol defining hazard levels and their mitigation actions.\n• TARP 1 = low risk > • TARP 4 = critical risk',
                context: 'The reference for emergency action on site based on the radar results.',
            },
        ],
    },
    {
        letter: 'V',
        entries: [
            {
                term: 'Velocity',
                definition: 'The rate of slope movement over a given period of time.',
                context: 'The primary indicator in radar analysis; expressed in mm/h or mm/d.',
            },
        ],
    },
];

/** The glossary groups for a locale, in printed order. */
export const dailyGlossaryGroups = (locale: DailyLocale = 'en'): DailyGlossaryGroup[] =>
    locale === 'id' ? ID_GROUPS : EN_GROUPS;

/**
 * SVG path for a pattern sketch, drawn in a 0 0 24 24 box.
 *
 * Traced to match the printed report: linear is a straight rise, progressive
 * curves up toward the vertical, regressive flattens out toward the horizontal.
 * Each is drawn against an L-shaped axis pair so the shape reads as a graph and
 * not as an arrow.
 */
export const PATTERN_SHAPE_PATH: Record<PatternShape, string> = {
    linear: 'M4 20 L20 4',
    progressive: 'M4 20 C 12 20, 18 16, 20 4',
    regressive: 'M4 20 C 6 8, 12 4, 20 4',
};
