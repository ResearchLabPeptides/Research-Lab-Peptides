'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import {
  GATE_COOKIE,
  GATE_MAX_AGE_SECONDS,
  gateVersion,
  signGate,
  type AcknowledgementItem,
} from '@/lib/gate';

export interface GateResult {
  ok: boolean;
  message: string;
}

/**
 * Records a visitor's acknowledgements.
 *
 * The submitted keys are checked against what is actually active in the
 * database, so a modified page cannot register consent to an acknowledgement
 * that was never shown, or skip one that was.
 */
export async function acceptAcknowledgements(keys: string[]): Promise<GateResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('active_acknowledgements');

  if (error) {
    return { ok: false, message: 'We could not load the confirmations. Reload and try again.' };
  }

  const items = (data ?? []) as AcknowledgementItem[];
  const submitted = new Set(keys);

  const missing = items.filter((i) => i.is_required && !submitted.has(i.key));
  if (missing.length > 0) {
    return {
      ok: false,
      message:
        missing.length === 1
          ? 'One confirmation is still unchecked.'
          : `${missing.length} confirmations are still unchecked.`,
    };
  }

  // Keep only keys that genuinely exist and are active.
  const valid = items.filter((i) => submitted.has(i.key)).map((i) => i.key);

  const store = await cookies();
  store.set(
    GATE_COOKIE,
    signGate({ version: gateVersion(items), keys: valid, at: new Date().toISOString() }),
    {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: GATE_MAX_AGE_SECONDS,
    },
  );

  revalidatePath('/', 'layout');
  return { ok: true, message: 'Thanks — you can order now.' };
}
