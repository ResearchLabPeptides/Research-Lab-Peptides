'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser client. Carries the anon key and is bound by Row Level Security, so
 * the worst a hostile page can do with it is read the public catalog.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
