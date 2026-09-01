// utils/reportDefaults.js
//
// The report a site USUALLY gets — Telfer a Data Quality assessment, Leonora a
// Comprehensive, Vale a Tabulation.
//
// WHY THIS EXISTS
//
// The generator opened on the same selection for every client: Radar / Data
// Quality, whichever site was on screen. So every report for a site that does
// not take that document began with the same two corrections, and the cost of
// forgetting them is not a wasted click — it is a client receiving the wrong
// document, or a preview built from the wrong window. The site's usual report is
// a property of the CLIENT, not of the analyst writing it that morning, so it is
// stored per site and shared, exactly like the section layout it sits beside
// (report_layouts / utils/reportLayout.js).
//
// WHAT A DEFAULT IS
//
//   report_type   'Radar' | 'Insar'      — the generator's own vocabulary
//   category      'Data Quality' | 'Comprehensive' | 'Tabulation' | …
//   frequency     'daily' | 'weekly' | 'monthly' | 'custom' | null
//   custom_days   the span behind 'custom'
//
// Every field is optional: a site that always takes the Comprehensive report but
// picks its window per report saves a category and no frequency, and the
// generator leaves the frequency alone.
//
// STORED AS THE UI'S OWN STRINGS, deliberately — the same decision
// report_layouts.category made. There is no second vocabulary to keep in step,
// and a value the UI no longer offers is DROPPED on read (see normalizeDefault)
// rather than forced into a <select> that has no such option, which would show
// an empty control and generate whatever the first option happened to be.
//
// Pure. No React, no Supabase — see components/admin/Reports/useSiteReportDefaults.js
// for both.

/** What a custom span may be. Beyond a year the window stops being a report. */
export const MIN_CUSTOM_DAYS = 1;
export const MAX_CUSTOM_DAYS = 366;

/**
 * A whole number of days inside the allowed span.
 *
 * Lives here rather than in the modal because a stored default and a typed
 * field have to agree about what a legal span is: a row hand-edited to 3650
 * would otherwise load a window no one could have typed.
 *
 * A CLEARED field ('') is 0, not garbage, so it clamps to MIN_CUSTOM_DAYS —
 * which is what the Days input has always filled back in on blur. `fallback` is
 * only reached by something that is not a number at all ('abc', NaN); pass null
 * where "no span was stored" has to stay distinguishable from a span of one day.
 */
export function clampCustomDays(value, fallback = 2) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_CUSTOM_DAYS, Math.max(MIN_CUSTOM_DAYS, n));
}

const str = (v) => (v == null ? '' : String(v).trim());

/**
 * A stored row as the generator can actually use it, or null if it says nothing.
 *
 * `catalogues` are the lists the form really offers. A value outside them is
 * dropped rather than kept: rows outlive renames — a category retired from the
 * UI, an InSAR type that moved — and the failure we want from a stale row is
 * "this site has no saved default for that field", not a form set to something
 * it cannot show.
 *
 * @param {object|null} row  A `site_report_defaults` row (snake_case) or an
 *   already-camelCased selection. Both are accepted so the save path can
 *   round-trip what it is about to write.
 * @param {{reportTypes?: string[], categories?: string[], frequencies?: string[]}} catalogues
 * @returns {{siteId: string|null, reportType: string|null, category: string|null,
 *   frequency: string|null, customDays: number|null, updatedAt: string|null,
 *   updatedBy: string|null}|null}
 */
export function normalizeDefault(row, catalogues = {}) {
  if (!row || typeof row !== 'object') return null;

  const { reportTypes = [], categories = [], frequencies = [] } = catalogues;
  const pick = (value, allowed) => {
    const v = str(value);
    return v && allowed.includes(v) ? v : null;
  };

  const reportType = pick(row.report_type ?? row.reportType, reportTypes);
  const category = pick(row.category, categories);
  const frequency = pick(row.frequency, frequencies);

  // Only meaningful behind a custom frequency, and only when one was stored —
  // defaulting it to 2 would quietly rewrite a site's window.
  const rawDays = row.custom_days ?? row.customDays;
  const customDays =
    rawDays === null || rawDays === undefined || rawDays === '' ? null : clampCustomDays(rawDays, null);

  // A row that survives normalisation with nothing left in it is not a default.
  if (!reportType && !category && !frequency && customDays === null) return null;

  const siteId = row.site_id ?? row.siteId;

  return {
    siteId: siteId === null || siteId === undefined ? null : String(siteId),
    reportType,
    category,
    frequency,
    customDays: Number.isFinite(customDays) ? customDays : null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
    updatedBy: row.updated_by ?? row.updatedBy ?? null,
  };
}

