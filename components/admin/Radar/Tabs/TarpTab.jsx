import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Spinner } from '@/components/Reusable/Spinner';
import EditModal from '@/components/admin/Radar/shared/EditModal';
import ConfirmDialog from '@/components/admin/Radar/shared/ConfirmDialog';
import TarpChart from '@/components/admin/Radar/Tarp/TarpChart';
import TarpImportModal from '@/components/admin/Radar/Tarp/TarpImportModal';
import {
  fetchTarpDocumentById,
  fetchTarpDocumentsForSite,
  useTarpDocument,
  useTarpVersions,
} from '@/components/admin/Radar/Tarp/useTarpDocument';
import { downloadTarpAllVersionsXlsx, downloadTarpXlsx } from '@/utils/tarpXlsx';
import { toContactImportPayload, toImportPayload } from '@/utils/tarpImport';
import { TYPE_MATRIX } from '@/config/formConfig';
import {
  RESPONSE_METHOD_LABEL,
  SELECTABLE_RESPONSE_METHODS,
  buildPolicyFromDocument,
  inferResponseMethod,
} from '@/config/tarpDocument';
import { DEFAULT_SUBJECT_LABEL_TEMPLATE, renderSubjectLabel } from '@/config/tarpPolicy';
import { composeDeformationSubject } from '@/config/emailSubject';
import { resolveTarpLocale, tarpStrings, translateDocumentText } from '@/config/tarpLocale';
import toast from 'react-hot-toast';
import {
  Copy, Download, FileText, History, Layers, Plus, Save, Trash2, Pencil, Undo2, Upload,
} from 'lucide-react';

/**
 * TarpTab
 *
 * Shows the site's active TARP document, lets an engineer amend the trigger
 * rows and both contact lists, and exports the whole thing as
 * `DTG Radar TARP - <Company>_DDMMYYYY.xlsx`.
 *
 * Editing never mutates the version in force. Changes are held locally and
 * committed by `tarp_save_revision`, which writes a complete new version plus
 * its DOCUMENT CONTROL entry in one transaction.
 *
 * Because no version is ever overwritten, every one of them can still be read:
 * the version picker loads any of them, and Export all versions writes the whole
 * chain as one workbook. An archived version is shown READ-ONLY — amending it
 * would mean branching a controlled document, and the row that drives an email
 * is always the one in force.
 *
 * An Indonesian site's chart and workbook are rendered in Bahasa Indonesia
 * (config/tarpLocale.ts). The document itself is not translated: the editing
 * surface, the subject preview and the email engine all keep reading the English
 * rows, so what an engineer amends here is what the inbox will quote.
 *
 * Props:
 *   sensor    {object} - needs `site_id` and `site_name`
 *   userSite  {object} - supplies the DTG engineer name for the revision row
 *   activeTab {string} - re-fetches when this becomes 'tarp'
 *   timezone  {string} - the SITE's IANA zone; decides the chart's language
 */

const DEF_TYPE_OPTIONS = [
  { value: '', label: '— None: a descriptive row (alarms, connection) —' },
  ...Object.keys(TYPE_MATRIX).map((type) => ({ value: type, label: type })),
];

const COLOUR_OPTIONS = ['red', 'orange', 'yellow', 'grey', 'green'].map((c) => ({
  value: c,
  label: c.charAt(0).toUpperCase() + c.slice(1),
}));

/**
 * The chart's left-hand column.
 *
 * Was free text, which the workbook then colour-fills and merges by matching the
 * string exactly — so "extreme" or a trailing space silently cost a row both.
 * The list is the vocabulary already in use across every seeded site, plus the
 * two more that config/tarpLocale.ts translates for imported charts.
 */
const RISK_RATING_VALUES = ['Extreme', 'High', 'Moderate', 'Intermediate', 'Low'];

const RISK_RATING_OPTIONS = [
  { value: '', label: '— None: this row carries no risk band —' },
  ...RISK_RATING_VALUES.map((value) => ({ value, label: value })),
];

/**
 * A client's own wording is never lost to a dropdown: a stored rating outside
 * the standard list is offered back as its own option.
 */
const riskRatingOptions = (values) => {
  const current = values.riskRating;
  return current && !RISK_RATING_VALUES.includes(current)
    ? [...RISK_RATING_OPTIONS, { value: current, label: `${current} (this document's wording)` }]
    : RISK_RATING_OPTIONS;
};

const TARP_LEVEL_OPTIONS = [
  { value: '', label: '— None: this row carries no TARP level —' },
  ...[0, 1, 2, 3, 4].map((n) => ({ value: String(n), label: `TARP ${n}` })),
];

/**
 * What an engineer may pick. `call_then_email` is deliberately absent — a site
 * whose rule is "every call is followed by an email" states that once in its
 * footer, not on every row. It is still offered back on a row that already
 * resolves to it, so opening such a row and saving cannot silently downgrade
 * what the client's chart says today.
 */
const RESPONSE_OPTIONS = [
  { value: '', label: '— Follow the document default —' },
  ...SELECTABLE_RESPONSE_METHODS.map((value) => ({
    value,
    label: RESPONSE_METHOD_LABEL[value],
  })),
];

const responseOptions = (values) =>
  values.responseMethod === 'call_then_email'
    ? [...RESPONSE_OPTIONS, {
      value: 'call_then_email',
      label: `${RESPONSE_METHOD_LABEL.call_then_email} (as this row reads today)`,
    }]
    : RESPONSE_OPTIONS;

/**
 * What each token means, in words, for the site-wide fields where there is no
 * one row to resolve them against. The per-row fields say more than this — see
 * `subjectTokenValues`, which shows what each one becomes on the row on screen.
 */
const SUBJECT_TOKEN_HINT =
  'Tokens: {band} the row\'s TARP band ("Red Notification", "TARP Trigger 4 - Red"), '
  + '{level} its TARP number, {Colour} its band colour, '
  + '{AlarmColour} the colour of the alarm that fired. '
  + 'A token the row cannot answer drops the whole wording, which is how rows '
  + 'that sit in no band stay silent.';

/** An example alarm, so the alarm wording can be previewed at all. */
const EXAMPLE_ALARM_COLOUR = 'red';

const capitalise = (value) =>
  value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

/** The facts a row offers the token renderer, read off the form as it stands. */
const subjectFactsFor = (values, alarmColour = null) => ({
  level: values.tarpLevel === '' || values.tarpLevel === undefined
    ? null
    : Number(values.tarpLevel),
  colour: values.colour || null,
  band: values.bandLabel || null,
  alarmColour,
});

/**
 * Every token spelled out against THIS row — "{band} → “Red Notification”" —
 * so the wording box is read rather than guessed at. A token the row cannot
 * answer says so, because that is the case that silently empties a subject.
 */
const subjectTokenValues = (values) => {
  const facts = subjectFactsFor(values);
  return [
    ['{band}', facts.band],
    ['{level}', facts.level === null || Number.isNaN(facts.level) ? null : String(facts.level)],
    ['{Colour}', facts.colour ? capitalise(facts.colour) : null],
  ]
    .map(([token, value]) => `${token} → ${value ? `“${value}”` : 'nothing on this row'}`)
    .join('   ');
};

/** "Red Notification:" — what the subject will actually open with. */
const renderedToken = (template, values, alarmColour = null) => {
  const rendered = renderSubjectLabel(template, subjectFactsFor(values, alarmColour));
  return rendered ? `“${rendered}”` : 'no wording at all';
};

const subjectLabelHelp = (values) => {
  const siteWording = values._subjectLabelTemplate || DEFAULT_SUBJECT_LABEL_TEMPLATE;
  const template = values.subjectLabel?.trim() || siteWording;
  return `Blank follows the site wording, “${siteWording}”. `
    + `This row opens with ${renderedToken(template, values)}.   `
    + subjectTokenValues(values);
};

