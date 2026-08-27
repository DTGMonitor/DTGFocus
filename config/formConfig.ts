// formConfig.ts

import {
    emailStrings,
    formatEmailTimestamp,
    intlLocale,
    translateAlarmColour,
    translateBracket,
    translateDqpPhrase,
    translateFinding,
    translateReason,
    translateStatus,
    translateUnit,
    type EmailLocale
} from './emailLocale';

/**
 * Language (and, for Indonesian, the site clock) a draft is written in.
 * Omitted everywhere means English formatted in the browser's clock — exactly
 * what these generators did before the Indonesian sites were added.
 */
export interface EmailDraftOptions {
    locale?: EmailLocale;
    /** The SITE's IANA timezone. Only consulted on the Indonesian path. */
    timeZone?: string | null;
}

// 1. Define all possible fields and their data types (Input types)

interface FieldDefinition {
    label: string;
    type: string;
    step?: string; // The '?' makes it optional
}

export const FIELD_DEFINITIONS: Record<string, FieldDefinition> = {
    // --- Fixed Fields (Yellow in your image) ---
    WallFolderID: { label: "Wall Folder ID", type: "number" },
    Location: { label: "Location", type: "text" },
    Start: { label: "Start / Triggered At", type: "datetime-local" },
    Notes: { label: "Notes", type: "textarea" },
    SiteEngineer: { label: "Site Engineer", type: "text" },
    NotificationTime: { label: "Notification Time", type: "datetime-local" },
    NotificationBy: { label: "Notification By", type: "text" },

    // --- Common Metrics ---
    SurfaceArea: { label: "Surface Area", type: "number", step: "0.1" },
    MaximumDeformation: { label: "Max Deformation", type: "number", step: "0.1" },
    Coherence: { label: "Coherence", type: "number", step: "0.01" },

    // --- Linear Specific ---
    AverageVelocity: { label: "Average Velocity", type: "number", step: "0.1" }, // Specific to Linear
    VCP: { label: "VCP", type: "number", step: "60" }, // Shared by Linear & Progressive

    // --- Progressive Specific ---
    Vmin: { label: "Vmin", type: "number", step: "0.1" }, // Distinct label for Progressive
    Vmax: { label: "Vmax", type: "number", step: "0.1" }, // Distinct label for Progressive

    // --- Failure Specific (The "Double" Set) ---
    Vmax1: { label: "Vmax 1", type: "number", step: "0.1" },
    VCP1: { label: "VCP 1", type: "number", step: "60" },
    Unit1: { label: "Unit 1", type: "text" },

    Vmax2: { label: "Vmax 2", type: "number", step: "0.1" },
    VCP2: { label: "VCP 2", type: "number", step: "60" },
    Unit2: { label: "Unit 2", type: "text" },

    // --- Extras ---
    InverseVelocity1: { label: "Inverse Velocity 1", type: "number", step: "0.01" },
    InverseVelocity2: { label: "Inverse Velocity 2", type: "number", step: "0.01" },
    ForecastResult1: { label: "Forecast Result 1", type: "datetime-local" },
    ForecastResult2: { label: "Forecast Result 2", type: "datetime-local" },
    TypeOfFailure: { label: "Type of Failure", type: "text" },
    Materials: { label: "Materials", type: "text" }
};

// 2. The Matrix: Which fields show up for which Type?
interface TypeConfig {
    tarp: string;
    fields: Array<keyof typeof FIELD_DEFINITIONS>;
}

export const TYPE_MATRIX: Record<string, TypeConfig> = {
    "Failure": {
        tarp: "",
        fields: [
            "MaximumDeformation", "Coherence", "Vmax1", "Vmax2",
            "VCP1", "VCP2", "Unit1", "Unit2", "InverseVelocity1", "InverseVelocity2",
            "TypeOfFailure", "Materials"
        ]
    },
    "Forecast": {
        tarp: "",
        fields: ["VCP1", "VCP2", "InverseVelocity1", "InverseVelocity2", "ForecastResult1", "ForecastResult2"
        ]
    },
    "Progressive": {
        tarp: "TARP 4",
        fields: ["Vmin", "Vmax", "VCP", "Unit1"
        ]
    },
    "Linear Accelerating": {
        tarp: "TARP 4",
        fields: ["Vmin", "Vmax", "VCP", "Unit1"
        ]
    },
    "Linear": {
        tarp: "TARP 3",
        fields: ["AverageVelocity", "VCP", "Unit1"
        ]
    },
    "Regressive": {
        tarp: "TARP 2",
        fields: [
        ]
    },
    "Blast Event": {
        tarp: "TARP 2",
        fields: [
        ]
    },
    "Rapid Movement": {
        tarp: "",
        fields: [
        ]
    },
    "Rock Fall": {
        tarp: "",
        fields: [
        ]
    },
    "Material Detachment": {
        tarp: "",
        fields: [
        ]
    },
    "Rainfall Event": {
        tarp: "TARP 2",
        fields: []
    },
    // Last in the list because it is last on the ranking (see riskDisplay.ts).
    // Carries no TARP trigger: the numbers behind the trend are the thing in
    // doubt, so there is nothing for the site to act on until the interference
    // clears.
    "Data Contamination": {
        tarp: "",
        fields: []
    }
};

