// Map Parent ID -> Email Template Details
// Define your templates first, grouping IDs together
const TEMPLATE_GROUPS = [
    {
        // Atmospheric Correction Group
        ids: [22, 23, 24, 25, 26], // Add all related children IDs here
        content: {
            subject: "[NOTIFICATION ONLY] DSRA Relocation on",
            issue: "Optimisation of atmospheric correction",
            action: "DSRA Relocation"
        }
    },
    {
        // Alarm Adjustment Group
        ids: [20],
        content: {
            subject: "[ACTION REQUIRED] Alarm Since Time Adjustment on",
            issue: "Deformation Alarm Details",
            action: "Adjustment of the 'Since Time' metric proposed by DTG Engineer — awaiting confirmation from site engineer before implementation.",
            alarmregion: "",
            cause: ""
        }
    },
    {
        // Alarm Masks Group
        ids: [21, 6], // Maybe parent 'Alarms' (6) shares this too?
        content: {
            subject: "[ACTION REQUIRED] Additional Alarm Mask Recommendation on",
            issue: "Excessive Unwanted Alarms",
            action: "As per the alarm mask recommendation.",
            alarmregion: "",
            cause: "",
            alarmmask: ""
        }
    }
];

// The Default Template
const DEFAULT_TEMPLATE = {
    subject: "[UPDATE] Sensor Configuration Change on",
    issue: "General parameter adjustment",
    action: "Review and Monitor"
};

// Automatically build the lookup object
const EMAIL_TEMPLATES = TEMPLATE_GROUPS.reduce((acc, group) => {
    // For every ID in the array, assign the same content
    group.ids.forEach(id => {
        acc[id] = group.content;
    });
    return acc;
}, { default: DEFAULT_TEMPLATE }); // Start with default

export const generateEmailDraft = (siteName, parentId, noteText) => {
    const template = EMAIL_TEMPLATES[parentId] || EMAIL_TEMPLATES.default;

    const subject = `${template.subject} ${siteName}`;
    const body = `
SENSOR: ${siteName}
ISSUE: ${template.issue}
ACTION REQUEST: ${template.action}
NOTES: ${noteText || "No additional notes provided."}

DTG engineers will monitor performance closely and implement further adjustments as necessary.
    `.trim();

    return { subject, body };
};