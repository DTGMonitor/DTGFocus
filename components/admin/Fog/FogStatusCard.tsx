'use client';

// components/admin/Fog/FogStatusCard.tsx
//
// The verdict, the Index A meter, and the component breakdown.
//
// The score is a HEADLINE NUMBER, not a chart — one value, so it gets a hero
// figure and a thin meter rather than a bar chart with one bar. The component
// breakdown is a labelled list for the same reason: six rows of "earned out of
// available" is a table's job.
//
// Two things this card must never do: show a score without saying how much of
// it was actually measurable, and show a verdict without saying whether Index
// B was able to check it.

import { Ban, Info, Moon, SunDim } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataAgeBadge } from './DataAgeBadge';
import {
  COMPONENT_LABEL,
  GATE_LABEL,
  VERDICT_STYLE,
  inZone,
  num,
  type Verdict,
} from './fogPresentation';
import type { Assessment, FogResponse } from './types';

function Meter({
  score,
  token,
  thresholds,
}: {
  score: number;
  token: string;
  thresholds: { likelyMin: number; ambiguousMin: number };
}) {
  return (
    <div className="mt-3">
      <div
        className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Fog potential, index A"
      >
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${score}%`, backgroundColor: token }}
        />
      </div>
      {/* Threshold ticks, so the number is readable against the scale that
          produced the verdict rather than against nothing. */}
      <div className="relative mt-1 h-3">
        {[
          { at: thresholds.ambiguousMin, label: 'ambiguous' },
          { at: thresholds.likelyMin, label: 'likely' },
        ].map((t) => (
          <span
            key={t.label}
            className="absolute -translate-x-1/2 text-[10px] text-muted-foreground tabular-nums"
            style={{ left: `${t.at}%` }}
          >
            {t.at}
          </span>
        ))}
      </div>
    </div>
  );
}

function IndexBPanel({ assessment }: { assessment: Assessment }) {
  if (assessment.indexBAvailable) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
        <SunDim className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">Index B active.</span>{' '}
          The score has been cross-checked against measured solar radiation —
          this is an observation, not only a prediction.
        </p>
      </div>
    );
  }

  // The reason matters operationally: "it is night" resolves itself in a few
  // hours; "this station has no pyranometer" never will, and means Index B is
  // permanently unavailable at this site.
  return (
    <div className="flex items-start gap-2 rounded-lg border border-dashed border-border bg-muted/30 p-3 text-sm">
      <Moon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <p className="text-muted-foreground">
        <span className="font-medium text-foreground">Index B unavailable.</span>{' '}
        Confirmation needs the sun above 8° and a station that reports solar
        radiation. Until then the verdict rests on Index A alone.
      </p>
    </div>
  );
}

function Breakdown({ assessment }: { assessment: Assessment }) {
  const earned = assessment.components.reduce((s, c) => s + c.points, 0);
  const measurable = assessment.components.reduce(
    (s, c) => s + (c.available ? c.max : 0),
    0
  );

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Component breakdown
        </h4>
        <span className="text-xs text-muted-foreground tabular-nums">
          {earned} earned · {measurable} of 100 measurable
        </span>
      </div>

      <table className="w-full text-sm">
        <caption className="sr-only">
          Points earned against points available for each scoring component
        </caption>
        <tbody>
          {assessment.components.map((c) => {
            const pct = c.max > 0 ? (c.points / c.max) * 100 : 0;
            return (
              <tr key={c.component} className="border-b border-border/60 last:border-0">
                <td className="py-2 pr-3 align-top">
                  <div className="font-medium">
                    {COMPONENT_LABEL[c.component] ?? c.component}
                  </div>
                  <div className="text-xs text-muted-foreground">{c.detail}</div>
                  {!c.available && (
                    // Never colour alone: the constraint is written out.
                    <div className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--status-warning)]">
                      <Info className="size-3" aria-hidden />
                      Not yet fully measurable — history too short
                    </div>
                  )}
                </td>
                <td className="w-28 py-2 align-top">
                  <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: c.available
                          ? 'var(--fog-dew)'
                          : 'var(--fog-missing)',
                      }}
                    />
                  </div>
                </td>
                <td className="w-14 py-2 pl-3 text-right align-top tabular-nums">
                  {c.points}
                  <span className="text-muted-foreground">/{c.max}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function FogStatusCard({
  data,
  loading,
}: {
  data: FogResponse | null;
  loading: boolean;
}) {
  if (!data) {
    return (
      <Card className={loading ? 'opacity-60' : ''}>
        <CardHeader>
          <CardTitle>Fog status</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No data.</p>
        </CardContent>
      </Card>
    );
  }

  const { assessment, station, thresholds, dataAge } = data;
  const verdict: Verdict = assessment?.verdict ?? 'INSUFFICIENT_HISTORY';
  const style = VERDICT_STYLE[verdict];
  const Icon = style.icon;
  const score = assessment?.scoreA;

  return (
    // Refetches hold the previous render at reduced opacity — no skeleton
    // flash, no layout jump.
    <Card className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base font-semibold">Fog status</CardTitle>
          <DataAgeBadge age={dataAge} timezone={station.timezone} />
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div>
          <span
            className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-sm font-semibold ${style.badge}`}
          >
            <Icon className="size-4" aria-hidden />
            {style.label}
          </span>
          <p className="mt-2 text-sm text-muted-foreground">
            {assessment?.reason || style.gloss}
          </p>

          {assessment?.hysteresisHeld && assessment.rawVerdict && (
            <p className="mt-2 text-xs text-muted-foreground">
              Holding this verdict: the latest reading proposed{' '}
              <span className="font-medium text-foreground">
                {VERDICT_STYLE[assessment.rawVerdict].label}
              </span>
              , and a change needs two consecutive readings that agree.
            </p>
          )}
        </div>

        {score !== null && score !== undefined ? (
          <div>
            <div className="flex items-baseline gap-2">
              {/* Hero figure: system sans, proportional figures, no tabular-nums. */}
              <span
                className="text-4xl font-semibold leading-none"
                style={{ color: style.token }}
              >
                {score}
              </span>
              <span className="text-sm text-muted-foreground">/ 100 · index A</span>
            </div>
            <Meter score={score} token={style.token} thresholds={thresholds} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No score yet. The public endpoint returns current conditions only, so
            history accumulates by polling — the index needs 8 readings, about 40
            minutes, before it will assess anything.
            {assessment?.readingCount !== null &&
              assessment?.readingCount !== undefined && (
                <> Currently holding {assessment.readingCount}.</>
              )}
          </p>
        )}

        {assessment && assessment.gates.length > 0 && (
          <div className="rounded-lg border border-[var(--status-good)]/30 bg-[var(--status-good)]/8 p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--status-good)]">
              <Ban className="size-3.5" aria-hidden />
              Score vetoed
            </div>
            <ul className="mt-1.5 space-y-0.5 text-sm text-muted-foreground">
              {assessment.gates.map((g) => (
                <li key={g.gate}>
                  <span className="font-medium text-foreground">
                    {GATE_LABEL[g.gate] ?? g.gate}
                  </span>{' '}
                  — {g.detail}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-xs text-muted-foreground">
              A gate forces the total to zero. The components below still show
              what they earned, so a near miss stays visible.
            </p>
          </div>
        )}

        {assessment && <IndexBPanel assessment={assessment} />}
        {assessment && assessment.components.length > 0 && (
          <Breakdown assessment={assessment} />
        )}

        {assessment && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-3 text-xs sm:grid-cols-4">
            {[
              ['Saturated for', num(assessment.minutesSaturated, 0, 'min')],
              ['dT/dt', num(assessment.dTdt, 2, '°C/h')],
              ['Peak kt', num(assessment.ktPeak, 2)],
              ['History', num(assessment.historyHours, 1, 'h')],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-medium tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {assessment && (
          <p className="text-xs text-muted-foreground">
            Assessed {inZone(assessment.assessedAt, station.timezone, 'd MMM HH:mm')}{' '}
            ({station.timezone}) · thresholds v{assessment.algorithmVersion ?? '—'},
            uncalibrated literature defaults
          </p>
        )}
      </CardContent>
    </Card>
  );
}
