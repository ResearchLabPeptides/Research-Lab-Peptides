import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { couponPreviewSchema } from '@/lib/validation';
import { LIMITS, callerKey, checkRateLimit, tooManyRequests } from '@/lib/rate-limit';
import type { CouponEvaluation } from '@/lib/types';

/**
 * Checks a code as the shopper types it, so they see the discount before they
 * commit rather than being surprised at the total.
 *
 * This is advisory only. place_order() re-evaluates the code under a row lock,
 * so a coupon that runs out between here and checkout is caught there.
 *
 * evaluate_coupon() answers one code at a time and gives unknown and inactive
 * codes the same message, so this endpoint cannot be used to discover which
 * codes exist.
 */
export async function POST(request: Request) {
  // Codes are short and guessable; this is what stops them being enumerated.
  const verdict = await checkRateLimit(`coupon:${callerKey(request)}`, LIMITS.coupon);
  if (!verdict.allowed) {
    return tooManyRequests(verdict, 'Too many codes tried. Wait a moment and try again.');
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const parsed = couponPreviewSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter a code.' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('evaluate_coupon', {
    p_code: parsed.data.code,
    p_subtotal_cents: parsed.data.subtotalCents,
    p_delivery_fee_cents: parsed.data.deliveryFeeCents,
    p_email: parsed.data.email || null,
  });

  if (error) {
    console.error('[coupon] evaluate failed', error);
    return NextResponse.json({ error: 'Could not check that code right now.' }, { status: 502 });
  }

  return NextResponse.json(data as CouponEvaluation, { headers: { 'Cache-Control': 'no-store' } });
}
