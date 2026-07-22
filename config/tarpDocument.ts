// tarpDocument.ts
//
// Domain model for a site's TARP document, plus the adapter that turns one into
// a TarpPolicy for the email engine.
//
// The rows in `tarp_triggers` are simultaneously:
//   - what the TARP tab renders and the .xlsx export prints, and
//   - what decides whether an email subject quotes "TARP Trigger N:".
// Keeping both on one row is deliberate: a client's TARP chart and the emails
// they receive cannot drift apart.

import type { TarpPolicy, TarpRule } from './tarpPolicy';
import { TYPE_MATRIX } from './formConfig';

export type TarpColour = 'red' | 'orange' | 'yellow' | 'grey' | 'green';

/** How the site expects DTG to respond when a trigger fires. */
export type TarpResponseMethod = 'call' | 'email' | 'call_then_email' | 'na';

export const RESPONSE_METHOD_LABEL: Record<TarpResponseMethod, string> = {
    call: 'Call',
    email: 'Email only',
    call_then_email: 'Call, then email',
    na: 'No action'
};

export interface TarpTrigger {
    id: number;
    sortOrder: number;
    riskRating: string | null;      // Extreme | Moderate | Intermediate | null
    bandLabel: string | null;       // "TARP Trigger 4 - Red"
    triggerLabel: string;           // "Progressive (accelerating) trend"
    colour: TarpColour | null;
    description: string | null;
    dayShift: string | null;
    nightShift: string | null;
    comments: string[];
    extraNote: string | null;

    /** null = follow the document default. */
    responseMethod: TarpResponseMethod | null;
    /** Optional custom wording shown when this row deviates from the default. */
    responseNotice: string | null;

    // Engine columns
    defType: string | null;         // matches TYPE_MATRIX keys in formConfig.ts
    tarpLevel: number | null;       // 0-4
    requiresAlarm: boolean;
    severityBracket: string | null;
}

export interface TarpContact {
    id: number;
    kind: 'escalation' | 'distribution';
    sortOrder: number;
    name: string | null;
    role: string | null;
    phone: string | null;
    email: string | null;
}

export interface TarpRevision {
    id: number;
    seq: number;
    siteLabel: string | null;
    versionNo: number | null;
    approvalDate: string | null;
    approvedBySite: string | null;
    siteRole: string | null;
    approvedByDtg: string | null;
    dtgRole: string | null;
    modifiedDate: string | null;
    sectionsModified: string | null;
    remark: string | null;
}

export interface TarpDocument {
    id: number;
    siteId: number;
    heading: string | null;
    title: string;
    responseOwner: string;
    version: number;
    status: 'draft' | 'active' | 'superseded';
    effectiveFrom: string | null;
    footerNote: string | null;
    escalationNote: string | null;
    distributionRaw: string | null;
    /** What this site normally expects. DTG standard is a phone call. */
    defaultResponseMethod: TarpResponseMethod;
    /** How this site wants a TARP level stood DOWN. DTG standard is a call. */
    deescalationResponseMethod: TarpResponseMethod;
    deescalationNotice: string | null;
    triggers: TarpTrigger[];
    contacts: TarpContact[];
    revisions: TarpRevision[];
}

/** `"TARP 4"` — the string form the rest of the app still speaks. */
export const tarpLevelLabel = (level: number | null | undefined): string =>
    level === null || level === undefined ? '' : `TARP ${level}`;

const asArray = (value: any): string[] => {
    if (Array.isArray(value)) return value.map(String);
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed.map(String) : [];
        } catch {
            return value.trim() ? [value] : [];
        }
    }
    return [];
};

const bySortOrder = (a: { sortOrder: number }, b: { sortOrder: number }) =>
    a.sortOrder - b.sortOrder;

/**
 * Maps a Supabase row (snake_case, nested selects) onto the domain model.
 * Tolerates missing nested arrays so a partial select still yields a document.
 */
