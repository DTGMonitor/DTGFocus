'use client';

/**
 * "Isi dari stasiun" — fills Kondisi Cuaca, Kondisi Kabut and Rekaman Curah
 * Hujan from the site's bound weather station.
 *
 * SCREEN-ONLY. It lives in the report toolbar, never inside the paginated
 * paper: DailySummary is also rendered into a hidden measurement layer to work
 * out page breaks, and a button in there would make the two passes measure
 * different heights.
 *
 * The fields stay editable afterwards. That is deliberate and not merely
 * convenient — the fog verdict is an INFERENCE from a station some distance
 * away, not an observation, and the analyst may have seen the pit with their
 * own eyes. The station gets the first word, not the last.
 *
 * The window comes from the same windowForFrequency() the rest of the report
 * uses, so a daily edition summarises its day and a weekly edition summarises
 * its seven — without this component knowing which it is.
 */

import { useState } from 'react';
import { windowForFrequency } from '@/utils/reportAvailability';

const btn = {
  padding: '4px 9px',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.2)',
  background: 'rgba(255,255,255,0.08)',
  color: '#fff',
  fontSize: 11,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

/**
 * @param {number|string} siteId     clients.id for the report's site.
 * @param {string} frequency         resolvedFrequency — 'daily' | 'weekly' | 'custom:<n>'.
 * @param {string} endDate           The report's End Date, a SITE day.
 * @param {string} timeZone          The site's IANA zone.
 * @param {'id'|'en'} locale         Resolved from the site, as the report is.
 * @param {Function} onFill          ({ weather, fog, rainfall }) => void
 */
export function StationSummaryFill({
  siteId,
  frequency,
  endDate,
  timeZone,
  locale = 'id',
  onFill,
}) {
  const [state, setState] = useState({ status: 'idle', message: '' });

  const disabled = !siteId || state.status === 'loading';

  async function fill() {
    setState({ status: 'loading', message: '' });
    try {
      const { windowStart, windowEnd } = windowForFrequency(
        frequency || 'daily',
        endDate,
        timeZone || 'UTC'
      );

      const params = new URLSearchParams({
        start: windowStart.toISOString(),
        end: windowEnd.toISOString(),
        locale,
      });

      const res = await fetch(`/api/sites/${siteId}/summary?${params}`);
      const body = await res.json().catch(() => ({}));

      if (res.status === 404 && body.code === 'NO_STATION_BOUND') {
        setState({
          status: 'error',
          message: 'No weather station is bound to this site.',
        });
        return;
      }
      if (!res.ok) {
        setState({ status: 'error', message: body.error || `HTTP ${res.status}` });
        return;
      }

      onFill?.(body.lines);

      // Data age is stated, not hidden behind a success tick. A summary built
      // from a poller that died yesterday looks identical to a fresh one, and
      // the analyst is the one signing the report.
      const age = body.dataAge?.stale
        ? ` — station data is stale (${Math.round(body.dataAge.ageMinutes ?? 0)} min old)`
        : '';
      setState({
        status: body.dataAge?.stale ? 'warn' : 'ok',
        message: `Filled from ${body.station?.name || 'station'}${age}`,
      });
    } catch (err) {
      setState({ status: 'error', message: err.message });
    }
  }

  const tone =
    state.status === 'error'
      ? '#fca5a5'
      : state.status === 'warn'
        ? '#fcd34d'
        : '#86efac';

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <button
        type="button"
        onClick={fill}
        disabled={disabled}
        style={{ ...btn, opacity: disabled ? 0.5 : 1 }}
        title="Fill weather, fog and rainfall from the site's weather station"
      >
        {state.status === 'loading' ? 'Mengisi…' : '⤓ Isi dari stasiun'}
      </button>
      {state.message ? (
        <span style={{ fontSize: 11, color: tone }}>{state.message}</span>
      ) : null}
    </span>
  );
}
