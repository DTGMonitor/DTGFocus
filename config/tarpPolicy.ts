// tarpPolicy.ts
//
// Each site runs its own TARP document, so the mapping
//   deformation type -> "TARP Trigger N"
// is a *site* decision, not a global one. This module keeps that mapping in one
// place so a new client only needs a new policy entry, never a change to the
// email/subject/work-log code.
//
// Resolution order for a sensor:
//   1. sensor.tarp_policy / sensor.site?.tarp_policy   (DB column, preferred)
//   2. SITE_TARP_POLICY_OVERRIDES  (hard-coded fallback while the column is empty)
//   3. DEFAULT_TARP_POLICY         (current DTG standard behaviour)

import { TYPE_MATRIX } from './formConfig';

/** Whether the subject keeps the automatic "<colours> Alarms - " prefix. */
export type AlarmPrefixStyle = 'regions' | 'none';

/** DTG standard wording of the subject token. */
export const DEFAULT_SUBJECT_LABEL_TEMPLATE = 'TARP Trigger {level}:';

export interface TarpRule {
    /** TARP trigger assigned to this deformation type, e.g. "TARP 4". */
    tarp: string;
    /**
     * When true the TARP trigger is only assigned if a genuine alarm was
     * triggered. Without an alarm the finding is reported as an observation
     * with no TARP trigger in the subject line.
     */
    requiresAlarm?: boolean;

    /**
     * Wording of the subject token for this row when NO alarm accompanies the
     * record. Null/undefined inherits the document template. See
     * `renderSubjectLabel` for the tokens.
     */
    subjectLabel?: string | null;
    /** Same, for the case where an alarm does accompany the record. */
    subjectLabelAlarm?: string | null;

    /** Band colour of the row, for `{colour}` / `{Colour}`. */
    colour?: string | null;
    /** Band label of the row, for `{band}`. */
    bandLabel?: string | null;
    /** Overrides the derived [CRITICAL] / [MODERATE RISK] bracket. */
    severityBracket?: string | null;
}

export interface TarpPolicy {
    key: string;
    label: string;
    /** Per deformation type. `null` means "never assign a TARP trigger". */
    rules: Record<string, TarpRule | null>;
    /**
     * True for policies built from a site's own TARP document. A type with no
     * rule then has no TARP trigger at all, rather than inheriting the DTG
     * default — the client's document is the complete statement of their TARP.
     */
    exhaustive?: boolean;
    /** Provenance, for auditing which document produced a subject line. */
    documentId?: number;
    documentVersion?: number;
    /**
     * When a rule is suppressed by `requiresAlarm`, should the risk bracket
     * ([MODERATE RISK] / [CRITICAL]) still follow the underlying TARP level?
     * Default false -> the email falls back to [NOTIFICATION ONLY].
     */
    keepSeverityWhenSuppressed?: boolean;

    /**
     * Document-wide wording of the subject token, used by every row that does
     * not override it. Undefined -> DTG standard, `TARP Trigger {level}:`.
     */
    subjectLabelTemplate?: string | null;
    /** Same, for records that carry an alarm. Undefined -> subjectLabelTemplate. */
    subjectLabelTemplateAlarm?: string | null;
    /**
     * Whether the subject still opens with the automatic "Red and Orange
     * Alarms - " prefix built from the selected alarm regions. A site whose
     * token already names the alarm ("Red Alarm:") sets 'none' to avoid saying
     * it twice.
     */
    alarmPrefixStyle?: AlarmPrefixStyle;
}

/**
 * The existing behaviour, derived from TYPE_MATRIX so the two can never drift.
 */
export const DEFAULT_TARP_POLICY: TarpPolicy = {
    key: 'default',
    label: 'DTG Standard',
    rules: Object.entries(TYPE_MATRIX).reduce((acc, [type, cfg]) => {
        acc[type] = cfg.tarp ? { tarp: cfg.tarp } : null;
        return acc;
    }, {} as Record<string, TarpRule | null>)
};

