// emailSubject.ts
//
// One place where a deformation record becomes an email subject line.
//
// Three things vary per site and all three are answered by that site's TARP
// document, never by this code:
//
//   Telfer         [CRITICAL] TARP Trigger 4: Progressive Deformation Trend on R01 - Telfer
//   Leonora        [NOTIFICATION ONLY] Linear Deformation Trend on R01 - Leonora
//                  (the trigger is quoted only when a genuine alarm fired)
//   Hidden Valley  [CRITICAL] Red Alarm: Progressive Deformation Trend on R01 - Hidden Valley
//                  [NOTIFICATION ONLY] Yellow Notification: Linear Deformation Trend on …
//
// Both the deformation form and the TARP tab's preview call this, so what an
// engineer reviews on the chart is exactly what the client receives.

import { DATA_CONTAMINATION_TYPE, generateEmailSubject, getWorkLogDetails } from './formConfig';
import type { EmailLocale } from './emailLocale';
import {
    DEFAULT_TARP_POLICY,
    resolveAlarmPrefixStyle,
    resolveSeverityBracket,
    resolveSeverityTarpLevel,
    resolveSubjectLabel,
    resolveTarpLevel,
    type TarpPolicy
} from './tarpPolicy';

export interface DeformationSubjectInput {
    /** Deformation type, a TYPE_MATRIX key. */
    type: string;
    /** "R01 - Leonora". */
    sensor: string;
    /** Alarm regions the engineer ticked; presence is what "has an alarm" means. */
    alarmRegions?: { type?: string | null; name?: string | null }[];
    policy?: TarpPolicy | null;
    /** A notification time downgrades the risk bracket, as it always has. */
    notificationTime?: string | null;
    /** Language of the subject line. Defaults to English. */
    locale?: EmailLocale;
    /**
     * The trend a data-contamination caveat qualifies — 'Linear' for a linear
     * trend whose data is interfered with. Null when the finding carries no
     * caveat, which is every record but the contaminated ones.
     */
    contaminatedFrom?: string | null;
}

export interface DeformationSubject {
    /** The finished subject line. */
    subject: string;
    /**
     * CRITICAL / MODERATE RISK / … as derived from the TARP level, which is the
     * tone the body is written in. The subject may instead show the row's
     * `severity_bracket` override; the body deliberately follows the risk.
     *
     * Always the ENGLISH wording, in every locale: it is a key, read by the body
     * generator to decide the tone and by the work log to pick its row. Only the
     * subject line carries the translated form.
     */
    bracket: string;
    /** "TARP Trigger 4:", "Red Alarm:", or "" when the site quotes nothing. */
    triggerLabel: string;
    /** TARP level to store on the record; "" when the policy suppresses it. */
    tarpLevel: string;
    /** work_logs.subject foreign key. */
    workLogSubjectId: number;
}

export const composeDeformationSubject = ({
    type,
    sensor,
    alarmRegions = [],
    policy,
    notificationTime = null,
    locale = 'en',
    contaminatedFrom = null
}: DeformationSubjectInput): DeformationSubject => {
    const activePolicy = policy || DEFAULT_TARP_POLICY;
    const hasAlarm = alarmRegions.length > 0;
    // Which alarm fired, not merely that one did: a site whose bands are
    // velocity thresholds reads its level off the colour, so an orange alarm on
    // a progressive trend is TARP 3. See TarpLevelSource.
    const alarmColours = alarmRegions.map(region => region?.type);
    const facts = { hasAlarm, alarmColours, policy: activePolicy };

    // A contaminated finding is reported at the Data Contamination row's level,
    // never the trend's. The trend may well be there, but its numbers are the
    // thing in doubt — quoting TARP Trigger 3 would ask the site to act on a
    // reading DTG has just said it cannot vouch for. The trend still keeps its
    // own level on its own record; this governs only what the DRAFT quotes.
    const reportedType = contaminatedFrom ? DATA_CONTAMINATION_TYPE : type;

    const tarpLevel = resolveTarpLevel(reportedType, facts);
    const severityTarp = resolveSeverityTarpLevel(reportedType, facts);

    const logDetails = getWorkLogDetails(severityTarp, notificationTime);
    const bracket = resolveSeverityBracket(reportedType, facts) || logDetails.subject;
    const triggerLabel = resolveSubjectLabel(reportedType, facts);

    // `type` — not `reportedType` — still names the finding: the wording is the
    // one thing that must carry both halves.
    const subject = generateEmailSubject(bracket, tarpLevel, type, sensor, alarmRegions, {
        triggerLabel,
        alarmPrefixStyle: resolveAlarmPrefixStyle(activePolicy),
        locale,
        contaminatedFrom
    });

    return {
        subject,
        bracket: logDetails.subject,
        triggerLabel,
        tarpLevel,
        workLogSubjectId: logDetails.id
    };
};
