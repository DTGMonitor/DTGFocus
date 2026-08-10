'use client';

// components/admin/Fog/StationBinding.tsx
//
// Search public stations near a site, compare them, bind one.
//
// Discovery deliberately does not auto-bind, and this panel is built to make
// that choice an informed one. Nearest is NOT best: a station three kilometres
// away with no pyranometer can never run Index B, so its score is never
// cross-checked against an observation — while one at eight kilometres that
// reports solar radiation can. Sensor coverage is shown at least as
// prominently as distance for exactly that reason.

import { useState } from 'react';
import { Link2, Loader2, Radar, TriangleAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { describeAge, num } from './fogPresentation';
import type { DiscoverResponse, StationCandidate } from './types';

const SENSORS = [
  { key: 'temperature', label: 'Temp' },
  { key: 'dewPoint', label: 'Dew pt' },
  { key: 'humidity', label: 'RH' },
  { key: 'wind', label: 'Wind' },
  { key: 'pressure', label: 'Pressure' },
  { key: 'rain', label: 'Rain' },
  { key: 'solar', label: 'Solar' },
  { key: 'uv', label: 'UV' },
] as const;

export function StationBinding({
  siteId,
  onBound,
}: {
  siteId: number;
  onBound: () => void;
}) {
  const [radiusKm, setRadiusKm] = useState(40);
  const [searching, setSearching] = useState(false);
  const [binding, setBinding] = useState<string | null>(null);
  const [result, setResult] = useState<DiscoverResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    setSearching(true);
    setError(null);
    try {
      const res = await fetch('/api/stations/discover', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ siteId, radiusKm }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Discovery failed');
      setResult(body as DiscoverResponse);
    } catch (err) {
      setError((err as Error).message);
      setResult(null);
    } finally {
      setSearching(false);
    }
  }

  async function bind(candidate: StationCandidate) {
    setBinding(candidate.macAddress);
    setError(null);
    try {
      const res = await fetch('/api/stations/bind', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          siteId,
          macAddress: candidate.macAddress,
          name: candidate.name,
          latitude: candidate.latitude,
          longitude: candidate.longitude,
          elevationM: candidate.elevationM ?? undefined,
          distanceKm: candidate.distanceKm,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail ?? body.error ?? 'Bind failed');
      onBound();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBinding(null);
    }
  }

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="text-base font-semibold">Bind a weather station</CardTitle>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Public Ambient Weather stations near this site. Binding starts the
          five-minute poll; the index needs about 40 minutes of history before it
          will score.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">Radius (km)</span>
            <Input
              type="number"
              min={1}
              max={200}
              value={radiusKm}
              onChange={(e) => setRadiusKm(Number(e.target.value))}
              className="w-28"
            />
          </label>
          <Button onClick={search} disabled={searching} className="gap-2">
            {searching ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Radar className="size-4" aria-hidden />
            )}
            Search
          </Button>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-[var(--status-critical)]/35 bg-[var(--status-critical)]/10 p-3 text-sm">
            <TriangleAlert
              className="mt-0.5 size-4 shrink-0 text-[var(--status-critical)]"
              aria-hidden
            />
            <span>{error}</span>
          </div>
        )}

        {result && result.candidates.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No public stations within {result.radiusKm} km. Try a wider radius —
            public coverage in remote mining areas is thin.
          </p>
        )}

        {result && result.candidates.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Candidate stations with distance and available sensors
              </caption>
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Station</th>
                  <th className="px-3 py-2 font-medium">Distance</th>
                  <th className="px-3 py-2 font-medium">Sensors</th>
                  <th className="px-3 py-2 font-medium">Last report</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {result.candidates.map((c) => {
                  const age =
                    c.lastReportAt === null
                      ? null
                      : (Date.now() - new Date(c.lastReportAt).getTime()) / 60_000;

                  return (
                    <tr key={c.macAddress} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-2">
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {c.macAddress}
                          {c.timezone && ` · ${c.timezone}`}
                        </div>
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {num(c.distanceKm, 1, 'km')}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {SENSORS.map((s) => {
                            const has = c.capabilities[s.key];
                            return (
                              <span
                                key={s.key}
                                className={`rounded px-1.5 py-0.5 text-[10px] ${
                                  has
                                    ? 'bg-muted text-foreground'
                                    : 'text-muted-foreground line-through'
                                }`}
                              >
                                {s.label}
                              </span>
                            );
                          })}
                        </div>
                        {!c.indexBCapable && (
                          <div className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--status-warning)]">
                            <TriangleAlert className="size-3" aria-hidden />
                            No pyranometer — index B can never run here
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {describeAge(age)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5"
                          disabled={binding !== null}
                          onClick={() => bind(c)}
                        >
                          {binding === c.macAddress ? (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden />
                          ) : (
                            <Link2 className="size-3.5" aria-hidden />
                          )}
                          Bind
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
