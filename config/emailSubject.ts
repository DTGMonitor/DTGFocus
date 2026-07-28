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

import { generateEmailSubject, getWorkLogDetails } from './formConfig';
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
}

export interface DeformationSubject {
    /** The finished subject line. */
    subject: string;
    /**
     * CRITICAL / MODERATE RISK / … as derived from the TARP level, which is the
     * tone the body is written in. The subject may instead show the row's
     * `severity_bracket` override; the body deliberately follows the risk.
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
    notificationTime = null
}: DeformationSubjectInput): DeformationSubject => {
    const activePolicy = policy || DEFAULT_TARP_POLICY;
    const hasAlarm = alarmRegions.length > 0;

    const tarpLevel = resolveTarpLevel(type, { hasAlarm, policy: activePolicy });
    const severityTarp = resolveSeverityTarpLevel(type, { hasAlarm, policy: activePolicy });

    const logDetails = getWorkLogDetails(severityTarp, notificationTime);
    const bracket =
        resolveSeverityBracket(type, { hasAlarm, policy: activePolicy }) || logDetails.subject;
    const triggerLabel = resolveSubjectLabel(type, { hasAlarm, policy: activePolicy });

    const subject = generateEmailSubject(bracket, tarpLevel, type, sensor, alarmRegions, {
        triggerLabel,
        alarmPrefixStyle: resolveAlarmPrefixStyle(activePolicy)
    });

    return {
        subject,
        bracket: logDetails.subject,
        triggerLabel,
        tarpLevel,
        workLogSubjectId: logDetails.id
    };
};