const subjectLabelAlarmHelp = (values) => {
  const siteWording = values._subjectLabelTemplateAlarm
    || values._subjectLabelTemplate || DEFAULT_SUBJECT_LABEL_TEMPLATE;
  // The same fallback chain resolveSubjectLabel walks, so the preview cannot
  // disagree with the email.
  const template = values.subjectLabelAlarm?.trim() || values.subjectLabel?.trim() || siteWording;
  return `Blank follows the wording above, then the site's. `
    + `With a ${EXAMPLE_ALARM_COLOUR} alarm this row opens with `
    + `${renderedToken(template, values, EXAMPLE_ALARM_COLOUR)}.   `
    + `{AlarmColour} → “${capitalise(EXAMPLE_ALARM_COLOUR)}” for that alarm.`;
};

const ALARM_PREFIX_OPTIONS = [
  { value: 'regions', label: 'Yes — prefix with the alarm colours, e.g. "Red and Orange Alarms - "' },
  { value: 'none', label: 'No — the trigger wording already names the alarm' },
  {
    value: 'if-different',
    label: 'Only when the alarm is a different colour from the row\'s band'
      + ' — for charts whose wording already names a colour',
  },
];

/**
 * The TARP number inside a band label — "TARP Trigger 4 - Red" yields 4.
 *
 * Every band label across every seeded site carries its own number, which is
 * what makes the level derivable at all. A site that names its bands without one
 * simply never matches, and the level stays the engineer's to set.
 */
const BAND_LEVEL_RE = /TARP\s+(?:Trigger\s+)?([0-4])\b/i;

const levelFromBand = (bandLabel) => {
  const match = BAND_LEVEL_RE.exec(bandLabel || '');
  return match ? match[1] : '';
};

/** True when the level on screen is exactly the one the band label states. */
const levelMatchesBand = (values) => {
  const derived = levelFromBand(values.bandLabel);
  return Boolean(derived) && String(values.tarpLevel) === derived;
};

/**
 * The sensor and alarm the preview is written against.
 *
 * The region type is capitalised because that is the form the deformation form
 * ticks and the subject prints verbatim — 'red' would preview "red Alarms - ".
 */
const PREVIEW_SENSOR = 'R01';
const PREVIEW_ALARM = [{ type: capitalise(EXAMPLE_ALARM_COLOUR), name: 'AR1' }];

/**
 * The subject lines this row will send, as the form stands.
 *
 * Built through `composeDeformationSubject` — the same call the deformation
 * form makes — against the whole document with THIS row swapped for the values
 * on screen. Not a re-implementation of the rules: a rule the engine follows
 * and the preview does not is the exact failure this exists to catch, and the
 * bottom-of-page preview cannot help while the modal is open over it.
 *
 * A row with no deformation type sends nothing, whatever its wording says.
 */
const subjectPreviewRows = (values) => {
  const ctx = values._preview;
  if (!ctx || !values.defType) return [];

  const edited = fromTriggerValues(ctx.trigger, values);
  const triggers = ctx.triggers.map((t) => (t.id === ctx.trigger.id ? edited : t));
  const policy = buildPolicyFromDocument({ ...ctx.document, triggers });
  const sensor = `${PREVIEW_SENSOR} - ${ctx.siteName}`;

  const compose = (alarmRegions) => composeDeformationSubject({
    type: values.defType, sensor, alarmRegions, policy,
  }).subject;

  return [
    { label: 'No alarm', value: compose([]) },
    { label: `With a ${EXAMPLE_ALARM_COLOUR} alarm`, value: compose(PREVIEW_ALARM) },
  ];
};

/**
 * The trigger row, as three short forms rather than one long one.
 *
 * Order follows how an engineer thinks about a row: what it IS, then what the
 * client reads, then what the software does with it, then the wording overrides
 * two sites use and nobody else touches.
 *
 * Nothing here changes what is stored. Every derived value only ever fills a
 * blank, every dropdown offers a document's existing wording back, and the
 * fields a row cannot use are hidden rather than removed — so no chart, workbook
 * or email subject moves because the form was rearranged.
 */
export const TRIGGER_FIELDS = [
  {
    key: 'defType',
    label: 'What this row answers',
    type: 'select',
    options: DEF_TYPE_OPTIONS,
    help: 'The deformation type that quotes this row in an email. One row per type. '
      + 'Alarm and connection rows answer nothing — leave it as None.',
  },

  { key: '_chart', type: 'heading', label: 'What the chart says' },

  {
    key: 'triggerLabel',
    label: 'Trigger',
    type: 'text',
    required: true,
    // Blank rows start from the type's own name; a client's wording stands.
    derive: (values) => values.defType || '',
    help: 'The row\'s name, in the client\'s own words — “Progressive (accelerating) trend”.',
  },
  {
    key: 'bandLabel',
    label: 'TARP band',
    type: 'text',
    help: 'The band this row sits in, e.g. “TARP Trigger 4 - Red”.',
  },
  {
    key: 'riskRating',
    label: 'Risk rating',
    type: 'select',
    computeOptions: riskRatingOptions,
    help: 'The left-hand column. Rows sharing a rating are merged into one banded cell.',
  },
  { key: 'colour', label: 'Colour', type: 'select', options: COLOUR_OPTIONS },
  { key: 'description', label: 'Description', type: 'textarea' },
  {
    key: 'dayShift',
    label: 'Day shift response',
    type: 'textarea',
    help: 'Also what the required response is read from, when none is set below.',
  },
  { key: 'nightShift', label: 'Night shift response', type: 'textarea' },
  {
    key: 'commentsText',
    label: 'Comments',
    type: 'textarea',
    help: 'One per line. They print as the numbered call script.',
  },
  { key: 'extraNote', label: 'Note', type: 'textarea' },
  {
    key: 'parameter',
    label: 'Parameter',
    type: 'text',
    // Only the matrix-layout charts have this axis. On every other site a value
    // here would add a leading column to the whole exported workbook.
    showWhen: (values) => Boolean(values._hasParameterAxis),
    help: 'The axis this row sits on — “Pola Deformasi”, “Koneksi Data”.',
  },

  { key: '_engine', type: 'heading', label: 'What it triggers' },

  {
    key: 'tarpLevel',
    label: 'TARP level',
    type: 'select',
    options: TARP_LEVEL_OPTIONS,
    // Read out of the band label while the level is still blank — every seeded
    // band carries its own number. Never overwrites a stored level.
    derive: (values) => levelFromBand(values.bandLabel),
    help: (values) => (levelMatchesBand(values)
      ? 'Read from the band label. Drives the number in the subject and the [CRITICAL] bracket.'
      : 'Drives the number in the subject and the [CRITICAL] / [MODERATE RISK] bracket.'),
  },
  {
    key: 'requiresAlarm',
    label: 'Only counts when an alarm has fired',
    type: 'select',
    options: [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }],
    // On a row with no deformation type this is not a question: an alarm row IS
    // the alarm, and the flag is what lets a fired alarm find its band.
    showWhen: (values) => Boolean(values.defType),
    help: 'Yes means a record with no alarm carries no TARP trigger at all.',
  },
  {
    key: 'responseMethod',
    label: 'Required response',
    type: 'select',
    computeOptions: responseOptions,
    help: (values) => {
      const inferred = inferResponseMethod(values.dayShift);
      if (values.responseMethod) return 'Set on this row.';
      return inferred
        ? `Currently read from the day shift cell: ${RESPONSE_METHOD_LABEL[inferred]}.`
        : 'Follows the site default.';
    },
  },
  {
    key: '_advanced',
    type: 'heading',
    label: 'Advanced — subject wording',
    collapsible: true,
    defaultCollapsed: true,
    help: `Per-row overrides. Blank follows the site rule. ${SUBJECT_TOKEN_HINT}`,
  },

  {
    key: 'subjectLabel',
    label: 'Subject wording, no alarm',
    type: 'text',
    help: subjectLabelHelp,
  },
  {
    key: 'subjectLabelAlarm',
    label: 'Subject wording, with an alarm',
    type: 'text',
    help: subjectLabelAlarmHelp,
  },

  { key: '_receives', type: 'heading', label: 'What the client receives' },

  {
    key: '_subjectPreview',
    label: 'Email subject, as this row stands',
    type: 'preview',
    rows: (values) => subjectPreviewRows(values),
    emptyText: 'This row answers no deformation type, so it sends no email. '
      + 'Set one above to see the subject it would produce.',
    help: 'Recomputed as you type, through the same code that sends the email. '
      + 'Unsaved — Cancel leaves the chart exactly as it is.',
  },
];

