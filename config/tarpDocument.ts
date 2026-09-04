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

import type { AlarmPrefixStyle, TarpLevelSource, TarpPolicy, TarpRule } from './tarpPolicy';
import { DEFAULT_SUBJECT_LABEL_TEMPLATE } from './tarpPolicy';
import { TYPE_MATRIX } from './formConfig';

export type TarpColour = 'red' | 'orange' | 'yellow' | 'grey' | 'green';

/**
 * How the site expects DTG to respond when a trigger fires.
 *
 * `call_then_email` is no longer offered as a CHOICE — a site whose rule is
 * "every call is followed by an email summary" says so once, in its footer, not
 * on every row. It stays in the type because `inferResponseMethod` still reads
 * it out of the shift cells that name both, and a value the engine can produce
 * is a value the chart has to be able to print.
 */
export type TarpResponseMethod = 'call' | 'email' | 'whatsapp' | 'call_then_email' | 'na';

export const RESPONSE_METHOD_LABEL: Record<TarpResponseMethod, string> = {
    call: 'Call',
    email: 'Email only',
    whatsapp: 'WhatsApp only',
    call_then_email: 'Call, then email',
    na: 'No action'
};

/** The methods an engineer may pick. See TarpResponseMethod for the omission. */
export const SELECTABLE_RESPONSE_METHODS: TarpResponseMethod[] =
    ['call', 'email', 'whatsapp', 'na'];

export interface TarpTrigger {
    id: number;
    sortOrder: number;
    /**
     * The row axis of a matrix-layout chart — "Pola Deformasi", "Koneksi Data".
     * Null on the one-row-per-trigger charts, which have no such axis. See
     * utils/tarpImport.js and migration 011.
     */
    parameter: string | null;
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

    // Engine columns
    defType: string | null;         // matches TYPE_MATRIX keys in formConfig.ts
    tarpLevel: number | null;       // 0-4
    requiresAlarm: boolean;

    /**
     * Subject token wording for this row. Null inherits the document template.
     * `subjectLabel` applies when no alarm accompanies the record,
     * `subjectLabelAlarm` when one does. Tokens: {level} {colour} {Colour} {band}.
     */
    subjectLabel: string | null;
    subjectLabelAlarm: string | null;
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
    /**
     * How this site's emails announce a trigger. DTG standard quotes the TARP
     * number; sites that name their bands instead put their own wording here.
     */
    subjectLabelTemplate: string;
    subjectLabelTemplateAlarm: string | null;
    alarmPrefixStyle: AlarmPrefixStyle;
    /**
     * Whether a record's TARP level comes from its deformation row or from the
     * alarm that fired. See TarpLevelSource — a site whose bands are velocity
     * thresholds reports a progressive trend on an orange alarm as TARP 3.
     */
    tarpLevelSource: TarpLevelSource;
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
        parameter: t.parameter ?? null,
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
        defType: t.def_type ?? null,
        tarpLevel: t.tarp_level ?? null,
        requiresAlarm: Boolean(t.requires_alarm),
        subjectLabel: t.subject_label ?? null,
        subjectLabelAlarm: t.subject_label_alarm ?? null
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
        subjectLabelTemplate: row.subject_label_template ?? DEFAULT_SUBJECT_LABEL_TEMPLATE,
        subjectLabelTemplateAlarm: row.subject_label_template_alarm ?? null,
        alarmPrefixStyle: (row.alarm_prefix_style ?? 'regions') as AlarmPrefixStyle,
        tarpLevelSource: (row.tarp_level_source ?? 'trigger') as TarpLevelSource,
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

    const asRule = (trigger: TarpTrigger): TarpRule => ({
        tarp: tarpLevelLabel(trigger.tarpLevel),
        requiresAlarm: trigger.requiresAlarm,
        // Carried so the subject can quote the row's own band wording.
        subjectLabel: trigger.subjectLabel,
        subjectLabelAlarm: trigger.subjectLabelAlarm,
        colour: trigger.colour,
        bandLabel: trigger.bandLabel
    });

    for (const trigger of doc.triggers) {
        if (!trigger.defType) continue;
        rules[trigger.defType] = asRule(trigger);
    }

