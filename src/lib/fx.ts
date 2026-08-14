-- =============================================================================
-- 0031  Save the exchange rate without needing the service role key
-- =============================================================================
-- Symptom that led here: sixteen refresh attempts in a day, no rate saved, and
-- no error recorded anywhere.
--
-- The cause is that those two operations went through different doors. The
-- attempt counter is bumped by claim_rate_refresh(), which is security definer
-- and therefore runs with the function owner's rights — it worked. Saving the
-- rate was a plain UPDATE from the application, which is subject to row level
-- security, and fx_rate_cache had no write policy. So the write was refused.
-- Worse, the write that records *why* it was refused was refused for the same
-- reason, which is why last_error stayed empty and there was nothing to
-- diagnose from.
--
-- The underlying misconfiguration is a SUPABASE_SERVICE_ROLE_KEY that is not
-- actually the service role key, since that key is what was supposed to bypass
-- RLS here. That is worth correcting on its own. But this function removes the
-- dependency: saving a rate is a narrow, well-defined operation that does not
-- need the most privileged credential in the system to be correct.

/**
 * Records the outcome of a rate lookup — success or failure, both go through
 * here.
 *
 * security definer so it works from the cron job, from a background refresh
 * with no session, and from a staff member pressing the button, without any of
 * them holding elevated credentials. The only thing it can touch is the single
 * row of fx_rate_cache.
 *
 * Validates the figure itself rather than trusting the caller. A rate arriving
 * as zero, or wildly out of band because a service returned something
 * unexpected, would otherwise be written and then used to price every USDC
 * order until someone noticed.
 */
create or replace function save_fx_rate(
  p_rate   numeric default null,
  p_source text default '',
  p_error  text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A failed lookup: record why, leave the previous rate in place. A rate a few
  -- hours old is still a good rate, and discarding it because one fetch failed
  -- would take USDC offline for no reason.
  if p_rate is null then
    update fx_rate_cache
    set last_error = coalesce(p_error, 'Unknown error'),
        last_attempt_at = now()
    where id;

    return jsonb_build_object('ok', false, 'saved', false);
  end if;

  if p_rate <= 0.8 or p_rate >= 3.0 then
    update fx_rate_cache
    set last_error = format('Refused an implausible rate of %s CAD per USDC from %s',
                            p_rate, coalesce(nullif(p_source, ''), 'an unnamed source')),
        last_attempt_at = now()
    where id;

    return jsonb_build_object('ok', false, 'saved', false, 'reason', 'implausible');
  end if;

  update fx_rate_cache
  set cad_per_usdc = p_rate,
      source = coalesce(nullif(p_source, ''), 'unknown'),
      fetched_at = now(),
      last_attempt_at = now(),
      last_error = ''
  where id;

  return jsonb_build_object('ok', true, 'saved', true, 'rate', p_rate);
end;
$$;

grant execute on function save_fx_rate(numeric, text, text) to anon, authenticated;