export const normalizeTarpDocument = (row: any): TarpDocument | null => {
    if (!row) return null;

    const triggers: TarpTrigger[] = (row.triggers || row.tarp_triggers || []).map((t: any) => ({
        id: t.id,
        sortOrder: t.sort_order ?? 0,
        riskRating: t.risk_rating ?? null,
        bandLabel: t.band_label ?? null,
        triggerLabel: t.trigger_label ?? '',
        colour: (t.colour ?? null) as TarpColour | null,
        description: t.description ?? null,
        dayShift: t.day_shift ?? null,
        nightShift: t.night_shift ?? null,
        comments: asArray(t.comments),
        extraNote: t.extra_note ?? null,
        responseMethod: (t.response_method ?? null) as TarpResponseMethod | null,
        responseNotice: t.response_notice ?? null,
        defType: t.def_type ?? null,
        tarpLevel: t.tarp_level ?? null,
        requiresAlarm: Boolean(t.requires_alarm),
        severityBracket: t.severity_bracket ?? null
    })).sort(bySortOrder);

    const contacts: TarpContact[] = (row.contacts || row.tarp_contacts || []).map((c: any) => ({
        id: c.id,
        kind: c.kind === 'distribution' ? 'distribution' : 'escalation',
        sortOrder: c.sort_order ?? 0,
        name: c.name ?? null,
        role: c.role ?? null,
        phone: c.phone ?? null,
        email: c.email ?? null
    })).sort(bySortOrder);

    const revisions: TarpRevision[] = (row.revisions || row.tarp_revisions || []).map((r: any) => ({
        id: r.id,
        seq: r.seq ?? 0,
        siteLabel: r.site_label ?? null,
        versionNo: r.version_no ?? null,
        approvalDate: r.approval_date ?? null,
        approvedBySite: r.approved_by_site ?? null,
        siteRole: r.site_role ?? null,
        approvedByDtg: r.approved_by_dtg ?? null,
        dtgRole: r.dtg_role ?? null,
        modifiedDate: r.modified_date ?? null,
        sectionsModified: r.sections_modified ?? null,
        remark: r.remark ?? null
    })).sort((a: TarpRevision, b: TarpRevision) => a.seq - b.seq);

    return {
        id: row.id,
        siteId: row.site_id,
        heading: row.heading ?? null,
        title: row.title ?? 'Radar - Trigger Action Response Plan Chart',
        responseOwner: row.response_owner ?? 'Primary Trigger Response - DTG Engineer',
        version: row.version ?? 1,
        status: row.status ?? 'draft',
        effectiveFrom: row.effective_from ?? null,
        footerNote: row.footer_note ?? null,
        escalationNote: row.escalation_note ?? null,
        distributionRaw: row.distribution_raw ?? null,
        defaultResponseMethod: (row.default_response_method ?? 'call') as TarpResponseMethod,
        deescalationResponseMethod:
            (row.deescalation_response_method ?? 'call') as TarpResponseMethod,
        deescalationNotice: row.deescalation_notice ?? null,
        triggers,
        contacts,
        revisions
    };
};

/**
 * Builds the email-engine policy from a document.
 *
 * The policy is marked `exhaustive`: a deformation type with no row in the
 * client's TARP has no TARP trigger, full stop — it does NOT inherit the DTG
 * default. That is what makes "Regressive: no TARP trigger at all" expressible
 * simply by not listing Regressive in the document.
 */
export const buildPolicyFromDocument = (doc: TarpDocument): TarpPolicy => {
    const rules: Record<string, TarpRule | null> = {};

    for (const trigger of doc.triggers) {
        if (!trigger.defType) continue;
        rules[trigger.defType] = {
            tarp: tarpLevelLabel(trigger.tarpLevel),
            requiresAlarm: trigger.requiresAlarm
        };
    }

    return {
        key: `document:${doc.id}`,
        label: `${doc.heading || 'TARP'} v${doc.version}`,
        rules,
        exhaustive: true,
        documentId: doc.id,
        documentVersion: doc.version
    };
};

/** The trigger row an email/record should cite, if the document has one. */
export const findTriggerForType = (
    doc: TarpDocument | null,
    defType: string
): TarpTrigger | null =>
    doc?.triggers.find(t => t.defType === defType) ?? null;

// ---------------------------------------------------------------------------
// Response method
//
// The DTG standard response is a phone call. A site that has de-escalated a
// specific row to email must not be discovered by reading a paragraph of
// free text at 2am, so the deviation is computed here and surfaced wherever
// the engineer is about to act.
// ---------------------------------------------------------------------------

export interface ResponseRequirement {
    method: TarpResponseMethod;
    label: string;
    /** True when this row departs from the document's own default. */
    deviates: boolean;
    /** Ready-to-display sentence. Empty when there is nothing unusual. */
    notice: string;
}

const DEVIATION_WORDING: Record<TarpResponseMethod, string> = {
    email: 'Email only — do NOT call.',
    call: 'A phone call is required for this trigger.',
    call_then_email: 'Call first, then follow up by email.',
    na: 'No notification required for this trigger.'
};

/**
 * Resolves what the engineer must actually do for a trigger, and whether that
 * differs from the site's normal practice.
 */
export const resolveResponseRequirement = (
    trigger: TarpTrigger | null,
    doc: Pick<TarpDocument, 'defaultResponseMethod'> | null
): ResponseRequirement | null => {
    if (!trigger) return null;

    const fallback: TarpResponseMethod = doc?.defaultResponseMethod ?? 'call';
    const method = trigger.responseMethod ?? fallback;
    const deviates = trigger.responseMethod !== null && trigger.responseMethod !== fallback;

    return {
        method,
        label: RESPONSE_METHOD_LABEL[method],
        deviates,
        notice: deviates ? (trigger.responseNotice || DEVIATION_WORDING[method]) : ''
    };
};

