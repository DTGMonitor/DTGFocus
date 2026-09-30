'use client';

// components/admin/Fog/useRainfallTarpAlarm.ts
//
// The data behind the rainfall TARP popup: which bound sites have rainfall
// thresholds on their active TARP, what their rain gauges have done lately, and
// which breaches somebody has already signed for.
//
// SITES ARE DISCOVERED, NOT NAMED. Sorowako is the only site with a bound
// weather station today, and it is the only one whose TARP carries rainfall
// numbers — so it is the only one that alarms. Neither fact is written down
// here: a second site that binds a station and has thresholds set starts
// alarming with no code change, and a site with a station but no thresholds
// stays quiet. Hard-coding "Sorowako" would have been shorter and would have
// made the next site a code change.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  ALARM_WINDOW_HOURS,
  breachKey,
  evaluateRainfallTarp,
  type RainfallBreach,
  type RainfallTarpKind,
  type RainfallTarpTrigger,
} from '@/utils/rainfallTarp';
import type { RainfallResponse } from './types';

/** Matches the poll cadence. Refetching faster cannot surface newer rain. */
const REFRESH_MS = 5 * 60_000;

/** How often the window is re-evaluated against the clock, with no network. */
const TICK_MS = 60_000;

export interface RainfallAlarmSite {
  trigger: RainfallTarpTrigger;
  rainfall: RainfallResponse | null;
}

interface State {
  sites: RainfallAlarmSite[];
  acknowledged: Set<string>;
  error: string | null;
}

/**
 * The rainfall row on each site's ACTIVE TARP, with at least one threshold set.
 *
 * Keyed on `def_type = 'Rainfall Event'` rather than on wording or position,
 * because that is the key the email engine already resolves a rainfall record
 * against — so the popup and the email quote the same band by construction
 * rather than by coincidence.
 *
 * Only `status = 'active'` is considered, for the reason useTarpDocument states:
 * whatever a TARP tab happens to be showing, the version that drives a response
 * is the active one.
 */
async function fetchTriggers(): Promise<RainfallTarpTrigger[]> {
  const { data, error } = await supabase
    .from('tarp_triggers')
    .select(
      `rain_rate_mmh, rain_daily_mm, tarp_level, band_label, description,
       day_shift, night_shift, comments,
       document:tarp_documents!inner ( site_id, status, site:clients!inner ( id, site_name ) )`
    )
    .eq('def_type', 'Rainfall Event')
    .eq('document.status', 'active');

  if (error) throw new Error(error.message);

  type Row = {
    rain_rate_mmh: number | null;
    rain_daily_mm: number | null;
    tarp_level: number | null;
    band_label: string | null;
    description: string | null;
    day_shift: string | null;
    night_shift: string | null;
    comments: string[] | null;
    document: {
      site_id: number;
      site: { id: number; site_name: string } | null;
    } | null;
  };

  return ((data ?? []) as unknown as Row[])
    // A row with neither number is a site that tracks rainfall-driven
    // displacement but has agreed no rain threshold — Telfer and Hidden Valley
    // both look like this. Nothing to alarm on.
    .filter((r) => r.rain_rate_mmh !== null || r.rain_daily_mm !== null)
    .map((r) => ({
      siteId: r.document?.site_id as number,
      siteName: r.document?.site?.site_name ?? `Site ${r.document?.site_id}`,
      rateMmh: r.rain_rate_mmh,
      dailyMm: r.rain_daily_mm,
      tarpLevel: r.tarp_level,
      bandLabel: r.band_label,
      description: r.description,
      dayShift: r.day_shift,
      nightShift: r.night_shift,
      comments: r.comments ?? [],
    }))
    .filter((t) => Number.isFinite(t.siteId));
}

/** Only the bound sites can alarm: no station, no rain gauge, no measurement. */
async function fetchBoundSiteIds(): Promise<Set<number>> {
  const { data, error } = await supabase
    .from('weather_stations')
    .select('site_id')
    .eq('is_active', true);

  if (error) throw new Error(error.message);
  return new Set(((data ?? []) as { site_id: number }[]).map((s) => s.site_id));
}