const LEVEL_SOURCE_OPTIONS = [
  {
    value: 'trigger',
    label: 'The deformation row — a progressive trend is always its own level',
  },
  {
    value: 'alarm',
    label: 'The alarm that fired — its colour decides the level, and no alarm means no trigger',
  },
];

/**
 * A site rule's response dropdown, with the same courtesy the trigger form
 * extends: a document already set to "call, then email" keeps seeing it, so
 * opening this form cannot quietly change what the whole site expects.
 */
const siteResponseOptions = (key) => (values) => {
  const options = SELECTABLE_RESPONSE_METHODS.map((value) => ({
    value,
    label: RESPONSE_METHOD_LABEL[value],
  }));
  return values[key] === 'call_then_email'
    ? [...options, {
      value: 'call_then_email',
      label: `${RESPONSE_METHOD_LABEL.call_then_email} (as this document reads today)`,
    }]
    : options;
};

const SITE_RULE_FIELDS = [
  { key: '_responses', type: 'heading', label: 'How this site is told' },
  {
    key: 'default_response_method',
    label: 'Normal response',
    type: 'select',
    computeOptions: siteResponseOptions('default_response_method'),
    required: true,
    help: 'What a trigger normally asks of the engineer. Rows that differ are '
      + 'called out on the chart and in the workbook.',
  },
  {
    key: 'deescalation_response_method',
    label: 'Standing a TARP level down',
    type: 'select',
    computeOptions: siteResponseOptions('deescalation_response_method'),
    required: true,
    help: 'The case engineers get wrong — e.g. Progressive easing back to Linear.',
  },
  {
    key: 'deescalation_notice',
    label: 'De-escalation notice',
    type: 'textarea',
    help: 'Shown to the engineer when standing a level down. Blank shows nothing.',
  },

  { key: '_level', type: 'heading', label: 'What decides the TARP level' },
  {
    key: 'tarp_level_source',
    label: 'The level comes from',
    type: 'select',
    options: LEVEL_SOURCE_OPTIONS,
    required: true,
    help: 'On an alarm-led site a progressive trend under an orange alarm is '
      + 'reported as TARP 3, and a record with no alarm carries no trigger at all.',
  },

  {
    key: '_subject',
    type: 'heading',
    label: 'Subject wording',
    help: `How every row announces itself, unless it overrides this. ${SUBJECT_TOKEN_HINT}`,
  },
  {
    key: 'subject_label_template',
    label: 'No alarm',
    type: 'text',
    help: `Blank uses the DTG standard, “${DEFAULT_SUBJECT_LABEL_TEMPLATE}”.`,
  },
  {
    key: 'subject_label_template_alarm',
    label: 'With an alarm',
    type: 'text',
    help: 'Blank uses the same wording as above.',
  },
  {
    key: 'alarm_prefix_style',
    label: 'List the alarm colours at the front?',
    type: 'select',
    options: ALARM_PREFIX_OPTIONS,
    required: true,
  },
];

const DISTRIBUTION_FIELDS = [
  {
    key: 'distribution_raw',
    label: 'Email distribution list — one recipient per line, as you would paste it into Outlook',
    type: 'textarea',
  },
];

const CONTACT_FIELDS = [
  { key: 'name', label: 'Name', type: 'text', required: true },
  {
    key: 'role',
    label: 'Role',
    type: 'text',
    help: 'Printed as “Role: Name” on the chart and in the workbook.',
  },
  { key: 'phone', label: 'Phone', type: 'text' },
  { key: 'email', label: 'Email', type: 'text' },
];

const REVISION_FIELDS = [
  { key: 'sections_modified', label: 'Sections Modified', type: 'text', required: true },
  { key: 'remark', label: 'Summary of Changes', type: 'textarea', required: true },
  { key: 'approved_by_site', label: 'Approved / Modified by (Site)', type: 'text' },
  { key: 'site_role', label: 'Site Role', type: 'text' },
  { key: 'approved_by_dtg', label: 'Approved / Modified by (DTG)', type: 'text' },
  { key: 'dtg_role', label: 'DTG Role', type: 'text' },
];

/**
 * Domain trigger -> flat values the generic EditModal understands.
 *
 * `context` carries the two facts a single row cannot answer for itself: whether
 * this document HAS a parameter axis, and what the site's normal response is.
 * Both only decide what the form shows — `fromTriggerValues` reads neither, so
 * they never reach the database.
 */
const toTriggerValues = (trigger, context = {}) => ({
  _hasParameterAxis: Boolean(context.hasParameterAxis),
  _defaultResponseMethod: context.defaultResponseMethod || 'call',
  // The site wording this row inherits when its own boxes are blank, so the
  // form can show what the row actually says rather than only what it overrides.
  _subjectLabelTemplate: context.subjectLabelTemplate || '',
  _subjectLabelTemplateAlarm: context.subjectLabelTemplateAlarm || '',
  // Everything the subject preview needs that a single row cannot answer: the
  // document around it, and the row as stored so edits can be layered on top.
  _preview: context.preview ? { ...context.preview, trigger } : null,
  triggerLabel: trigger.triggerLabel || '',
  parameter: trigger.parameter || '',
  bandLabel: trigger.bandLabel || '',
  riskRating: trigger.riskRating || '',
  colour: trigger.colour || '',
  description: trigger.description || '',
  responseMethod: trigger.responseMethod || '',
  dayShift: trigger.dayShift || '',
  nightShift: trigger.nightShift || '',
  commentsText: (trigger.comments || []).join('\n'),
  extraNote: trigger.extraNote || '',
  defType: trigger.defType || '',
  tarpLevel: trigger.tarpLevel ?? '',
  requiresAlarm: trigger.requiresAlarm ? 'yes' : 'no',
  subjectLabel: trigger.subjectLabel || '',
  subjectLabelAlarm: trigger.subjectLabelAlarm || '',
});

const fromTriggerValues = (trigger, values) => ({
  ...trigger,
  triggerLabel: values.triggerLabel?.trim() || trigger.triggerLabel,
  parameter: values.parameter?.trim() || null,
  bandLabel: values.bandLabel?.trim() || null,
  riskRating: values.riskRating?.trim() || null,
  colour: values.colour || null,
  description: values.description?.trim() || null,
  responseMethod: values.responseMethod || null,
  dayShift: values.dayShift?.trim() || null,
  nightShift: values.nightShift?.trim() || null,
  comments: String(values.commentsText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean),
  extraNote: values.extraNote?.trim() || null,
  defType: values.defType || null,
  tarpLevel: values.tarpLevel === '' || values.tarpLevel === null || values.tarpLevel === undefined
    ? null
    : Number(values.tarpLevel),
  requiresAlarm: values.requiresAlarm === 'yes',
  // Blank means "follow the site rule", not "say nothing".
  subjectLabel: values.subjectLabel?.trim() || null,
  subjectLabelAlarm: values.subjectLabelAlarm?.trim() || null,
});

