'use client';

/**
 * Every site's default report selection, loaded once and written back per site.
 *
 * ONE query for all sites, not one per site. The generator's client dropdown
 * already holds every client, the modal switches between them freely, and a
 * fetch per switch would put a round trip between choosing a site and seeing the
 * form settle on its report. The whole table is a few dozen narrow rows.
 *
 * The table is OPTIONAL at runtime. Until the migration is applied
 * (.kiro/specs/site-report-defaults/migrations/001_site_report_defaults.sql)
 * PostgREST answers "relation does not exist", and the right behaviour then is
 * the generator exactly as it was — every site opening on the form's own
 * defaults — with a line in the config pane saying why the control is inert.
 * A missing table must never be able to block writing a report.
 *
 * See utils/reportDefaults.js for the pure model; nothing here knows what a
 * category or a frequency IS.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { defaultsBySite, normalizeDefault, serializeDefault } from '@/utils/reportDefaults';

const TABLE = 'site_report_defaults';

/** Postgres: undefined_table. PostgREST forwards the code untouched. */
const MISSING_TABLE = '42P01';

const IDLE = { kind: 'idle', message: '' };
const EMPTY = new Map();

/**
 * @param {{reportTypes?: string[], categories?: string[], frequencies?: string[]}} catalogues
 *   The lists the form really offers. Passed in rather than imported so this
 *   hook cannot drift from the selects the analyst is looking at — a value
 *   outside them is dropped on read (see normalizeDefault).
 * @param {{enabled?: boolean, updatedBy?: string}} options
 */
export function useSiteReportDefaults(catalogues, { enabled = true, updatedBy = '' } = {}) {
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState(IDLE);
  // Latched, not derived from `status`: a save failure would otherwise clear the
  // "run the migration" notice and leave the control looking merely broken.
  const [available, setAvailable] = useState(true);

  // Stabilised: the caller builds these lists inline, so an unmemoised
  // dependency would re-map every default on every keystroke in the modal.
  const reportTypes = catalogues?.reportTypes;
  const categories = catalogues?.categories;
  const frequencies = catalogues?.frequencies;
  const catalogueKey = useMemo(
    () => JSON.stringify([reportTypes ?? [], categories ?? [], frequencies ?? []]),
    [reportTypes, categories, frequencies]
  );
  const resolvedCatalogues = useMemo(() => {
    const [types, cats, freqs] = JSON.parse(catalogueKey);
    return { reportTypes: types, categories: cats, frequencies: freqs };
  }, [catalogueKey]);

  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from(TABLE)
        .select('site_id, report_type, category, frequency, custom_days, updated_at, updated_by');

      if (cancelled) return;

      if (error) {
        setRows([]);
        if (error.code === MISSING_TABLE) {
          setAvailable(false);
          setStatus({
            kind: 'unavailable',
            message: 'Per-site defaults are not set up yet — run migration 001_site_report_defaults.sql.',
          });
        } else {
          setStatus({ kind: 'error', message: `Site defaults could not be loaded (${error.message}).` });
        }
        return;
      }

      setRows(data ?? []);
      setAvailable(true);
      setStatus(IDLE);
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const bySite = useMemo(
    () => (rows ? defaultsBySite(rows, resolvedCatalogues) : EMPTY),
    [rows, resolvedCatalogues]
  );

  /**
   * Whether the first load has finished — NOT whether anything was found.
   *
   * The caller applies a site's default exactly once per site, so it has to be
   * able to tell "no default for this site" from "not looked yet"; applying on
   * the empty map would spend that one chance before the rows arrive.
   */
  const ready = rows !== null || !enabled;

  const forSite = useCallback(
    (siteId) => (siteId === null || siteId === undefined || siteId === '' ? null : bySite.get(String(siteId)) ?? null),
    [bySite]
  );

  /**
   * Write this selection as the site's default.
   *
   * The saved row is merged into local state rather than refetched: the modal
   * shows "saved" state off the same map it applies from, and a round trip would
   * leave the two disagreeing for as long as it took.
   */
  const save = useCallback(
    async (siteId, selection) => {
      if (!siteId) return false;
      setStatus({ kind: 'saving', message: 'Saving…' });

      const payload = serializeDefault(siteId, selection, { updatedBy });
      const { data, error } = await supabase
        .from(TABLE)
        .upsert(payload, { onConflict: 'site_id' })
        .select('site_id, report_type, category, frequency, custom_days, updated_at, updated_by')
        .maybeSingle();

      if (error) {
        if (error.code === MISSING_TABLE) setAvailable(false);
        setStatus({
          kind: error.code === MISSING_TABLE ? 'unavailable' : 'error',
          message:
            error.code === MISSING_TABLE
              ? 'Per-site defaults are not set up yet — run migration 001_site_report_defaults.sql.'
              : `Could not save the default (${error.message}).`,
        });
        return false;
      }

      const saved = data ?? { ...payload, updated_at: null };
      setRows((prev) => [...(prev ?? []).filter((r) => String(r.site_id) !== String(siteId)), saved]);
      setStatus({ kind: 'saved', message: 'Saved as this site’s default.' });
      return true;
    },
    [updatedBy]
  );

  /** Drop the site's default; the generator falls back to the form's own. */
  const clear = useCallback(async (siteId) => {
    if (!siteId) return false;
    setStatus({ kind: 'saving', message: 'Clearing…' });

    const { error } = await supabase.from(TABLE).delete().eq('site_id', siteId);

    if (error) {
      if (error.code === MISSING_TABLE) setAvailable(false);
      setStatus({ kind: 'error', message: `Could not clear the default (${error.message}).` });
      return false;
    }

    setRows((prev) => (prev ?? []).filter((r) => String(r.site_id) !== String(siteId)));
    setStatus({ kind: 'idle', message: 'Default cleared.' });
    return true;
  }, []);

  return { ready, available, status, bySite, forSite, save, clear, normalize: normalizeDefault };
}

export default useSiteReportDefaults;
