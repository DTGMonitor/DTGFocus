// tarpLocale.ts
//
// The language a site's TARP chart is READ in, and every word that changes with
// it.
//
// A TARP document is client data: the rows in `tarp_triggers` are what the site
// signed, and they are also what the email engine reads to decide whether a
// subject quotes "TARP Trigger N:". Translating those rows in the database would
// therefore change what the engine matches on. So nothing here touches the
// document — the translation happens at RENDER time, in the two places a human
// reads the chart:
//
//   * the TARP tab's chart (components/admin/Radar/Tarp/TarpChart.jsx)
//   * the .xlsx a client is sent   (utils/tarpXlsx.js)
//
// Everything else — the subject preview, the deformation form's response
// banners, the editing modals — keeps reading the English rows, so an engineer
// amending the document is amending exactly what the email engine will see.
//
// The rules match config/emailLocale.ts, whose dictionary this one sits beside:
//
//   * Prose, labels and column headings translate.
//   * Terms an Indonesian site engineer already reads on the radar software do
//     not — TARP Trigger N, velocity, coherence, alarm mask, FOG, Dispatch,
//     Geotech, stick-slip. Translating those would make the chart HARDER to act
//     on at 2am, not easier.
//   * Every entry is keyed by the exact English string the DTG standard chart
//     produces, so a lookup miss degrades to the English wording rather than to
//     nothing. A client's own free text is never mangled.

import type { EmailLocale } from './emailLocale';
import { resolveEmailLocale } from './emailLocale';

/** Same two languages, same resolution, as the email drafts. */
export type TarpLocale = EmailLocale;

/**
 * The language this sensor's site reads its TARP in.
 *
 * Deliberately the same answer as `resolveEmailLocale`: a site emailed in Bahasa
 * Indonesia reads its chart in Bahasa Indonesia, and a site that opts out of one
 * opts out of both. `SITE_EMAIL_LOCALE_OVERRIDES` is therefore the single place
 * to switch a site over.
 */
export const resolveTarpLocale = resolveEmailLocale;

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

const lookup = (
    table: Record<string, string>,
    value: unknown,
    locale: TarpLocale
): string => {
    const text = value === null || value === undefined ? '' : String(value);
    if (locale !== 'id' || !text) return text;
    return table[text] ?? table[text.trim()] ?? text;
};

/**
 * A lookup for cells that read as sentences.
 *
 * The same sentence appears across client documents with and without its final
 * full stop — "A genuine Orange alarm is triggered" in one chart, the same line
 * punctuated in the next — so the table is keyed without one and the stop is put
 * back when the source carried it. One entry then covers both charts.
 */
const lookupSentence = (
    table: Record<string, string>,
    value: unknown,
    locale: TarpLocale
): string => {
    const text = value === null || value === undefined ? '' : String(value);
    if (locale !== 'id' || !text.trim()) return text;

    const trimmed = text.trim();
    const direct = table[text] ?? table[trimmed];
    if (direct) return direct;

    const bare = trimmed.replace(/\.\s*$/, '');
    const hit = table[bare];
    if (!hit) return text;

    const hadStop = bare !== trimmed;
    return hadStop && !/[.!?]$/.test(hit) ? `${hit}.` : hit;
};

// ---------------------------------------------------------------------------
// The dictionary
// ---------------------------------------------------------------------------

/** Risk rating, the left-hand band column. */
const RISK_RATINGS_ID: Record<string, string> = {
    'Extreme': 'Ekstrem',
    'High': 'Tinggi',
    'Moderate': 'Sedang',
    'Intermediate': 'Menengah',
    'Low': 'Rendah'
};

/**
 * Band colours. Applied INSIDE a band label — "TARP Trigger 4 (Red)" becomes
 * "TARP Trigger 4 (Merah)" — because the TARP number is the part a site engineer
 * matches against their own procedure and must survive untranslated.
 */
const COLOURS_ID: Record<string, string> = {
    'Red': 'Merah',
    'Orange': 'Oranye',
    'Yellow': 'Kuning',
    'Green': 'Hijau',
    'Grey': 'Abu-abu',
    'Gray': 'Abu-abu',
    'Blue': 'Biru'
};

const COLOUR_WORD = new RegExp(`\\b(${Object.keys(COLOURS_ID).join('|')})\\b`, 'g');

