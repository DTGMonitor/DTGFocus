import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { OPEN_STATUS, initialResolutions } from '@/utils/dqpImprovements';

/**
 * The recommendations still awaiting site feedback on a wall folder's alarm
 * regions, plus the per-row choices a form makes about them.
 *
 * `alarm_improvement` has no wall-folder column — it reaches one only through
 * alarm_record → alarm_region — so the region list IS the scope, exactly as
 * SensorDetail's "→ Optimal" gate has always scoped it.
 *
 * Choices are re-seeded on every open, never carried between openings: a
 * resolution the analyst picked and then cancelled out of must not reappear
 * pre-selected the next time the form is opened.
 *
 * @param {boolean} enabled  false keeps the hook idle (a non-alarm row, a closed form)
 * @param {Array<{id: number}>} regions
 * @param {{requireAll?: boolean}} opts  see initialResolutions
 */
export function useOpenImprovements(enabled, regions, opts = {}) {
    const requireAll = Boolean(opts.requireAll);
    const [improvements, setImprovements] = useState([]);
    const [loading, setLoading] = useState(false);
    const [resolutions, setResolutions] = useState({});

    // A stable dependency: `regions` is a fresh array on most parent renders.
    const regionIdKey = useMemo(
        () => (regions ?? []).map((r) => r?.id).filter((id) => id != null).join(','),
        [regions]
    );

    useEffect(() => {
        if (!enabled) {
            setImprovements([]);
            setResolutions({});
            return undefined;
        }

        const regionIds = regionIdKey ? regionIdKey.split(',') : [];
        if (!regionIds.length) {
            setImprovements([]);
            setResolutions({});
            return undefined;
        }

        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const { data, error } = await supabase
                    .from('alarm_improvement')
                    .select('id, type, issue, action, alarm_mask, recommendation_submission, alarm_records!inner(id, alarm_region, cause)')
                    .eq('improvement_status', OPEN_STATUS)
                    .in('alarm_records.alarm_region', regionIds)
                    .order('recommendation_submission', { ascending: false });

                if (error) throw error;
                if (cancelled) return;

                const rows = data ?? [];
                setImprovements(rows);
                setResolutions(initialResolutions(rows, { requireAll }));
            } catch (err) {
                console.error('Error loading open alarm improvements:', err);
                if (!cancelled) {
                    setImprovements([]);
                    setResolutions({});
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [enabled, regionIdKey, requireAll]);

    const setResolution = (id, patch) =>
        setResolutions((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

    return { improvements, loading, resolutions, setResolution };
}

export default useOpenImprovements;
