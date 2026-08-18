import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { LIMITS, callerKey, checkRateLimit, tooManyRequests } from '@/lib/rate-limit';
import { refreshQuoteSchema } from '@/lib/validation';

/**
 * Re-quotes an order whose fifteen minutes have run out.
 *
 * The address never changes — only the amount — so a payment already in flight
 * against the old figure still lands somewhere attributable to this order, and
 * staff see it as a short or over payment rather than as money from nowhere.
 *
 * Requires the order number and the email together, matching the order lookup
 * endpoint, so this cannot be used to discover which order numbers exist.
 */
export async function POST(request: Request) {
  const limit = await checkRateLimit(`usdc-quote:${callerKey(request)}`, LIMITS.lookup);
  if (!limit.allowed) {
    return tooManyRequests(limit, 'Too many attempts. Wait a moment and try again.');
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const parsed = refreshQuoteSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Check your details.' },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc('refresh_usdc_quote', {
    p_order_number: parsed.data.orderNumber,
    p_email: parsed.data.email,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const result = data as { ok: boolean; message?: string };
  if (!result.ok) {
    return NextResponse.json({ error: result.message ?? 'Could not refresh.' }, { status: 400 });
  }

  return NextResponse.json(result);
}
