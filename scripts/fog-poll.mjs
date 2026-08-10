#!/usr/bin/env node
//
// scripts/fog-poll.mjs — drive /api/weather/poll on a loop.
//
// WHY THIS EXISTS
// ---------------
// Vercel Cron only runs against a deployment. It never fires at `npm run dev`,
// so during local development nothing polls, no readings accumulate, and the
// fog index sits at INSUFFICIENT_HISTORY forever no matter how long you leave
// the page open.
//
// This is that cron, run from your machine. Leave it running in a terminal
// while you work; it is unrelated to the browser, so refreshing the page,
// switching tabs, or closing the tab entirely changes nothing. History lives in
// Postgres.
//
// Usage:
//   npm run poll:fog                       # every 5 min against localhost:3000
//   npm run poll:fog -- --once             # a single cycle, then exit
//   npm run poll:fog -- --interval 60      # every 60 s (see the note below)
//   npm run poll:fog -- --url https://your-app.vercel.app
//
// A NOTE ON INTERVAL: ASBSAR1 publishes a new observation about every five
// minutes. Polling faster does not produce history faster — the upsert on
// (mac_address, observed_at) simply rewrites the same row. Eight readings takes
// roughly forty minutes of wall clock and there is no way around that; the
// endpoint has no history to backfill from.

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const BASE = (flag('url', 'http://localhost:3000') ?? '').replace(/\/$/, '');
const INTERVAL_S = Number(flag('interval', '300'));
const ONCE = args.includes('--once');

/** Read a key from .env.local without pulling in a dotenv dependency. */
function fromEnvFile(key) {
  try {
    const text = readFileSync(join(process.cwd(), '.env.local'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && match[1] === key) {
        return match[2].replace(/^["']|["']$/g, '').trim();
      }
    }
  } catch {
    /* no .env.local — fall through */
  }
  return undefined;
}

const secret = process.env.CRON_SECRET ?? fromEnvFile('CRON_SECRET');

if (!secret) {
  // Not a warning to be worked around: the poll route writes with the service
  // role and makes outbound requests, so it refuses to run unauthenticated.
  console.error(`
CRON_SECRET is not set, and /api/weather/poll refuses to run without it.

Add this line to .env.local (restart the dev server afterwards), and set the
same value in your Vercel project environment so the deployed cron works too:

  CRON_SECRET=${randomBytes(24).toString('base64url')}
`);
  process.exit(1);
}

const stamp = () => new Date().toISOString().slice(11, 19);

async function cycle() {
  const url = `${BASE}/api/weather/poll?source=manual`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    });
    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error(`${stamp()}  HTTP ${res.status}  ${body.error ?? ''}`);
      if (res.status === 401) {
        console.error('          CRON_SECRET here does not match the server’s.');
      }
      return;
    }

    if (body.attempted === 0) {
      console.log(
        `${stamp()}  no active stations — bind one in the FOG MONITOR tab first`
      );
      return;
    }

    const parts = body.results.map((r) =>
      r.ok
        ? `${r.macAddress} ${r.verdict ?? 'no assessment'}${
            r.scoreA === null || r.scoreA === undefined ? '' : ` (${r.scoreA}/100)`
          }`
        : `${r.macAddress} FAILED: ${r.error}`
    );

    console.log(
      `${stamp()}  ${body.succeeded}/${body.attempted} ok · ` +
        `${body.readingsInserted} rows upserted · ${parts.join(' | ')}`
    );
  } catch (err) {
    console.error(`${stamp()}  ${err.message}`);
    if (err.cause?.code === 'ECONNREFUSED') {
      console.error(`          nothing listening on ${BASE} — is the dev server up?`);
    }
  }
}

console.log(
  `polling ${BASE}/api/weather/poll every ${INTERVAL_S}s` +
    `${ONCE ? ' (single cycle)' : ' — ctrl-c to stop'}`
);
console.log(
  'readings accumulate in Postgres, not in the browser; the index needs 8 of them\n'
);

await cycle();
if (!ONCE) setInterval(cycle, INTERVAL_S * 1000);
