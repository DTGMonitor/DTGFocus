// app/api/weather/poll/route.ts
//
// The cron target. Fetches every active station, upserts what it reported,
// re-scores it, and writes a poll_runs audit row.
//
// GET and POST both run the cycle. The spec calls for POST, and Vercel Cron
// issues GET — so both are exported rather than making the scheduler and the
// specification disagree.

import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { supabaseServer } from '@/lib/supaBaseServer';
import { runPoll } from '@/lib/weather/poll';

// Node, never edge: this route needs full fetch semantics against an
// undocumented third-party endpoint and a timeout longer than edge allows.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Constant-time comparison of the cron secret.
 *
 * A plain `===` on a secret leaks its length and, in principle, its prefix
 * through timing. Cheap to do properly.
 */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when the env var is
 * set. A manual trigger can send the same header, or `x-cron-secret`.
 *
 * A MISSING CRON_SECRET IS A HARD FAILURE, not an open door. This route writes
 * to the database with the service role and makes outbound requests on our
 * behalf; leaving it unauthenticated because a variable was not set is how it
 * ends up being run by anyone who guesses the path.
 */
function authorise(request: Request): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured; refusing to run the poll.' },
      { status: 500 }
    );
  }

  const header = request.headers.get('authorization') ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const provided = bearer || request.headers.get('x-cron-secret') || '';

  if (!provided || !secretMatches(provided, expected)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  return null;
}

async function handle(request: Request): Promise<NextResponse> {
  const denied = authorise(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const triggerSource = url.searchParams.get('source') ?? 'cron';

  // One evaluation instant for the whole cycle. Reading the clock per station
  // would measure two stations' data ages against different "nows".
  const now = new Date();

  try {
    const report = await runPoll(supabaseServer, { now, triggerSource });

    // 200 even when individual stations failed: the CYCLE succeeded, and a
    // non-2xx would make Vercel's cron log treat a single dead station as a
    // broken schedule. The failure count and error samples carry the detail.
    return NextResponse.json(report, { status: 200 });
  } catch (err) {
    // Only reachable if the audit write itself blew up — runPoll swallows
    // everything else.
    return NextResponse.json(
      { error: 'Poll cycle failed', detail: (err as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}

/** Vercel Cron issues GET. Same cycle, same authorisation. */
export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}
