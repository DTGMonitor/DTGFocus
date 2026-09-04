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

/**
 * Whether the subject keeps the automatic "<colours> Alarms - " prefix.
 *
 *   'regions'       always, the DTG standard
 *   'none'          never
 *   'if-different'  only when the alarm that fired is a different colour from
 *                   the band the row sits in. For sites whose token names a
 *                   colour, where the two agreeing would say it twice.
 *                   See `resolveAlarmPrefixStyle`.
 */
export type AlarmPrefixStyle = 'regions' | 'none' | 'if-different';

/**
 * Which row decides the TARP level a record is reported at.
 *
 *   'trigger' (the DTG standard, and every site up to now)
 *     The deformation row's own level. A progressive trend is TARP 4 because
 *     the trend is progressive; an alarm is a separate row that can demand a
 *     phone call but never changes the number.
 *
 *   'alarm'
 *     The alarm row that fired, matched on its colour. Sites whose bands are
 *     velocity and displacement thresholds work this way round: the alarm says
 *     how fast the slope is moving and the deformation type says what shape the
 *     trend is, so a progressive trend on an orange alarm is TARP 3, not TARP 4.
 *     With no alarm no threshold was breached, so the record carries no TARP
 *     trigger at all and reports as an observation.
 */
export type TarpLevelSource = 'trigger' | 'alarm';

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

    /** Which row decides the level. Undefined -> 'trigger', the DTG standard. */
    tarpLevelSource?: TarpLevelSource;
    /**
     * The document's alarm rows, keyed by lower-cased colour. Only read when
     * `tarpLevelSource` is 'alarm'; that is the map the fired alarm is looked
     * up in.
     */
    alarmRules?: Record<string, TarpRule>;
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
    /** Colours of the alarm regions ticked, e.g. ['Red', 'Orange']. */
    alarmColours?: (string | null | undefined)[];
    policy?: TarpPolicy;
}

const normaliseColour = (value: string | null | undefined): string =>
    String(value ?? '').trim().toLowerCase();

/** Highest level wins, so two alarms at once are answered by the worse of them. */
const mostSevereRule = (rules: TarpRule[]): TarpRule | null =>
    rules.reduce<TarpRule | null>(
        (best, rule) =>
            best === null || (levelOf(rule.tarp) ?? -1) > (levelOf(best.tarp) ?? -1) ? rule : best,
        null
    );

/**
 * The alarm row that fired.
 *
 * With no colour to go on — the engineer has ticked Alarm but not yet chosen a
 * region — the most severe row stands, because erring towards the higher level
 * is the only safe direction to err in. A colour the document lists no row for
 * yields null: that alarm is not in this client's TARP. Mirrors
 * `findAlarmTrigger` in tarpDocument.ts, which answers the same question for
 * the response method.
 */
const matchAlarmRule = (
    policy: TarpPolicy,
    alarmColours: (string | null | undefined)[] = []
): TarpRule | null => {
    const byColour = policy.alarmRules ?? {};
    const all = Object.values(byColour);
    if (all.length === 0) return null;

    const wanted = new Set(alarmColours.map(normaliseColour).filter(Boolean));
    if (wanted.size === 0) return mostSevereRule(all);

    const matched = Object.entries(byColour)
        .filter(([colour]) => wanted.has(colour))
        .map(([, rule]) => rule);
    return matched.length > 0 ? mostSevereRule(matched) : null;
};

/**
 * The row that decides this record's level, subject token and risk bracket.
 *
 * Normally the deformation row. Where the site's levels ARE its alarm
 * thresholds it is the alarm row that fired instead — but the deformation row
 * still has to exist, because a type absent from the client's TARP has no
 * trigger however loud the alarm.
 */
const governingRule = (
    policy: TarpPolicy,
    type: string,
    { hasAlarm = false, alarmColours = [] }: ResolveOptions
): TarpRule | null => {
    const typeRule = getRule(policy, type);
    if (!typeRule) return null;
    if (policy.tarpLevelSource !== 'alarm') return typeRule;
    // No alarm means no threshold was breached, so there is nothing to quote.
    if (!hasAlarm) return null;
    return matchAlarmRule(policy, alarmColours);
};

/**
 * TARP trigger quoted in the email subject and stored on the record.
 * Returns "" when the policy suppresses the trigger.
 */