/**
 * The type reported when radar data is interfered with — machinery working the
 * face, a truck parked in the beam. Named once, because the form, the subject
 * builder and the risk ranking all have to agree on the exact string.
 */
export const DATA_CONTAMINATION_TYPE = "Data Contamination";

// 3. Helper to get the list of fields
export const getConfigForType = (type: string) => {
    return TYPE_MATRIX[type] || { tarp: '', fields: [] };
};

export const getWorkLogDetails = (tarp: string, notificationTime: string | null) => {
    // Check if notification time exists and isn't just whitespace
    const hasNotification = notificationTime && notificationTime.trim() !== "";

    if (tarp === "Live") {
        return { id: 3, subject: "CONNECTION RESTORED" };
    }

    if (tarp === "Link Down" || tarp === "Lost Connection") {
        return { id: 3, subject: "SERVICE OFFLINE" };
    }

    if (tarp === "TARP 3" && !hasNotification) {
        return { id: 5, subject: "MODERATE RISK" };
    }

    if (tarp === "TARP 4" && !hasNotification) {
        return { id: 6, subject: "CRITICAL" };
    }

    // Default for everything else (including if NotificationTime IS present)
    return { id: 1, subject: "NOTIFICATION ONLY" };
};

const getCleanFindingsEn = (type: string) => {
    switch (type) {
        case "Progressive": case "Linear": case "Linear Accelerating": return `${type} Deformation Trend`
        case "Failure": return `${type} Pattern Indication`
        case "Material Detachment": return `${type} Indication`
        case "Forecast": return `Failure ${type}`
        default: return type
    }
}

/**
 * How the subject and the FINDINGS/TEMUAN line name this deformation type.
 * The English wording is the canonical one; Indonesian falls back to it for any
 * type the dictionary has not been taught.
 */
const getCleanFindings = (type: string, locale: EmailLocale = 'en') =>
    translateFinding(type, getCleanFindingsEn(type), locale);

/**
 * The finding, with the data-contamination caveat where one applies.
 *
 * Contamination is rarely the whole finding: the engineer is reporting a trend
 * whose data they cannot fully vouch for, so both halves have to be said — the
 * shape of the trend, then the caveat. "Linear Deformation Trend with Data
 * Contamination".
 *
 * `contaminatedFrom` is the TREND being qualified, and it is what both reporting
 * routes hand in:
 *
 *   ticked on the trend's own form   type = 'Linear',            from = 'Linear'
 *   raised against an earlier record type = 'Data Contamination', from = 'Linear'
 *
 * Both produce the same sentence, which is the point — the client must not be
 * able to tell which way round the engineer reported it. Contamination raised
 * with nothing to qualify passes `null` and names only itself.
 */
export const composeFinding = (
    type: string,
    locale: EmailLocale = 'en',
    contaminatedFrom?: string | null
) => {
    const self = getCleanFindings(type, locale);
    const trend = String(contaminatedFrom ?? '').trim();
    if (!trend || trend === DATA_CONTAMINATION_TYPE) return self;
    return emailStrings(locale).contaminated(
        getCleanFindings(trend, locale),
        getCleanFindings(DATA_CONTAMINATION_TYPE, locale)
    );
};

export interface EmailSubjectOptions {
    /**
     * The token that names the trigger, resolved from the site's TARP document
     * — "TARP Trigger 4:", "Red Alarm:", or "" to quote nothing. Omit entirely
     * (not "") to fall back to the DTG standard wording derived from `tarp`.
     */
    triggerLabel?: string | null;
    /**
     * 'none' drops the automatic "Red and Orange Alarms - " prefix, for sites
     * whose own token already names the alarm.
     */
    alarmPrefixStyle?: 'regions' | 'none';
    /**
     * Language of the bracket, the finding and the "on"/"pada" connector. The
     * trigger token itself is NOT translated — "TARP Trigger 4:" is how the
     * client's own TARP document names it, in either language.
     */
    locale?: EmailLocale;
    /** The trend a data-contamination caveat qualifies. See `composeFinding`. */
    contaminatedFrom?: string | null;
}