/**
 * Client variant: a TARP trigger is only quoted when the trend is progressive,
 * or when a genuine alarm has been triggered.
 *   Progressive / Linear Accelerating -> TARP 4 with or without an alarm
 *   Linear                            -> TARP 3 only if an alarm triggered
 *   Regressive                        -> never
 *   Blast / Rainfall                  -> never; the site treats them as events
 *                                        to report, not as TARP triggers, so
 *                                        quoting TARP 2 would over-state them
 *                                        (this is the opposite of Telfer, whose
 *                                        document does trigger on them).
 */
export const ALARM_GATED_TARP_POLICY: TarpPolicy = {
    key: 'alarm-gated',
    label: 'TARP trigger for progressive trends or genuine alarms only',
    rules: {
        ...DEFAULT_TARP_POLICY.rules,
        'Progressive': { tarp: 'TARP 4' },
        'Linear Accelerating': { tarp: 'TARP 4' },
        'Linear': { tarp: 'TARP 3', requiresAlarm: true },
        'Regressive': null,
        'Blast Event': null,
        'Rainfall Event': null
    }
};

export const TARP_POLICIES: Record<string, TarpPolicy> = {
    [DEFAULT_TARP_POLICY.key]: DEFAULT_TARP_POLICY,
    [ALARM_GATED_TARP_POLICY.key]: ALARM_GATED_TARP_POLICY
};

/**
 * Fallback map, keyed by lower-cased site name, used until `sites.tarp_policy`
 * is populated. Add a site here to switch it over without a migration.
 */
export const SITE_TARP_POLICY_OVERRIDES: Record<string, string> = {
    // Genesis Minerals - Leonora
    'leonora': ALARM_GATED_TARP_POLICY.key,
};

export const getTarpPolicy = (policyKey?: string | null): TarpPolicy =>
    (policyKey && TARP_POLICIES[policyKey]) || DEFAULT_TARP_POLICY;

export const getTarpPolicyForSensor = (sensor: any): TarpPolicy => {
    const fromDb = sensor?.tarp_policy || sensor?.site?.tarp_policy;
    if (fromDb) return getTarpPolicy(fromDb);

    const siteName = String(sensor?.site_name || '').trim().toLowerCase();
    return getTarpPolicy(SITE_TARP_POLICY_OVERRIDES[siteName]);
};

const getRule = (policy: TarpPolicy, type: string): TarpRule | null => {
    const rule = policy.rules[type];
    // A document-backed policy is complete in itself — no inheriting.
    if (policy.exhaustive) return rule ?? null;
    return rule === undefined ? DEFAULT_TARP_POLICY.rules[type] ?? null : rule;
};

interface ResolveOptions {
    hasAlarm?: boolean;
    policy?: TarpPolicy;
}

/**
 * TARP trigger quoted in the email subject and stored on the record.
 * Returns "" when the policy suppresses the trigger.
 */
export const resolveTarpLevel = (
    type: string,
    { hasAlarm = false, policy = DEFAULT_TARP_POLICY }: ResolveOptions = {}
): string => {
    const rule = getRule(policy, type);
    if (!rule) return '';
    if (rule.requiresAlarm && !hasAlarm) return '';
    return rule.tarp;
};

/**
 * TARP level that drives the risk bracket ([CRITICAL] / [MODERATE RISK]).
 * Identical to `resolveTarpLevel` unless the policy opts to keep the severity
 * bracket after suppressing the trigger label.
 */
export const resolveSeverityTarpLevel = (
    type: string,
    { hasAlarm = false, policy = DEFAULT_TARP_POLICY }: ResolveOptions = {}
): string => {
    const rule = getRule(policy, type);
    if (!rule) return '';
    if (rule.requiresAlarm && !hasAlarm) {
        return policy.keepSeverityWhenSuppressed ? rule.tarp : '';
    }
    return rule.tarp;
};

