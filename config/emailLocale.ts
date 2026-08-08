// emailLocale.ts
//
// The language an email draft is written in, and every word that changes with
// it.
//
// DTG's Indonesian clients are emailed in Bahasa Indonesia. Rather than fork the
// draft generators, the generators stay one code path and read their wording
// from here. Two rules keep the Indonesian drafts readable to a geotech:
//
//   * Prose, labels and brackets translate.
//   * Metric symbols do not — VCP, Vmin, Vmax, Velocity, Inv. Velocity, DSRA,
//     TARP Trigger N and the alarm-mask names are what an Indonesian site
//     engineer already reads on the radar software. Only their UNITS translate
//     (mm/h -> mm/jam), which is what the site's own emails do.
//
// Anything this module has no translation for is passed through untouched, so
// analyst free-text and a client's own TARP document wording are never mangled.

/** Which language a draft is written in. */
export type EmailLocale = 'en' | 'id';

// ---------------------------------------------------------------------------
// Which sites get Indonesian
// ---------------------------------------------------------------------------

/**
 * The Indonesian zones, and the abbreviation each one's clients write after a
 * time. These do double duty: they detect the locale AND stamp the timestamp.
 */
export const INDONESIAN_TIME_ZONES: Record<string, string> = {
    'Asia/Jakarta': 'WIB',
    'Asia/Pontianak': 'WIB',
    'Asia/Makassar': 'WITA',
    'Asia/Jayapura': 'WIT'
};

/**
 * Sites whose language is not what their timezone implies, keyed by lower-cased
 * site name — the same escape hatch `SITE_TARP_POLICY_OVERRIDES` gives the TARP
 * layer. Add a site here to switch it over without a migration; set 'en' to opt
 * an Indonesian-timezone site back out.
 */
export const SITE_EMAIL_LOCALE_OVERRIDES: Record<string, EmailLocale> = {
    // e.g. 'ibp': 'id',
};

const asLocale = (value: unknown): EmailLocale | null =>
    value === 'id' || value === 'en' ? value : null;

/**
 * The parts of a sensor row (or of the post-blast report's `meta`) this needs.
 * Everything is optional: the callers pass whatever object they are holding.
 */
export interface EmailLocaleSource {
    site_name?: string | null;
    timezone?: string | null;
    email_locale?: string | null;
    site?: { site_name?: string | null; timezone?: string | null; email_locale?: string | null } | null;
}

/**
 * The language this sensor's site is emailed in.
 *
 * Resolution order mirrors `getTarpPolicyForSensor`:
 *   1. an explicit `email_locale` on the sensor or its site (a DB column, if one
 *      is ever added — read here so no code change is needed then)
 *   2. SITE_EMAIL_LOCALE_OVERRIDES, by site name
 *   3. the site's IANA timezone
 *   4. English
 *
 * `timeZone` is accepted separately because the components hold the site zone as
 * its own prop (`timezone` / `clientTimezone`) more reliably than on `sensor`.
 */
export const resolveEmailLocale = (
    sensor: EmailLocaleSource | null | undefined,
    timeZone?: string | null
): EmailLocale => {
    const explicit = asLocale(sensor?.email_locale) || asLocale(sensor?.site?.email_locale);
    if (explicit) return explicit;

    const siteName = String(sensor?.site_name || '').trim().toLowerCase();
    const override = SITE_EMAIL_LOCALE_OVERRIDES[siteName];
    if (override) return override;

    const zone = timeZone || sensor?.timezone || sensor?.site?.timezone;
    return zone && INDONESIAN_TIME_ZONES[zone] ? 'id' : 'en';
};

// ---------------------------------------------------------------------------
// Timestamps
// ---------------------------------------------------------------------------

/** "WITA" for a site on Asia/Makassar; "" for a zone with no such convention. */
export const emailTimeZoneLabel = (timeZone?: string | null): string =>
    (timeZone && INDONESIAN_TIME_ZONES[timeZone]) || '';

export interface EmailFormatOptions {
    locale?: EmailLocale;
    /** The SITE's IANA zone. Only consulted on the Indonesian path. */
    timeZone?: string | null;
}

/** "2026-03-28T04:03" — a datetime-local field value, with no zone attached. */
const NAIVE_LOCAL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

