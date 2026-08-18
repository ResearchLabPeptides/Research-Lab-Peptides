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
  /** Built per request, so an API key added later is picked up without code changes. */
  headers?: () => Record<string, string>;
}

const SOURCES: RateSource[] = [
  {
    name: 'coingecko',
    // Same URL with or without a key. Set COINGECKO_API_KEY and the request
    // moves from the keyless pool — 5 to 15 calls a minute shared with every
    // other project calling from this datacentre — onto the free Demo plan's
    // own allowance. That is the single most effective thing that can be done
    // about intermittent 429s, and it costs nothing.
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=usd-coin&vs_currencies=cad',
    extract: (b) => (b as { 'usd-coin'?: { cad?: number } })?.['usd-coin']?.cad,
    headers: () => {
      const key = process.env.COINGECKO_API_KEY?.trim();
      // Typed as an empty object rather than one with an undefined value, so
      // the header is genuinely absent when there is no key.
      // The header must be absent rather than empty when there is no key:
      // CoinGecko ignores it on the keyless endpoint, but an empty credential
      // is the kind of thing that starts being rejected later.
      return key ? { 'x-cg-demo-api-key': key } : ({} as Record<string, string>);
    },
  },
  {
    name: 'coinbase',
    url: 'https://api.coinbase.com/v2/exchange-rates?currency=USDC',
    extract: (b) => {
      const rate = (b as { data?: { rates?: Record<string, string> } })?.data?.rates?.CAD;
      return rate === undefined ? undefined : Number(rate);
    },
  },
  {
    name: 'frankfurter',
    // European Central Bank data. Quotes USD rather than USDC, so it carries a
    // note: on a day when USDC drifts off its peg this is slightly wrong, and
    // the admin screen says which source is in force.
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
      headers: { accept: 'application/json', ...(source.headers?.() ?? {}) },
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      // 429 is the one worth naming: on a keyless, IP-shared endpoint it means
      // other traffic from this datacentre has used the allowance, not that
      // anything here is misconfigured. The daily budget already backs us off.
      const keyed = source.name === 'coingecko' && !!process.env.COINGECKO_API_KEY?.trim();
      const reason =
        response.status === 429
          ? keyed
            ? 'rate limited — the monthly allowance for your API key may be spent'
            : 'rate limited (the shared keyless allowance for this server is used up — a free CoinGecko API key fixes this)'
          : `returned ${response.status}`;
      return { ok: false, message: `${source.name} ${reason}` };
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

/**
 * Refreshes the cached rate.
 *
 * Both outcomes are written through save_fx_rate(), a security definer function
 * that owns the single row of fx_rate_cache. That is deliberate: the earlier
 * version wrote to the table directly and depended on the service role key
 * bypassing row level security, so a mistyped key meant the rate silently never
 * saved *and* the error explaining it silently never saved either. Sixteen
 * attempts, nothing recorded, nothing to diagnose.
 *
 * On failure the previous rate is left alone. A rate a few hours old is still a
 * good rate; taking USDC offline because one fetch failed would be the wrong
 * trade.
 */
export async function refreshCachedRate(): Promise<RateResult> {
  const result = await fetchUsdcCadRate();
  const supabase = createServiceClient();

  const { error } = await supabase.rpc('save_fx_rate', {
    p_rate: result.ok ? result.rate : null,
    p_source: result.source ?? '',
    p_error: result.ok ? '' : (result.message ?? 'Unknown error'),
  });

  // Checked, not assumed. An unchecked write here is exactly what hid this
  // problem for as long as it was hidden.
  if (error) {
    return { ok: false, message: `Could not save the rate: ${error.message}` };
  }

  return result;
}

export async function ensureRateFresh(): Promise<void> {
  const supabase = createServiceClient();

  try {
    const { data: stale } = await supabase.rpc('rate_needs_refresh');
    if (stale !== true) return;

    // Twenty minutes between attempts: often enough that a customer arriving
    // after an outage gets a fresh rate quickly, rare enough that a persistent
    // failure cannot hammer a free API tier.
    // 140 minutes ≈ ten evenly spaced lookups across a day, so the budget
    // lasts until midnight instead of being spent in the first busy hour.
    const { data: claimed } = await supabase.rpc('claim_rate_refresh', {
      p_min_interval_minutes: 140,
    });
    if (claimed !== true) return;

    await refreshCachedRate();
  } catch (error) {
    // Recorded, not swallowed. An earlier version discarded this, which meant a
    // background refresh that died produced a "last checked" time, no rate, and
    // no explanation anywhere — the most confusing possible combination. The
    // shop still must not break over a currency API, so the error is written to
    // the admin screen rather than thrown.
    const message = error instanceof Error ? error.message : 'Unknown error';
    try {
      await supabase
        .from('fx_rate_cache')
        .update({ last_error: `Background refresh failed: ${message}` })
        .eq('id', true);
    } catch {
      // Nothing left to do: the database itself is unreachable, which the shop
      // will be reporting far more loudly elsewhere.
    }
  }
}
