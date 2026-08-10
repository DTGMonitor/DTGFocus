// lib/weather/poll.ts
//
// One polling cycle: fetch every active station, persist what it reported,
// re-score it, and record how the run went.
//
// The design constraint behind all of it: the public endpoint has NO HISTORY.
// A reading missed at 03:05 cannot be recovered at 03:10, or ever. So the poll
// is built to lose as little as possible — one station's failure never touches
// another's, the audit row is opened before any work starts, and every write
// is idempotent so a retry is always safe.

import { AmbientError, fetchStationRecords } from './ambient';
import { deriveReadings } from './derive';
import { assessFog, type PreviousState, type Verdict } from './fogIndex';
import { FOG_CONSTANTS } from '@/config/fogConstants';
import {
  fetchLatestAssessment,
  fetchReadings,
  finishPollRun,
  listActiveStations,
  startPollRun,
  toFogReading,
  upsertAssessment,
  upsertReadings,
  type PollOutcome,
  type StationRow,
} from './repository';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Stations polled at once.
 *
 * Three. This is an undocumented endpoint we do not pay for and whose operator
 * has no idea we exist; the polite ceiling matters more than the wall-clock
 * saving. At five-minute intervals even a dozen stations finish comfortably
 * inside the function timeout at this width.
 */
const MAX_CONCURRENT = 3;

/** Errors recorded per run. Enough to diagnose, not enough to bloat the table. */
const MAX_ERROR_SAMPLES = 5;

export interface StationPollResult {
  macAddress: string;
  siteId: number;
  ok: boolean;
  readingsUpserted: number;
  verdict: Verdict | null;
  scoreA: number | null;
  error: string | null;
}

export interface PollReport extends PollOutcome {
  runId: number | null;
  startedAt: string;
  finishedAt: string;
  results: StationPollResult[];
}

/**
 * Run `fn` over `items`, at most `limit` at a time.
 *
 * Workers pull from a shared cursor rather than being handed fixed slices, so
 * one slow station cannot leave the other lanes idle. Rejections are impossible
 * by construction — `fn` here always resolves — but the pool would propagate
 * one if it happened, which is why the per-station handler catches everything
 * itself.
 */
async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );

  return results;
}

/** Turn any thrown value into something worth reading in the audit table. */
function describeError(err: unknown): string {
  if (err instanceof AmbientError) return `${err.kind}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Poll one station end to end.
 *
 * NEVER THROWS. The caller's whole job is to keep one broken station from
 * costing the others their sample, and it can only do that if the failure
 * stops here.
 */
async function pollStation(
  db: SupabaseClient,
  station: StationRow,
  now: Date
): Promise<StationPollResult> {
  const base: StationPollResult = {
    macAddress: station.mac_address,
    siteId: station.site_id,
    ok: false,
    readingsUpserted: 0,
    verdict: null,
    scoreA: null,
    error: null,
  };

  try {
    // 1) Current conditions. One request. No bursts.
    const { parsed } = await fetchStationRecords(station.mac_address);

    // 2) Derive to SI at the station's own coordinates — the solar geometry
    //    belongs to the pyranometer, not to the pit it reports for.
    const { rows } = deriveReadings(
      parsed,
      {
        macAddress: station.mac_address,
        latitude: station.latitude,
        longitude: station.longitude,
      },
      now
    );

    const upserted = await upsertReadings(db, rows);

    // 3) Re-score against the accumulated window. Read back AFTER the upsert
    //    so this cycle's observation is included.
    const since = new Date(
      now.getTime() - FOG_CONSTANTS.windowHours * 3_600_000
    ).toISOString();
    const records = await fetchReadings(db, station.mac_address, since);

    if (records.length === 0) {
      // Nothing stored and nothing readable: no instant to anchor an
      // assessment to, so there is nothing honest to write.
      return { ...base, ok: true, readingsUpserted: upserted };
    }

    const readings = records.map(toFogReading);
    const assessedAt = new Date(records[records.length - 1].observed_at);

    // 4) Prior state for hysteresis, strictly BEFORE the instant being scored,
    //    so a rerun in the same minute cannot read back its own output.
    const previousRow = await fetchLatestAssessment(
      db,
      station.mac_address,
      assessedAt.toISOString()
    );
    const previous: PreviousState | null = previousRow
      ? {
          verdict: previousRow.verdict,
          // Rows written before migration 003 have no raw verdict. Falling
          // back to the published one makes the damping behave as if the
          // previous cycle agreed with itself, which is the conservative
          // reading of missing evidence.
          rawVerdict: previousRow.raw_verdict ?? previousRow.verdict,
        }
      : null;

    const result = assessFog(readings, { evaluatedAt: now, previous });
    await upsertAssessment(db, station.mac_address, assessedAt, result);

    return {
      ...base,
      ok: true,
      readingsUpserted: upserted,
      verdict: result.verdict,
      scoreA: result.status === 'scored' ? result.scoreA : null,
    };
  } catch (err) {
    return { ...base, error: describeError(err) };
  }
}

/**
 * One full polling cycle.
 *
 * `now` is passed in rather than read from the clock so the whole cycle shares
 * a single evaluation instant — otherwise two stations polled seconds apart
 * would report data ages measured against different "nows".
 */
export async function runPoll(
  db: SupabaseClient,
  options: { now: Date; triggerSource: string }
): Promise<PollReport> {
  const startedAt = options.now.toISOString();
  const runId = await startPollRun(db, options.triggerSource);

  let stations: StationRow[];
  try {
    stations = await listActiveStations(db);
  } catch (err) {
    const outcome: PollOutcome = {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      readingsInserted: 0,
      errorSamples: [{ mac: '-', error: describeError(err) }],
    };
    await finishPollRun(db, runId, outcome);
    return {
      ...outcome,
      runId,
      startedAt,
      finishedAt: new Date().toISOString(),
      results: [],
    };
  }

  const results = await mapWithLimit(stations, MAX_CONCURRENT, (station) =>
    pollStation(db, station, options.now)
  );

  const outcome: PollOutcome = {
    attempted: results.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    readingsInserted: results.reduce((s, r) => s + r.readingsUpserted, 0),
    errorSamples: results
      .filter((r) => r.error !== null)
      .slice(0, MAX_ERROR_SAMPLES)
      .map((r) => ({ mac: r.macAddress, error: r.error as string })),
  };

  await finishPollRun(db, runId, outcome);

  return {
    ...outcome,
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    results,
  };
}
