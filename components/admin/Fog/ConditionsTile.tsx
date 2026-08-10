'use client';

// components/admin/Fog/ConditionsTile.tsx
//
// Current conditions. A grid of stat tiles, not a chart — each value is one
// number with no shape to show.

import {
  Compass,
  Droplets,
  Gauge,
  Sun,
  Thermometer,
  Wind,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataAgeBadge } from './DataAgeBadge';
import { compass, num } from './fogPresentation';
import type { WeatherResponse } from './types';

function Tile({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </div>
      {/* Stat-tile values use proportional figures — tabular-nums makes a
          large standalone number read loose. */}
      <div className="mt-1 text-xl font-semibold leading-none">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function ConditionsTile({
  data,
  loading,
}: {
  data: WeatherResponse | null;
  loading: boolean;
}) {
  if (!data) return null;
  const c = data.conditions;
  const tz = data.station.timezone;

  return (
    <Card className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base font-semibold">
              Current conditions
            </CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {data.station.name ?? data.station.macAddress} ·{' '}
              {data.station.macAddress}
              {data.station.distanceKm !== null &&
                ` · ${data.station.distanceKm.toFixed(1)} km from site`}
            </p>
          </div>
          <DataAgeBadge age={data.dataAge} timezone={tz} />
        </div>
      </CardHeader>

      <CardContent>
        {!c ? (
          <p className="text-sm text-muted-foreground">
            {data.note ?? 'No reading stored for this station yet.'}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              <Tile
                label="Temperature"
                value={num(c.tempC, 1, '°C')}
                icon={Thermometer}
              />
              <Tile
                label="Dew point"
                value={num(c.dewPointC, 1, '°C')}
                sub={`depression ${num(c.dpdC, 2, '°C')}`}
                icon={Droplets}
              />
              <Tile
                label="Humidity"
                value={num(c.humidity, 0, '%')}
                // Said out loud because it governs how the score may be read:
                // Ambient computes dew point FROM humidity, so the two are one
                // measurement and are never scored as two.
                sub="dew point is derived from this"
                icon={Droplets}
              />
              <Tile
                label="Wind"
                value={num(c.windKmh, 1, 'km/h')}
                sub={`${compass(c.windDir)} · gust ${num(c.windGustKmh, 1, 'km/h')}`}
                icon={Wind}
              />
              <Tile
                label="Station pressure"
                value={num(c.pressureHpa, 1, 'hPa')}
                // NOT sea-level pressure on a station whose owner never set an
                // offset. Labelling it MSLP would be wrong by ~100 hPa here.
                sub="absolute, not reduced to sea level"
                icon={Gauge}
              />
              <Tile
                label="Solar radiation"
                value={num(c.solarWm2, 0, 'W/m²')}
                sub={`clearness ${num(c.clearnessIndex, 2)}`}
                icon={Sun}
              />
              <Tile label="UV index" value={num(c.uv, 0)} icon={Sun} />
              <Tile
                label="Sun elevation"
                value={num(c.solarElevationDeg, 0, '°')}
                sub={
                  (c.solarElevationDeg ?? -90) > 8
                    ? 'index B can run'
                    : 'too low for index B'
                }
                icon={Compass}
              />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Rain today {num(c.rainDailyMm, 1, 'mm')} · current rate{' '}
              {num(c.rainRateMmh, 1, 'mm/h')} (a rate, never summed into a total)
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
