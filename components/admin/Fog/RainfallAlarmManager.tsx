'use client';

// components/admin/Fog/RainfallAlarmManager.tsx
//
// The rainfall TARP popup. Mounted once in the admin Radar shell, beside
// ReportReminderManager, so it is active across tabs — an alarm only the Fog
// Monitor tab could raise would be an alarm nobody sees, since that is not the
// tab an operator sits on.
//
// BLOCKING, like the report reminder, and for a stronger reason: this is a TARP
// trigger the site has to be called or messaged about. What it is NOT is a
// dismiss button. The only way it closes is Acknowledge, which files a work-log
// entry in the same transaction (see migration 007) — or Snooze, which is
// explicitly not an acknowledgement, holds for SNOOZE_MINUTES in this browser
// only, and writes nothing. An operator who needs to read the rainfall chart
// before signing needs a way out of a modal that covers it; an operator who
// wants the alarm to go away permanently has to sign for it.
//
// WHAT IT QUOTES, AND WHY IT QUOTES SO MUCH
// The measured total, the threshold it passed, AND the TARP row's own printed
// description, together. The threshold is a number in a column; the description
// is the wording the site signed. Showing both is what makes a drift between
// them visible to the operator at the moment they are asked to put their name to
// one — see the header of the scalable-tarp migration 018.