/** Trigger labels, the coloured chip in the Trigger column. */
const TRIGGER_LABELS_ID: Record<string, string> = {
    'Progressive trend': 'Pola Progresif',
    'Progressive (accelerating) trend': 'Pola Progresif (Akselerasi)',
    'Linear accelerating trend': 'Pola Linear Akselerasi',
    'Linear trend': 'Pola Linear',
    'Linear trend (constant velocity)': 'Pola Linear (Velocity Konstan)',
    'Regressive trend': 'Pola Regresif',
    'Red Alarm': 'Alarm Merah',
    'Orange Alarm': 'Alarm Oranye',
    'Yellow Alarm': 'Alarm Kuning',
    'Lost Connection': 'Koneksi Terputus',
    'Fall of Ground': 'Jatuhan Material (FOG)',
    'Fall of Ground/failure': 'Jatuhan Material (FOG) / Longsoran',
    'Data Contamination': 'Kontaminasi Data',
    'Scheduled Radar Offline': 'Radar Offline Terjadwal',
    'Scheduled Offline': 'Offline Terjadwal',
    'Offline Scheduled': 'Offline Terjadwal'
};

/** The Description column. */
const DESCRIPTIONS_ID: Record<string, string> = {
    'Progressive (accelerating) slope displacement trend is identified':
        'Teridentifikasi pola perpindahan lereng progresif (akselerasi)',
    'Progressive (accelerating) slope displacement trend is identified (at any rate)':
        'Teridentifikasi pola perpindahan lereng progresif (akselerasi) pada laju berapa pun',
    'Stick-slip linear displacement trend with increasing average velocity is identified':
        'Teridentifikasi pola perpindahan linear stick-slip dengan rata-rata velocity yang meningkat',
    'A genuine Red Alarm is triggered': 'Terjadi Alarm Merah yang genuine',
    'A genuine Orange alarm is triggered': 'Terjadi Alarm Oranye yang genuine',
    'A consistent linear (constant velocity) displacement trend is identified':
        'Teridentifikasi pola perpindahan linear (velocity konstan) yang konsisten',
    'A consistent linear trend (at any rate) is identified':
        'Teridentifikasi pola linear yang konsisten pada laju berapa pun',
    'A regressive (decelerating) displacement trend is identified':
        'Teridentifikasi pola perpindahan regresif (deselerasi)',
    'Connection between monitoring centre and site is lost':
        'Koneksi antara monitoring centre dan site terputus',
    'Uncontrolled fall of ground (FOG) occurs. This may occur following a previously identified deformation trend':
        'Terjadi jatuhan material (FOG) yang tidak terkendali. Hal ini dapat terjadi setelah pola deformasi yang teridentifikasi sebelumnya',
    'Uncontrolled fall of ground (FOG) occurs. This may occur following a previously identified deformation trend or by an observed unexplained drop in coherence':
        'Terjadi jatuhan material (FOG) yang tidak terkendali. Hal ini dapat terjadi setelah pola deformasi yang teridentifikasi sebelumnya, atau ditandai penurunan coherence yang tidak dapat dijelaskan',
    "Significant data contamination impacts the remote engineer's ability to analyse and interpret data":
        'Kontaminasi data yang signifikan memengaruhi kemampuan remote engineer untuk menganalisis dan menginterpretasi data'
};

/** The Day Shift / Night Shift columns. */
const SHIFT_RESPONSES_ID: Record<string, string> = {
    'Call Geotech': 'Telepon Geotech',
    'Email Geotech': 'Email Geotech',
    'Call Supervisor': 'Telepon Supervisor',
    'Call supervisor': 'Telepon supervisor',
    'Call Geotech and Supervisor': 'Telepon Geotech dan Supervisor',
    'NA': 'Tidak ada',
    'N/A': 'Tidak ada',
    'No action': 'Tidak ada tindakan',
    'No action required': 'Tidak ada tindakan yang diperlukan'
};

/**
 * The numbered Comment list. Keyed WITHOUT the "1. " prefix, which
 * `translateComment` strips and puts back — the numbering is the order of
 * operations and must not move.
 */