    // The alarm rows, keyed by colour, so a site whose levels are alarm
    // thresholds can be answered by the alarm that actually fired. Built for
    // every document — it costs nothing and `tarpLevelSource` decides whether
    // anything reads it.
    const alarmRules: Record<string, TarpRule> = {};
    for (const trigger of doc.triggers) {
        if (!trigger.requiresAlarm || trigger.defType || !trigger.colour) continue;
        const colour = trigger.colour.toLowerCase();
        const existing = alarmRules[colour];
        // Two rows of one colour: the more severe stands, as findAlarmTrigger does.
        if (existing && (existing.tarp ? Number(existing.tarp.replace(/\D/g, '')) : -1)
            >= (trigger.tarpLevel ?? -1)) continue;
        alarmRules[colour] = asRule(trigger);
    }

    return {
        key: `document:${doc.id}`,
        label: `${doc.heading || 'TARP'} v${doc.version}`,
        rules,
        exhaustive: true,
        documentId: doc.id,
        documentVersion: doc.version,
        subjectLabelTemplate: doc.subjectLabelTemplate,
        subjectLabelTemplateAlarm: doc.subjectLabelTemplateAlarm,
        alarmPrefixStyle: doc.alarmPrefixStyle,
        tarpLevelSource: doc.tarpLevelSource,
        alarmRules
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
    /** The row this answer came from — the alarm row when an alarm fired. */
    trigger: TarpTrigger | null;
    /** True when a fired alarm's row demands more than the deformation row. */
    alarmOverride: boolean;
}

const DEVIATION_WORDING: Record<TarpResponseMethod, string> = {
    email: 'Email only — do NOT call.',
    call: 'A phone call is required for this trigger.',
    whatsapp: 'WhatsApp message only — do NOT call.',
    call_then_email: 'Call first, then follow up by email.',
    na: 'No notification required for this trigger.'
};

const NO_ACTION_RE = /^\s*(na|n\/a|none|no action(\s+required)?|tidak ada( tindakan)?)\s*\.?\s*$/i;
/**
 * Indonesian spellings are matched too, and both spellings of "telephone" that
 * turn up in the field. A chart that says "Telfon Geotek, WhatsApp, Email semua
 * kontak" names a phone call FIRST; reading only the English would have seen
 * nothing but the word "Email" and printed EMAIL ONLY beside a row that requires
 * a call.
 */
const CALL_RE = /\b(call|calls|called|calling|phone|phoned|ring|telfon|telpon|telepon|menelepon|hubungi|menghubungi)\b/i;
const EMAIL_RE = /\b(e-?mail|e-?mails|e-?mailed|e-?mailing)\b/i;
/**
 * Read ONLY when the cell names no call and no email.
 *
 * The Indonesian charts say "Telfon Geotek, WhatsApp, Email semua kontak" —
 * WhatsApp is listed alongside a phone call there, not instead of one, and that
 * cell must keep resolving to a call. So WhatsApp answers a cell that names
 * nothing else, and never downgrades one that does.
 */
const WHATSAPP_RE = /\b(whats\s?app|wa\s+(?:message|group|blast)|chat)\b/i;

/**
 * The response a shift cell *states*, or null when the prose names none.
 *
 * `response_method` is the structural answer (migration 004) but it was
 * backfilled by matching the seeded wording, so any row phrased differently —
 * "Site Geotech to email DTG monitoring engineers" — kept a NULL. NULL nominally
 * means "follow the document default", and on a call-first site that printed
 * CALL beside a cell that says email. Reading the cell is strictly better than
 * asserting the site default over the top of the text the client signed.
 */
export const inferResponseMethod = (
    text: string | null | undefined
): TarpResponseMethod | null => {
    const value = String(text ?? '').trim();
    if (!value) return null;
    if (NO_ACTION_RE.test(value)) return 'na';

    const call = CALL_RE.test(value);
    const email = EMAIL_RE.test(value);
    if (call && email) return 'call_then_email';
    if (call) return 'call';
    if (email) return 'email';
    if (WHATSAPP_RE.test(value)) return 'whatsapp';
    return null;
};

/**
 * Resolves what the engineer must actually do for a trigger, and whether that
 * differs from the site's normal practice.
 *
 * Order: the row's own column, then what its day-shift cell says, then the
 * document default. Only the last of those is a guess, and a guess never
 * counts as a deviation.
 */
export const resolveResponseRequirement = (
    trigger: TarpTrigger | null,
    doc: Pick<TarpDocument, 'defaultResponseMethod'> | null
): ResponseRequirement | null => {
    if (!trigger) return null;

    const fallback: TarpResponseMethod = doc?.defaultResponseMethod ?? 'call';
    const stated = trigger.responseMethod ?? inferResponseMethod(trigger.dayShift);
    const method = stated ?? fallback;
    const deviates = stated !== null && stated !== fallback;

    return {
        method,
        label: RESPONSE_METHOD_LABEL[method],
        deviates,
        notice: deviates ? DEVIATION_WORDING[method] : '',
        trigger,
        alarmOverride: false
    };
};

// ---------------------------------------------------------------------------
// Alarm rows
//
// A TARP chart states an alarm as a trigger in its own right — "Red Alarm",
// "Orange Alarm" — with no deformation type against it, because an alarm fires
// on top of whatever trend is being reported. `findTriggerForType` can never
// reach those rows, so a record carrying a genuine alarm was answered by the
// trend row alone: at Leonora that printed EMAIL ONLY over a red alarm the
// same chart says to phone in.
// ---------------------------------------------------------------------------

/** How much a response asks of the engineer. Used to pick the stronger of two. */
const RESPONSE_STRENGTH: Record<TarpResponseMethod, number> = {
    na: 0,
    // A chat message reaches a phone, but it is not a record and not an
    // answered call — it asks less of the engineer than an email does.
    whatsapp: 1,
    email: 2,
    call: 3,
    call_then_email: 4
};

export interface ResponseContext {
    /** True when a genuine alarm accompanies the record. */
    hasAlarm?: boolean;
    /** Colours of the alarm regions ticked, e.g. ['Red', 'Orange']. */
    alarmColours?: (string | null | undefined)[];
}

/** Rows the document gates on an alarm and pins to no deformation type. */
export const alarmTriggers = (doc: TarpDocument | null): TarpTrigger[] =>
    (doc?.triggers ?? []).filter(t => t.requiresAlarm && !t.defType);

const normaliseColour = (value: string | null | undefined): string =>
    String(value ?? '').trim().toLowerCase();

/** Highest TARP level wins; ties keep the order the chart lists them in. */
const mostSevere = (rows: TarpTrigger[]): TarpTrigger | null =>
    rows.reduce<TarpTrigger | null>(
        (best, row) =>
            best === null || (row.tarpLevel ?? -1) > (best.tarpLevel ?? -1) ? row : best,
        null
    );

/**
 * The alarm row that fired, matched on the colour of the regions ticked.
 *
 * With no colour to go on — the engineer has ticked Alarm but not yet chosen a
 * region — the most severe alarm row stands, because erring towards the row
 * that asks for a call is the only safe direction to err in. A colour the
 * document lists no alarm row for yields null: that alarm is not in this
 * client's TARP, so it cannot override what the trend row says.
 */
export const findAlarmTrigger = (
    doc: TarpDocument | null,
    alarmColours: (string | null | undefined)[] = []
): TarpTrigger | null => {
    const rows = alarmTriggers(doc);
    if (rows.length === 0) return null;

    const wanted = new Set(alarmColours.map(normaliseColour).filter(Boolean));
    const colourCoded = rows.filter(row => normaliseColour(row.colour));
    if (wanted.size === 0 || colourCoded.length === 0) return mostSevere(rows);

    const matched = colourCoded.filter(row => wanted.has(normaliseColour(row.colour)));
    return matched.length > 0 ? mostSevere(matched) : null;
};

/**
 * What the engineer must do for a record of this type, given whether an alarm
 * came with it.
 *
 * Both rows can fire at once — a linear trend that also raised a red alarm is
 * the linear row AND the red alarm row — so the record owes the more demanding
 * of the two responses. A site that de-escalated plain linear trends to email
 * did not thereby de-escalate its alarms.
 */
export const responseRequirementForType = (
    doc: TarpDocument | null,
    defType: string,
    context: ResponseContext = {}
): ResponseRequirement | null => {
    const typeRow = findTriggerForType(doc, defType);
    const typeRequirement = resolveResponseRequirement(typeRow, doc);
    if (!context.hasAlarm) return typeRequirement;

    const alarmRow = findAlarmTrigger(doc, context.alarmColours);
    const alarmRequirement = resolveResponseRequirement(alarmRow, doc);
    if (!alarmRequirement) return typeRequirement;
    if (!typeRequirement) return alarmRequirement;

    if (RESPONSE_STRENGTH[alarmRequirement.method]
        <= RESPONSE_STRENGTH[typeRequirement.method]) {
        return typeRequirement;
    }

    const alarmLabel = alarmRow?.triggerLabel || 'The alarm';
    const typeLabel = typeRow?.triggerLabel || defType;

    return {
        ...alarmRequirement,
        alarmOverride: true,
        notice: alarmRequirement.notice
            || `${DEVIATION_WORDING[alarmRequirement.method]} ${alarmLabel} is a trigger in `
               + `its own right — the ${typeLabel} row applies only without an alarm.`
    };
};

// ---------------------------------------------------------------------------
// Who the draft is addressed to
//
// Most TARP rows are a promise to the client: the engineer emails the site. A
// few are not. Blast and rainfall rows exist so DTG can watch a slope respond to
// something it already knows happened, and the charts that carry them say so —
// "Email DTG Internal". Those must never open a draft addressed to the mine:
// the site did not ask to be told that we are looking, and a blast notification
// landing in the pit's inbox reads as a hazard call that nobody made.
//
// The row's own wording decides. Anything else — a per-site flag, a hard-coded
// list of deformation types — would drift the moment a client signs a revision,
// which is the whole reason the chart is data.
// ---------------------------------------------------------------------------

/** The Outlook group every DTG workstation resolves for internal notices. */
export const DTG_INTERNAL_GROUP = 'DTG Engineers';

/**
 * True when a shift cell says the email goes to DTG rather than to the client.
 *
 * Matched on the recipient, not the sender: "Site Geotech to email DTG
 * monitoring engineers" is still an email whose audience is DTG. Rows that name
 * a call are excluded — a call is a client-facing response by definition, and a
 * row that says "Call Geotech" has not de-escalated to an internal note however
 * it goes on to phrase the follow-up.
 */
const DTG_AUDIENCE_RE = /\bdtg\b|\binternal(ly)?\b/i;

export const namesInternalAudience = (
    text: string | null | undefined
): boolean => {
    const value = String(text ?? '').trim();
    if (!value) return false;
    if (CALL_RE.test(value)) return false;
    return EMAIL_RE.test(value) && DTG_AUDIENCE_RE.test(value);
};

/** True when a shift cell asks for anything the client is meant to receive. */
const namesClientAudience = (text: string | null | undefined): boolean => {
    const value = String(text ?? '').trim();
    if (!value || NO_ACTION_RE.test(value)) return false;
    if (CALL_RE.test(value)) return true;
    return EMAIL_RE.test(value) && !DTG_AUDIENCE_RE.test(value);
};

export interface DraftAudience {
    /** mailto "To". */
    to: string;
    /** mailto "Cc". Empty string means send no CC at all. */
    cc: string;
    /** True when the row addressed DTG itself rather than the client. */
    internal: boolean;
}

/**
 * Recipients for the draft a trigger produces.
 *
 * `siteGroup` is the client's own Outlook group, used for every normal row with
 * DTG copied in. An internal row inverts that: DTG is the only recipient and
 * there is no CC, because the one party who must not receive it is the party
 * the CC would otherwise reach.
 *
 * Pass the trigger `responseRequirementForType` resolved, not the deformation
 * row directly — when an alarm fires that answer is the alarm row, and an alarm
 * is a client-facing trigger in its own right. A blast that also raised a red
 * alarm is a phone call to the mine, not an internal note.
 *
 * A row whose two shifts disagree stays client-facing. Withholding an email the
 * chart promised the site is the worse of the two mistakes.
 */
export const resolveDraftAudience = (
    trigger: TarpTrigger | null,
    siteGroup: string
): DraftAudience => {
    const shifts = [trigger?.dayShift, trigger?.nightShift];
    const internal = shifts.some(namesInternalAudience)
        && !shifts.some(namesClientAudience);

    return internal
        ? { to: DTG_INTERNAL_GROUP, cc: '', internal: true }
        : { to: siteGroup, cc: DTG_INTERNAL_GROUP, internal: false };
};

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
    whatsapp: 'Stand this level down by WhatsApp only — do NOT call.',
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
