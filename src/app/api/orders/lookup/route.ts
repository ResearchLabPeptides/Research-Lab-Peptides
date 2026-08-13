import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { orderLookupSchema } from '@/lib/validation';
import { LIMITS, callerKey, checkRateLimit, tooManyRequests } from '@/lib/rate-limit';
import type { OrderLookupResult } from '@/lib/types';

/**
 * Order status without an account. The order number alone is not enough — the
 * email has to match too, and lookup_order() returns the same vague message for
 * a wrong email as for an order that does not exist, so this endpoint cannot be
 * used to discover whether a given order number is real.
 */
export async function POST(request: Request) {
  // Without this, order numbers could be guessed at machine speed.
  const verdict = await checkRateLimit(`lookup:${callerKey(request)}`, LIMITS.lookup);
  if (!verdict.allowed) {
    return tooManyRequests(verdict, 'Too many lookups. Wait a moment and try again.');
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const parsed = orderLookupSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Check the details and try again.' },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc('lookup_order', {
    p_order_number: parsed.data.orderNumber,
    p_email: parsed.data.email,
  });

  if (error) {
    console.error('[lookup] failed', error);
    return NextResponse.json({ error: 'Could not look that up right now.' }, { status: 502 });
  }

  return NextResponse.json(data as OrderLookupResult, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