/**
 * How a time is written in an email body.
 *
 * English is byte-for-byte what it has always been: `Date#toLocaleString` in
 * en-AU. Indonesian writes the same instant as "28/03/2026 04:03 WITA".
 *
 * The values these generators are handed are the form's own datetime-local
 * strings, which are already the SITE's wall clock (the components convert with
 * `toUTC(value, timezone)` only when they save). So a tz-naive string is read
 * component-wise and simply labelled — re-projecting it into `timeZone` would
 * shift it by the offset between the analyst's browser and the site. `timeZone`
 * is applied only to a value that carries a real instant (a trailing Z or an
 * explicit offset), where the projection is the correct thing to do.
 */
export const formatEmailTimestamp = (
    value: string | null | undefined,
    { locale = 'en', timeZone }: EmailFormatOptions = {}
): string => {
    if (!value) return locale === 'id' ? '-' : 'N/A';

    const raw = String(value).trim();
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;

    if (locale !== 'id') {
        return date.toLocaleString('en-AU', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: false
        });
    }

    const zone = emailTimeZoneLabel(timeZone);
    const naive = NAIVE_LOCAL.exec(raw);
    const hasZone = /([zZ])$|[+-]\d{2}:?\d{2}$/.test(raw);

    // en-GB rather than 'id': the numeric order is the one the sites write and
    // the month names never appear, so no localised separator can slip in.
    const stamped = naive && !hasZone
        ? `${naive[3]}/${naive[2]}/${naive[1]} ${naive[4]}:${naive[5]}`
        : new Intl.DateTimeFormat('en-GB', {
            timeZone: timeZone || undefined,
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: false
        }).format(date).replace(',', '');

    return zone ? `${stamped} ${zone}` : stamped;
};

// ---------------------------------------------------------------------------
// The dictionary
//
// Every entry is keyed by the exact English string the generators already
// produce, so a lookup miss degrades to the English word rather than to nothing.
// ---------------------------------------------------------------------------

/** Subject brackets. Note SERVICE OFFLINE is left as-is — the sites use it. */
const BRACKETS_ID: Record<string, string> = {
    'CRITICAL': 'BAHAYA',
    'MODERATE RISK': 'RISIKO MENENGAH',
    'NOTIFICATION ONLY': 'NOTIFIKASI',
    'ACTION REQUIRED': 'PERLU TINDAKAN',
    'UPDATE': 'PEMBARUAN',
    'SERVICE OFFLINE': 'SERVICE OFFLINE',
    'CONNECTION RESTORED': 'KONEKSI KEMBALI NORMAL'
};

/** `getCleanFindings` output, per deformation type. */
const FINDINGS_ID: Record<string, string> = {
    'Progressive': 'Pola Deformasi Progresif',
    'Linear Accelerating': 'Pola Deformasi Linear Akselerasi',
    'Linear': 'Pola Deformasi Linear',
    'Regressive': 'Pola Deformasi Regresif',
    'Failure': 'Indikasi Pola Longsoran',
    'Forecast': 'Prakiraan Longsoran',
    'Material Detachment': 'Indikasi Material Terlepas',
    'Rock Fall': 'Jatuhan Batuan',
    'Rapid Movement': 'Pergerakan Cepat',
    'Blast Event': 'Kejadian Peledakan',
    'Rainfall Event': 'Kejadian Curah Hujan'
};

/** Downtime statuses, as they appear in a subject line. */
const STATUSES_ID: Record<string, string> = {
    'Lost Connection': 'Koneksi Terputus',
    'Link Down': 'Pembaruan Data Terputus',
    'Scheduled Offline': 'Offline Terjadwal',
    'Live': 'Kembali Online'
};

/** Alarm band colours, for the "Red and Orange Alarms - " subject prefix. */
const ALARM_COLOURS_ID: Record<string, string> = {
    'Red': 'Merah',
    'Orange': 'Oranye',
    'Yellow': 'Kuning',
    'Green': 'Hijau',
    'Blue': 'Biru'
};

/** Downtime reason (the SPESIFIK line). Actions stay English — see module note. */
const REASONS_ID: Record<string, string> = {
    'Radar System Issue': 'Isu Sistem Radar',
    'Maintenance': 'Pemeliharaan',
    'Relocation': 'Relokasi',
    'Connection': 'Koneksi',
    'PMP Issue': 'Isu PMP',
    'Scheduled maintenance from the DTG side.': 'Pemeliharaan terjadwal dari sisi DTG.'
};

/**
 * Pattern-recognition stage and event labels, as the post-blast draft names
 * them. The printed report keeps the English labels — only the email draft is
 * translated — so these live apart from FINDINGS_ID.
 */