export const generateEmailSubject = (
    subject: string,
    tarp: string,
    type: any,
    sensor: string,
    alarmRegions: any[] = [],
    options: EmailSubjectOptions = {}
) => {
    const locale = options.locale ?? 'en';
    const t = emailStrings(locale);
    const cleanType = composeFinding(type, locale, options.contaminatedFrom);
    const match = tarp ? tarp.match(/TARP\s+(\d+)/i) : null;
    const tarpTrigger = options.triggerLabel ?? (match ? `TARP Trigger ${match[1]}:` : "");

    let alarmPrefix = "";
    if (options.alarmPrefixStyle !== 'none' && alarmRegions && alarmRegions.length > 0) {
        // 1. Get unique types
        const types = Array.from(new Set(alarmRegions.map(r => r.type).filter(Boolean)))
            .map(colour => translateAlarmColour(colour, locale));

        if (types.length > 0) {
            // 2. Create a formatter for Australian English (or 'en-US', 'en-GB' etc.)
            const formatter = new Intl.ListFormat(intlLocale(locale), { style: 'short', type: 'conjunction' });

            // 3. Format the list and append "Alarms"
            // This turns ["Red", "Orange"] into "Red and Orange"
            alarmPrefix = t.alarms(formatter.format(types));
        }
    }

    // Note: I added a dash separator before cleanType based on typical subject line patterns,
    // but you can remove the space/dash if you prefer your strict original spacing.
    return `[${translateBracket(subject, locale)}] ${alarmPrefix} ${tarpTrigger} ${cleanType} ${t.on} ${sensor}`
        .replace(/\s+/g, ' ')
        .trim();
};

/**
 * Subject for the downtime notifications — Link Down, Lost Connection,
 * Scheduled Offline and the Live restoration.
 *
 * Lived inline in two components until Bahasa Indonesia gave it three things to
 * translate. Coming back online is announced without a bracket in Indonesian
 * ("KONEKSI KEMBALI NORMAL pada …"), which is how those sites write it; the
 * English form is unchanged, brackets and all.
 */
export const generateStatusSubject = (
    bracket: string,
    status: string,
    sensor: string,
    locale: EmailLocale = 'en'
) => {
    const t = emailStrings(locale);
    const isRestored = status === 'Live';

    if (locale === 'id' && isRestored) {
        return `${translateBracket(bracket, locale)} ${t.on} ${sensor}`.replace(/\s+/g, ' ').trim();
    }

    const statusText = isRestored ? '' : translateStatus(status, locale);
    return `[${translateBracket(bracket, locale)}] ${statusText} ${t.on} ${sensor}`;
};

/** Subject for a DQP / Action Required draft. */
export const generateDqpSubject = (
    bracket: string,
    dqpSubject: string,
    sensor: string,
    locale: EmailLocale = 'en'
) =>
    `[${translateBracket(bracket, locale)}] ${translateDqpPhrase(dqpSubject, locale)} ${emailStrings(locale).on} ${sensor}`;

