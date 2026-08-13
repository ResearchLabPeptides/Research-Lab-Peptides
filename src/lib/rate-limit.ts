import 'server-only';
import { NextResponse } from 'next/server';
import { createServiceClient } from './supabase/admin';

/**
 * Rate limiting for the public endpoints.
 *
 * The counter lives in Postgres rather than memory because the app runs on
 * serverless functions — there is no single process to hold state, and two
 * requests routinely land on two different machines.
 *
 * This is a speed bump, not a wall. It stops a script hammering checkout or
 * grinding through coupon codes; it will not stop a determined attacker with a
 * pool of addresses. For that you want a WAF in front of the whole site.
 */

export const LIMITS = {
  /** Placing orders. Generous for a real shopper, useless for a flood. */
  checkout: { limit: 5, windowSecs: 600 },
  /** Per email as well as per address, so one machine cannot cycle addresses. */
  checkoutEmail: { limit: 5, windowSecs: 3600 },
  /** Guessing order numbers. */
  lookup: { limit: 10, windowSecs: 60 },
  /** Brute-forcing coupon codes. */
  coupon: { limit: 10, windowSecs: 60 },
  /** Fires as the shopper types a postal code, so this one has to be roomy. */
  quote: { limit: 40, windowSecs: 60 },
} as const;

/**
 * Best available caller identity.
 *
 * On Vercel the left-most entry of x-forwarded-for is the real client; the rest
 * are proxies. A header can be forged, but forging it only changes which bucket
 * the request counts against — it cannot raise a limit.
 */
export function callerKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

export interface RateVerdict {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export async function checkRateLimit(
  bucket: string,
  { limit, windowSecs }: { limit: number; windowSecs: number },
): Promise<RateVerdict> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_bucket: bucket,
      p_limit: limit,
      p_window_secs: windowSecs,
    });

    if (error) throw error;

    const result = data as { allowed: boolean; remaining: number; retry_after_seconds: number };
    return {
      allowed: result.allowed,
      remaining: result.remaining,
      retryAfterSeconds: result.retry_after_seconds,
    };
  } catch (error) {
    // If the limiter itself is broken, letting real customers through is the
    // lesser harm. Log loudly so it does not go unnoticed.
    console.error('[rate-limit] check failed, allowing the request', bucket, error);
    return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
  }
}

/** The 429 to return when a limit is hit. */
export function tooManyRequests(verdict: RateVerdict, message: string): NextResponse {
  return NextResponse.json(
    { error: message, retryAfterSeconds: verdict.retryAfterSeconds },
    {
      status: 429,
      headers: {
        'Retry-After': String(verdict.retryAfterSeconds),
        'Cache-Control': 'no-store',
      },
    },
  );
}
