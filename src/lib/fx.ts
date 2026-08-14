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

/**
 * Where the rate comes from.
 *
 * Several sources, tried in order, because a single one is a single point of
 * failure and the failure is silent from a shop's point of view: USDC simply
 * stops being offered. CoinGecko's free endpoint in particular rejects requests
 * from cloud IP ranges, which is exactly where this runs.
 *
 * Ordered by directness. The first two quote USDC against CAD, which is the
 * number that actually matters. The last quotes plain USD and is a fallback for
 * when nothing else answers — worth having, because a rate that is a fraction
 * of a percent off is far better than no rate and no crypto payments at all.
 */
interface RateSource {
  name: string;
  url: string;
  /** Pulls the CAD-per-USDC figure out of that service's response shape. */
  extract: (body: unknown) => number | undefined;
  note?: string;
}

const SOURCES: RateSource[] = [
  {
    name: 'coinbase',
    url: 'https://api.coinbase.com/v2/exchange-rates?currency=USDC',
    extract: (b) => {
      const rate = (b as { data?: { rates?: Record<string, string> } })?.data?.rates?.CAD;
      return rate === undefined ? undefined : Number(rate);
    },
  },
  {
    name: 'coingecko',
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=usd-coin&vs_currencies=cad',
    extract: (b) => (b as { 'usd-coin'?: { cad?: number } })?.['usd-coin']?.cad,
  },
  {
    name: 'frankfurter',
    // European Central Bank data, no key, no rate limit. Quotes USD, not USDC,
    // so it carries a note: on a day when USDC drifts off its peg this is
    // slightly wrong, and the admin screen says which source is in force.
    url: 'https://api.frankfurter.app/latest?from=USD&to=CAD',
    extract: (b) => (b as { rates?: { CAD?: number } })?.rates?.CAD,
    note: 'USD rate — USDC itself was unavailable',
  },
];

export interface RateResult {
  ok: boolean;
  rate?: number;
  source?: string;
  message?: string;
}

/**
 * A rate that fails a sanity check is treated as no rate at all.
 *
 * If a service returns a malformed body, a zero, or a number in the wrong
 * units, the damage is not an error page — it is every customer that day being
 * told to send the wrong amount of money. The band below is wide enough to
 * survive real currency movement and narrow enough to catch a decimal point in
 * the wrong place.
 */
const MIN_PLAUSIBLE_CAD_PER_USDC = 0.8;
const MAX_PLAUSIBLE_CAD_PER_USDC = 3.0;

async function trySource(source: RateSource): Promise<RateResult> {
  try {
    const response = await fetch(source.url, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      return { ok: false, message: `${source.name} returned ${response.status}` };
    }

    const rate = source.extract(await response.json());

    if (typeof rate !== 'number' || !Number.isFinite(rate)) {
      return { ok: false, message: `${source.name} returned no usable number` };
    }

    if (rate < MIN_PLAUSIBLE_CAD_PER_USDC || rate > MAX_PLAUSIBLE_CAD_PER_USDC) {
      return { ok: false, message: `${source.name} gave ${rate}, outside the plausible range` };
    }

    return {
      ok: true,
      rate,
      source: source.note ? `${source.name} (${source.note})` : source.name,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    return { ok: false, message: `${source.name}: ${reason}` };
  }
}

/**
 * Tries each source until one answers. Reports every failure when they all do,
 * because "could not reach the rate service" tells whoever is looking nothing
 * about which service, or why.
 */
export async function fetchUsdcCadRate(): Promise<RateResult> {
  const failures: string[] = [];

  for (const source of SOURCES) {
    const result = await trySource(source);
    if (result.ok) return result;
    failures.push(result.message ?? source.name);
  }

  return {
    ok: false,
    message: `No rate source answered. ${failures.join('; ')}`,
  };
}

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
