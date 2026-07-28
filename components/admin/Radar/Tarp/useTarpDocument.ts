// useTarpDocument
//
// Loads the active TARP document for a site, and derives the email-engine
// policy from it.
//
// `policy` is non-null only when the site actually has an active document.
// While loading, and for sites not yet migrated, it stays null and the caller
// falls back to getTarpPolicyForSensor() — the legacy hard-coded map.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
    normalizeTarpDocument,
    buildPolicyFromDocument,
    type TarpDocument
} from '@/config/tarpDocument';
import type { TarpPolicy } from '@/config/tarpPolicy';

const SELECT = `
  id, site_id, heading, title, response_owner, version, status, effective_from,
  footer_note, escalation_note, distribution_raw,
  default_response_method, deescalation_response_method, deescalation_notice,
  subject_label_template, subject_label_template_alarm, alarm_prefix_style,
  triggers:tarp_triggers (
    id, sort_order, risk_rating, band_label, trigger_label, colour, description,
    day_shift, night_shift, comments, extra_note,
    def_type, tarp_level, requires_alarm, severity_bracket,
    subject_label, subject_label_alarm,
    response_method, response_notice
  ),
  contacts:tarp_contacts (
    id, kind, sort_order, name, role, phone, email
  ),
  revisions:tarp_revisions (
    id, seq, site_label, version_no, approval_date, approved_by_site, site_role,
    approved_by_dtg, dtg_role, modified_date, sections_modified, remark
  )
`;

interface UseTarpDocumentResult {
    document: TarpDocument | null;
    /** Null when the site has no active document — caller supplies the fallback. */
    policy: TarpPolicy | null;
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
}

export function useTarpDocument(siteId?: number | string | null): UseTarpDocumentResult {
    const [document, setDocument] = useState<TarpDocument | null>(null);
    const [loading, setLoading] = useState(Boolean(siteId));
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!siteId) {
            setDocument(null);
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);

        const { data, error: queryError } = await supabase
            .from('tarp_documents')
            .select(SELECT)
            .eq('site_id', siteId)
            .eq('status', 'active')
            .maybeSingle();

        if (queryError) {
            console.error('[useTarpDocument] load failed', queryError);
            setError(queryError.message);
            setDocument(null);
        } else {
            setDocument(normalizeTarpDocument(data));
        }
        setLoading(false);
    }, [siteId]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            await load();
            if (cancelled) return;
        })();
        return () => { cancelled = true; };
    }, [load]);

    const policy = document ? buildPolicyFromDocument(document) : null;

    return { document, policy, loading, error, refresh: load };
}