const PHASES_ID: Record<string, string> = {
    'No Significant Movement': 'Tidak Ada Pergerakan Signifikan',
    'Regressive': 'Regresif',
    'Linear': 'Linear',
    'Progressive': 'Progresif',
    'Progressive Failure': 'Longsoran Progresif',
    'Blast': 'Peledakan',
    'Rock Fall': 'Jatuhan Batuan',
    'Material Detachment': 'Material Terlepas',
    'Failure': 'Longsoran'
};

/** How a whole-site selection is named — `ALL_SELECTED_LABEL` in siteWideStatus. */
const SELECTION_LABELS_ID: Record<string, string> = {
    'All Sensors': 'Seluruh Sensor',
    'All Radars': 'Seluruh Radar'
};

/**
 * DQP issue / action / notes wording, from `getSubjectOptions`. Free-text the
 * analyst typed is not in here and passes through, which is the intent.
 */
const DQP_PHRASES_ID: Record<string, string> = {
    // Subjects
    'DSRA Relocation': 'Relokasi DSRA',
    'Service Impacted': 'Layanan Terdampak',
    'Alarm Since Time Adjustment': 'Penyesuaian Since Time Alarm',
    'Alarm Configuration': 'Konfigurasi Alarm',
    'Additional Alarm Mask Recommendation': 'Rekomendasi Tambahan Alarm Mask',
    // Issues
    'Optimisation of atmospheric correction': 'Optimalisasi koreksi atmosferik',
    'Significant impact on data quality': 'Dampak signifikan terhadap kualitas data',
    'Deformation Alarm Details': 'Detail Alarm Deformasi',
    'Alarm Details': 'Detail Alarm',
    'Excessive Unwanted Alarms': 'Alarm Tidak Diinginkan Berlebih',
    'The combination of SSR and scan mode does not match with any criteria.':
        'Kombinasi SSR dan scan mode tidak memenuhi kriteria manapun.',
    'Several parts of the scan area are considered unnecessary and can be trimmed.':
        'Beberapa bagian dari scan area dinilai tidak diperlukan dan dapat dipangkas.',
    // Actions
    'Apply additional site controls as required.':
        'Mohon terapkan kontrol tambahan di site sesuai kebutuhan.',
    'Review the current alarm configuration.': 'Mohon tinjau konfigurasi alarm saat ini.',
    'As per the alarm mask recommendation.': 'Sesuai rekomendasi alarm mask.',
    'Adjustment of the `Since Time` metric proposed by DTG Engineer — awaiting confirmation from site engineer before implementation.':
        'Penyesuaian metrik `Since Time` diusulkan oleh DTG Engineer — menunggu konfirmasi dari site engineer sebelum diterapkan.',
    'Adjustment of the \'Since Time\' metric proposed by DTG Engineer — awaiting confirmation from site engineer before implementation.':
        'Penyesuaian metrik \'Since Time\' diusulkan oleh DTG Engineer — menunggu konfirmasi dari site engineer sebelum diterapkan.',
    'Please review the current location and consider to relocate the radar.':
        'Mohon tinjau lokasi saat ini dan pertimbangkan untuk merelokasi radar.',
    'Please review the current scan area and consider trimming the unnecessary area.':
        'Mohon tinjau scan area saat ini dan pertimbangkan untuk memangkas area yang tidak diperlukan.',
    'Review and Monitor': 'Tinjau dan Monitor',
    // Standing notes
    'DTG engineers will continue to monitor alarm settings configuration for appropriateness and advise accordingly.':
        'DTG engineer akan terus memantau kesesuaian konfigurasi alarm dan menginformasikan lebih lanjut.',
    'Weather/atmospheric conditions are significantly impacting data quality. The effectiveness of the radar for risk mitigation may be affected.':
        'Kondisi cuaca/atmosfer berdampak signifikan terhadap kualitas data. Efektivitas radar untuk mitigasi risiko dapat terpengaruh.'
};

const lookup = (table: Record<string, string>, value: unknown, locale: EmailLocale): string => {
    const text = value === null || value === undefined ? '' : String(value);
    if (locale !== 'id' || !text) return text;
    return table[text] ?? table[text.trim()] ?? text;
};

export const translateBracket = (bracket: unknown, locale: EmailLocale): string =>
    lookup(BRACKETS_ID, bracket, locale);

export const translateStatus = (status: unknown, locale: EmailLocale): string =>
    lookup(STATUSES_ID, status, locale);

export const translateAlarmColour = (colour: unknown, locale: EmailLocale): string =>
    lookup(ALARM_COLOURS_ID, colour, locale);

