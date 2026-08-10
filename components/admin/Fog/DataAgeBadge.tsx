'use client';

// components/admin/Fog/DataAgeBadge.tsx
//
// Every view in this feature carries one of these.
//
// A stale reading looks EXACTLY like a fresh one: same number, same colour,
// same confident tile. For fog that is the dangerous failure — a status card
// quietly asserting "no fog" from air measured ninety minutes ago, while the
// poller has been dead since midnight. The badge is not decoration; it is the
// only thing standing between the operator and that mistake.

import { Clock, TriangleAlert } from 'lucide-react';
import { describeAge, inZone } from './fogPresentation';
import type { DataAge } from './types';

export function DataAgeBadge({
  age,
  timezone,
  className = '',
}: {
  age: DataAge;
  timezone: string;
  className?: string;
}) {
  const stale = age.stale;
  const Icon = stale ? TriangleAlert : Clock;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${
        stale
          ? 'border-[var(--status-serious)]/35 bg-[var(--status-serious)]/12 text-[var(--status-serious)]'
          : 'border-border bg-muted text-muted-foreground'
      } ${className}`}
      title={
        age.observedAt
          ? `Observed ${inZone(age.observedAt, timezone, 'd MMM yyyy HH:mm')} (${timezone})`
          : 'No reading has been stored for this station yet'
      }
    >
      <Icon className="size-3" aria-hidden />
      {/* The word "stale" is carried in text, not colour alone. */}
      {stale && age.ageMinutes !== null ? 'Stale · ' : ''}
      {describeAge(age.ageMinutes)}
    </span>
  );
}