const COMMENTS_ID: Record<string, string> = {
    'State area of concern': 'Sampaikan area yang menjadi perhatian',
    'Advise to respond as per site TARP': 'Sarankan penanganan sesuai TARP site',
    'Advise to respond as per site TARP for the specific area':
        'Sarankan penanganan sesuai TARP site untuk area tersebut',
    'Conduct velocity analysis': 'Lakukan analisis velocity',
    'Conduct collapse forecast where possible as per DTG procedure':
        'Lakukan prakiraan longsoran bila memungkinkan sesuai prosedur DTG',
    'Liaise with site engineers to support application of velocity ratio alarms where possible':
        'Koordinasikan dengan site engineer untuk mendukung penerapan alarm velocity ratio bila memungkinkan',
    'State alarm area': 'Sampaikan area alarm',
    'Check for progressive deformation trend and commence collapse forecast where possible':
        'Periksa pola deformasi progresif dan mulai prakiraan longsoran bila memungkinkan',
    'Monitor as per TARP Trigger 2 procedures': 'Monitor sesuai prosedur TARP Trigger 2',
    'Monitor as per TARP Trigger 3 procedures': 'Monitor sesuai prosedur TARP Trigger 3',
    'Monitor as per TARP Trigger 4 procedures': 'Monitor sesuai prosedur TARP Trigger 4',
    'Record in daily log': 'Catat dalam daily log',
    'Clear alarm. Conduct velocity analysis': 'Clear alarm. Lakukan analisis velocity',
    // The source wording carries a typo ("for and change"); the Indonesian says
    // what the step means rather than reproducing it.
    'Monitor closely for and change in deformation trend':
        'Monitor secara ketat setiap perubahan pola deformasi',
    'Monitor closely for any change in deformation trend':
        'Monitor secara ketat setiap perubahan pola deformasi',
    'Advise remote link is down and no longer able to monitor remotely':
        'Informasikan bahwa remote link terputus dan monitoring jarak jauh tidak dapat dilakukan',
    'Advise Dispatch to follow site procedure for alarms (Dispatch to call site Geotech for all triggered alarms)':
        'Informasikan Dispatch untuk mengikuti prosedur site terkait alarm (Dispatch menghubungi Geotech site untuk setiap alarm yang terpicu)',
    'All uncontrolled falls of ground (rockfalls) must be reported and documented. Site geotech is to be notified by email. If considered "high potential" or near miss - call on day shift':
        'Seluruh jatuhan material (rockfall) yang tidak terkendali wajib dilaporkan dan didokumentasikan. Geotech site diinformasikan melalui email. Apabila dinilai "high potential" atau near miss — telepon pada shift siang',
    'State time period for offline': 'Sampaikan periode waktu offline',
    'Follow up by email': 'Tindak lanjuti melalui email',
    'Validate velocity / movement with drone inspections photos':
        'Validasi velocity / pergerakan dengan foto inspeksi drone'
};

/** `RESPONSE_METHOD_LABEL` from tarpDocument.ts. */
const RESPONSE_LABELS_ID: Record<string, string> = {
    'Call': 'Telepon',
    'Email only': 'Email saja',
    // Kept as the product name the site engineer knows, per the rules above.
    'WhatsApp only': 'WhatsApp saja',
    'Call, then email': 'Telepon, lalu email',
    'No action': 'Tidak ada tindakan'
};

/** `DEVIATION_WORDING` from tarpDocument.ts, as the chart prints it. */
const NOTICES_ID: Record<string, string> = {
    'Email only — do NOT call.': 'Email saja — JANGAN menelepon.',
    'A phone call is required for this trigger.':
        'Pemicu ini mewajibkan panggilan telepon.',
    'WhatsApp message only — do NOT call.':
        'Pesan WhatsApp saja — JANGAN menelepon.',
    'Call first, then follow up by email.':
        'Telepon terlebih dahulu, lalu tindak lanjuti melalui email.',
    'No notification required for this trigger.':
        'Tidak ada notifikasi yang diperlukan untuk pemicu ini.'
};

