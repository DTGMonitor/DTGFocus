// lib/supabaseRoute.ts
//
// A request-scoped Supabase client for route handlers, carrying the caller's
// session so ROW LEVEL SECURITY applies.
//
// This is deliberately NOT lib/supaBaseServer.js. That client holds the
// service-role key and bypasses RLS entirely; it belongs on the poll route,
// which writes. Every read route must go through this one instead, because
// middleware.ts explicitly excludes `/api` from its matcher:
//
//     '/((?!api|_next/static|_next/image|favicon.ico).*)'
//
// so nothing authenticates an API route unless the route does it itself. A
// read route reaching for the service client would be publicly readable data
// with an authentication check that looks present and isn't.

import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

/**
 * Build a client bound to the request's cookies.
 *
 * `setAll` is a no-op: these routes only read, and a route handler that
 * rewrites the session cookie mid-response races the browser client, which is
 * already refreshing its own token. An expired token surfaces as a 401 here
 * and the caller retries after its client refreshes.
 */
export async function createRouteClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {
          /* read-only: see above */
        },
      },
    }
  );
}

export interface AuthedRequest {
  supabase: SupabaseClient;
  user: User;
  isAdmin: boolean;
}

/**
 * Resolve the caller, or null when unauthenticated.
 *
 * Uses getUser(), which validates the JWT against the auth server, rather than
 * getSession(), which trusts whatever the cookie claims.
 *
 * The admin flag reads `user_metadata.role`, matching the convention
 * middleware.ts already uses for /admin and /tools.
 */
export async function authenticate(): Promise<AuthedRequest | null> {
  const supabase = await createRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  return {
    supabase,
    user,
    isAdmin: user.user_metadata?.role === 'admin',
  };
}