/**
 * Event keys already signed for, over a window wider than the alarm's own.
 *
 * Wider on purpose: the filter is a cheap way to keep the query small, and a
 * boundary that sat exactly on the alarm window would risk an ack scrolling out
 * of the read a moment before its breach scrolls out of the alarm — which would
 * show the popup again for something already answered.
 */
async function fetchAcks(siteIds: number[], now: Date): Promise<Set<string>> {
  if (siteIds.length === 0) return new Set();

  const since = new Date(now.getTime() - 3 * ALARM_WINDOW_HOURS * 3_600_000);
  const { data, error } = await supabase
    .from('rainfall_tarp_acks')
    .select('site_id, kind, bucket_start')
    .in('site_id', siteIds)
    .gte('bucket_start', since.toISOString());

  if (error) throw new Error(error.message);

  return new Set(
    ((data ?? []) as {
      site_id: number;
      kind: RainfallTarpKind;
      bucket_start: string;
    }[])
      .map((a) => breachKey(a.site_id, a.kind, a.bucket_start))
  );
}

/**
 * Watches every station-bound site against its TARP's rainfall thresholds.
 *
 * `breaches` holds only what nobody has signed for, so an empty array is the
 * normal state and the popup renders nothing.
 */
export function useRainfallTarpAlarm() {
  const [state, setState] = useState<State>({
    sites: [],
    acknowledged: new Set(),
    error: null,
  });
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    try {
      const [triggers, bound] = await Promise.all([
        fetchTriggers(),
        fetchBoundSiteIds(),
      ]);

      const watched = triggers.filter((t) => bound.has(t.siteId));
      const at = new Date();

      // The rainfall route is the one place the hourly and daily rules live.
      // Re-deriving them here from raw readings would put a second
      // implementation of migration 002 in the browser.
      const [payloads, acknowledged] = await Promise.all([
        Promise.all(
          watched.map(async (t) => {
            const res = await fetch(`/api/sites/${t.siteId}/rainfall?range=24h`);
            if (!res.ok) return null;
            return (await res.json()) as RainfallResponse;
          })
        ),
        fetchAcks(watched.map((t) => t.siteId), at),
      ]);

      setState({
        sites: watched.map((trigger, i) => ({ trigger, rainfall: payloads[i] })),
        acknowledged,
        error: null,
      });
      setNow(at);
    } catch (err) {
      // Reported, never thrown: a failed read must not take down the Radar
      // shell this is mounted in. It does mean an outage here is a SILENT loss
      // of alarming, which is why the message is surfaced on the popup's own
      // card when there is anything else to show.
      setState((prev) => ({ ...prev, error: (err as Error).message }));
    }
  }, []);

  useEffect(() => {
    load();
    const reload = setInterval(load, REFRESH_MS);
    const tick = setInterval(() => setNow(new Date()), TICK_MS);
    return () => {
      clearInterval(reload);
      clearInterval(tick);
    };
  }, [load]);

  const breaches: RainfallBreach[] = useMemo(() => {
    const all: RainfallBreach[] = [];
    for (const site of state.sites) {
      if (!site.rainfall) continue;
      all.push(
        ...evaluateRainfallTarp({
          trigger: site.trigger,
          // Full-resolution readings, not the hourly grid: a crossing is a
          // reading, and bucketing would hide the moment it happened.
          series: site.rainfall.series,
          daily: site.rainfall.daily,
          now,
          acknowledged: state.acknowledged,
        })
      );
    }
    return all.sort(
      (a, b) => new Date(b.bucketStart).getTime() - new Date(a.bucketStart).getTime()
    );
  }, [state.sites, state.acknowledged, now]);

  /** Mark one event signed locally, so the popup closes without a round trip. */
  const markAcknowledged = useCallback((key: string) => {
    setState((prev) => {
      const next = new Set(prev.acknowledged);
      next.add(key);
      return { ...prev, acknowledged: next };
    });
  }, []);

  const siteFor = useCallback(
    (siteId: number) => state.sites.find((s) => s.trigger.siteId === siteId) ?? null,
    [state.sites]
  );

  return { breaches, siteFor, error: state.error, refresh: load, markAcknowledged };
}
