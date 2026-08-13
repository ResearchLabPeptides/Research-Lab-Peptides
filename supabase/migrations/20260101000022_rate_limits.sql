-- =============================================================================
-- 0022  Rate limiting
-- =============================================================================
-- Nothing stopped someone hammering checkout with junk orders, brute-forcing
-- coupon codes, or guessing order numbers. That was the largest hole in the
-- security review.
--
-- The counter lives in Postgres rather than in memory, because the app runs on
-- serverless functions: there is no single long-lived process to hold state,
-- and two requests can easily land on two different machines. A shared table is
-- the only place a count means anything.
--
-- Fixed windows rather than a sliding log: one row per caller per window, one
-- statement to check and increment. A burst can straddle a boundary and briefly
-- allow up to twice the limit, which is a fair trade for a check that costs a
-- single upsert on a primary key.

create table rate_limits (
  bucket       text        not null,
  window_start timestamptz not null,
  hits         int         not null default 0,
  primary key (bucket, window_start)
);

-- Old windows are dead weight; this makes clearing them cheap.
create index rate_limits_window_idx on rate_limits (window_start);

alter table rate_limits enable row level security;
-- No policies at all: only check_rate_limit() touches this, and it is definer.
-- A caller who could edit the table could lift their own limit.

/**
 * Records one hit and says whether it is allowed.
 *
 * Returns { allowed, remaining, retry_after_seconds }.
 *
 * The insert-then-update is a single statement so two simultaneous requests
 * cannot both read "0 so far" and both be let through.
 */
create or replace function check_rate_limit(
  p_bucket      text,
  p_limit       int,
  p_window_secs int default 60
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_hits  int;
begin
  if coalesce(trim(p_bucket), '') = '' then
    -- No caller identity means no counting. Allow rather than block everyone,
    -- and let the application decide whether that is acceptable.
    return jsonb_build_object('allowed', true, 'remaining', p_limit, 'retry_after_seconds', 0);
  end if;

  -- Truncate now to the window, so every caller in the same period shares a row.
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_secs) * p_window_secs);

  insert into rate_limits (bucket, window_start, hits)
  values (p_bucket, v_start, 1)
  on conflict (bucket, window_start) do update set hits = rate_limits.hits + 1
  returning hits into v_hits;

  return jsonb_build_object(
    'allowed', v_hits <= p_limit,
    'remaining', greatest(0, p_limit - v_hits),
    'retry_after_seconds',
      greatest(1, ceil(extract(epoch from (v_start + make_interval(secs => p_window_secs)) - now()))::int)
  );
end;
$$;

grant execute on function check_rate_limit(text, int, int) to anon, authenticated;

/**
 * Deletes windows that have closed. Safe to run on a schedule, or opportunistically.
 */
create or replace function prune_rate_limits(p_older_than interval default interval '1 day')
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  delete from rate_limits where window_start < now() - p_older_than;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