import { useCallback, useEffect, useState } from 'react';
import { CloudRain, Check, Clock, AlertTriangle, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '@/lib/supabaseClient';
import { inZone } from './fogPresentation';
import { useRainfallTarpAlarm } from './useRainfallTarpAlarm';
import {
  composeRainfallWorkLog,
  describeDuration,
  trimMm,
  type RainfallBreach,
} from '@/utils/rainfallTarp';

/** How long Snooze holds. Long enough to read the chart, short enough to return. */
const SNOOZE_MINUTES = 15;

const SNOOZE_KEY = 'rainfallTarpSnooze';

/**
 * Snoozes live in localStorage on purpose — the opposite of the acknowledgement,
 * which is in the database on purpose.
 *
 * A snooze says "this operator, on this screen, is looking into it right now".
 * It is not a record of anything and it must not reach the other shift: if the
 * night shift comes on mid-snooze, they should see the alarm. Persisting it would
 * quietly widen a 15-minute pause into a handover-crossing silence.
 */
function loadSnoozes(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(SNOOZE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function snooze(key: string): void {
  try {
    const all = loadSnoozes();
    all[key] = Date.now() + SNOOZE_MINUTES * 60_000;
    window.localStorage.setItem(SNOOZE_KEY, JSON.stringify(all));
  } catch {
    /* A browser refusing storage means no snooze, not a broken alarm. */
  }
}

function isSnoozed(key: string, now: number): boolean {
  const until = loadSnoozes()[key];
  return typeof until === 'number' && until > now;
}

export default function RainfallAlarmManager() {
  const { breaches, siteFor, markAcknowledged, refresh } = useRainfallTarpAlarm();
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Drives snoozes expiring back into view without waiting for the 5-minute
  // refetch: a 15-minute snooze that only lifted on a data reload would be up to
  // five minutes late, and the operator asked for 15.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const acknowledge = useCallback(
    async (breach: RainfallBreach) => {
      const site = siteFor(breach.siteId);
      if (!site) return;

      const tz = site.rainfall?.station.timezone ?? 'UTC';
      setBusy(breach.key);

      try {
        const draft = composeRainfallWorkLog({
          breach,
          trigger: site.trigger,
          stationName: site.rainfall?.station.name ?? null,
          // The offset is part of the timestamp. A bare "15:00" would not say
          // whose clock it is, and the station is not necessarily on the
          // reader's.
          bucketLabel: inZone(
            breach.bucketStart,
            tz,
            breach.kind === 'rate' ? 'd MMM HH:mm X' : 'd MMM yyyy'
          ),
          // The minute the peak was read, not just the hour it fell in. A rate is
          // one reading at one moment, and this is what lets somebody find it on
          // the chart afterwards.
          peakLabel: breach.peakAt ? inZone(breach.peakAt, tz, 'd MMM HH:mm X') : null,
          localHour: Number(inZone(breach.bucketStart, tz, 'H')),
        });

        const { data, error } = await supabase.rpc('acknowledge_rainfall_tarp', {
          p_site_id: breach.siteId,
          p_kind: breach.kind,
          p_bucket_start: breach.bucketStart,
          // mm/h for an hourly event, mm for a daily one — the unit follows the
          // kind, on the row as in the popup. See the fog spec's migration 008.
          p_threshold_mm: breach.thresholdValue,
          p_measured_mm: breach.measuredValue,
          p_tarp_level: breach.tarpLevel,
          p_band_label: breach.bandLabel,
          p_subject_id: draft.subjectId,
          p_location: draft.location,
          p_action: draft.action,
          p_notes: draft.notes,
        });

        if (error) throw error;

        // `already_acknowledged` is a success: the other shift got there first,
        // or this is a second tab. Nothing more to file, and the popup should
        // close rather than argue.
        const row = Array.isArray(data) ? data[0] : data;
        markAcknowledged(breach.key);

        if (row?.already_acknowledged) {
          toast.success('Already acknowledged — work log entry exists');
        } else {
          toast.success('Acknowledged and logged in the work log');
        }
      } catch (err) {
        // The popup deliberately stays up. An acknowledgement whose work-log
        // entry did not land is not an acknowledgement, and the migration makes
        // the two inseparable — so a failure here means neither happened.
        console.error('[RainfallAlarmManager] acknowledge failed', err);
        toast.error(
          `Not acknowledged — the work log entry failed: ${(err as Error).message}`
        );
      } finally {
        setBusy(null);
        refresh();
      }
    },
    [siteFor, markAcknowledged, refresh]
  );

  const showing = breaches.filter((b) => !isSnoozed(b.key, now));
  if (showing.length === 0) return null;

  return (
    // z-110 sits one layer above ReportReminderManager's z-100, deliberately: if
    // both are up, a TARP trigger the site has to be told about outranks a
    // reminder to generate a report.
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="rainfall-alarm-title"
    >
      <style>{`
        @keyframes rainfall-alarm-flash {
          0%, 100% { border-color: #eab308; box-shadow: 0 0 0 1px rgba(234,179,8,0.6); }
          50% { border-color: #854d0e; box-shadow: 0 0 26px 4px rgba(234,179,8,0.55); }
        }
        .rainfall-alarm-flash { animation: rainfall-alarm-flash 1s ease-in-out infinite; }
      `}</style>

      <div className="rainfall-alarm-flash w-full max-w-lg rounded-xl border-4 bg-[var(--dtg-bg-card)] p-6">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-yellow-500/40 bg-yellow-500/20">
            <CloudRain className="size-6 text-yellow-400" aria-hidden />
          </div>
          <div>
            <h3
              id="rainfall-alarm-title"
              className="text-lg font-bold text-[var(--dtg-text-primary)]"
            >
              Rainfall TARP Trigger
            </h3>
            <p className="text-sm text-[var(--dtg-gray-500)]">
              {showing.length} rainfall threshold
              {showing.length === 1 ? '' : 's'} exceeded
            </p>
          </div>
        </div>

        <div className="my-4 max-h-[22rem] space-y-2 overflow-y-auto">
          {showing.map((b) => {
            const site = siteFor(b.siteId);
            const tz = site?.rainfall?.station.timezone ?? 'UTC';
            const working = busy === b.key;

            return (
              <div
                key={b.key}
                className="rounded-lg border border-yellow-500/30 bg-[var(--dtg-bg-primary)] p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[var(--dtg-text-primary)]">{b.siteName}</span>
                  {b.bandLabel && (
                    <span className="rounded border border-yellow-500/40 bg-yellow-500/10 px-1.5 py-0.5 text-xs text-yellow-300">
                      {b.bandLabel}
                    </span>
                  )}
                  {/* For a rate event the headline time is WHEN IT CROSSED, not
                      when it peaked: that instant is the event, and it is the one
                      the acknowledgement is filed under. */}
                  <span className="flex items-center gap-1 text-xs text-[var(--dtg-gray-500)]">
                    <Clock className="size-3" aria-hidden />
                    {b.kind === 'rate'
                      ? `Crossed ${inZone(b.bucketStart, tz, 'd MMM HH:mm X')}`
                      : `Day of ${inZone(b.bucketStart, tz, 'd MMM yyyy')}`}
                  </span>
                  {b.kind === 'rate' && b.ongoing && (
                    <span className="rounded border border-yellow-500/40 bg-yellow-500/15 px-1.5 py-0.5 text-xs font-medium text-yellow-200">
                      still above
                    </span>
                  )}
                </div>

                {/* The measurement against the number it passed, on one line and
                    in tabular figures, so the comparison is read rather than
                    reconstructed. */}
                <p className="mt-1.5 tabular-nums text-sm text-[var(--dtg-text-primary)]">
                  <span className="font-semibold text-yellow-300">
                    {trimMm(b.measuredValue)} {b.kind === 'rate' ? 'mm/h' : 'mm'}
                  </span>
                  <span className="text-[var(--dtg-gray-500)]">
                    {' '}
                    {b.kind === 'rate' ? 'peak' : 'measured'} · site TARP threshold
                    &gt;{trimMm(b.thresholdValue)} {b.unitLabel}
                  </span>
                </p>

                {/* HOW LONG IT HAS HELD, which is the figure a peak rate cannot
                    give. The rate is instantaneous, so a two-minute burst and an
                    hour of downpour can report the same peak and call for
                    different responses. The crossing reading is named beside it
                    because it is what the alarm is keyed on — and because a
                    crossing at 21 that peaked at 40 is a different story from one
                    that crossed at 39. */}
                {b.kind === 'rate' && (
                  <p className="mt-1 tabular-nums text-xs text-[var(--dtg-gray-500)]">
                    Crossed at {trimMm(b.onsetValue ?? b.measuredValue)} mm/h ·{' '}
                    above the threshold for {describeDuration(b.minutesAbove)}
                    {b.readingCount !== null && ` (${b.readingCount} reading${b.readingCount === 1 ? '' : 's'})`}
                  </p>
                )}

                {/* An incomplete day and a finished one are different claims. */}
                {b.kind === 'daily' && b.dayComplete === false && (
                  <p className="mt-1 text-xs text-[var(--dtg-gray-500)]">
                    Day still in progress — the total is a floor, not a final figure.
                  </p>
                )}

                {/* Says out loud what the acknowledgement buys, because the whole
                    point of an edge-triggered alarm is easy to mistake for a bug:
                    a rate that keeps climbing will NOT ask again. */}
                {b.kind === 'rate' && (
                  <p className="mt-1 text-xs text-[var(--dtg-gray-500)]">
                    Acknowledging covers this crossing, however high the rate goes
                    next. The alarm returns only if the rate falls back to{' '}
                    {trimMm(b.thresholdValue)} mm/h or below and rises past it
                    again.
                  </p>
                )}

                {/* The row's own wording, verbatim and in the site's own
                    language. This is the text the site signed; the threshold
                    above is our reading of it, and the two sit together so a
                    disagreement is impossible to miss. */}
                {site?.trigger.description && (
                  <p className="mt-2 border-l-2 border-yellow-500/40 pl-2 text-xs italic text-[var(--dtg-gray-400)]">
                    {site.trigger.description}
                  </p>
                )}

                {site && site.trigger.comments.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs text-[var(--dtg-gray-400)]">
                    {site.trigger.comments.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                )}

                {/* What the TARP asks for. Printed before the button, because it
                    is the thing being acknowledged — not the popup. */}
                <p className="mt-2 flex items-start gap-1.5 text-xs text-yellow-200/90">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                  <span>
                    Response required:{' '}
                    {(site?.trigger.dayShift ?? '')
                      .split(/\r?\n/)
                      .map((l) => l.trim())
                      .filter(Boolean)
                      .join(' · ') || 'per site TARP'}
                  </span>
                </p>

                <div className="mt-3 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      snooze(b.key);
                      setNow(Date.now());
                    }}
                    disabled={working}
                    className="rounded-md border border-[var(--dtg-border-medium)] px-3 py-1.5 text-sm text-[var(--dtg-gray-400)] transition-colors hover:bg-[var(--dtg-bg-card)] disabled:opacity-50"
                  >
                    Snooze {SNOOZE_MINUTES} min
                  </button>
                  <button
                    type="button"
                    onClick={() => acknowledge(b)}
                    disabled={working}
                    className="flex shrink-0 items-center gap-1.5 rounded-md bg-[#eab308] px-3 py-1.5 text-sm text-black transition-colors hover:bg-[#ca8a04] disabled:opacity-60"
                  >
                    {working ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Check className="size-4" aria-hidden />
                    )}
                    Acknowledge
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-xs text-[var(--dtg-gray-500)]">
          Acknowledging files a work log entry against the site under category
          &ldquo;rainfall&rdquo;, recording the threshold, the measurement and the
          window. Snooze records nothing and returns the alarm in{' '}
          {SNOOZE_MINUTES} minutes.
        </p>
      </div>
    </div>
  );
}