export const generateEmailBody = (
    formData: any,
    sensor: string,
    subjectPrefix: string,
    userFullName: string,
    crossChecker: string,
    { locale = 'en', timeZone }: EmailDraftOptions = {}
) => {
    const t = emailStrings(locale);

    // 1. HELPER: Format Dates
    const fmt = (dateStr: string) => formatEmailTimestamp(dateStr, { locale, timeZone });

    const getVelocityUnit = (vcp: number) => {
        if (vcp < 1440) return translateUnit('mm/h', locale);
        return translateUnit('mm/d', locale)
    };

    const getInverseUnit = (vcp: number) => {
        if (vcp < 1440) return translateUnit('h/mm', locale);
        return translateUnit('d/mm', locale)
    };

    // 2. DYNAMIC METRICS BLOCK
    let metricsBlock = "";

    // Case A: Double Failure (Has two sets of velocities)
    if (formData.Type === "Failure") {
        metricsBlock = `

> ${t.shortVcp}
  - Max Velocity (1): ${formData.Vmax1 || "-"} ${getVelocityUnit(formData.VCP1) || "-"}
  - Inv. Velocity (1): ${formData.InverseVelocity1 || "-"} ${getInverseUnit(formData.VCP1)}
  - VCP (1): ${formData.VCP1 || "-"}

> ${t.longVcp}
  - Max Velocity (2): ${formData.Vmax2 || "-"} ${getVelocityUnit(formData.VCP2) || "-"}
  - Inv. Velocity (2): ${formData.InverseVelocity2 || "-"} ${getInverseUnit(formData.VCP2)}
  - VCP (2): ${formData.VCP2 || "-"}

  `.trim();
    }
    // Case B: Progressive / Linear Acc (Has Min & Max)
    else if (["Progressive", "Linear Accelerating"].includes(formData.Type)) {
        metricsBlock = `

  - Vmin: ${formData.Vmin || "-"} ${getVelocityUnit(formData.VCP) || "-"}
  - Vmax: ${formData.Vmax || "-"} ${getVelocityUnit(formData.VCP) || "-"}
  - VCP:  ${formData.VCP || "-"}
        
  `.trim();
    }
    // Case C: Standard (Linear, etc.)
    else if (["Linear"].includes(formData.Type)) {
        metricsBlock = `

  - Velocity: ${formData.AverageVelocity || "-"} ${getVelocityUnit(formData.VCP) || "-"}
  - VCP: ${formData.VCP || "-"}
        
  `.trim();
    }

    else if (["Forecast"].includes(formData.Type)) {
        metricsBlock = `

> ${t.shortVcp}
  - Inv. Velocity (1): ${formData.InverseVelocity1 || "-"} ${getInverseUnit(formData.VCP1)}
  - VCP (1): ${formData.VCP1 || "-"}
  - ${t.forecastResult} (1): ${fmt(formData.ForecastResult1) || "-"}

> ${t.longVcp}
  - Inv. Velocity (2): ${formData.InverseVelocity2 || "-"} ${getInverseUnit(formData.VCP2)}
  - VCP (2): ${formData.VCP2 || "-"}
  - ${t.forecastResult} (2): ${fmt(formData.ForecastResult2) || "-"}

  `.trim();
    }

    // 3. ACTION / NOTIFICATION BLOCK
    // Change tone based on whether it was a "CRITICAL" subject or just "NOTIFICATION"
    const isCritical = subjectPrefix.includes("CRITICAL") || subjectPrefix.includes("RISK");
    const isFallofGround = formData.Type === "Failure" || formData.Type === "Rock Fall" || formData.Type === "Material Detachment";
    const isBlast = formData.Type === "Blast Event";

    let actionBlock = "";
    if (formData.NotificationTime) {
        actionBlock = t.notificationMade(formData.NotificationBy, fmt(formData.NotificationTime));
    } else {
        // If critical but no notification, add a warning label
        actionBlock = isCritical
            ? t.unreachable
            : isFallofGround
                ? t.fallOfGroundRegister
                : isBlast
                    ? t.blastWatch
                    : '';
    }

    // Standing caveat appended to every failure forecast notification.
    const forecastNote = formData.Type === "Forecast" ? t.forecastCaveat : '';

    let alarmRegionLine = "";

    if (formData.alarmRegions && formData.alarmRegions.length > 0) {
        const formatter = new Intl.ListFormat(intlLocale(locale), { style: 'short', type: 'conjunction' });
        const names = Array.from(new Set(formData.alarmRegions.map((r: any) => r.name).filter(Boolean))) as string[];
        alarmRegionLine = `${t.alarmRegions}: ${formatter.format(names)}`;
    }

    let timeEventLine = "";
    timeEventLine = isBlast || isFallofGround
        ? `${t.time}: ${fmt(formData.Start)}`
        : '';

    // The label column is padded to the widest label so the values line up in a
    // monospaced mail client — the widest label differs per language.
    const pad = (label: string, width: number) => `${label}:`.padEnd(width + 2);
    const width = Math.max(t.sensor.length, t.findings.length, t.location.length, t.surfaceArea.length);

    // 4. ASSEMBLE THE FINAL EMAIL
    return `
${pad(t.sensor, width)}${sensor}
${pad(t.findings, width)}${composeFinding(formData.Type, locale, formData.ContaminatedFrom)}
${pad(t.location, width)}${formData.Location}
${pad(t.surfaceArea, width)}${formData.SurfaceArea || "-"} m2
${timeEventLine}
${alarmRegionLine}
${metricsBlock}

${t.contextAndNotes}
--------------------------------------------------
${formData.Notes ? formData.Notes : t.noNotes}
${forecastNote ? `\n${forecastNote}\n` : ""}
${actionBlock}

${t.details}
--------------------------------------------------

${t.figureLocationAnalysis}

${t.kindRegards}
${userFullName} ${crossChecker}
    `.trim();
};

