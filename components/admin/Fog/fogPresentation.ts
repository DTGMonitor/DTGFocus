// components/admin/Fog/fogPresentation.ts
//
// Shared presentation rules for the fog views: how a verdict looks, how a
// number is written, and where a line is allowed to connect.
//
// No React here — the mappings are data, so they can be tested and so two
// components cannot drift on what "AMBIGUOUS" means.

import { formatInTimeZone } from 'date-fns-tz';
import {
  CircleCheck,
  CircleHelp,
  CloudFog,
  CloudSun,
  Hourglass,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';

export type Verdict =
  | 'FOG'
  | 'FOG_LIKELY'
  | 'AMBIGUOUS'
  | 'NOT_FOG'
  | 'NO_FOG'
  | 'INSUFFICIENT_HISTORY';

/**
 * Status tokens, not series colours.
 *
 * A verdict encodes STATE (good -> critical), so it wears the reserved status
 * scale and never a categorical hue — a fog verdict must never be mistakable
 * for "series 4" of a chart. Every use ships an icon AND a label, which is
 * also what makes the two sub-3:1 steps (warning, serious) legible on the
 * light surface.
 */
export interface VerdictStyle {
  label: string;
  /** One line, in operator language, not algorithm language. */
  gloss: string;
  icon: LucideIcon;
  /** CSS custom property holding the status colour. */
  token: string;
  /** Tailwind classes for the badge, kept away from the chart tokens. */
  badge: string;
}

export const VERDICT_STYLE: Record<Verdict, VerdictStyle> = {
  FOG: {
    label: 'Fog',
    gloss: 'Confirmed by radiation suppression, not inferred',
    icon: CloudFog,
    token: 'var(--status-critical)',
    badge: 'bg-[var(--status-critical)]/12 text-[var(--status-critical)] border-[var(--status-critical)]/35',
  },
  FOG_LIKELY: {
    label: 'Fog likely',
    gloss: 'Every radiation-fog precondition is satisfied',
    icon: TriangleAlert,
    token: 'var(--status-serious)',
    badge: 'bg-[var(--status-serious)]/12 text-[var(--status-serious)] border-[var(--status-serious)]/35',
  },
  AMBIGUOUS: {
    label: 'Ambiguous',
    gloss: 'Saturated, but the distinguishing signals are weak',
    icon: CircleHelp,
    token: 'var(--status-warning)',
    badge: 'bg-[var(--status-warning)]/15 text-[var(--status-warning)] border-[var(--status-warning)]/35',
  },
  NOT_FOG: {
    label: 'Not fog',
    gloss: 'Radiation is suppressed, but the air is dry — low stratus or overcast',
    icon: CloudSun,
    token: 'var(--status-good)',
    badge: 'bg-[var(--status-good)]/12 text-[var(--status-good)] border-[var(--status-good)]/35',
  },
  NO_FOG: {
    label: 'No fog',
    gloss: 'Conditions do not support fog',
    icon: CircleCheck,
    token: 'var(--status-good)',
    badge: 'bg-[var(--status-good)]/12 text-[var(--status-good)] border-[var(--status-good)]/35',
  },
  INSUFFICIENT_HISTORY: {
    label: 'Not enough history',
    gloss: 'The endpoint returns no past data — history fills by polling',
    icon: Hourglass,
    token: 'var(--fog-ink-muted)',
    badge: 'bg-muted text-muted-foreground border-border',
  },
};

export const COMPONENT_LABEL: Record<string, string> = {
  saturation: 'Saturation',
  persistence: 'Persistence',
  wind: 'Wind',
  plateau: 'Thermal plateau',
  radiative: 'Radiative precondition',
  reservoir: 'Moisture reservoir',
};

export const GATE_LABEL: Record<string, string> = {
  raining: 'Raining now',
  not_saturated: 'Air not saturated',
  wind_too_strong: 'Wind above the veto',
};

/**
 * The longest gap a chart line may bridge, in minutes.
 *
 * Beyond this the series is broken with a null point rather than drawn
 * straight across. A five-minute poll tolerates three consecutive misses; past
 * that we do not know what the air did, and a continuous line would assert
 * that we do. Deliberately the same tolerance the rainfall coverage rule uses,
 * so "we were watching" means one thing across the whole feature.
 */
export const MAX_CONNECT_MINUTES = 20;

/** Insert explicit nulls where polling stopped, so the line breaks honestly. */
export function breakOnGaps<T extends { t: number }>(
  points: T[],
  nullFields: (keyof T)[]
): T[] {
  const out: T[] = [];

  points.forEach((point, i) => {
    if (i > 0) {
      const gapMinutes = (point.t - points[i - 1].t) / 60_000;
      if (gapMinutes > MAX_CONNECT_MINUTES) {
        const blank = { t: points[i - 1].t + 1 } as T;
        for (const field of nullFields) {
          (blank as Record<keyof T, unknown>)[field] = null;
        }
        out.push(blank);
      }
    }
    out.push(point);
  });

  return out;
}

/**
 * Contiguous spans where the air was saturated, for shading the chart.
 *
 * A span is closed when the reading leaves saturation OR when polling gapped —
 * shading across a hole would claim the layer persisted through hours nobody
 * watched.
 */
export function saturationSpans(
  points: { t: number; dpdC: number | null }[],
  dpdSatC: number
): { from: number; to: number }[] {
  const spans: { from: number; to: number }[] = [];
  let start: number | null = null;
  let previous: number | null = null;

  for (const p of points) {
    const gapped =
      previous !== null && (p.t - previous) / 60_000 > MAX_CONNECT_MINUTES;
    const saturated = p.dpdC !== null && p.dpdC <= dpdSatC;

    if ((!saturated || gapped) && start !== null && previous !== null) {
      spans.push({ from: start, to: previous });
      start = null;
    }
    if (saturated && start === null) start = p.t;
    previous = p.t;
  }

  if (start !== null && previous !== null) spans.push({ from: start, to: previous });
  return spans.filter((s) => s.to > s.from);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Times are shown in the STATION's zone — that is the clock the data is on. */
export function inZone(iso: string | number | Date, tz: string, pattern: string): string {
  try {
    return formatInTimeZone(new Date(iso), tz, pattern);
  } catch {
    return formatInTimeZone(new Date(iso), 'UTC', pattern);
  }
}

/** An em dash, never "0" — a missing value and a zero are different facts. */
export function num(v: number | null | undefined, digits = 1, unit = ''): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v.toFixed(digits)}${unit ? ` ${unit}` : ''}`;
}

export function compass(deg: number | null | undefined): string {
  if (deg === null || deg === undefined || !Number.isFinite(deg)) return '—';
  const points = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
  ];
  return points[Math.floor(deg / 22.5 + 0.5) % 16];
}

export function describeAge(ageMinutes: number | null): string {
  if (ageMinutes === null) return 'no reading yet';
  if (ageMinutes < 1) return 'just now';
  if (ageMinutes < 60) return `${Math.round(ageMinutes)} min ago`;
  const hours = ageMinutes / 60;
  if (hours < 24) return `${hours.toFixed(1)} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
