// app/api/crosscheckers/route.ts
//
// The detector / crosschecker roster: user_sites rows with role = 'admin',
// minus the exclusions in utils/crosscheckers.
//
// Read through the SERVICE-ROLE client, which is the exception lib/supabaseRoute
// warns about, so the reasoning belongs here: user_sites is not readable across
// users from a session — every client query in the app filters on the caller's
// own user_id, and the SECURITY DEFINER `get_safe_crosscheckers` RPC this route
// replaces exists precisely because a session cannot list the others. The check
// that route file asks for is present and real: an unauthenticated caller gets
// 401, and what an authenticated one receives — display name and auth uid — is
// the same pair the RPC already returned to anyone who could name a colleague.

import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supaBaseServer';
import { authenticate } from '@/lib/supabaseRoute';
import { CROSSCHECKER_ROLE, toCrosscheckers } from '@/utils/crosscheckers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const auth = await authenticate();
  if (!auth) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { data, error } = await supabaseServer
    .from('user_sites')
    .select('user_id, displayname')
    .eq('role', CROSSCHECKER_ROLE);

  if (error) {
    return NextResponse.json(
      { error: 'Failed to load crosscheckers', detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ crosscheckers: toCrosscheckers(data) });
}
