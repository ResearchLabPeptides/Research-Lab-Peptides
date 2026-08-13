'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import type { ActionResult } from './orders';

const schema = z.object({
  email: z.string().trim().email(),
  unsubscribed: z.boolean(),
});

/**
 * Takes someone off the mailing list, or puts them back.
 *
 * Re-subscribing on someone's behalf is offered because staff do get asked to
 * do it over the phone — but it is recorded in the activity log, because
 * consent someone else gave for you is the kind of thing that needs a trail.
 */
export async function setUnsubscribed(input: unknown): Promise<ActionResult> {
  await requireStaff('manager');

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'That email address is not valid.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('customer_contacts')
    .update({
      unsubscribed: parsed.data.unsubscribed,
      unsubscribed_at: parsed.data.unsubscribed ? new Date().toISOString() : null,
    })
    .eq('email', parsed.data.email);

  if (error) {
    return {
      ok: false,
      message: error.code === '42501' ? 'Your role cannot change the mailing list.' : error.message,
    };
  }

  await supabase.rpc('log_activity', {
    p_action: parsed.data.unsubscribed ? 'customer.unsubscribed' : 'customer.resubscribed',
    p_entity_type: 'customer',
    p_entity_id: parsed.data.email,
    p_metadata: {},
  });

  revalidatePath('/admin/customers');
  return {
    ok: true,
    message: parsed.data.unsubscribed
      ? 'Removed from the mailing list.'
      : 'Back on the mailing list.',
  };
}