export const translateReason = (reason: unknown, locale: EmailLocale): string =>
    lookup(REASONS_ID, reason, locale);

export const translateSelectionLabel = (label: unknown, locale: EmailLocale): string =>
    lookup(SELECTION_LABELS_ID, label, locale);

export const translatePhase = (phase: unknown, locale: EmailLocale): string =>
    lookup(PHASES_ID, phase, locale);

export const translateDqpPhrase = (phrase: unknown, locale: EmailLocale): string =>
    lookup(DQP_PHRASES_ID, phrase, locale);

/**
 * The finding as the subject and the TEMUAN line name it.
 *
 * `english` is what `getCleanFindings` produced, so an English draft is
 * unchanged and an Indonesian one with no entry for the type still says
 * something rather than nothing.
 */
export const translateFinding = (
    type: unknown,
    english: string,
    locale: EmailLocale
): string => (locale === 'id' ? FINDINGS_ID[String(type)] ?? english : english);

/** Velocity / inverse-velocity units. "mm/h" -> "mm/jam". */
export const translateUnit = (unit: string, locale: EmailLocale): string => {
    if (locale !== 'id') return unit;
    return unit
        .replace(/\bmm\/h\b/g, 'mm/jam')
        .replace(/\bmm\/d\b/g, 'mm/hari')
        .replace(/\bh\/mm\b/g, 'jam/mm')
        .replace(/\bd\/mm\b/g, 'hari/mm');
};

// ---------------------------------------------------------------------------
// The template strings
// ---------------------------------------------------------------------------

export interface EmailStrings {
    /** Subject: "<finding> on <sensor>". */
    on: string;
    /** Subject: "Red and Orange Alarms - ". */
    alarms: (colours: string) => string;

    // Body field labels.
    sensor: string;
    findings: string;
    location: string;
    surfaceArea: string;
    time: string;
    alarmRegions: string;
    issue: string;
    action: string;
    /** The downtime cause picked from a fixed list — "SPESIFIK: Koneksi". */
    reason: string;
    /** The free-text reason on a Scheduled Offline, which reads as a sentence. */
    reasonLong: string;
    alarmRegion: string;
    alarmMask: string;

    // Metric block headers.
    shortVcp: string;
    longVcp: string;
    forecastResult: string;

    // Section rules.
    contextAndNotes: string;
    details: string;
    noNotes: string;

    // The action / notification block.
    notificationMade: (by: string, at: string) => string;
    unreachable: string;
    fallOfGroundRegister: string;
    blastWatch: string;
    forecastCaveat: string;

    // Closings and standing sentences.
    figureLocationAnalysis: string;
    figureAlarmMask: string;
    figureAlarmTab: string;
    dearAll: string;
    kindRegards: string;
    backOnline: (sensor: string) => string;
    siteLocalTime: string;
    willAdviseWhenOnline: string;

    // The DQP "data quality is reliable again" draft.
    serviceNormalSubject: (sensor: string) => string;
    serviceNormalBody: (sensor: string) => string;

    // Post-blast report draft.
    postBlastSensor: string;
    postBlastBlastId: string;
    postBlastSummary: string;
    postBlastLink: (url: string) => string;
    pbRiskStatus: (tarp: string, phase: string) => string;
    pbTransition: (sequence: string) => string;
    pbNoStages: string;
    pbOutlook: (takeaway: string) => string;
    /** Outlook sentences, one per branch of the takeaway. */
    pbActualFailure: (at: string) => string;
    pbForecastError: (method: string, vcp: string, at: string, error: string) => string;
    pbEstimatedFailure: (at: string, method: string, vcp: string) => string;
    pbNoForecast: string;
    pbSettledAfterBlast: (phase: string, duration: string, from: string, to: string) => string;
    pbSettling: (phase: string, over: string) => string;
    pbSettlingOver: (duration: string) => string;
    pbStillLinear: (duration: string) => string;
    pbMonitoredPeriod: string;
}