// ---------------------------------------------------------------------------
// Subject token
//
// Sites do not agree on how a deformation email should announce itself:
//
//   Telfer         [CRITICAL] TARP Trigger 4: Progressive Deformation Trend on …
//   Leonora        same, but the token disappears without a genuine alarm
//   Hidden Valley  [CRITICAL] Red Alarm: …      /  [NOTIFICATION ONLY] Yellow Notification: …
//
// The wording is therefore data on the TARP row, not a literal in the email
// code. A site's own document is the only place it can be changed, so the
// subject a client receives and the chart they signed cannot drift apart.
// ---------------------------------------------------------------------------

const SUBJECT_TOKEN = /\{(level|colour|color|Colour|Color|band)\}/g;

export interface SubjectLabelFacts {
    level: number | null;
    colour?: string | null;
    band?: string | null;
}

const titleCase = (value: string) =>
    value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

/**
 * Fills a subject-token template.
 *
 * A template that asks for a fact the row does not carry renders as nothing at
 * all — "TARP Trigger :" on a row with no level, or "Notification:" on a row
 * with no colour, would be worse than staying silent.
 */
export const renderSubjectLabel = (
    template: string | null | undefined,
    { level, colour, band }: SubjectLabelFacts
): string => {
    if (!template) return '';

    let missing = false;
    const filled = template.replace(SUBJECT_TOKEN, (_match, token: string) => {
        switch (token) {
            case 'level':
                if (level === null || level === undefined) { missing = true; return ''; }
                return String(level);
            case 'colour':
            case 'color':
                if (!colour) { missing = true; return ''; }
                return String(colour).toLowerCase();
            case 'Colour':
            case 'Color':
                if (!colour) { missing = true; return ''; }
                return titleCase(String(colour));
            default:
                if (!band) { missing = true; return ''; }
                return String(band);
        }
    });

    return missing ? '' : filled.replace(/\s+/g, ' ').trim();
};

const levelOf = (tarp: string): number | null => {
    const match = tarp ? tarp.match(/TARP\s+(\d+)/i) : null;
    return match ? Number(match[1]) : null;
};

/**
 * The token this record's email should announce itself with — "TARP Trigger 4:",
 * "Red Alarm:", or "" when the site quotes nothing.
 *
 * Resolution order: the trigger row's own wording, then the document template,
 * then the DTG standard.
 */
export const resolveSubjectLabel = (
    type: string,
    { hasAlarm = false, policy = DEFAULT_TARP_POLICY }: ResolveOptions = {}
): string => {
    const rule = getRule(policy, type);
    if (!rule) return '';
    // A gated row with no alarm is an observation, not a TARP trigger.
    if (rule.requiresAlarm && !hasAlarm) return '';

    const documentDefault = policy.subjectLabelTemplate ?? DEFAULT_SUBJECT_LABEL_TEMPLATE;
    const template = hasAlarm
        ? rule.subjectLabelAlarm ?? rule.subjectLabel
            ?? policy.subjectLabelTemplateAlarm ?? documentDefault
        : rule.subjectLabel ?? documentDefault;

    return renderSubjectLabel(template, {
        level: levelOf(rule.tarp),
        colour: rule.colour,
        band: rule.bandLabel
    });
};

/**
 * Per-row override of the [CRITICAL] / [MODERATE RISK] bracket, or null to let
 * `getWorkLogDetails` derive it from the TARP level as usual.
 */
export const resolveSeverityBracket = (
    type: string,
    { hasAlarm = false, policy = DEFAULT_TARP_POLICY }: ResolveOptions = {}
): string | null => {
    const rule = getRule(policy, type);
    if (!rule) return null;
    if (rule.requiresAlarm && !hasAlarm) return null;
    return rule.severityBracket || null;
};

export const resolveAlarmPrefixStyle = (policy?: TarpPolicy | null): AlarmPrefixStyle =>
    policy?.alarmPrefixStyle ?? 'regions';