export const generateEmailBodyDQP = (
    formData: any,
    sensor: string,
    userFullName: string,
    crossChecker: string,
    allAlarmRegions: { id: any; name: string }[] = [],
    { locale = 'en' }: EmailDraftOptions = {}
) => {
    const t = emailStrings(locale);
    const noRegions = locale === 'id' ? 'Tidak ada' : 'N/A';

    const getRegionNames = (regionIds: any[]) => {
        if (!regionIds || regionIds.length === 0) return noRegions;
        return regionIds
            .map(id => allAlarmRegions.find(r => String(r.id) === String(id))?.name)
            .filter(Boolean)
            .join(', ');
    };

    // Region/mask labels share a column, as do sensor/issue/action above them.
    const mainWidth = Math.max(t.alarmRegion.length, t.alarmMask.length);
    const headWidth = Math.max(t.sensor.length, t.issue.length, t.action.length);
    const pad = (label: string, width: number) => `${label}:`.padEnd(width + 2);

    let mainBlock = "";
    let imageBlock = "";

    // The subject is matched on its ENGLISH key: it is the stored value, and the
    // translation happens on the way out, not on the way in.
    if (formData.subject === "Additional Alarm Mask Recommendation") {
        mainBlock =
            `
${pad(t.alarmRegion, mainWidth)}${getRegionNames(formData.alarmRegions)}
${pad(t.alarmMask, mainWidth)}${formData.alarmMask || noRegions}`
        imageBlock = `

${t.figureAlarmMask}`
    }
    else if (formData.subject === "Alarm Since Time Adjustment" || formData.subject === "Alarm Configuration") {
        mainBlock =
            `
${pad(t.alarmRegion, mainWidth)}${getRegionNames(formData.alarmRegions)}`
        imageBlock = `

${t.figureAlarmTab}`
    }
    else {
        mainBlock = ''
        imageBlock = ''
    }

    return `
${pad(t.sensor, headWidth)}${sensor}
${pad(t.issue, headWidth)}${translateDqpPhrase(formData.issue, locale)}
${pad(t.action, headWidth)}${translateDqpPhrase(formData.action, locale)}
${mainBlock}

${t.contextAndNotes}
--------------------------------------------------
${formData.notes ? translateDqpPhrase(formData.notes, locale) : t.noNotes}
${formData.tempnotes ? translateDqpPhrase(formData.tempnotes, locale) : ""}

${imageBlock}

${t.kindRegards}
            ${userFullName} ${crossChecker}
        `.trim();
};


export const generateEmailBodyOthers = (
    formData: any,
    status: string,
    sensor: string,
    userFullName: string,
    crossChecker: string,
    { locale = 'en', timeZone }: EmailDraftOptions = {}
) => {
    const t = emailStrings(locale);

    // 1. HELPER: Format Dates
    const fmt = (dateStr: string) => formatEmailTimestamp(dateStr, { locale, timeZone });

    const width = Math.max(t.sensor.length, t.issue.length, t.time.length, t.reason.length, t.action.length);
    const pad = (label: string) => `${label}:`.padEnd(width + 2);

    let mainBlock = "";

    if (status === "Live") {
        mainBlock =
            `${t.dearAll}

${t.backOnline(sensor)}`
    } else {
        mainBlock =
            `
${pad(t.sensor)}${sensor}
${pad(t.issue)}${translateStatus(status, locale)}
${pad(t.time)}${fmt(formData.from)}
${pad(t.reason)}${translateReason(formData.reason, locale)}
${pad(t.action)}${formData.action}

${t.contextAndNotes}
--------------------------------------------------
${formData.notes ? formData.notes : t.noNotes}`
    }

    return `
${mainBlock}

${t.kindRegards}
            ${userFullName} ${crossChecker}
        `.trim();
};

/**
 * The Scheduled Offline notification.
 *
 * A notification only — nothing is recorded against the sensors, because the
 * outage is planned from the DTG side and has not happened yet. The window is
 * quoted as a plain "HH:mm-HH:mm (site local time)" range: the client reads it
 * against their own clock, and a full timestamp on a window that may be moved
 * reads as a commitment it is not.
 *
 * @param sensorLabel  How the selection is named, WITHOUT the site suffix —
 *   "All Radars", or the radar numbers when only some are going offline.
 */
