'use client';

// components/admin/Fog/FogMonitor.tsx
//
// The page. Filter row on top, then status, conditions, convergence, rainfall.
//
// One filter row scoping everything below it — never a control inside a chart
// card. Refetches hold the previous render at reduced opacity rather than
// flashing a skeleton, so nothing jumps under the cursor every five minutes.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { ConditionsTile } from './ConditionsTile';
import { ConvergenceChart } from './ConvergenceChart';
import { FogGuidance, FogGuidanceButton } from './FogGuidance';
import { PeriodSummaryCard, type SummaryResponse } from './PeriodSummaryCard';
import { FogStatusCard } from './FogStatusCard';
import { RainfallPanel } from './RainfallPanel';
import { StationBinding } from './StationBinding';
import { STALE_AFTER_MINUTES } from '@/lib/weather/staleness';
import type {
  DataAge,
  FogResponse,
  RainfallResponse,
  WeatherResponse,
} from './types';

interface Site {
  id: number;
  site_name: string;
}

/** Matches the poll cadence: refetching faster cannot surface newer data. */
const REFRESH_MS = 5 * 60_000;

/** How often the age badges recompute. Cheap, and no network. */
const AGE_TICK_MS = 30_000;

/**
 * Recompute data age against the browser's clock.
 *
 * The server stamps an age when it answers, but the page then holds that
 * answer for up to five minutes. Left alone the badge would keep insisting
 * "1 min ago" while the reading quietly went half an hour stale — which is the
 * exact failure the badge exists to prevent.
 */
function liveAge(observedAt: string | null, now: number): DataAge {
  if (!observedAt) return { observedAt: null, ageMinutes: null, stale: true };
  const ageMinutes = (now - new Date(observedAt).getTime()) / 60_000;
  return {
    observedAt,
    ageMinutes: Number(ageMinutes.toFixed(1)),
    stale: ageMinutes > STALE_AFTER_MINUTES,
  };
}