/** Document-level prose: title, response owner, footer and escalation notes. */
const DOCUMENT_TEXT_ID: Record<string, string> = {
    'Radar - Trigger Action Response Plan Chart':
        'Radar - Bagan Trigger Action Response Plan',
    'Primary Trigger Response - DTG Engineer': 'Respons Pemicu Utama - DTG Engineer',
    'ALL CALLS FROM REMOTE ENGINEER TO SITE ENGINEER MUST BE FOLLOWED BY AN EMAIL SUMMARY':
        'SELURUH PANGGILAN TELEPON DARI REMOTE ENGINEER KEPADA SITE ENGINEER WAJIB DITINDAKLANJUTI DENGAN RINGKASAN MELALUI EMAIL',
    'ALL CALLS MUST BE FOLLOWED BY AN EMAIL SUMMARY':
        'SELURUH PANGGILAN TELEPON WAJIB DITINDAKLANJUTI DENGAN RINGKASAN MELALUI EMAIL',
    'Contact hierarchy: 1. supervisor 2. superintendent 3. mine manager 4. Geotech':
        'Hierarki kontak: 1. supervisor 2. superintendent 3. mine manager 4. Geotech',
    'All parts': 'Seluruh bagian'
};

// ---------------------------------------------------------------------------
// Translators
// ---------------------------------------------------------------------------

export const translateRiskRating = (value: unknown, locale: TarpLocale): string =>
    lookup(RISK_RATINGS_ID, value, locale);

/** "TARP Trigger 4 (Red)" -> "TARP Trigger 4 (Merah)". */
export const translateBandLabel = (value: unknown, locale: TarpLocale): string => {
    const text = value === null || value === undefined ? '' : String(value);
    if (locale !== 'id' || !text) return text;
    return text.replace(COLOUR_WORD, (word) => COLOURS_ID[word] ?? word);
};

export const translateTriggerLabel = (value: unknown, locale: TarpLocale): string =>
    lookupSentence(TRIGGER_LABELS_ID, value, locale);

export const translateDescription = (value: unknown, locale: TarpLocale): string =>
    lookupSentence(DESCRIPTIONS_ID, value, locale);

export const translateShiftResponse = (value: unknown, locale: TarpLocale): string =>
    lookupSentence(SHIFT_RESPONSES_ID, value, locale);

export const translateResponseLabel = (value: unknown, locale: TarpLocale): string =>
    lookup(RESPONSE_LABELS_ID, value, locale);

export const translateNotice = (value: unknown, locale: TarpLocale): string =>
    lookupSentence(NOTICES_ID, value, locale);

export const translateDocumentText = (value: unknown, locale: TarpLocale): string =>
    lookupSentence(DOCUMENT_TEXT_ID, value, locale);

/** "1. " and "2) " — the ordering the chart's Comment column is written in. */
const NUMBER_PREFIX = /^(\s*\d+\s*[.)]\s*)([\s\S]*)$/;

/**
 * A comment line, with its numbering preserved.
 *
 * The step number is the order of operations at 2am, so it is peeled off, the
 * instruction translated, and the number put back exactly as it was.
 */
export const translateComment = (value: unknown, locale: TarpLocale): string => {
    const text = value === null || value === undefined ? '' : String(value);
    if (locale !== 'id' || !text.trim()) return text;

    const numbered = NUMBER_PREFIX.exec(text);
    if (!numbered) return lookupSentence(COMMENTS_ID, text, locale);

    const [, prefix, body] = numbered;
    return `${prefix}${lookupSentence(COMMENTS_ID, body, locale)}`;
};

/**
 * A whole trigger row, as the chart and the workbook display it.
 *
 * Returned as a NEW object: the caller keeps the untranslated row, which is what
 * the email engine, the subject preview and the edit modals go on reading.
 * `extraNote` is left alone — it is the analyst's own free text.
 */
export interface DisplayTrigger {
    riskRating: string | null;
    bandLabel: string | null;
    triggerLabel: string;
    description: string | null;
    dayShift: string | null;
    nightShift: string | null;
    comments: string[];
}

export const translateTriggerRow = <T extends DisplayTrigger>(
    trigger: T,
    locale: TarpLocale
): T => {
    if (locale !== 'id') return trigger;
    return {
        ...trigger,
        riskRating: trigger.riskRating ? translateRiskRating(trigger.riskRating, locale) : trigger.riskRating,
        bandLabel: trigger.bandLabel ? translateBandLabel(trigger.bandLabel, locale) : trigger.bandLabel,
        triggerLabel: translateTriggerLabel(trigger.triggerLabel, locale),
        description: trigger.description ? translateDescription(trigger.description, locale) : trigger.description,
        dayShift: trigger.dayShift ? translateShiftResponse(trigger.dayShift, locale) : trigger.dayShift,
        nightShift: trigger.nightShift ? translateShiftResponse(trigger.nightShift, locale) : trigger.nightShift,
        comments: (trigger.comments || []).map((comment) => translateComment(comment, locale))
    };
};