const EN: EmailStrings = {
    on: 'on',
    alarms: (colours) => `${colours} Alarms - `,

    sensor: 'SENSOR',
    findings: 'FINDINGS',
    location: 'LOCATION',
    surfaceArea: 'SURFACE AREA',
    time: 'TIME',
    alarmRegions: 'ALARM REGION(s)',
    issue: 'ISSUE',
    action: 'ACTION',
    reason: 'REASON',
    reasonLong: 'REASON',
    alarmRegion: 'ALARM REGION',
    alarmMask: 'ALARM MASK',

    shortVcp: 'SHORT VCP',
    longVcp: 'LONG VCP',
    forecastResult: 'Forecast Result',

    contextAndNotes: 'CONTEXT & NOTES',
    details: 'DETAILS',
    noNotes: 'No additional notes provided.',

    notificationMade: (by, at) => `✅ ACTION TAKEN: Notification was made via ${by} at ${at}.`,
    unreachable: '⚠️ ATTENTION: Multiple phone calls have been attempted, however it was unreachable.',
    fallOfGroundRegister: 'ℹ️ REGISTER: This information has been recorded in the DTG client fall of ground register.',
    blastWatch: '⚠️ ATTENTION: Constant close attention to velocity for the next 24hrs.',
    forecastCaveat:
        'ℹ️ NOTE: Slope failure may occur prior to the predicted timeframe, particularly if accelerated by external triggers such as heavy rainfall, blasting activities, or intense machinery operation near the deforming wall. Consequently, the failure forecast will be updated as new data or changing site conditions require.',

    figureLocationAnalysis: 'Figure 1. Location & Analysis',
    figureAlarmMask: 'Figure 1. Alarm Mask Recommendation.',
    figureAlarmTab: 'Figure 1. Alarm Tab.',
    // Carries its own punctuation: the Indonesian greeting takes a comma and the
    // English one is written with a comma in the other DQP draft, so both call
    // sites now use the string verbatim rather than appending one.
    dearAll: 'Dear All,',
    kindRegards: 'Kind regards,',
    backOnline: (sensor) =>
        `This email is to inform you that the ${sensor} is back online and monitoring has resumed.`,
    siteLocalTime: '(site local time)',
    willAdviseWhenOnline: 'DTG engineers will advise when the system is back online.',

    serviceNormalSubject: (sensor) => `Service Operating Normally on ${sensor}`,
    serviceNormalBody: (sensor) =>
        `Please be advised that the data quality on ${sensor} is now reliable for monitoring.\n\nWe will continue to monitor the system and will notify you if any new risks are detected.`,

    postBlastSensor: 'SENSOR',
    postBlastBlastId: 'BLAST ID',
    postBlastSummary: 'SUMMARY:',
    postBlastLink: (url) => `The report can also be accessed from this link (${url})`,
    pbRiskStatus: (tarp, phase) => `Current risk status: ${tarp} — slope classified as ${phase}.`,
    pbTransition: (sequence) => `Slope behaviour transition: ${sequence}`,
    pbNoStages: 'No staged behaviour detected.',
    pbOutlook: (takeaway) => `Outlook: ${takeaway}`,
    pbActualFailure: (at) => `Actual failure occurred at ${at}.`,
    pbForecastError: (method, vcp, at, error) =>
        ` Predicted failure (${method}, ${vcp}) was ${at} — forecast error ${error} h.`,
    pbEstimatedFailure: (at, method, vcp) => `Estimated failure time: ${at} (method: ${method}, ${vcp}).`,
    pbNoForecast: 'Slope is in progressive failure; no forecast time could be computed for the selected VCP.',
    pbSettledAfterBlast: (phase, duration, from, to) =>
        `Slope is ${phase}; settled ${duration} after the blast (${from} → ${to}). No failure time is projected.`,
    pbSettling: (phase, over) => `Slope is ${phase}; estimated to be settling${over}. No failure time is projected.`,
    pbSettlingOver: (duration) => ` over the last ${duration}`,
    pbStillLinear: (duration) =>
        `Slope remains in a linear deformation stage for the last ${duration}. Continue monitoring for any transition to progressive failure.`,
    pbMonitoredPeriod: 'the monitored period'
};