export const generateEmailBodyScheduledOffline = (
    sensorLabel: string,
    from: string,
    to: string,
    reason: string,
    userFullName: string,
    crossChecker: string,
    { locale = 'en' }: EmailDraftOptions = {}
) => {
    const t = emailStrings(locale);
    return `
${t.sensor}: ${sensorLabel}
${t.time}: ${from}-${to} ${t.siteLocalTime}

${t.reasonLong}: ${translateReason(reason, locale)}

${t.willAdviseWhenOnline}

${t.kindRegards}
${userFullName} ${crossChecker}
    `.trim();
};

export const CAUSE_OPTIONS = {
    False: [
        "Machinery Activity", "Rapid Atmospheric Changes", "Rainfall Event",
        "Riling Material", "Vegetation", "Pushed Material", "Water Refraction",
        "Sandstorm Event", "Blasting Event", "Diurnal Pattern", "Wire Mesh",
        "Mine Facility", "Step After Link Down"
    ],
    Valid: [
        "Failure Pattern Indication", "Slip Pattern Indication",
        "Material Detachment Indication", "Rock Fall", "Rapid Movement",
        "Progressive Deformation Trend", "Linear Accelerating Trend", "Linear Deformation Trend",
        "Regressive Deformation Trend"
    ]
};

// NEW: Dynamic Subject Generator
// config/formConfig.js or .ts

export const getSubjectOptions = (parameter: any) => {
    if (!parameter) return [];

    const { id, name } = parameter;

    // Case 1: ID 20 (Alarms)
    if (id === 20) {
        return [
            {
                value: 'Alarm Since Time Adjustment',
                label: 'Alarm Since Time Adjustment',
                issue: 'Deformation Alarm Details',
                action: 'Adjustment of the `Since Time` metric proposed by DTG Engineer — awaiting confirmation from site engineer before implementation.',
                notes: '',
                tempnotes: 'DTG engineers will continue to monitor alarm settings configuration for appropriateness and advise accordingly.'
            },
            {
                value: 'Alarm Configuration',
                label: 'Alarm Configuration Issue',
                issue: 'Alarm Details',
                action: 'Review the current alarm configuration.',
                notes: '',
                tempnotes: 'DTG engineers will continue to monitor alarm settings configuration for appropriateness and advise accordingly.'
            },
        ];
    }

    // Case 2: ID 21 (Alarm Mask)
    if (id === 21) {
        return [
            {
                value: 'Additional Alarm Mask Recommendation',
                label: 'Additional Alarm Mask Recommendation',
                issue: 'Excessive Unwanted Alarms',
                action: 'As per the alarm mask recommendation.',
                notes: '',
                tempnotes: 'DTG engineers will continue to monitor alarm settings configuration for appropriateness and advise accordingly.'
            }
        ];
    }

    // Case 3: ID 22-26 (DSRA / Service) — also matched by name so the
    // Rainfall → "Service Impacted" flow works regardless of the exact
    // Refractivity parameter id in the database.
    if ((id >= 22 && id <= 26) || (typeof name === 'string' && name.toLowerCase().includes('refractivity'))) {
        return [
            {
                value: 'DSRA Relocation',
                label: 'DSRA Relocation',
                issue: 'Optimisation of atmospheric correction',
                action: 'DSRA Relocation',
                notes: ''
            },
            {
                value: 'Service Impacted',
                label: 'Service Impacted',
                issue: 'Significant impact on data quality',
                action: 'Apply additional site controls as required.',
                notes: 'Weather/atmospheric conditions are significantly impacting data quality. The effectiveness of the radar for risk mitigation may be affected.'
            }
        ];
    }

    if (id === 10) {
        return [
            {
                value: `${name} Issue`,
                label: `${name} Issue`,
                issue: 'The combination of SSR and scan mode does not match with any criteria.',
                action: 'Please review the current location and consider to relocate the radar.',
                notes: ''
            }
        ];
    }

    if (id === 12) {
        return [
            {
                value: `${name} Issue`,
                label: `${name} Issue`,
                issue: 'Several parts of the scan area are considered unnecessary and can be trimmed.',
                action: 'Please review the current scan area and consider trimming the unnecessary area.',
                notes: ''
            }
        ];
    }

    // Case 4: Default (Allow manual entry)
    return [
        {
            value: `${name} Issue`,
            label: `${name} Issue`,
            issue: `${name} Issue`,
            action: '',
            notes: ''
        }
    ];
};
