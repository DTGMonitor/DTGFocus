// useTarpDocument
//
// Loads the active TARP document for a site, and derives the email-engine
// policy from it.
//
// `policy` is non-null only when the site actually has an active document.
// While loading, and for sites not yet migrated, it stays null and the caller
// falls back to getTarpPolicyForSensor() — the legacy hard-coded map.
//
// Superseded versions are never loaded here. Whatever a TARP tab is showing,
// the version that drives an email is the ACTIVE one, so the hook every other
// caller uses can only return that. Reading an archived version is the separate,
// explicit act of `fetchTarpDocumentById` / `fetchTarpDocumentsForSite`.

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
  tarp_level_source,
  triggers:tarp_triggers (
    id, sort_order, parameter, risk_rating, band_label, trigger_label, colour, description,
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

// ---------------------------------------------------------------------------
// Version history
// ---------------------------------------------------------------------------

export interface TarpVersionSummary {
    id: number;
    version: number;
    status: 'draft' | 'active' | 'superseded';
    effectiveFrom: string | null;
    createdAt: string | null;
}

interface UseTarpVersionsResult {
    versions: TarpVersionSummary[];
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
}

/**
 * Every version this site has ever had, newest first.
 *
 * Deliberately a summary rather than the documents themselves: the picker only
 * needs the number, the status and the date, and a site with a long history
 * would otherwise pull every trigger row of every version to draw a dropdown.
 */
export function useTarpVersions(siteId?: number | string | null): UseTarpVersionsResult {
    const [versions, setVersions] = useState<TarpVersionSummary[]>([]);
    const [loading, setLoading] = useState(Boolean(siteId));
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!siteId) {
            setVersions([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);

        const { data, error: queryError } = await supabase
            .from('tarp_documents')
            .select('id, version, status, effective_from, created_at')
            .eq('site_id', siteId)
            .order('version', { ascending: false });

        if (queryError) {
            console.error('[useTarpVersions] load failed', queryError);
            setError(queryError.message);
            setVersions([]);
        } else {
            setVersions((data || []).map((row) => ({
                id: row.id,
                version: row.version ?? 0,
                status: (row.status ?? 'draft') as TarpVersionSummary['status'],
                effectiveFrom: row.effective_from ?? null,
                createdAt: row.created_at ?? null
            })));
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

    return { versions, loading, error, refresh: load };
}

/** One version in full, active or not. Throws so the caller can toast. */
export async function fetchTarpDocumentById(
    documentId: number | string
): Promise<TarpDocument | null> {
    const { data, error } = await supabase
        .from('tarp_documents')
        .select(SELECT)
        .eq('id', documentId)
        .maybeSingle();

    if (error) throw error;
    return normalizeTarpDocument(data);
}

/** Every version of a site's TARP, in full, newest first — for the export. */
export async function fetchTarpDocumentsForSite(
    siteId: number | string
): Promise<TarpDocument[]> {
    const { data, error } = await supabase
        .from('tarp_documents')
        .select(SELECT)
        .eq('site_id', siteId)
        .order('version', { ascending: false });

    if (error) throw error;
    return ((data || []) as unknown[])
        .map((row) => normalizeTarpDocument(row))
        .filter((doc): doc is TarpDocument => Boolean(doc));
}