/** Convenience for callers that only hold a deformation type. */
export const responseRequirementForType = (
    doc: TarpDocument | null,
    defType: string
): ResponseRequirement | null =>
    resolveResponseRequirement(findTriggerForType(doc, defType), doc);

// ---------------------------------------------------------------------------
// Escalation / de-escalation
//
// A de-escalation is a movement DOWN the TARP levels — the trend reported as
// Progressive (TARP 4) is now Linear (TARP 3), or a Linear trend has settled to
// Regressive. Standing a level down changes what the crew may do, so the DTG
// default is to phone the site. Some sites want that by email instead.
//
// The ranking is the *nominal* level of the deformation type — what the trend
// is, physically — not the level the email engine finally quotes. Those differ
// whenever a site gates a trigger on an alarm, and a suppressed trigger must
// never read as if the slope had de-escalated.
// ---------------------------------------------------------------------------

/** Nominal TARP level for a deformation type, ignoring any alarm gating. */
export const nominalTarpLevel = (
    defType: string | null | undefined,
    doc: TarpDocument | null = null
): number | null => {
    if (!defType) return null;

    const row = doc?.triggers.find(t => t.defType === defType);
    if (row && row.tarpLevel !== null && row.tarpLevel !== undefined) return row.tarpLevel;

    const fallback = TYPE_MATRIX[defType]?.tarp;
    const match = fallback ? fallback.match(/TARP\s+(\d+)/i) : null;
    return match ? Number(match[1]) : null;
};

export type TarpTransitionDirection = 'escalation' | 'deescalation' | 'unchanged' | 'unknown';

export interface TarpTransition {
    direction: TarpTransitionDirection;
    fromLevel: number | null;
    toLevel: number | null;
    fromType: string | null;
    toType: string | null;
    /** Required response for this transition, e.g. 'email' on a de-escalation. */
    method: TarpResponseMethod;
    label: string;
    /** True when the transition needs a response other than the site's normal one. */
    deviates: boolean;
    /** Ready-to-display sentence, empty when there is nothing unusual. */
    notice: string;
    /** "Progressive → Linear (TARP 4 → TARP 3)" */
    summary: string;
}

const DEESCALATION_WORDING: Record<TarpResponseMethod, string> = {
    email: 'Stand this level down by EMAIL only — do NOT call.',
    call: 'Call the site to stand this TARP level down.',
    call_then_email: 'Call the site to stand this level down, then confirm by email.',
    na: 'No notification required to stand this level down.'
};

/**
 * Compares the prior record(s) against the record being written.
 *
 * @param priorTypes deformation types of the precursor record(s)
 * @param nextType   deformation type of the record being written
 */
export const resolveTarpTransition = (
    priorTypes: (string | null | undefined)[],
    nextType: string | null | undefined,
    doc: TarpDocument | null
): TarpTransition => {
    const priorLevels = priorTypes
        .map(type => ({ type, level: nominalTarpLevel(type, doc) }))
        .filter((entry): entry is { type: string; level: number } =>
            entry.level !== null && Boolean(entry.type));

    // The highest prior level is the one being stood down from.
    const highestPrior = priorLevels.reduce<{ type: string; level: number } | null>(
        (best, entry) => (best === null || entry.level > best.level ? entry : best),
        null
    );

    const toLevel = nominalTarpLevel(nextType, doc);
    const fromLevel = highestPrior?.level ?? null;

    let direction: TarpTransitionDirection = 'unknown';
    if (fromLevel !== null && toLevel !== null) {
        if (toLevel < fromLevel) direction = 'deescalation';
        else if (toLevel > fromLevel) direction = 'escalation';
        else direction = 'unchanged';
    }

    const method: TarpResponseMethod = direction === 'deescalation'
        ? (doc?.deescalationResponseMethod ?? 'call')
        : (doc?.defaultResponseMethod ?? 'call');

    const siteDefault = doc?.defaultResponseMethod ?? 'call';
    const deviates = direction === 'deescalation' && method !== siteDefault;

    const summary = direction === 'unknown'
        ? ''
        : `${highestPrior?.type ?? '—'} → ${nextType ?? '—'} (TARP ${fromLevel} → TARP ${toLevel})`;

    let notice = '';
    if (direction === 'deescalation') {
        notice = doc?.deescalationNotice || DEESCALATION_WORDING[method];
    }

    return {
        direction,
        fromLevel,
        toLevel,
        fromType: highestPrior?.type ?? null,
        toType: nextType ?? null,
        method,
        label: RESPONSE_METHOD_LABEL[method],
        deviates,
        notice,
        summary
    };
};
