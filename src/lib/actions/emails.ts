'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import type { ActionResult } from './orders';

const templateSchema = z.object({
  key: z.string().trim().min(1).max(60),
  subject: z.string().trim().min(1, 'The subject cannot be empty').max(200),
  body: z.string().trim().min(1, 'The message cannot be empty').max(8000),
  isActive: z.boolean(),
});

/**
 * These are the words that reach customers, so only administrators may change
 * them — the same bar as the storefront copy and the entry gate.
 */
export async function saveEmailTemplate(input: unknown): Promise<ActionResult> {
  const profile = await requireStaff('administrator');

  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the template.' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('email_templates')
    .update({
      subject: parsed.data.subject,
      body: parsed.data.body,
      is_active: parsed.data.isActive,
      updated_by: profile.id,
    })
    .eq('key', parsed.data.key);

  if (error) {
    return {
      ok: false,
      message: error.code === '42501' ? 'Your role cannot change email wording.' : error.message,
    };
  }

  await supabase.rpc('log_activity', {
    p_action: 'email_template.updated',
    p_entity_type: 'email_template',
    p_entity_id: parsed.data.key,
    p_metadata: { active: parsed.data.isActive },
  });

  revalidatePath('/admin/emails');
  return {
    ok: true,
    message: parsed.data.isActive
      ? 'Saved. New emails use this wording from now on.'
      : 'Saved. This email is switched off and will not be sent.',
  };
}