export default function FogMonitor() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [range, setRange] = useState<'24h' | '7d'>('24h');

  const [fog, setFog] = useState<FogResponse | null>(null);
  const [weather, setWeather] = useState<WeatherResponse | null>(null);
  const [rain, setRain] = useState<RainfallResponse | null>(null);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);

  const [loading, setLoading] = useState(false);
  const [noStation, setNoStation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [guidanceOpen, setGuidanceOpen] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), AGE_TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase
        .from('clients')
        .select('id, site_name')
        .order('site_name');
      if (cancelled) return;
      if (err) {
        setError(err.message);
        return;
      }
      const rows = (data ?? []) as Site[];
      setSites(rows);
      setSiteId((current) => current ?? rows[0]?.id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(
    async (id: number, windowRange: '24h' | '7d') => {
      setLoading(true);
      setError(null);
      try {
        // The summary window follows the rainfall selector, so the dashboard
        // and the report agree about what "this period" covers.
        const summaryDays = windowRange === '24h' ? 1 : 7;

        const [fogRes, weatherRes, rainRes, summaryRes] = await Promise.all([
          fetch(`/api/sites/${id}/fog`),
          fetch(`/api/sites/${id}/weather`),
          fetch(`/api/sites/${id}/rainfall?range=${windowRange}`),
          fetch(`/api/sites/${id}/summary?days=${summaryDays}`),
        ]);

        if (!fogRes.ok) {
          // Distinguish the setup state from a genuine fault. Only a 404
          // carrying NO_STATION_BOUND means "bind a station"; a bare 404 is a
          // missing route, and showing the binding panel for it would hide the
          // real problem behind a plausible-looking screen.
          const body = await fogRes.json().catch(() => ({}));

          if (fogRes.status === 404 && body.code === 'NO_STATION_BOUND') {
            setNoStation(true);
            setFog(null);
            setWeather(null);
            setRain(null);
            setSummary(null);
            return;
          }

          if (fogRes.status === 404) {
            throw new Error(
              `/api/sites/${id}/fog was not found. The route is missing — ` +
                'restart the dev server, and check the migrations have been run.'
            );
          }
          if (fogRes.status === 401) {
            throw new Error('Session expired. Reload the page to sign in again.');
          }
          throw new Error(body.error ?? `Request failed (HTTP ${fogRes.status})`);
        }

        setNoStation(false);
        setFog(await fogRes.json());
        if (weatherRes.ok) setWeather(await weatherRes.json());
        if (rainRes.ok) setRain(await rainRes.json());
        if (summaryRes.ok) setSummary(await summaryRes.json());
        setNow(Date.now());
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (siteId === null) return;
    load(siteId, range);
    const timer = setInterval(() => load(siteId, range), REFRESH_MS);
    return () => clearInterval(timer);
  }, [siteId, range, load]);

  // Age is recomputed on every tick; the payloads themselves are untouched.
  const fogLive = useMemo(
    () =>
      fog ? { ...fog, dataAge: liveAge(fog.dataAge.observedAt, now) } : null,
    [fog, now]
  );
  const weatherLive = useMemo(
    () =>
      weather
        ? { ...weather, dataAge: liveAge(weather.dataAge.observedAt, now) }
        : null,
    [weather, now]
  );
  const rainLive = useMemo(
    () => (rain ? { ...rain, dataAge: liveAge(rain.dataAge.observedAt, now) } : null),
    [rain, now]
  );

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Fog monitor</h1>
          <p className="text-sm text-muted-foreground">
            Highland radiation and valley fog, scored from a bound public weather
            station. Thresholds are uncalibrated literature defaults — compare
            against observation before trusting them operationally.
          </p>
        </div>
        {/* Sits beside the title rather than in the filter row: it scopes
            nothing and filters nothing, and putting it there would imply it
            changes what the panels below show. */}
        <FogGuidanceButton onClick={() => setGuidanceOpen(true)} />
      </div>

      <FogGuidance open={guidanceOpen} onClose={() => setGuidanceOpen(false)} />

      {/* One filter row, above everything it scopes. */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">Site</span>
          {/* Mounted only once a site id exists. Rendering it earlier hands
              Radix `value={undefined}` and then a string, which is a switch
              from uncontrolled to controlled — React warns, and the component
              is entitled to drop the first selection. */}
          {siteId === null ? (
            <div className="flex h-9 w-56 items-center rounded-md border border-border px-3 text-sm text-muted-foreground">
              {sites.length === 0 ? 'Loading sites…' : 'No sites'}
            </div>
          ) : (
            <Select value={String(siteId)} onValueChange={(v) => setSiteId(Number(v))}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Select a site" />
              </SelectTrigger>
              <SelectContent>
                {sites.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.site_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </label>

        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">Rainfall window</span>
          <Select value={range} onValueChange={(v) => setRange(v as '24h' | '7d')}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">Last 24 hours</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
            </SelectContent>
          </Select>
        </label>

        <Button
          variant="outline"
          className="gap-2"
          disabled={loading || siteId === null}
          onClick={() => siteId !== null && load(siteId, range)}
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="size-4" aria-hidden />
          )}
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-[var(--status-critical)]/35 bg-[var(--status-critical)]/10 p-3 text-sm">
          {error}
        </div>
      )}

      {noStation && siteId !== null ? (
        <StationBinding
          siteId={siteId}
          onBound={() => {
            setNoStation(false);
            load(siteId, range);
          }}
        />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <FogStatusCard data={fogLive} loading={loading} />
            <ConditionsTile data={weatherLive} loading={loading} />
          </div>
          <PeriodSummaryCard
            data={summary}
            loading={loading}
            rangeLabel={range === '24h' ? '24 jam terakhir' : '7 hari terakhir'}
          />
          <ConvergenceChart data={fogLive} loading={loading} />
          <RainfallPanel data={rainLive} loading={loading} range={range} />
        </>
      )}
    </div>
  );
}
