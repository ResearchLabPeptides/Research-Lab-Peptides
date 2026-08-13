'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import { couponSchema } from '@/lib/validation';
import type { ActionResult } from './orders';

/**
 * Coupons are a manager-level tool: they give money away, so they sit above the
 * employee role alongside pricing and the catalog.
 */

function friendly(code: string | undefined, message: string): string {
  if (code === '23505') return 'A coupon with that code already exists.';
  if (code === '42501') return 'Your role cannot manage coupons.';
  return message;
}

function toRow(input: ReturnType<typeof couponSchema.parse>) {
  return {
    code: input.code,
    description: input.description ?? '',
    kind: input.kind,
    value: input.kind === 'free_delivery' ? 0 : input.value,
    // A cap only means something for a percentage.
    max_discount_cents: input.kind === 'percent_off' ? (input.maxDiscountCents ?? null) : null,
    minimum_order_cents: input.minimumOrderCents,
    usage_limit: input.usageLimit ?? null,
    per_customer_limit: input.perCustomerLimit ?? null,
    starts_at: input.startsAt ?? null,
    expires_at: input.expiresAt ?? null,
    is_active: input.isActive,
  };
}

export async function createCoupon(input: unknown): Promise<ActionResult> {
  await requireStaff('manager');

  const parsed = couponSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the coupon.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.from('coupons').insert(toRow(parsed.data));
  if (error) return { ok: false, message: friendly(error.code, error.message) };

  await supabase.rpc('log_activity', {
    p_action: 'coupon.created',
    p_entity_type: 'coupon',
    p_entity_id: parsed.data.code,
    p_metadata: { kind: parsed.data.kind, value: parsed.data.value },
  });

  revalidatePath('/admin/coupons');
  return { ok: true, message: `${parsed.data.code} is live.` };
}

export async function updateCoupon(couponId: string, input: unknown): Promise<ActionResult> {
  await requireStaff('manager');

  const parsed = couponSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the coupon.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.from('coupons').update(toRow(parsed.data)).eq('id', couponId);
  if (error) return { ok: false, message: friendly(error.code, error.message) };

  revalidatePath('/admin/coupons');
  return { ok: true, message: 'Coupon updated.' };
}

/**
 * Pausing is the safe way to stop a code: it keeps the redemption history, so
 * "how much did that promotion cost us" still has an answer next quarter.
 */
export async function setCouponActive(couponId: string, isActive: boolean): Promise<ActionResult> {
  await requireStaff('manager');

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('coupons')
    .update({ is_active: isActive })
    .eq('id', couponId)
    .select('code')
    .single();

  if (error) return { ok: false, message: friendly(error.code, error.message) };

  revalidatePath('/admin/coupons');
  return {
    ok: true,
    message: isActive
      ? `${data.code as string} is accepting orders again.`
      : `${data.code as string} is paused. Nobody can redeem it until you resume it.`,
  };
}

export async function deleteCoupon(couponId: string): Promise<ActionResult> {
  await requireStaff('manager');

  const supabase = await createClient();
  const { data: coupon } = await supabase
    .from('coupons')
    .select('code, times_redeemed')
    .eq('id', couponId)
    .single();

  // Deleting takes the redemption rows with it, which would quietly rewrite
  // what past promotions appear to have cost.
  if (coupon && (coupon.times_redeemed as number) > 0) {
    return {
      ok: false,
      message: `${coupon.code as string} has been redeemed ${coupon.times_redeemed} times. Pause it instead so the history survives.`,
    };
  }

  const { error } = await supabase.from('coupons').delete().eq('id', couponId);
  if (error) return { ok: false, message: friendly(error.code, error.message) };

  revalidatePath('/admin/coupons');
  return { ok: true, message: 'Coupon deleted.' };
}
