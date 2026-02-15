// formConfig.ts

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
    }
};

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

const getCleanFindings = (type: string) => {
    switch (type) {
        case "Progressive": case "Linear": case "Linear Accelerating": return `${type} Deformation Trend`
        case "Failure": return `${type} Pattern Indication`
        case "Material Detachment": return `${type} Indication`
        case "Forecast": return `Failure ${type}`
        default: return type
    }
}

export const generateEmailSubject = (subject: string, tarp: string, type: any, sensor: string, alarmRegions: any[] = []) => {
    const cleanType = getCleanFindings(type);
    const match = tarp ? tarp.match(/TARP\s+(\d+)/i) : null;
    const tarpTrigger = match ? `TARP Trigger ${match[1]}:` : "";

    let alarmPrefix = "";
    if (alarmRegions && alarmRegions.length > 0) {
        // 1. Get unique types
        const types = Array.from(new Set(alarmRegions.map(r => r.type).filter(Boolean)));

        if (types.length > 0) {
            // 2. Create a formatter for Australian English (or 'en-US', 'en-GB' etc.)
            const formatter = new Intl.ListFormat('en-AU', { style: 'short', type: 'conjunction' });

            // 3. Format the list and append "Alarms"
            // This turns ["Red", "Orange"] into "Red and Orange"
            alarmPrefix = `${formatter.format(types)} Alarms - `;
        }
    }

    // Note: I added a dash separator before cleanType based on typical subject line patterns, 
    // but you can remove the space/dash if you prefer your strict original spacing.
    return `[${subject}] ${alarmPrefix} ${tarpTrigger} ${cleanType} on ${sensor}`.replace(/\s+/g, ' ').trim();
};

export const generateEmailBody = (
    formData: any,
    sensor: string,
    subjectPrefix: string,
    userFullName: string,
    crossChecker: string
) => {
    // 1. HELPER: Format Dates
    const fmt = (dateStr: string) => dateStr ? new Date(dateStr).toLocaleString('en-AU', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false
    }) : "N/A";

    const getVelocityUnit = (vcp: number) => {
        if (vcp < 1440) return 'mm/h';
        return 'mm/d'
    };

    const getInverseUnit = (vcp: number) => {
        if (vcp < 1440) return 'h/mm';
        return 'd/mm'
    };

    // 2. DYNAMIC METRICS BLOCK
    let metricsBlock = "";

    // Case A: Double Failure (Has two sets of velocities)
    if (formData.Type === "Failure") {
        metricsBlock = `
> SHORT VCP
  - Max Velocity (1): ${formData.Vmax1 || "-"} ${getVelocityUnit(formData.VCP1) || "-"}
  - Inv. Velocity (1): ${formData.InverseVelocity1 || "-"} ${getInverseUnit(formData.VCP1)}
  - VCP (1): ${formData.VCP1 || "-"}
  
> LONG VCP
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
> SHORT VCP
  - Inv. Velocity (1): ${formData.InverseVelocity1 || "-"} ${getInverseUnit(formData.VCP1)}
  - VCP (1): ${formData.VCP1 || "-"}
  - Forecast Result (1): ${fmt(formData.ForecastResult1) || "-"}
  
> LONG VCP
  - Inv. Velocity (2): ${formData.InverseVelocity2 || "-"} ${getInverseUnit(formData.VCP2)}
  - VCP (2): ${formData.VCP2 || "-"}
  - Forecast Result (2): ${fmt(formData.ForecastResult2) || "-"}
        `.trim();
    }

    else if (["Forecast"].includes(formData.Type)) {
        metricsBlock = `
> SHORT VCP
  - Inv. Velocity (1): ${formData.InverseVelocity1 || "-"} ${getInverseUnit(formData.VCP1)}
  - VCP (1): ${formData.VCP1 || "-"}
  - Forecast Result (1): ${fmt(formData.ForecastResult1) || "-"}
  
> LONG VCP
  - Inv. Velocity (2): ${formData.InverseVelocity2 || "-"} ${getInverseUnit(formData.VCP2)}
  - VCP (2): ${formData.VCP2 || "-"}
  - Forecast Result (2): ${fmt(formData.ForecastResult2) || "-"}
        `.trim();
    }

    // 3. ACTION / NOTIFICATION BLOCK
    // Change tone based on whether it was a "CRITICAL" subject or just "NOTIFICATION"
    const isCritical = subjectPrefix.includes("CRITICAL") || subjectPrefix.includes("RISK");

    let actionBlock = "";
    if (formData.NotificationTime) {
        actionBlock = `✅ ACTION TAKEN: Notification was made via ${formData.NotificationBy} at ${fmt(formData.NotificationTime)}.`;
    } else {
        // If critical but no notification, add a warning label
        actionBlock = isCritical
            ? '⚠️ ATTENTION: Multiple phone calls have been attempted, however it was unreachable.'
            : `ℹ️ NOTE: This information has been recorded in the DTG client fall of ground register.`;
    }

    let alarmRegionLine = "";

    if (formData.alarmRegions && formData.alarmRegions.length > 0) {
        const formatter = new Intl.ListFormat('en-AU', { style: 'short', type: 'conjunction' });
        const names = Array.from(new Set(formData.alarmRegions.map((r: any) => r.name).filter(Boolean))) as string[];
        alarmRegionLine = `ALARM REGION(s): ${formatter.format(names)}`;
    }

    // 4. ASSEMBLE THE FINAL EMAIL
    return `
SENSOR:       ${sensor}
FINDINGS:     ${getCleanFindings(formData.Type)}
LOCATION:     ${formData.Location}
SURFACE AREA: ${formData.SurfaceArea || "-"} m2
${alarmRegionLine}

${metricsBlock}

CONTEXT & NOTES
--------------------------------------------------
${formData.Notes ? formData.Notes : "No additional notes provided."}

${actionBlock}

DETAILS
--------------------------------------------------

Figure 1. Location & Analysis

Kind regards,
${userFullName} ${crossChecker}
    `.trim();
};