// The Indonesian wording is transcribed from the drafts DTG's Indonesian sites
// already send, so a client sees the phrasing they are used to — including the
// plain sentences that carry no ✅/⚠️/ℹ️ marker.
const ID: EmailStrings = {
    on: 'pada',
    alarms: (colours) => `Alarm ${colours} - `,

    sensor: 'SENSOR',
    findings: 'TEMUAN',
    location: 'LOKASI',
    surfaceArea: 'LUAS AREA',
    time: 'WAKTU',
    alarmRegions: 'REGION ALARM',
    issue: 'ISU',
    action: 'AKSI',
    reason: 'SPESIFIK',
    reasonLong: 'ALASAN',
    alarmRegion: 'REGION ALARM',
    alarmMask: 'ALARM MASK',

    shortVcp: 'VCP PENDEK',
    longVcp: 'VCP PANJANG',
    forecastResult: 'Hasil Prakiraan',

    contextAndNotes: 'KONTEKS & CATATAN',
    details: 'DETAIL',
    noNotes: 'Tidak ada catatan tambahan.',

    notificationMade: (by, at) =>
        `Informasi ini telah disampaikan melalui ${by} pada ${at}.`,
    unreachable:
        'Percobaan telepon kepada tim site telah dilakukan namun belum dapat terhubung.',
    fallOfGroundRegister:
        'Informasi ini telah direcord dalam database Fall of Ground. Mohon informasikan kepada kami jika membutuhkan data/analisis yang lebih detail.',
    blastWatch:
        'Mohon perhatian khusus terhadap velocity selama 24 jam ke depan.',
    forecastCaveat:
        'Catatan: Longsoran dapat terjadi lebih awal dari perkiraan waktu di atas, terutama apabila dipicu faktor eksternal seperti curah hujan tinggi, aktivitas peledakan, atau operasi alat berat di dekat dinding yang terdeformasi. Prakiraan longsoran akan diperbarui seiring bertambahnya data atau perubahan kondisi site.',

    figureLocationAnalysis: 'Gambar 1. Lokasi & Analisis',
    figureAlarmMask: 'Gambar 1. Rekomendasi Alarm Mask.',
    figureAlarmTab: 'Gambar 1. Tab Alarm.',
    dearAll: 'Semangat Pagi,',
    kindRegards: 'Salam,',
    backOnline: (sensor) =>
        `Izin menginformasikan bahwa ${sensor} telah kembali online dan monitoring dapat dilanjutkan.`,
    siteLocalTime: '(waktu lokal site)',
    willAdviseWhenOnline:
        'DTG engineer akan menginformasikan ketika sistem telah kembali online.',

    serviceNormalSubject: (sensor) => `LAYANAN KEMBALI NORMAL pada ${sensor}`,
    serviceNormalBody: (sensor) =>
        `Izin menginformasikan bahwa kualitas data pada ${sensor} telah kembali andal untuk monitoring.\n\nKami akan terus memantau sistem dan menginformasikan apabila terdapat risiko baru.`,

    postBlastSensor: 'SENSOR',
    postBlastBlastId: 'ID PELEDAKAN',
    postBlastSummary: 'RINGKASAN:',
    postBlastLink: (url) => `Laporan ini juga dapat diakses melalui tautan berikut (${url})`,
    pbRiskStatus: (tarp, phase) => `Status risiko saat ini: ${tarp} — lereng terklasifikasi sebagai ${phase}.`,
    pbTransition: (sequence) => `Transisi perilaku lereng: ${sequence}`,
    pbNoStages: 'Tidak terdeteksi perubahan tahapan perilaku.',
    pbOutlook: (takeaway) => `Prognosis: ${takeaway}`,
    pbActualFailure: (at) => `Longsoran aktual terjadi pada ${at}.`,
    pbForecastError: (method, vcp, at, error) =>
        ` Prakiraan longsoran (${method}, ${vcp}) adalah ${at} — deviasi prakiraan ${error} jam.`,
    pbEstimatedFailure: (at, method, vcp) => `Perkiraan waktu longsoran: ${at} (metode: ${method}, ${vcp}).`,
    pbNoForecast:
        'Lereng berada pada tahap longsoran progresif; waktu prakiraan tidak dapat dihitung untuk VCP yang dipilih.',
    pbSettledAfterBlast: (phase, duration, from, to) =>
        `Lereng berada pada kondisi ${phase}; stabil kembali ${duration} setelah peledakan (${from} → ${to}). Tidak ada prakiraan waktu longsoran.`,
    pbSettling: (phase, over) =>
        `Lereng berada pada kondisi ${phase}; diperkirakan sedang menuju stabil${over}. Tidak ada prakiraan waktu longsoran.`,
    pbSettlingOver: (duration) => ` dalam ${duration} terakhir`,
    pbStillLinear: (duration) =>
        `Lereng masih berada pada tahap deformasi linear selama ${duration} terakhir. Mohon lanjutkan monitoring terhadap kemungkinan transisi ke longsoran progresif.`,
    pbMonitoredPeriod: 'periode monitoring'
};

export const emailStrings = (locale: EmailLocale = 'en'): EmailStrings =>
    locale === 'id' ? ID : EN;

/** The BCP-47 tag Intl should use for list joining ("A, B and C"). */
export const intlLocale = (locale: EmailLocale = 'en'): string =>
    locale === 'id' ? 'id' : 'en-AU';