// ---------------------------------------------------------------------------
// Chrome
//
// Column headings and section labels, for the chart and the workbook. The
// workbook headings keep the SHOUTED case of the client workbooks the export was
// modelled on.
// ---------------------------------------------------------------------------

export interface TarpStrings {
    // Chart columns.
    /** Only printed by charts that HAVE a parameter axis — see migration 011. */
    parameter: string;
    riskRating: string;
    trigger: string;
    description: string;
    dayShift: string;
    nightShift: string;
    comment: string;
    note: string;

    // Chart body.
    emptyDocument: string;
    /** "drives Progressive → TARP 4 (alarm only)". */
    drives: string;
    alarmOnly: string;

    // Workbook column headers, in column order.
    sheetHeaders: string[];
    tarpBand: string;

    // Workbook sections.
    contacts: string;
    distributionList: string;

    // Workbook sheet 2.
    historySheet: string;
    documentControl: string;
    historyHeaders: string[];

    /**
     * How a version is labelled when several are exported together — the tab
     * name of each chart sheet in the every-version workbook. Only the status
     * translates; "v3" is the number the site quotes back at us.
     */
    versionStatus: Record<'active' | 'superseded' | 'draft', string>;
}

const EN: TarpStrings = {
    parameter: 'Parameter',
    riskRating: 'Risk Rating',
    trigger: 'Trigger',
    description: 'Description',
    dayShift: 'Day Shift',
    nightShift: 'Night Shift',
    comment: 'Comment',
    note: 'Note',

    emptyDocument: 'This document has no trigger rows yet.',
    drives: 'drives',
    alarmOnly: 'alarm only',

    sheetHeaders: [
        'RISK RATING', 'TARP Band', 'Trigger', 'Description',
        'Day Shift', 'NightShift', 'Comment', 'Note'
    ],
    tarpBand: 'TARP Band',

    contacts: 'Contacts',
    distributionList: 'Email Distribution List',

    historySheet: 'TARP History',
    documentControl: 'DOCUMENT CONTROL',
    historyHeaders: [
        'No.', 'Site Name', 'Version No.', 'Approval Date',
        'Approved / Modified by\nSite', 'Role',
        'Approved / Modified by DTG Engineer', 'Role', 'Modified Date',
        'Sections Modified and Summary of Changes', 'Remark'
    ],

    versionStatus: {
        active: 'in force',
        superseded: 'superseded',
        draft: 'draft'
    }
};

const ID: TarpStrings = {
    parameter: 'Parameter',
    riskRating: 'Tingkat Risiko',
    trigger: 'Pemicu',
    description: 'Deskripsi',
    dayShift: 'Shift Siang',
    nightShift: 'Shift Malam',
    comment: 'Keterangan',
    note: 'Catatan',

    emptyDocument: 'Dokumen ini belum memiliki baris pemicu.',
    drives: 'memicu',
    alarmOnly: 'hanya dengan alarm',

    sheetHeaders: [
        'TINGKAT RISIKO', 'Band TARP', 'Pemicu', 'Deskripsi',
        'Shift Siang', 'Shift Malam', 'Keterangan', 'Catatan'
    ],
    tarpBand: 'Band TARP',

    contacts: 'Kontak',
    distributionList: 'Daftar Distribusi Email',

    historySheet: 'Riwayat TARP',
    documentControl: 'KENDALI DOKUMEN',
    historyHeaders: [
        'No.', 'Nama Site', 'Versi', 'Tanggal Persetujuan',
        'Disetujui / Diubah oleh\nSite', 'Jabatan',
        'Disetujui / Diubah oleh DTG Engineer', 'Jabatan', 'Tanggal Perubahan',
        'Bagian yang Diubah dan Ringkasan Perubahan', 'Keterangan'
    ],

    versionStatus: {
        active: 'berlaku',
        superseded: 'digantikan',
        draft: 'draf'
    }
};

export const tarpStrings = (locale: TarpLocale = 'en'): TarpStrings =>
    locale === 'id' ? ID : EN;
