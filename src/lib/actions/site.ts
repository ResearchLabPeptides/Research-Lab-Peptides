'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import { isAllowedFont } from '@/lib/branding';
import {
  brandingSchema,
  contentUpdateSchema,
  deliveryModifierSchema,
  deliveryPricingSchema,
  pageSchema,
} from '@/lib/validation';
import type { ActionResult } from './orders';

/**
 * Branding, copy, and pages all change what every visitor sees, so each of
 * these revalidates the whole site rather than a single route.
 */
function revalidateEverything() {
  revalidatePath('/', 'layout');
}

// --- Branding ----------------------------------------------------------------

export async function saveBranding(input: unknown): Promise<ActionResult> {
  await requireStaff('administrator');

  const parsed = brandingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the colours.' };
  }

  const b = parsed.data;

  // Font names are interpolated into a Google Fonts URL, so they are checked
  // against the allow-list here as well as in the picker.
  for (const font of [b.fontDisplay, b.fontBody, b.fontMono]) {
    if (!isAllowedFont(font)) {
      return { ok: false, message: `"${font}" is not one of the available fonts.` };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('settings')
    .update({
      brand_light: b.light,
      brand_dark: b.dark,
      brand_font_display: b.fontDisplay,
      brand_font_body: b.fontBody,
      brand_font_mono: b.fontMono,
      brand_radius_px: b.radiusPx,
    })
    .eq('id', true);

  if (error) return { ok: false, message: error.message };

  await supabase.rpc('log_activity', {
    p_action: 'branding.updated',
    p_entity_type: 'settings',
    p_entity_id: 'branding',
    p_metadata: { primary: b.light.primary, font: b.fontDisplay },
  });

  revalidateEverything();
  return { ok: true, message: 'Branding saved. Every page is using it now.' };
}

// --- Short copy --------------------------------------------------------------

export async function saveContent(input: unknown): Promise<ActionResult> {
  await requireStaff('manager');

  const parsed = contentUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: 'Some of that text was too long to save.' };
  }

  const supabase = await createClient();

  // Rows are seeded, never created here — a key nothing renders would be a dead
  // end — so each entry is an update against an existing key.
  for (const entry of parsed.data.entries) {
    const { error } = await supabase
      .from('site_content')
      .update({ value: entry.value })
      .eq('key', entry.key);

    if (error) {
      return {
        ok: false,
        message:
          error.code === '42501'
            ? 'Your role can view the wording but not change it.'
            : error.message,
      };
    }
  }

  await supabase.rpc('log_activity', {
    p_action: 'content.updated',
    p_entity_type: 'content',
    p_entity_id: `${parsed.data.entries.length} fields`,
    p_metadata: {},
  });

  revalidateEverything();
  return { ok: true, message: 'Wording saved.' };
}

// --- Pages -------------------------------------------------------------------

export interface SavePageResult extends ActionResult {
  pageId?: string;
}

function pageWriteError(code: string | undefined, message: string): string {
  if (code === '23505') return 'Another page already uses that web address.';
  if (code === '42501') return 'Your role can view pages but not change them.';
  return message;
}

export async function createPage(input: unknown): Promise<SavePageResult> {
  await requireStaff('manager');

  const parsed = pageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the page.' };
  }

  const p = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('site_pages')
    .insert({
      slug: p.slug,
      title: p.title,
      body_markdown: p.bodyMarkdown,
      meta_description: p.metaDescription,
      is_published: p.isPublished,
      show_in_nav: p.showInNav,
      sort_order: p.sortOrder,
    })
    .select('id')
    .single();

  if (error) return { ok: false, message: pageWriteError(error.code, error.message) };

  revalidateEverything();
  return { ok: true, pageId: data.id as string, message: `"${p.title}" created.` };
}

export async function updatePage(pageId: string, input: unknown): Promise<SavePageResult> {
  await requireStaff('manager');

  const parsed = pageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the page.' };
  }

  const p = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from('site_pages')
    .update({
      slug: p.slug,
      title: p.title,
      body_markdown: p.bodyMarkdown,
      meta_description: p.metaDescription,
      is_published: p.isPublished,
      show_in_nav: p.showInNav,
      sort_order: p.sortOrder,
    })
    .eq('id', pageId);

  if (error) return { ok: false, message: pageWriteError(error.code, error.message) };

  revalidateEverything();
  return {
    ok: true,
    pageId,
    message: p.isPublished ? 'Saved and live.' : 'Saved as a draft — customers cannot see it yet.',
  };
}

export async function deletePage(pageId: string): Promise<ActionResult> {
  await requireStaff('manager');

  const supabase = await createClient();
  const { error } = await supabase.from('site_pages').delete().eq('id', pageId);
  if (error) return { ok: false, message: pageWriteError(error.code, error.message) };

  revalidateEverything();
  return { ok: true, message: 'Page deleted.' };
}

// --- Shipping pricing --------------------------------------------------------

export async function saveDeliveryPricing(input: unknown): Promise<ActionResult> {
  await requireStaff('manager');

  const parsed = deliveryPricingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the values.' };
  }

  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from('settings')
    .update({
      delivery_mode: d.mode,
      delivery_flat_fee_cents: d.flatFeeCents,
      delivery_minimum_order_cents: d.minimumOrderCents,
      delivery_eta_min_minutes: d.etaMinMinutes,
      delivery_eta_max_minutes: d.etaMaxMinutes,
      delivery_restrict_area: d.restrictArea,
    })
    .eq('id', true);

  if (error) return { ok: false, message: error.message };

  await supabase.rpc('log_activity', {
    p_action: 'delivery.pricing_updated',
    p_entity_type: 'settings',
    p_entity_id: 'delivery',
    p_metadata: { mode: d.mode, fee_cents: d.flatFeeCents },
  });

  revalidatePath('/admin/delivery');
  revalidateEverything();

  return {
    ok: true,
    message:
      d.minimumOrderCents > 0
        ? 'Saved. Remember a minimum blocks checkout below that amount — worth testing an address.'
        : 'Saved. The next order prices against it.',
  };
}

export async function saveDeliveryModifier(
  input: unknown,
  modifierId?: string,
): Promise<ActionResult> {
  await requireStaff('manager');

  const parsed = deliveryModifierSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the rule.' };
  }

  const m = parsed.data;
  const row = {
    label: m.label,
    condition: m.condition,
    threshold: m.condition === 'always' ? 0 : m.threshold,
    effect: m.effect,
    amount: m.effect === 'free' ? 0 : m.amount,
    priority: m.priority,
    is_active: m.isActive,
  };

  const supabase = await createClient();
  const { error } = modifierId
    ? await supabase.from('delivery_modifiers').update(row).eq('id', modifierId)
    : await supabase.from('delivery_modifiers').insert(row);

  if (error) {
    return {
      ok: false,
      message: error.code === '42501' ? 'Your role cannot change delivery pricing.' : error.message,
    };
  }

  revalidatePath('/admin/delivery');
  revalidateEverything();
  return { ok: true, message: modifierId ? 'Rule updated.' : 'Rule added.' };
}

export async function deleteDeliveryModifier(modifierId: string): Promise<ActionResult> {
  await requireStaff('manager');

  const supabase = await createClient();
  const { error } = await supabase.from('delivery_modifiers').delete().eq('id', modifierId);
  if (error) return { ok: false, message: error.message };

  revalidatePath('/admin/delivery');
  revalidateEverything();
  return { ok: true, message: 'Rule removed.' };
}