/** Domain trigger -> the snake_case payload tarp_save_revision expects. */
const toTriggerPayload = (trigger, index) => ({
  sort_order: index + 1,
  parameter: trigger.parameter,
  risk_rating: trigger.riskRating,
  band_label: trigger.bandLabel,
  trigger_label: trigger.triggerLabel,
  colour: trigger.colour,
  description: trigger.description,
  day_shift: trigger.dayShift,
  night_shift: trigger.nightShift,
  comments: trigger.comments || [],
  extra_note: trigger.extraNote,
  def_type: trigger.defType,
  tarp_level: trigger.tarpLevel === null ? '' : String(trigger.tarpLevel),
  requires_alarm: trigger.requiresAlarm,
  subject_label: trigger.subjectLabel,
  subject_label_alarm: trigger.subjectLabelAlarm,
  response_method: trigger.responseMethod,
});

const toContactPayload = (contact, index) => ({
  kind: contact.kind,
  sort_order: index + 1,
  name: contact.name,
  role: contact.role,
  phone: contact.phone,
  email: contact.email,
});

let tempIdCounter = 0;
const nextTempId = () => `new-${(tempIdCounter += 1)}`;

export default function TarpTab({ sensor, userSite, activeTab, timezone }) {
  const siteId = sensor?.site_id;
  const { document: activeDoc, loading, error, refresh } = useTarpDocument(siteId);
  const { versions, refresh: refreshVersions } = useTarpVersions(siteId);
  // The document's own prose follows the site's language; the editing controls
  // around it stay English, because they act on the English rows.
  const locale = resolveTarpLocale(sensor, timezone);
  const t = tarpStrings(locale);

  const [draft, setDraft] = useState(null); // null = not editing
  const [editTarget, setEditTarget] = useState(null);
  const [contactTarget, setContactTarget] = useState(null); // { contact, kind, isNew }
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showDistribution, setShowDistribution] = useState(false);
  const [sourceOptions, setSourceOptions] = useState([]);
  const [cloneSourceId, setCloneSourceId] = useState('');
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [company, setCompany] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  // Where the draft's rows came from, so the revision row says so rather than
  // recording a wholesale replacement as an ordinary amendment.
  const [importSource, setImportSource] = useState(null);
  // An archived version being read. Held beside the active document rather than
  // replacing it, so the version in force is always one click away — and so
  // publishing still knows which document it is superseding.
  const [archivedDoc, setArchivedDoc] = useState(null);
  const [isLoadingVersion, setIsLoadingVersion] = useState(false);
  const [isExportingAll, setIsExportingAll] = useState(false);

  useEffect(() => {
    if (activeTab === 'tarp') {
      refresh();
      refreshVersions();
    }
  }, [activeTab, refresh, refreshVersions]);

  useEffect(() => {
    if (!siteId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('clients')
        .select('company, site_name')
        .eq('id', siteId)
        .maybeSingle();
      if (!cancelled && data) setCompany(data.company || data.site_name || '');
    })();
    return () => { cancelled = true; };
  }, [siteId]);

  // Reading an archived version, rather than the one in force.
  const isArchiveView = Boolean(archivedDoc) && archivedDoc.id !== activeDoc?.id;
  const doc = isArchiveView ? archivedDoc : activeDoc;

  // A version that has been superseded cannot be amended, imported into or
  // published from — the only thing offered on it is a read.
  const isEditing = draft !== null;
  const triggers = useMemo(
    () => (isEditing ? draft.triggers : (doc?.triggers ?? [])),
    [isEditing, draft, doc]
  );
  const contacts = useMemo(
    () => (isEditing ? draft.contacts : (doc?.contacts ?? [])),
    [isEditing, draft, doc]
  );

  // The distribution list is free text on the document (see migration 006), so
  // only escalation contacts are structured rows.
  const escalation = useMemo(
    () => contacts.filter((c) => c.kind === 'escalation'),
    [contacts]
  );

  const rules = useMemo(() => (isEditing ? draft.rules : {
    default_response_method: doc?.defaultResponseMethod ?? 'call',
    deescalation_response_method: doc?.deescalationResponseMethod ?? 'call',
    deescalation_notice: doc?.deescalationNotice ?? '',
    distribution_raw: doc?.distributionRaw ?? '',
    subject_label_template: doc?.subjectLabelTemplate ?? DEFAULT_SUBJECT_LABEL_TEMPLATE,
    subject_label_template_alarm: doc?.subjectLabelTemplateAlarm ?? '',
    alarm_prefix_style: doc?.alarmPrefixStyle ?? 'regions',
    tarp_level_source: doc?.tarpLevelSource ?? 'trigger',
  }), [isEditing, draft, doc]);

  // What the trigger form needs to know about the document around the row it is
  // editing. Memoised because the modal re-syncs when its values change.
  const triggerContext = useMemo(() => ({
    // One row with a parameter gives the whole workbook a leading column, so
    // the field is offered wherever the chart already has that axis.
    hasParameterAxis: triggers.some((t) => t.parameter),
    defaultResponseMethod: rules.default_response_method,
    // Read from the draft, not the saved document: an engineer changing the
    // site wording should see the rows follow it before saving.
    subjectLabelTemplate: rules.subject_label_template || DEFAULT_SUBJECT_LABEL_TEMPLATE,
    subjectLabelTemplateAlarm: rules.subject_label_template_alarm || '',
    preview: doc ? {
      triggers,
      siteName: sensor?.site_name || 'Site',
      // The draft rules, not the saved ones — the preview has to answer for the
      // chart as it will be published, not as it was loaded.
      document: {
        ...doc,
        subjectLabelTemplate: rules.subject_label_template || DEFAULT_SUBJECT_LABEL_TEMPLATE,
        subjectLabelTemplateAlarm: rules.subject_label_template_alarm || null,
        alarmPrefixStyle: rules.alarm_prefix_style || 'regions',
        tarpLevelSource: rules.tarp_level_source || 'trigger',
      },
    } : null,
  }), [doc, triggers, rules, sensor?.site_name]);

  const triggerValues = useMemo(
    () => (editTarget ? toTriggerValues(editTarget, triggerContext) : {}),
    [editTarget, triggerContext]
  );

  // What this chart actually sends. Built from the rows on screen — including
  // unpublished edits — through the same code path the deformation form uses,
  // so a subject can never be agreed on the chart and differ in the inbox.
  const subjectPreviews = useMemo(() => {
    if (!doc) return [];

    const policy = buildPolicyFromDocument({
      ...doc,
      triggers,
      subjectLabelTemplate: rules.subject_label_template || DEFAULT_SUBJECT_LABEL_TEMPLATE,
      subjectLabelTemplateAlarm: rules.subject_label_template_alarm || null,
      alarmPrefixStyle: rules.alarm_prefix_style || 'regions',
      tarpLevelSource: rules.tarp_level_source || 'trigger',
    });

    const exampleSensor = `R01 - ${sensor?.site_name || 'Site'}`;
    const exampleAlarm = [{ type: 'Red', name: 'AR1' }];

    return triggers
      .filter((t) => t.defType)
      .map((t) => {
        const plain = composeDeformationSubject({
          type: t.defType, sensor: exampleSensor, policy,
        });
        const alarmed = composeDeformationSubject({
          type: t.defType, sensor: exampleSensor, alarmRegions: exampleAlarm, policy,
        });
        return {
          id: t.id,
          defType: t.defType,
          // The token on its own, for the chart's "drives" line.
          token: plain.triggerLabel,
          withoutAlarm: plain.subject,
          withAlarm: alarmed.subject,
        };
      });
  }, [doc, triggers, rules, sensor?.site_name]);

  /** The same tokens keyed by row, for TarpChart. */
  const subjectTokens = useMemo(
    () => Object.fromEntries(subjectPreviews.map((p) => [p.id, p.token])),
    [subjectPreviews],
  );

  const isDirty = useMemo(() => {
    if (!isEditing || !doc) return false;
    return JSON.stringify(draft.triggers) !== JSON.stringify(doc.triggers)
      || JSON.stringify(draft.contacts) !== JSON.stringify(doc.contacts)
      || draft.rules.default_response_method !== doc.defaultResponseMethod
      || draft.rules.deescalation_response_method !== doc.deescalationResponseMethod
      || (draft.rules.deescalation_notice || '') !== (doc.deescalationNotice || '')
      || (draft.rules.distribution_raw || '') !== (doc.distributionRaw || '')
      || (draft.rules.subject_label_template || '') !== (doc.subjectLabelTemplate || '')
      || (draft.rules.subject_label_template_alarm || '') !== (doc.subjectLabelTemplateAlarm || '')
      || draft.rules.alarm_prefix_style !== doc.alarmPrefixStyle
      || draft.rules.tarp_level_source !== doc.tarpLevelSource;
  }, [isEditing, draft, doc]);

  const beginEditing = useCallback(() => {
    if (!doc || isArchiveView) return;
    setDraft({
      triggers: doc.triggers.map((t) => ({ ...t })),
      contacts: doc.contacts.map((c) => ({ ...c })),
      rules: {
        default_response_method: doc.defaultResponseMethod,
        deescalation_response_method: doc.deescalationResponseMethod,
        deescalation_notice: doc.deescalationNotice || '',
        distribution_raw: doc.distributionRaw || '',
        subject_label_template: doc.subjectLabelTemplate || DEFAULT_SUBJECT_LABEL_TEMPLATE,
        subject_label_template_alarm: doc.subjectLabelTemplateAlarm || '',
        alarm_prefix_style: doc.alarmPrefixStyle || 'regions',
        tarp_level_source: doc.tarpLevelSource || 'trigger',
      },
    });
  }, [doc, isArchiveView]);

  const handleRulesSave = useCallback((values) => {
    setDraft((prev) => ({ ...prev, rules: { ...prev.rules, ...values } }));
    setShowRules(false);
  }, []);

  const handleDistributionSave = useCallback((values) => {
    setDraft((prev) => ({
      ...prev,
      rules: { ...prev.rules, distribution_raw: values.distribution_raw ?? '' },
    }));
    setShowDistribution(false);
  }, []);

  // ── Trigger edits ──────────────────────────────────────────────────────────

  const handleTriggerSave = useCallback((values) => {
    setDraft((prev) => ({
      ...prev,
      triggers: prev.triggers.map((t) =>
        t.id === editTarget.id ? fromTriggerValues(t, values) : t
      ),
    }));
    setEditTarget(null);
  }, [editTarget]);

  // ── Contact edits ──────────────────────────────────────────────────────────

  const handleContactSave = useCallback((values) => {
    const { contact, kind, isNew } = contactTarget;
    const next = {
      id: contact.id,
      kind,
      sortOrder: contact.sortOrder ?? 0,
      name: values.name?.trim() || null,
      role: values.role?.trim() || null,
      phone: values.phone?.trim() || null,
      email: values.email?.trim() || null,
    };

    setDraft((prev) => ({
      ...prev,
      contacts: isNew
        ? [...prev.contacts, next]
        : prev.contacts.map((c) => (c.id === contact.id ? next : c)),
    }));
    setContactTarget(null);
  }, [contactTarget]);

  const handleContactDelete = useCallback(() => {
    setDraft((prev) => ({
      ...prev,
      contacts: prev.contacts.filter((c) => c.id !== deleteTarget.id),
    }));
    setDeleteTarget(null);
  }, [deleteTarget]);

  const addContact = useCallback((kind) => {
    setContactTarget({
      kind,
      isNew: true,
      contact: { id: nextTempId(), kind, name: '', role: '', phone: '', email: '' },
    });
  }, []);

  // ── Publish / export ───────────────────────────────────────────────────────

  const handlePublish = useCallback(async (values) => {
    // Always supersedes the version in force, never the one being read.
    if (!activeDoc) return;
    setIsPublishing(true);
    try {
      const { error: rpcError } = await supabase.rpc('tarp_save_revision', {
        p_document_id: activeDoc.id,
        p_document: { created_by: userSite?.user_id || null, ...draft.rules },
        p_triggers: draft.triggers.map(toTriggerPayload),
        p_contacts: draft.contacts.map(toContactPayload),
        p_revision: values,
      });
      if (rpcError) throw rpcError;

      toast.success(`Published version ${(activeDoc.version ?? 0) + 1}`);
      setShowPublish(false);
      setDraft(null);
      setImportSource(null);
      await Promise.all([refresh(), refreshVersions()]);
    } catch (err) {
      console.error('[TarpTab] publish failed', err);
      toast.error(err.message || 'Could not publish the new version.');
    } finally {
      setIsPublishing(false);
    }
  }, [activeDoc, draft, refresh, refreshVersions, userSite]);

  // ── Reading an earlier version ─────────────────────────────────────────────

  const handleVersionChange = useCallback(async (value) => {
    const id = Number(value);
    if (!id || id === activeDoc?.id) {
      setArchivedDoc(null);
      return;
    }

    setIsLoadingVersion(true);
    try {
      const fetched = await fetchTarpDocumentById(id);
      if (!fetched) throw new Error('That version is no longer on file.');
      // Set only once the rows are in hand, so the chart never blanks out
      // between the two versions.
      setArchivedDoc(fetched);
    } catch (err) {
      console.error('[TarpTab] version load failed', err);
      toast.error(err.message || 'Could not load that version.');
    } finally {
      setIsLoadingVersion(false);
    }
  }, [activeDoc?.id]);

  const handleExportAllVersions = useCallback(async () => {
    if (!siteId) return;
    setIsExportingAll(true);
    try {
      const allDocs = await fetchTarpDocumentsForSite(siteId);
      if (!allDocs.length) {
        toast.error('There are no versions to export.');
        return;
      }
      await downloadTarpAllVersionsXlsx(allDocs, {
        company, siteName: sensor?.site_name, locale,
      });
      toast.success(
        `Exported ${allDocs.length} version${allDocs.length === 1 ? '' : 's'} as one workbook.`
      );
    } catch (err) {
      console.error('[TarpTab] export of every version failed', err);
      toast.error(err.message || 'Could not build the workbook.');
    } finally {
      setIsExportingAll(false);
    }
  }, [siteId, company, sensor?.site_name, locale]);

  // ── Bootstrapping a site that has no document yet ──────────────────────────

  // Other sites' active documents, offered as a starting point when a client
  // onboards a second pit under the same corporate TARP.
  useEffect(() => {
    if (doc || loading || !siteId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('tarp_documents')
        .select('id, version, site_id, clients ( site_name )')
        .eq('status', 'active')
        .neq('site_id', siteId);

      if (cancelled) return;
      setSourceOptions(
        (data || []).map((row) => ({
          id: row.id,
          version: row.version,
          siteName: row.clients?.site_name || `Site ${row.site_id}`,
        }))
      );
    })();
    return () => { cancelled = true; };
  }, [doc, loading, siteId]);

  const bootstrap = useCallback(async (mode) => {
    setIsBootstrapping(true);
    try {
      const { error: rpcError } = mode === 'clone'
        ? await supabase.rpc('tarp_clone_document', {
          p_source_document_id: Number(cloneSourceId),
          p_target_site_id: siteId,
          p_created_by: userSite?.user_id || null,
        })
        : await supabase.rpc('tarp_create_from_standard', {
          p_site_id: siteId,
          p_created_by: userSite?.user_id || null,
        });

      if (rpcError) throw rpcError;
      toast.success('Draft TARP created — review it with the site before relying on it.');
      await Promise.all([refresh(), refreshVersions()]);
    } catch (err) {
      console.error('[TarpTab] bootstrap failed', err);
      toast.error(err.message || 'Could not create the TARP document.');
    } finally {
      setIsBootstrapping(false);
    }
  }, [cloneSourceId, siteId, userSite, refresh, refreshVersions]);

  // ── Importing a client's own workbook ──────────────────────────────────────
  //
  // Two destinations, one parser (utils/tarpImport.js):
  //
  //   * a site WITH a document imports into the draft, so the rows go out
  //     through tarp_save_revision like any other amendment — the version in
  //     force keeps driving emails until an engineer publishes, and the
  //     replacement is recorded in DOCUMENT CONTROL.
  //   * a site WITHOUT one calls tarp_create_from_import, which refuses to run
  //     if a document appeared in the meantime.
  const handleImport = useCallback(async (importedTriggers, meta) => {
    const provenance = [meta.fileName, meta.sheetName && `sheet "${meta.sheetName}"`]
      .filter(Boolean).join(', ');

    if (doc) {
      setDraft((prev) => ({
        triggers: importedTriggers,
        contacts: (prev ?? doc).contacts.map((c) => ({ ...c })),
        rules: prev?.rules ?? {
          default_response_method: doc.defaultResponseMethod,
          deescalation_response_method: doc.deescalationResponseMethod,
          deescalation_notice: doc.deescalationNotice || '',
          distribution_raw: doc.distributionRaw || '',
          subject_label_template: doc.subjectLabelTemplate || DEFAULT_SUBJECT_LABEL_TEMPLATE,
          subject_label_template_alarm: doc.subjectLabelTemplateAlarm || '',
          alarm_prefix_style: doc.alarmPrefixStyle || 'regions',
        tarp_level_source: doc.tarpLevelSource || 'trigger',
        },
      }));
      setImportSource(provenance);
      setShowImport(false);
      toast.success(
        `${importedTriggers.length} rows loaded into the draft. `
        + `Version ${doc.version} stays in force until you publish.`
      );
      return;
    }

    setIsImporting(true);
    try {
      const { error: rpcError } = await supabase.rpc('tarp_create_from_import', {
        p_site_id: siteId,
        p_document: {
          // The workbook's own names beat ours — it is the client's document.
          heading: meta.heading || sensor?.site_name || company || null,
          title: meta.title || null,
          distribution_raw: meta.distributionRaw || null,
          import_remark:
            `Imported from ${provenance}. NOT YET AGREED WITH SITE — a spreadsheet `
            + 'cannot state which rows drive an email, so confirm the deformation '
            + 'type, TARP level and response on every row before relying on it.',
        },
        p_triggers: importedTriggers.map(toImportPayload),
        p_contacts: (meta.contacts || []).map(toContactImportPayload),
        p_created_by: userSite?.user_id || null,
      });
      if (rpcError) throw rpcError;

      toast.success('TARP created from the file — review it with the site before relying on it.');
      setShowImport(false);
      await Promise.all([refresh(), refreshVersions()]);
    } catch (err) {
      console.error('[TarpTab] import failed', err);
      toast.error(err.message || 'Could not create the TARP document from that file.');
    } finally {
      setIsImporting(false);
    }
  }, [doc, siteId, sensor?.site_name, company, userSite, refresh, refreshVersions]);

  const handleCopyDistribution = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(rules.distribution_raw || '');
      toast.success('Distribution list copied');
    } catch {
      toast.error('Could not copy to the clipboard.');
    }
  }, [rules.distribution_raw]);

  const handleExport = useCallback(async () => {
    if (!doc) return;
    try {
      // Export what is on screen, including unpublished edits.
      await downloadTarpXlsx(
        { ...doc, triggers, contacts, distributionRaw: rules.distribution_raw },
        { company, siteName: sensor?.site_name, locale }
      );
    } catch (err) {
      console.error('[TarpTab] export failed', err);
      toast.error('Could not build the workbook.');
    }
  }, [doc, triggers, contacts, rules.distribution_raw, company, sensor?.site_name, locale]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return <div className="flex justify-center py-12"><Spinner /></div>;
  }

  if (error) {
    return (
      <p className="px-4 py-6 text-sm text-red-400">
        Could not load the TARP document: {error}
      </p>
    );
  }

  if (!doc) {
    return (
      <div className="px-4 py-10 max-w-lg mx-auto text-center">
        <FileText className="mx-auto mb-3 text-[var(--dtg-text-muted)]" size={28} />
        <p className="text-sm text-[var(--dtg-text-secondary)]">
          No TARP document for {sensor?.site_name || 'this site'}.
        </p>
        <p className="mt-1 text-xs text-[var(--dtg-text-muted)]">
          Email subjects fall back to the DTG standard mapping, and no site-specific
          rule — alarm gating, de-escalation by email — can apply until a document exists.
        </p>

        <div className="mt-5 flex flex-col items-stretch gap-2">
          {/* Offered first: a site that already has an agreed TARP should not
              have it retyped from the DTG standard. */}
          <button
            type="button"
            disabled={isBootstrapping || isImporting}
            onClick={() => setShowImport(true)}
            className="flex items-center justify-center gap-2 px-4 py-2 text-sm rounded-md bg-[var(--dtg-brand-orange)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <Upload size={14} />
            Import the site&apos;s TARP file
          </button>

          <button
            type="button"
            disabled={isBootstrapping || isImporting}
            onClick={() => bootstrap('standard')}
            className="flex items-center justify-center gap-2 px-4 py-2 text-sm rounded-md border border-[var(--dtg-border-medium)] hover:bg-[var(--dtg-bg-secondary)] transition-colors disabled:opacity-50"
          >
            <Plus size={14} />
            Start from the DTG standard chart
          </button>

          {sourceOptions.length > 0 && (
            <div className="flex gap-2">
              <select
                value={cloneSourceId}
                onChange={(e) => setCloneSourceId(e.target.value)}
                className="flex-1 px-3 py-2 text-sm rounded-md border border-[var(--dtg-border-medium)] bg-[var(--dtg-bg-card)] text-[var(--dtg-text-primary)]"
              >
                <option value="">— Copy from another site —</option>
                {sourceOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.siteName} (v{option.version})
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!cloneSourceId || isBootstrapping}
                onClick={() => bootstrap('clone')}
                className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-md border border-[var(--dtg-border-medium)] hover:bg-[var(--dtg-bg-secondary)] transition-colors disabled:opacity-50"
              >
                <Copy size={14} />
                Copy
              </button>
            </div>
          )}
        </div>

        <p className="mt-4 text-xs text-[var(--dtg-text-muted)]">
          However it starts, the result is a starting point, not an approved TARP.
          Review every row with the site, then publish an agreed version.
        </p>

        <TarpImportModal
          isOpen={showImport}
          mode="create"
          siteName={sensor?.site_name}
          onCancel={() => setShowImport(false)}
          onApply={handleImport}
          isSaving={isImporting}
        />
      </div>
    );
  }

  const renderContactList = (list, kind, heading) => (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-[var(--dtg-text-primary)]">{heading}</h4>
        {isEditing && (
          <button
            type="button"
            onClick={() => addContact(kind)}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-[var(--dtg-border-medium)] hover:bg-[var(--dtg-bg-secondary)] transition-colors"
          >
            <Plus size={12} />
            Add
          </button>
        )}
      </div>

      {list.length === 0 ? (
        <p className="text-xs text-[var(--dtg-text-muted)] italic">No entries.</p>
      ) : (
        <ul className="text-sm text-[var(--dtg-text-secondary)] divide-y divide-[var(--dtg-border-light)]">
          {list.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-1.5">
              <span className="flex-1 min-w-0">
                <span className="block truncate">
                  {[c.role, c.name].filter(Boolean).join(': ') || '—'}
                </span>
                {(c.phone || c.email) && (
                  <span className="block text-xs text-[var(--dtg-text-muted)] truncate">
                    {[c.phone, c.email].filter(Boolean).join(' · ')}
                  </span>
                )}
              </span>

              {isEditing && (
                <span className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setContactTarget({ contact: c, kind, isNew: false })}
                    className="p-1.5 rounded hover:bg-[var(--dtg-bg-secondary)] text-[var(--dtg-text-muted)] hover:text-[var(--dtg-brand-orange)] transition-colors"
                    aria-label={`Edit ${c.name || c.role || 'contact'}`}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(c)}
                    className="p-1.5 rounded hover:bg-red-500/10 text-[var(--dtg-text-muted)] hover:text-red-400 transition-colors"
                    aria-label={`Delete ${c.name || c.role || 'contact'}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="p-4 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-[var(--dtg-text-primary)]">
            {doc.heading || sensor?.site_name}
          </h3>
          <p className="text-sm text-[var(--dtg-text-secondary)]">
            {translateDocumentText(doc.title, locale)}
          </p>
          <p className="mt-1 text-xs text-[var(--dtg-text-muted)]">
            Version {doc.version}
            {doc.status === 'active' ? ' · in force' : ` · ${doc.status}`}
            {doc.effectiveFrom && ` · effective ${doc.effectiveFrom}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Version picker. Only offered once a site has a history to pick
              from, and locked while a draft is open — switching away would
              throw the draft away without saying so. */}
          {versions.length > 1 && (
            <select
              value={doc.id}
              disabled={isEditing || isLoadingVersion}
              onChange={(e) => handleVersionChange(e.target.value)}
              title={isEditing
                ? 'Discard or publish your draft before reading another version.'
                : 'Read an earlier version of this TARP'}
              className="px-3 py-1.5 text-sm rounded-md border border-[var(--dtg-border-medium)] bg-[var(--dtg-bg-card)] text-[var(--dtg-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {`v${v.version}`}
                  {v.status === 'active' ? ' — in force' : ` — ${v.status}`}
                  {v.effectiveFrom ? ` (${v.effectiveFrom})` : ''}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-[var(--dtg-border-medium)] hover:bg-[var(--dtg-bg-secondary)] transition-colors"
          >
            <History size={14} />
            History ({doc.revisions.length})
          </button>

          <button
            type="button"
            onClick={handleExport}
            title={isArchiveView
              ? `Export v${doc.version} as it stood`
              : 'Export the chart on screen, including unpublished edits'}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-[var(--dtg-border-medium)] hover:bg-[var(--dtg-bg-secondary)] transition-colors"
          >
            <Download size={14} />
            {isArchiveView ? `Export v${doc.version}` : 'Export .xlsx'}
          </button>

          {/* One workbook, one sheet per version. Offered beside the ordinary
              export because "send us the TARP history" is a request in its own
              right — an audit or an incident review needs the chart that was in
              force then, not the one in force now. */}
          {versions.length > 1 && (
            <button
              type="button"
              onClick={handleExportAllVersions}
              disabled={isExportingAll}
              title="Every published version as one workbook — unpublished edits are not included"
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-[var(--dtg-border-medium)] hover:bg-[var(--dtg-bg-secondary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Layers size={14} />
              {isExportingAll ? 'Building…' : `Export all ${versions.length} versions`}
            </button>
          )}

          {/* Re-importing is an amendment like any other, so it is offered
              alongside Amend rather than hidden inside it. */}
          {!isArchiveView && (
            <button
              type="button"
              onClick={() => setShowImport(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-[var(--dtg-border-medium)] hover:bg-[var(--dtg-bg-secondary)] transition-colors"
            >
              <Upload size={14} />
              Import .xlsx
            </button>
          )}

          {isArchiveView ? (
            <button
              type="button"
              onClick={() => setArchivedDoc(null)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-[var(--dtg-border-medium)] hover:bg-[var(--dtg-bg-secondary)] transition-colors"
            >
              <Undo2 size={14} />
              Back to v{activeDoc?.version}
            </button>
          ) : isEditing ? (
            <>
              <button
                type="button"
                onClick={() => { setDraft(null); setImportSource(null); }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-[var(--dtg-border-medium)] hover:bg-[var(--dtg-bg-secondary)] transition-colors"
              >
                <Undo2 size={14} />
                Discard
              </button>
              <button
                type="button"
                disabled={!isDirty}
                onClick={() => setShowPublish(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-[var(--dtg-brand-orange)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save size={14} />
                Publish v{doc.version + 1}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={beginEditing}
              className="px-3 py-1.5 text-sm rounded-md border border-[var(--dtg-border-medium)] hover:bg-[var(--dtg-bg-secondary)] transition-colors"
            >
              Amend
            </button>
          )}
        </div>
      </div>

      {isArchiveView && (
        <p className="text-xs px-3 py-2 rounded border border-[var(--dtg-border-medium)] bg-[var(--dtg-bg-secondary)] text-[var(--dtg-text-secondary)]">
          Reading version {doc.version} — a record of what this site had agreed, not
          what is in force. Emails are driven by version {activeDoc?.version}, and this
          version cannot be amended: to bring an old row back, return to
          v{activeDoc?.version} and amend it there.
        </p>
      )}

      {isEditing && (
        <p className="text-xs px-3 py-2 rounded border border-[var(--dtg-brand-orange)]/40 bg-[var(--dtg-brand-orange)]/10 text-[var(--dtg-text-secondary)]">
          Draft changes. Version {doc.version} stays in force — and keeps driving email
          subjects — until you publish.
          {importSource && (
            <>
              {' '}Every trigger row was replaced from <strong>{importSource}</strong>;
              contacts and the distribution list were left as they were.
            </>
          )}
        </p>
      )}

      {/* Site response rules — the de-escalation rule is the one engineers get
          wrong, so it is stated here rather than buried in a trigger row. */}
      <div className="rounded-md border border-[var(--dtg-border-medium)] px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-2 sm:grid-cols-2 flex-1">
            <div>
              <p className="text-xs text-[var(--dtg-text-muted)]">Normal response to a trigger</p>
              <p className="text-sm font-medium text-[var(--dtg-text-primary)]">
                {RESPONSE_METHOD_LABEL[rules.default_response_method] || rules.default_response_method}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--dtg-text-muted)]">
                Standing a TARP level down
              </p>
              <p
                className={`text-sm font-medium ${rules.deescalation_response_method !== rules.default_response_method
                  ? 'text-amber-300'
                  : 'text-[var(--dtg-text-primary)]'
                  }`}
              >
                {RESPONSE_METHOD_LABEL[rules.deescalation_response_method]
                  || rules.deescalation_response_method}
                {rules.deescalation_response_method !== rules.default_response_method
                  && ' — differs from normal'}
              </p>
            </div>
          </div>

          {isEditing && (
            <button
              type="button"
              onClick={() => setShowRules(true)}
              className="shrink-0 flex items-center gap-1 px-2 py-1 text-xs rounded border border-[var(--dtg-border-medium)] hover:bg-[var(--dtg-bg-secondary)] transition-colors"
            >
              <Pencil size={12} />
              Edit
            </button>
          )}
        </div>

        {/* Which row decides the number in the subject line. Stated here because
            it changes what every email says, and nothing on a trigger row hints
            at it. */}
        {rules.tarp_level_source === 'alarm' && (
          <p className="mt-2 text-xs text-amber-300">
            The TARP level follows the alarm that fired, not the deformation type —
            a progressive trend on an orange alarm is reported as TARP 3. A record
            with no alarm carries no TARP trigger at all.
          </p>
        )}

        {rules.deescalation_notice && (
          <p className="mt-2 text-xs text-[var(--dtg-text-secondary)]">
            {rules.deescalation_notice}
          </p>
        )}
      </div>

      <TarpChart
        triggers={triggers}
        defaultResponseMethod={rules.default_response_method}
        subjectTokens={subjectTokens}
        locale={locale}
        editable={isEditing}
        onEdit={setEditTarget}
      />

      {/* The wording a client actually receives is part of what they sign off,
          so it is printed here rather than left to be discovered in an inbox. */}
      {subjectPreviews.length > 0 && (
        <div className="rounded-md border border-[var(--dtg-border-medium)] px-4 py-3">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <h4 className="text-sm font-semibold text-[var(--dtg-text-primary)]">
                {isArchiveView
                  ? `Email subjects version ${doc.version} produced`
                  : 'Email subjects this chart produces'}
              </h4>
              <p className="text-xs text-[var(--dtg-text-muted)]">
                Example sensor, one red alarm region.
              </p>
            </div>
            {isEditing && (
              <button
                type="button"
                onClick={() => setShowRules(true)}
                className="shrink-0 flex items-center gap-1 px-2 py-1 text-xs rounded border border-[var(--dtg-border-medium)] hover:bg-[var(--dtg-bg-secondary)] transition-colors"
              >
                <Pencil size={12} />
                Wording
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left text-[var(--dtg-text-muted)]">
                  <th className="py-1 pr-3 font-medium">Deformation</th>
                  <th className="py-1 pr-3 font-medium">No alarm</th>
                  <th className="py-1 font-medium">With an alarm</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--dtg-border-light)]">
                {subjectPreviews.map((row) => (
                  <tr key={row.id} className="align-top">
                    <td className="py-1.5 pr-3 whitespace-nowrap text-[var(--dtg-text-secondary)]">
                      {row.defType}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-[var(--dtg-text-primary)]">
                      {row.withoutAlarm}
                    </td>
                    <td className="py-1.5 font-mono text-[var(--dtg-text-primary)]">
                      {row.withAlarm}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {doc.footerNote && (
        <p className="text-xs font-semibold text-[var(--dtg-text-secondary)]">
          {translateDocumentText(doc.footerNote, locale)}
        </p>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <div>
          {renderContactList(escalation, 'escalation', t.contacts)}
          {doc.escalationNote && (
            <p className="mt-2 text-xs text-[var(--dtg-text-muted)]">
              {translateDocumentText(doc.escalationNote, locale)}
            </p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-[var(--dtg-text-primary)]">
              {t.distributionList}
            </h4>
            {isEditing && (
              <button
                type="button"
                onClick={() => setShowDistribution(true)}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-[var(--dtg-border-medium)] hover:bg-[var(--dtg-bg-secondary)] transition-colors"
              >
                <Pencil size={12} />
                Edit
              </button>
            )}
          </div>

          {rules.distribution_raw ? (
            <>
              <p className="text-xs text-[var(--dtg-text-secondary)] whitespace-pre-line break-words">
                {rules.distribution_raw}
              </p>
              <button
                type="button"
                onClick={handleCopyDistribution}
                className="mt-2 flex items-center gap-1 px-2 py-1 text-xs rounded border border-[var(--dtg-border-medium)] hover:bg-[var(--dtg-bg-secondary)] transition-colors"
              >
                <Copy size={12} />
                Copy
              </button>
            </>
          ) : (
            <p className="text-xs text-[var(--dtg-text-muted)] italic">No entries.</p>
          )}
        </div>
      </div>

      {/* Document control */}
      {showHistory && (
        <div className="overflow-x-auto border-t border-[var(--dtg-border-medium)] pt-4">
          <h4 className="text-sm font-semibold mb-2 text-[var(--dtg-text-primary)]">
            Document Control
          </h4>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[var(--dtg-text-muted)]">
                <th className="px-2 py-1 font-medium">No.</th>
                <th className="px-2 py-1 font-medium">Ver.</th>
                <th className="px-2 py-1 font-medium">Approval</th>
                <th className="px-2 py-1 font-medium">Site</th>
                <th className="px-2 py-1 font-medium">DTG</th>
                <th className="px-2 py-1 font-medium">Sections Modified</th>
                <th className="px-2 py-1 font-medium">Remark</th>
              </tr>
            </thead>
            <tbody>
              {doc.revisions.map((r) => (
                <tr key={r.id} className="border-t border-[var(--dtg-border-light)] align-top">
                  <td className="px-2 py-1.5">{r.seq}</td>
                  <td className="px-2 py-1.5">{r.versionNo ?? '—'}</td>
                  <td className="px-2 py-1.5">{r.approvalDate || '—'}</td>
                  <td className="px-2 py-1.5">
                    {r.approvedBySite || '—'}
                    {r.siteRole && (
                      <div className="text-[var(--dtg-text-muted)]">{r.siteRole}</div>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {r.approvedByDtg || '—'}
                    {r.dtgRole && (
                      <div className="text-[var(--dtg-text-muted)]">{r.dtgRole}</div>
                    )}
                  </td>
                  <td className="px-2 py-1.5">{r.sectionsModified || '—'}</td>
                  <td className="px-2 py-1.5">{r.remark || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <EditModal
        isOpen={Boolean(editTarget)}
        title={`Edit trigger — ${editTarget?.triggerLabel ?? ''}`}
        fields={TRIGGER_FIELDS}
        initialValues={triggerValues}
        onSave={handleTriggerSave}
        onCancel={() => setEditTarget(null)}
      />

      <EditModal
        isOpen={Boolean(contactTarget)}
        title={
          contactTarget?.isNew
            ? `Add ${contactTarget?.kind === 'distribution' ? 'distribution entry' : 'contact'}`
            : `Edit ${contactTarget?.kind === 'distribution' ? 'distribution entry' : 'contact'}`
        }
        fields={CONTACT_FIELDS}
        initialValues={
          contactTarget
            ? {
              name: contactTarget.contact.name || '',
              role: contactTarget.contact.role || '',
              phone: contactTarget.contact.phone || '',
              email: contactTarget.contact.email || '',
            }
            : {}
        }
        onSave={handleContactSave}
        onCancel={() => setContactTarget(null)}
      />

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Remove contact"
        message={`Remove ${deleteTarget?.name || deleteTarget?.role || 'this entry'} from the list? It stays in the published version until you publish a new one.`}
        confirmLabel="Remove"
        isDestructive
        onConfirm={handleContactDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <EditModal
        isOpen={showDistribution}
        title="Email distribution list"
        fields={DISTRIBUTION_FIELDS}
        initialValues={{ distribution_raw: rules.distribution_raw || '' }}
        onSave={handleDistributionSave}
        onCancel={() => setShowDistribution(false)}
      />

      <EditModal
        isOpen={showRules}
        title="Site response rules"
        fields={SITE_RULE_FIELDS}
        initialValues={rules}
        onSave={handleRulesSave}
        onCancel={() => setShowRules(false)}
      />

      <EditModal
        isOpen={showPublish}
        title={`Publish version ${doc.version + 1}`}
        fields={REVISION_FIELDS}
        initialValues={{
          approved_by_dtg: userSite?.displayname || '',
          dtg_role: 'Geotechnical Engineer',
          // An import replaces the whole chart, which is the one change a
          // reader of DOCUMENT CONTROL most needs stated plainly.
          ...(importSource
            ? {
              sections_modified: 'Trigger chart (all rows)',
              remark: `Trigger rows replaced from ${importSource}.`,
            }
            : {}),
        }}
        onSave={handlePublish}
        onCancel={() => setShowPublish(false)}
        isSaving={isPublishing}
      />

      <TarpImportModal
        isOpen={showImport}
        mode="replace"
        siteName={sensor?.site_name}
        onCancel={() => setShowImport(false)}
        onApply={handleImport}
        isSaving={isImporting}
      />
    </div>
  );
}