export const generateEmailBodyDQP = (
    formData: any,
    sensor: string,
    userFullName: string,
    crossChecker: string,
    allAlarmRegions: { id: any; name: string }[] = []
) => {
    const getRegionNames = (regionIds: any[]) => {
        if (!regionIds || regionIds.length === 0) return 'N/A';
        return regionIds
            .map(id => allAlarmRegions.find(r => String(r.id) === String(id))?.name)
            .filter(Boolean)
            .join(', ');
    };

    let mainBlock = "";
    let imageBlock = "";

    if (formData.subject === "Additional Alarm Mask Recommendation") {
        mainBlock =
            `
ALARM REGION: ${getRegionNames(formData.alarmRegions)}
ALARM MASK:   ${formData.alarmMask || 'N/A'}`
        imageBlock = `

Figure 1. Alarm Mask Recommendation.`
    }
    else if (formData.subject === "Alarm Since Time Adjustment" || formData.subject === "Alarm Configuration") {
        mainBlock =
            `
ALARM REGION: ${getRegionNames(formData.alarmRegions)}`
        imageBlock = `

Figure 1. Alarm Tab.`
    }
    else {
        mainBlock = ''
        imageBlock = ''
    }

    return `
SENSOR: ${sensor}
ISSUE:  ${formData.issue}
ACTION: ${formData.action}
${mainBlock}

CONTEXT & NOTES
--------------------------------------------------
${formData.notes ? formData.notes : "No additional notes provided."}

${imageBlock}

Kind regards,
            ${userFullName} ${crossChecker}
        `.trim();
};


export const generateEmailBodyOthers = (
    formData: any,
    status: string,
    sensor: string,
    userFullName: string,
    crossChecker: string
) => {
    // 1. HELPER: Format Dates
    const fmt = (dateStr: string) => dateStr ? new Date(dateStr).toLocaleString('en-AU', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false
    }) : "N/A";

    let mainBlock = "";

    if (status === "Live") {
        mainBlock =
            `Dear All

This email is to inform you that the ${sensor} is back online and monitoring has resumed.`
    } else {
        mainBlock =
            `
SENSOR: ${sensor}
ISSUE:  ${status}
TIME:   ${fmt(formData.from)}
REASON: ${formData.reason}
ACTION: ${formData.action}

CONTEXT & NOTES
--------------------------------------------------
${formData.notes ? formData.notes : "No additional notes provided."}`
    }

    return `
${mainBlock}

Kind regards,
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
        "Progressive Deformation Trend", "Linear Deformation Trend",
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
                notes: 'DTG engineers will continue to monitor alarm settings configuration for appropriateness and advise accordingly.'
            },
            {
                value: 'Alarm Configuration',
                label: 'Alarm Configuration Issue',
                issue: 'Alarm Details',
                action: 'Review the current alarm configuration.',
                notes: ''
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
                notes: ''
            }
        ];
    }

    // Case 3: ID 22-26 (DSRA / Service)
    if (id >= 22 && id <= 26) {
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
                notes: 'Weather/atmospheric conditions are significantly impacting data quality. The effectiveness of the radar for risk mitigation may be affected.'
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
                issue: 'The combination of SSR and scan mode does not match with any criteria.',
                action: 'Please review the current location and consider to relocate the radar.',
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