/**
 * Every site's default, keyed by site id AS A STRING.
 *
 * String keys because `clients.id` is a bigint that reaches the form through a
 * <select> value — `'12'` from the DOM would never match `12` from the database.
 * A row that normalises to nothing is left out entirely, so `has()` answers
 * "this site has a usable default", not "a row exists".
 */
export function defaultsBySite(rows, catalogues = {}) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const def = normalizeDefault(row, catalogues);
    if (def?.siteId) map.set(def.siteId, def);
  }
  return map;
}

/**
 * The form fields a default sets, merged over the current selection.
 *
 * Fields the default does not name are LEFT ALONE — that is what makes a
 * category-only default legal. The caller re-derives whatever depends on these
 * (the Tabulation report's fixed daily frequency, the Start Date), because those
 * rules belong to the form, not to the stored row.
 */
export function applyDefaultToForm(form, def) {
  if (!def) return form;
  const next = { ...form };
  if (def.reportType) next.reportType = def.reportType;
  if (def.category) next.category = def.category;
  if (def.frequency) next.frequency = def.frequency;
  if (def.customDays !== null && def.customDays !== undefined) next.customDays = def.customDays;
  return next;
}

/**
 * The row to write for a selection.
 *
 * `customDays` is stored only behind a custom frequency: keeping the field's
 * last value against a Weekly default would resurrect a span the analyst never
 * chose the next time someone picked Custom.
 */
export function serializeDefault(siteId, selection, { customFrequency = 'custom', updatedBy = '' } = {}) {
  const frequency = str(selection?.frequency) || null;
  return {
    site_id: siteId,
    report_type: str(selection?.reportType) || null,
    category: str(selection?.category) || null,
    frequency,
    custom_days: frequency === customFrequency ? clampCustomDays(selection?.customDays) : null,
    updated_by: str(updatedBy) || null,
  };
}

/**
 * Does the form already sit on this site's saved default?
 *
 * Only the fields the default NAMES are compared — a default that says
 * "Comprehensive" is satisfied by any frequency, because it never claimed one.
 * Used to tell "Saved as this site's default" from "Save current as default",
 * so the button does not offer to write a row that already says this.
 */
export function matchesDefault(def, selection, { customFrequency = 'custom' } = {}) {
  if (!def || !selection) return false;
  if (def.reportType && def.reportType !== selection.reportType) return false;
  if (def.category && def.category !== selection.category) return false;
  if (def.frequency && def.frequency !== selection.frequency) return false;
  if (
    def.frequency === customFrequency &&
    def.customDays !== null &&
    def.customDays !== clampCustomDays(selection?.customDays)
  ) {
    return false;
  }
  return true;
}

/**
 * A default in one line — 'Radar · Comprehensive · Weekly'.
 *
 * `frequencyLabels` maps the stored value to what the form calls it, so the
 * summary reads in the analyst's words ('Daily') and not the database's
 * ('daily'). A custom span names its length, the same way the filename does.
 */
export function describeDefault(def, { frequencyLabels = {}, customFrequency = 'custom' } = {}) {
  if (!def) return '';
  const parts = [];
  if (def.reportType) parts.push(def.reportType);
  if (def.category) parts.push(def.category);
  if (def.frequency) {
    const label = frequencyLabels[def.frequency] || def.frequency;
    parts.push(
      def.frequency === customFrequency && def.customDays ? `${def.customDays}-day window` : label
    );
  }
  return parts.join(' · ');
}

export default normalizeDefault;
