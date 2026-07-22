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

export interface TarpRule {
    /** TARP trigger assigned to this deformation type, e.g. "TARP 4". */
    tarp: string;
    /**
     * When true the TARP trigger is only assigned if a genuine alarm was
     * triggered. Without an alarm the finding is reported as an observation
     * with no TARP trigger in the subject line.
     */
    requiresAlarm?: boolean;
}

export interface TarpPolicy {
    key: string;
    label: string;
    /** Per deformation type. `null` means "never assign a TARP trigger". */
    rules: Record<string, TarpRule | null>;
    /**
     * When a rule is suppressed by `requiresAlarm`, should the risk bracket
     * ([MODERATE RISK] / [CRITICAL]) still follow the underlying TARP level?
     * Default false -> the email falls back to [NOTIFICATION ONLY].
     */
    keepSeverityWhenSuppressed?: boolean;
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
        'Blast Event': { tarp: 'TARP 2', requiresAlarm: true },
        'Rainfall Event': { tarp: 'TARP 2', requiresAlarm: true }
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
