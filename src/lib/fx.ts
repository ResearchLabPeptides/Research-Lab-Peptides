import 'server-only';

import { createServiceClient } from '@/lib/supabase/admin';

/**
 * The CAD price of one USDC.
 *
 * Deliberately quoted against USDC rather than against USD. USDC is meant to
 * track the dollar and usually does, but it has drifted before, and on a day
 * when it trades at 0.995 a pure USD/CAD rate would quietly undercharge every
 * customer by half a percent. Asking what a USDC is actually worth in Canadian
 * dollars is the number that matters, because USDC is the thing arriving.
 *
 * Fetched on a schedule and cached in Postgres, never in memory: Vercel
 * functions are stateless, so an in-process cache would refetch on every cold
 * start and leave no record of which rate was in force when an order was
 * quoted.
 */

const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=usd-coin&vs_currencies=cad';

export interface RateResult {
  ok: boolean;
  rate?: number;
  source?: string;
  message?: string;
}

/**
 * A rate that fails a sanity check is treated as no rate at all.
 *
 * If CoinGecko ever returns a malformed body, a zero, or a number in the wrong
 * units, the damage is not an error page — it is every customer that day being
 * told to send the wrong amount of money. The band below is deliberately wide
 * enough to survive real currency movement and narrow enough to catch a decimal
 * point in the wrong place.
 */
const MIN_PLAUSIBLE_CAD_PER_USDC = 0.8;
const MAX_PLAUSIBLE_CAD_PER_USDC = 3.0;

export async function fetchUsdcCadRate(): Promise<RateResult> {
  try {
    const response = await fetch(COINGECKO_URL, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return { ok: false, message: `Rate service returned ${response.status}.` };
    }

    const body = (await response.json()) as { 'usd-coin'?: { cad?: number } };
    const rate = body['usd-coin']?.cad;

    if (typeof rate !== 'number' || !Number.isFinite(rate)) {
      return { ok: false, message: 'Rate service returned no usable number.' };
    }

    if (rate < MIN_PLAUSIBLE_CAD_PER_USDC || rate > MAX_PLAUSIBLE_CAD_PER_USDC) {
      return {
        ok: false,
        message: `Rate ${rate} CAD per USDC is outside the plausible range and was rejected.`,
      };
    }

    return { ok: true, rate, source: 'coingecko' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, message: `Could not reach the rate service: ${message}` };
  }
}

/**
 * Refreshes the cached rate.
 *
 * On failure the previous rate is left exactly where it is and only the error
 * text is written. A rate that is a few hours old is still a good rate; the
 * staleness guard in usdc_available() decides when it stops being one. Wiping
 * it on a transient network blip would take the payment method offline for no
 * reason.
 */
export async function refreshCachedRate(): Promise<RateResult> {
  const result = await fetchUsdcCadRate();
  const supabase = createServiceClient();

  if (!result.ok) {
    await supabase
      .from('fx_rate_cache')
      .update({ last_error: result.message ?? 'Unknown error' })
      .eq('id', true);
    return result;
  }

  const { error } = await supabase
    .from('fx_rate_cache')
    .update({
      cad_per_usdc: result.rate,
      source: result.source,
      fetched_at: new Date().toISOString(),
      last_error: '',
    })
    .eq('id', true);

  if (error) return { ok: false, message: error.message };

  return result;
}
