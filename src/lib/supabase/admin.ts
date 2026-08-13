import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role client. Bypasses Row Level Security entirely.
 *
 * Only two things are allowed to use it:
 *   1. The checkout route, which calls place_order() on behalf of a customer
 *      who has no account and therefore no session.
 *   2. The order lookup route, for the same reason.
 *
 * It must never be imported into a Client Component. The `server-only` import
 * above turns that mistake into a build error rather than a leaked key.
 */
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Checkout cannot run without it — see .env.example.',
    );
  }

  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
