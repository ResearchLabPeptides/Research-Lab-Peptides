import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { deliveryQuoteSchema } from '@/lib/validation';
import { LIMITS, callerKey, checkRateLimit, tooManyRequests } from '@/lib/rate-limit';
import type { DeliveryQuote } from '@/lib/types';

/**
 * Prices a delivery for an address. Called as the shopper types their postal
 * code, so it must stay cheap: one indexed lookup, no writes.
 */
export async function POST(request: Request) {
  const verdict = await checkRateLimit(`quote:${callerKey(request)}`, LIMITS.quote);
  if (!verdict.allowed) {
    return tooManyRequests(verdict, 'Too many requests. Wait a moment and try again.');
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const parsed = deliveryQuoteSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter a valid postal code.' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('quote_delivery', {
    p_postal: parsed.data.postalCode,
    p_city: parsed.data.city,
    p_subtotal_cents: parsed.data.subtotalCents,
    p_item_count: parsed.data.itemCount,
  });

  if (error) {
    return NextResponse.json({ error: 'Could not price delivery right now.' }, { status: 502 });
  }

  return NextResponse.json(data as DeliveryQuote, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
