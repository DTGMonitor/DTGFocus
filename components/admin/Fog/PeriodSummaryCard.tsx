'use client';

// components/admin/Fog/PeriodSummaryCard.tsx
//
// The three lines the daily report will print — Kondisi Cuaca, Kondisi Kabut,
// Rekaman Curah Hujan — shown on the dashboard.
//
// Deliberately the SAME text, from the same endpoint, that the report's "Isi
// dari stasiun" button writes into the document. An analyst who checks the
// dashboard and then generates the report should not meet two different
// sentences about the same day; if they do, one of them is wrong and there is
// no way to tell which.

import { CloudSun } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataAgeBadge } from './DataAgeBadge';
import { inZone } from './fogPresentation';
import type { DataAge, StationSummary } from './types';

export interface SummaryResponse {
  station: StationSummary;
  window: { start: string; end: string; hours: number; timeZone: string };
  locale: 'id' | 'en';
  lines: { weather: string; fog: string; rainfall: string };
  detail: {
    weather: { meanKt: number | null; daytimeSamples: number };
    rainfall: { measuredPeriods: number; wetPeriods: number; basis: string };
  };
  thresholds: { calibrated: boolean };
  dataAge: DataAge;
}

const LABEL: Record<'id' | 'en', { weather: string; fog: string; rainfall: string; heading: string; range: string }> = {
  id: {
    heading: 'Ringkasan untuk laporan',
    weather: 'Kondisi Cuaca',
    fog: 'Kondisi Kabut',
    rainfall: 'Rekaman Curah Hujan',
    range: 'Periode',
  },
  en: {
    heading: 'Report summary',
    weather: 'Weather Condition',
    fog: 'Fog Condition',
    rainfall: 'Rainfall Record',
    range: 'Period',
  },
};

export function PeriodSummaryCard({
  data,
  loading,
  rangeLabel,
}: {
  data: SummaryResponse | null;
  loading: boolean;
  rangeLabel: string;
}) {
  if (!data) return null;

  const t = LABEL[data.locale] ?? LABEL.id;
  const tz = data.window.timeZone;

  const rows: [string, string][] = [
    [t.weather, data.lines.weather],
    [t.fog, data.lines.fog],
    [t.rainfall, data.lines.rainfall],
  ];

  return (
    <Card className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <CloudSun className="size-4 text-muted-foreground" aria-hidden />
              {t.heading}
            </CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t.range}: {rangeLabel} ·{' '}
              {inZone(data.window.start, tz, 'd MMM HH:mm')} —{' '}
              {inZone(data.window.end, tz, 'd MMM HH:mm')} ({tz})
            </p>
          </div>
          <DataAgeBadge age={data.dataAge} timezone={tz} />
        </div>
      </CardHeader>

      <CardContent>
        <dl className="divide-y divide-border">
          {rows.map(([label, value]) => (
            <div key={label} className="flex flex-wrap gap-x-4 gap-y-0.5 py-2">
              <dt className="w-44 shrink-0 text-xs font-medium text-muted-foreground">
                {label}
              </dt>
              <dd className="flex-1 text-sm">{value}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-3 text-xs text-muted-foreground">
          {/* The provenance an analyst needs before signing this into a client
              document: how much the sky reading rests on, and that the bands
              behind it have never been checked against an observer here. */}
          Sky condition from {data.detail.weather.daytimeSamples} daytime samples
          {data.detail.weather.meanKt !== null && (
            <> · mean clearness {data.detail.weather.meanKt.toFixed(2)}</>
          )}{' '}
          · rainfall from {data.detail.rainfall.measuredPeriods} measured{' '}
          {data.detail.rainfall.basis === 'hourly' ? 'hours' : 'days'}
          {!data.thresholds.calibrated && ' · thresholds uncalibrated'}
        </p>
      </CardContent>
    </Card>
  );
}