export const resolveTarpLevel = (
    type: string,
    { hasAlarm = false, alarmColours = [], policy = DEFAULT_TARP_POLICY }: ResolveOptions = {}
): string => {
    const rule = governingRule(policy, type, { hasAlarm, alarmColours });
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
    { hasAlarm = false, alarmColours = [], policy = DEFAULT_TARP_POLICY }: ResolveOptions = {}
): string => {
    const rule = governingRule(policy, type, { hasAlarm, alarmColours });
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

const SUBJECT_TOKEN =
    /\{(level|alarmColour|alarmColor|AlarmColour|AlarmColor|colour|color|Colour|Color|band)\}/g;

export interface SubjectLabelFacts {
    level: number | null;
    colour?: string | null;
    band?: string | null;
    /**
     * Colour of the alarm that actually fired, for `{AlarmColour}`.
     *
     * Deliberately NOT the same fact as `colour`. That one is the band the
     * matched row sits in — a linear trend's row is orange whatever fired
     * alongside it — so "Orange Alarm:" over a red alarm reads as though the
     * quieter alarm was the one that went off. Where the site names its bands
     * rather than numbering them, the alarm has to name itself.
     */
    alarmColour?: string | null;
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
    { level, colour, band, alarmColour }: SubjectLabelFacts
): string => {
    if (!template) return '';

    let missing = false;
    const filled = template.replace(SUBJECT_TOKEN, (_match, token: string) => {
        switch (token) {
            case 'level':
                if (level === null || level === undefined) { missing = true; return ''; }
                return String(level);
            case 'alarmColour':
            case 'alarmColor':
                if (!alarmColour) { missing = true; return ''; }
                return String(alarmColour).toLowerCase();
            case 'AlarmColour':
            case 'AlarmColor':
                if (!alarmColour) { missing = true; return ''; }
                return titleCase(String(alarmColour));
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
 * Alarm colours worst-first, for the case where two regions are ticked at once.
 *
 * The same relative order as RISK_ORDER in config/riskDisplay.ts, restated here
 * rather than imported: that module is presentation and this one is the email
 * engine, and a colour the list does not know sorts last instead of first.
 */
const ALARM_COLOUR_ORDER = ['red', 'orange', 'yellow', 'grey', 'green'];

const alarmColourRank = (colour: string): number => {
    const index = ALARM_COLOUR_ORDER.indexOf(colour);
    return index === -1 ? ALARM_COLOUR_ORDER.length : index;
};

/**
 * The colour to quote for an alarm that fired — "Red" in "Red Alarm:".
 *
 * The alarm ROW's colour first, so the subject names a band the client's own
 * chart carries an alarm row for, and so two regions at once are answered by
 * the row the document itself ranks highest. Where the document lists no such
 * row the region still fired, and its own colour is the honest thing to print
 * rather than dropping the token.
 *
 * Distinct from `rule.colour`, which is the band the DEFORMATION row sits in.
 * See SubjectLabelFacts.alarmColour.
 */
const firedAlarmColour = (
    policy: TarpPolicy,
    alarmColours: (string | null | undefined)[]
): string | null => {
    const fromRow = matchAlarmRule(policy, alarmColours)?.colour;
    if (fromRow) return normaliseColour(fromRow);

    const ticked = alarmColours.map(normaliseColour).filter(Boolean);
    if (ticked.length === 0) return null;
    return ticked.reduce((worst, colour) =>
        alarmColourRank(colour) < alarmColourRank(worst) ? colour : worst);
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
    { hasAlarm = false, alarmColours = [], policy = DEFAULT_TARP_POLICY }: ResolveOptions = {}
): string => {
    // Where the alarm governs, the token is the alarm row's — its level, its
    // colour, its band label — so the subject names the band the client's own
    // chart puts that alarm in.
    const rule = governingRule(policy, type, { hasAlarm, alarmColours });
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
        band: rule.bandLabel,
        // Only a record that actually carries an alarm can name one. A no-alarm
        // template that asks for {AlarmColour} renders as nothing, which is the
        // same silence every other unanswerable token produces.
        alarmColour: hasAlarm ? firedAlarmColour(policy, alarmColours) : null
    });
};

/**
 * What `generateEmailSubject` is actually told to do. 'if-different' is a
 * document setting, not an instruction — it has to be answered against a
 * record before the subject can be built.
 */
export type ResolvedAlarmPrefix = 'regions' | 'none';

/**
 * Whether this record's subject opens with "Orange Alarms - ".
 *
 * A subject has two slots and they answer different questions:
 *
 *   prefix   which alarm fired
 *   token    what severity the record is reported at
 *
 * They only collide where the TOKEN already names a colour, because then a red
 * alarm on a red band says red twice. 'if-different' is that de-duplication and
 * nothing more: the prefix is dropped only when the token already names every
 * colour the prefix would have listed.
 *
 * The test is against the rendered token, not against the row's band colour.
 * Those are different questions — Telfer's row IS red and its token is
 * "TARP Trigger 4:", which says nothing about red, so a red alarm there still
 * earns its prefix. Comparing colours would have silently swallowed it.
 *
 * Answered as 'regions' whenever the comparison cannot be made — no record, no
 * alarm, no token. Showing the prefix can only repeat a fact; hiding it can
 * lose one.
 */
export const resolveAlarmPrefixStyle = (
    policy?: TarpPolicy | null,
    context?: Pick<ResolveOptions, 'hasAlarm' | 'alarmColours'> & { type?: string }
): ResolvedAlarmPrefix => {
    const style = policy?.alarmPrefixStyle ?? 'regions';
    if (style !== 'if-different') return style;

    if (!policy || !context?.type || !context.hasAlarm) return 'regions';

    const alarmColours = context.alarmColours ?? [];
    const ticked = alarmColours.map(normaliseColour).filter(Boolean);
    if (ticked.length === 0) return 'regions';

    const token = resolveSubjectLabel(context.type, {
        hasAlarm: true, alarmColours, policy
    }).toLowerCase();
    if (!token) return 'regions';

    // EVERY colour, not any: a red-and-orange prefix beside an "Orange
    // Notification" token still has to report the red one.
    return ticked.every(colour => token.includes(colour)) ? 'none' : 'regions';
};
