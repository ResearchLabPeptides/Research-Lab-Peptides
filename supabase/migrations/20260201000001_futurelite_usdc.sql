-- =============================================================================
-- 0023  Futurelite: USDC on Solana as a second payment method
-- =============================================================================
-- Interac e-Transfer is unchanged. This adds a parallel path where the customer
-- sends USDC to a Solana address that belongs to this order and nobody else.
--
-- Design constraints that shaped this file:
--
--   * No seed phrase touches the server. Addresses are generated on a phone and
--     pasted in as public strings. The database stores text, never a key.
--   * These are addresses, not wallets. The shop has one wallet, on a phone.
--     Every address here is a receiving address belonging to that single wallet,
--     so there is nothing per-order to fund, sweep, or keep track of.
--   * No RPC node. Nothing here reads the Solana network. Staff confirm the
--     payment by looking at their own wallet, exactly as they do with Interac.
--   * An address is used once, ever. The unique constraint on order_id is what
--     enforces that, not application code, so a cold start or a double-submit
--     cannot hand the same address to two customers.
--
-- The exchange rate is captured at checkout and stored on the order. It is a
-- record of what was quoted, not a live figure -- if the rate moves after the
-- customer has been told to send 36.50 USDC, the order still says 36.50.

-- --- Payment method ----------------------------------------------------------

create type payment_method as enum ('interac', 'usdc_solana');

alter table orders
  add column payment_method payment_method not null default 'interac',

  -- The address this customer was told to pay. Denormalized from usdc_addresses
  -- on purpose: an order is a historical record and has to survive the pool row
  -- being retired or cleaned up years later.
  add column usdc_address text not null default '',

  -- USDC has six decimals. Storing micros keeps this integer-only, matching the
  -- integer-cents rule the rest of the money in this schema follows.
  add column usdc_amount_micros bigint not null default 0
    check (usdc_amount_micros >= 0),

  -- CAD price of one USDC at the moment of checkout, e.g. 1.370000.
  add column usdc_rate_cad numeric(12, 6) not null default 0
    check (usdc_rate_cad >= 0),
  add column usdc_rate_source text not null default '',
  add column usdc_rate_fetched_at timestamptz,
  add column usdc_quote_expires_at timestamptz,

  -- What actually landed, typed in by staff at confirmation time. Lets a short
  -- payment be recorded honestly as partially_paid rather than forced to
  -- paid/unpaid.
  add column usdc_received_micros bigint not null default 0
    check (usdc_received_micros >= 0),
  add column usdc_confirmed_at timestamptz;

create index orders_payment_method_idx
  on orders (payment_method, status)
  where payment_method = 'usdc_solana';

-- --- The address pool --------------------------------------------------------
-- One row per receiving address. Not per wallet: every address here belongs to
-- the same wallet on the shop's phone.

create table usdc_addresses (
  id          uuid primary key default gen_random_uuid(),

  -- Base58, 32 bytes decoded. Validated in the application before it ever gets
  -- here, because a single wrong character sends a customer's money to an
  -- address nobody on earth controls and it cannot be undone.
  address     text not null unique
              check (
                length(address) between 32 and 44
                and address ~ '^[1-9A-HJ-NP-Za-km-z]+$'
              ),

  -- Order the addresses are handed out in. Matches the position in the wallet
  -- app's own list, so staff can find any address on their phone by counting
  -- down to it.
  position    int not null,

  label       text not null default '',

  -- One address, one order, forever. This constraint is the whole safety story.
  order_id    uuid unique references orders(id) on delete set null,
  assigned_at timestamptz,

  -- Retired means "never hand this out", used if an address is compromised or
  -- was pasted in error. Retiring never deletes history.
  is_retired  boolean not null default false,
  notes       text not null default '',

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index usdc_addresses_position_idx on usdc_addresses (position);

-- The lookup that assignment depends on. Partial, because the only rows that
-- matter to it are the handful still available.
create index usdc_addresses_available_idx
  on usdc_addresses (position)
  where order_id is null and not is_retired;

create trigger usdc_addresses_updated_at
  before update on usdc_addresses
  for each row execute function set_updated_at();

-- --- Exchange rate cache -----------------------------------------------------
-- Single row. Refreshed on a schedule by the application, read by checkout.
-- Kept in the database rather than in memory because Vercel functions are
-- stateless -- an in-process cache would refetch on every cold start and there
-- would be no record of what rate was in force when.

create table fx_rate_cache (
  id          boolean primary key default true check (id),
  cad_per_usdc numeric(12, 6) not null default 0 check (cad_per_usdc >= 0),
  source      text not null default '',
  fetched_at  timestamptz,
  -- Set when a refresh fails, so the admin screen can say why the number is old
  -- instead of silently showing a stale figure.
  last_error  text not null default '',
  updated_at  timestamptz not null default now()
);

insert into fx_rate_cache (id) values (true) on conflict do nothing;

create trigger fx_rate_cache_updated_at
  before update on fx_rate_cache
  for each row execute function set_updated_at();

-- --- Settings ----------------------------------------------------------------

alter table settings
  add column usdc_enabled boolean not null default false,

  -- Optional margin on top of the market rate, in basis points. Zero means the
  -- customer pays the straight converted amount.
  add column usdc_markup_bps int not null default 0
    check (usdc_markup_bps between 0 and 5000),

  -- Warn in admin below this many unused addresses.
  add column usdc_low_pool_threshold int not null default 20
    check (usdc_low_pool_threshold >= 0),

  -- How long a quoted USDC figure stands before the customer is offered a
  -- refreshed one.
  add column usdc_quote_minutes int not null default 15
    check (usdc_quote_minutes between 1 and 1440),

  -- Past this age the rate is considered untrustworthy and the USDC option
  -- hides itself. Quoting a wrong number is worse than quoting none.
  add column usdc_rate_max_age_hours int not null default 36
    check (usdc_rate_max_age_hours between 1 and 720);

-- --- Rate helpers ------------------------------------------------------------

-- True only when every precondition for offering USDC holds: switched on, a
-- rate fresh enough to trust, and at least one address left to hand out.
create or replace function usdc_available()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select s.usdc_enabled
     and f.fetched_at is not null
     and f.cad_per_usdc > 0
     and f.fetched_at > now() - make_interval(hours => s.usdc_rate_max_age_hours)
     and exists (
       select 1 from usdc_addresses
       where order_id is null and not is_retired
     )
  from settings s, fx_rate_cache f
  where s.id and f.id;
$$;

-- Converts a CAD total to USDC micros, rounded to two decimal places so the
-- figure on screen is one a customer can type into a wallet without fumbling
-- the sixth decimal.
create or replace function usdc_quote(p_total_cents int)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rate    numeric(12, 6);
  v_source  text;
  v_fetched timestamptz;
  v_markup  int;
  v_minutes int;
  v_micros  bigint;
begin
  select f.cad_per_usdc, f.source, f.fetched_at, s.usdc_markup_bps, s.usdc_quote_minutes
    into v_rate, v_source, v_fetched, v_markup, v_minutes
  from settings s, fx_rate_cache f
  where s.id and f.id;

  if not usdc_available() then
    return jsonb_build_object('available', false,
      'message', 'USDC payment is not available right now.');
  end if;

  -- cents -> CAD -> USDC -> micros, with the markup applied to the CAD side.
  --   total_cents / 100 * (1 + markup) / rate * 1_000_000
  -- collapses to total_cents * 10000 * (1 + markup) / rate.
  v_micros := round(
    (p_total_cents::numeric * 10000 * (1 + v_markup::numeric / 10000) / v_rate) / 10000
  )::bigint * 10000;

  return jsonb_build_object(
    'available', true,
    'amount_micros', v_micros,
    'amount_display', to_char(v_micros::numeric / 1000000, 'FM999999990.00'),
    'rate_cad', v_rate,
    'source', v_source,
    'fetched_at', v_fetched,
    'expires_at', now() + make_interval(mins => v_minutes)
  );
end;
$$;

-- --- Assignment --------------------------------------------------------------

-- Takes the lowest-numbered free address and ties it to the order. SKIP LOCKED
-- means two simultaneous checkouts take two different rows instead of one
-- waiting on the other.
--
-- Note the explicit null check on v_address rather than a bare FOUND test:
-- FOUND after an UPDATE ... WHERE id IN (subquery) reports on the outer
-- statement and reads true even when the subquery matched nothing.
create or replace function assign_usdc_address(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_address text;
begin
  update usdc_addresses w
  set order_id = p_order_id,
      assigned_at = now()
  where w.id = (
    select id from usdc_addresses
    where order_id is null and not is_retired
    order by position
    limit 1
    for update skip locked
  )
  returning w.address into v_address;

  if v_address is null then
    raise exception 'No USDC payment addresses are available. Choose Interac e-Transfer instead.'
      using errcode = 'check_violation';
  end if;

  return v_address;
end;
$$;

-- --- Checkout ----------------------------------------------------------------
-- Wrapped rather than rewritten, following the pattern established in 0021, so
-- there stays exactly one copy of the pricing and stock logic.

alter function place_order(jsonb) rename to place_order_with_contact;

create or replace function place_order(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result   jsonb;
  v_method   text;
  v_order_id uuid;
  v_total    int;
  v_address  text;
  v_quote    jsonb;
  v_minutes  int;
begin
  v_method := coalesce(p_payload ->> 'payment_method', 'interac');

  if v_method not in ('interac', 'usdc_solana') then
    raise exception 'Choose a payment method.' using errcode = 'check_violation';
  end if;

  -- Fail before the order exists rather than leaving an unpayable one behind.
  if v_method = 'usdc_solana' and not usdc_available() then
    raise exception 'USDC payment is not available right now. Choose Interac e-Transfer instead.'
      using errcode = 'check_violation';
  end if;

  v_result := place_order_with_contact(p_payload);

  if v_method <> 'usdc_solana' then
    return v_result;
  end if;

  v_order_id := (v_result ->> 'order_id')::uuid;
  v_total    := (v_result ->> 'total_cents')::int;

  -- Quoted here, inside the same transaction that created the order, so the
  -- figure stored is the figure the customer is about to be shown.
  v_quote   := usdc_quote(v_total);
  v_address := assign_usdc_address(v_order_id);

  select usdc_quote_minutes into v_minutes from settings where id;

  update orders
  set payment_method        = 'usdc_solana',
      usdc_address          = v_address,
      usdc_amount_micros    = (v_quote ->> 'amount_micros')::bigint,
      usdc_rate_cad         = (v_quote ->> 'rate_cad')::numeric,
      usdc_rate_source      = coalesce(v_quote ->> 'source', ''),
      usdc_rate_fetched_at  = (v_quote ->> 'fetched_at')::timestamptz,
      usdc_quote_expires_at = now() + make_interval(mins => v_minutes)
  where id = v_order_id;

  return v_result
    || jsonb_build_object(
         'payment_method', 'usdc_solana',
         'usdc_address', v_address,
         'usdc_amount_micros', (v_quote ->> 'amount_micros')::bigint,
         'usdc_amount_display', v_quote ->> 'amount_display',
         'usdc_rate_cad', v_quote ->> 'rate_cad',
         'usdc_quote_expires_at', now() + make_interval(mins => v_minutes)
       );
end;
$$;

-- --- Re-quoting --------------------------------------------------------------
-- A customer who wanders off for an hour comes back to an expired figure. This
-- restates it at the current rate. The address never changes -- only the
-- amount -- so a payment already in flight still lands somewhere attributable.

create or replace function refresh_usdc_quote(p_order_number text, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order   orders;
  v_quote   jsonb;
  v_minutes int;
begin
  select * into v_order
  from orders
  where upper(order_number) = upper(trim(p_order_number))
    and customer_email = trim(p_email)::citext;

  -- Same deliberate vagueness as lookup_order: unauthenticated, so it must not
  -- confirm whether an order number exists.
  if not found then
    return jsonb_build_object('ok', false,
      'message', 'No order matches that order number and email.');
  end if;

  if v_order.payment_method <> 'usdc_solana' then
    return jsonb_build_object('ok', false, 'message', 'That order is not paying with USDC.');
  end if;

  if v_order.payment_status = 'paid' then
    return jsonb_build_object('ok', false, 'message', 'That order is already paid.');
  end if;

  v_quote := usdc_quote(v_order.total_cents);

  if not (v_quote ->> 'available')::boolean then
    return jsonb_build_object('ok', false, 'message', v_quote ->> 'message');
  end if;

  select usdc_quote_minutes into v_minutes from settings where id;

  update orders
  set usdc_amount_micros    = (v_quote ->> 'amount_micros')::bigint,
      usdc_rate_cad         = (v_quote ->> 'rate_cad')::numeric,
      usdc_rate_source      = coalesce(v_quote ->> 'source', ''),
      usdc_rate_fetched_at  = (v_quote ->> 'fetched_at')::timestamptz,
      usdc_quote_expires_at = now() + make_interval(mins => v_minutes)
  where id = v_order.id;

  return jsonb_build_object(
    'ok', true,
    'amount_micros', (v_quote ->> 'amount_micros')::bigint,
    'amount_display', v_quote ->> 'amount_display',
    'address', v_order.usdc_address,
    'rate_cad', v_quote ->> 'rate_cad',
    'expires_at', now() + make_interval(mins => v_minutes)
  );
end;
$$;

grant execute on function refresh_usdc_quote(text, text) to anon, authenticated;

-- --- Confirmation ------------------------------------------------------------
-- Staff have looked at their wallet and typed in what arrived. Everything below
-- follows from that number; nothing here trusts the chain.

create or replace function confirm_usdc_payment(
  p_order_id       uuid,
  p_received_micros bigint,
  p_actor          uuid default null,
  p_note           text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order    orders;
  v_shortfall bigint;
  v_status   payment_status;
begin
  select * into v_order from orders where id = p_order_id for update;

  if not found then
    raise exception 'Order not found.' using errcode = 'no_data_found';
  end if;

  if v_order.payment_method <> 'usdc_solana' then
    raise exception 'That order is not paying with USDC.' using errcode = 'check_violation';
  end if;

  if p_received_micros <= 0 then
    raise exception 'Enter the amount of USDC that arrived.' using errcode = 'check_violation';
  end if;

  v_shortfall := v_order.usdc_amount_micros - p_received_micros;

  -- Under by a cent or less is treated as paid. Wallets round, and chasing two
  -- cents costs more than it recovers.
  if v_shortfall > 10000 then
    v_status := 'partially_paid';
  else
    v_status := 'paid';
  end if;

  update orders
  set usdc_received_micros = p_received_micros,
      usdc_confirmed_at    = now(),
      payment_status       = v_status,
      -- The CAD ledger stays the source of truth for reporting. A short payment
      -- credits proportionally rather than pretending the full amount landed.
      amount_paid_cents    = case
                               when v_status = 'paid' then v_order.total_cents
                               else least(
                                 v_order.total_cents,
                                 round(v_order.total_cents::numeric
                                       * p_received_micros
                                       / nullif(v_order.usdc_amount_micros, 0))::int
                               )
                             end,
      paid_at              = case when v_status = 'paid' then now() else v_order.paid_at end,
      status               = case
                               when v_status = 'paid' and v_order.status = 'pending_payment'
                                 then 'payment_received'
                               else v_order.status
                             end,
      internal_notes       = case
                               when p_note = '' then v_order.internal_notes
                               else trim(both E'\n' from v_order.internal_notes || E'\n' || p_note)
                             end
  where id = p_order_id;

  return jsonb_build_object(
    'ok', true,
    'payment_status', v_status,
    'shortfall_micros', greatest(v_shortfall, 0)
  );
end;
$$;

-- --- Pool statistics ---------------------------------------------------------

create or replace function usdc_pool_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'total',     count(*),
    'available', count(*) filter (where order_id is null and not is_retired),
    'assigned',  count(*) filter (where order_id is not null),
    'retired',   count(*) filter (where is_retired),
    'low',       count(*) filter (where order_id is null and not is_retired)
                 <= (select usdc_low_pool_threshold from settings where id),
    'threshold', (select usdc_low_pool_threshold from settings where id),
    'enabled',   (select usdc_enabled from settings where id),
    'rate_ok',   usdc_available()
  )
  from usdc_addresses;
$$;

-- --- Customer tracking page --------------------------------------------------
-- Extends 0016. A USDC customer coming back to check on their order needs the
-- address and figure in front of them again, not just a status.

create or replace function lookup_order(p_order_number text, p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_order orders;
begin
  select * into v_order
  from orders
  where upper(order_number) = upper(trim(p_order_number))
    and customer_email = trim(p_email)::citext;

  if not found then
    return jsonb_build_object('found', false,
      'message', 'No order matches that order number and email.');
  end if;

  return jsonb_build_object(
    'found', true,
    'order_number', v_order.order_number,
    'status', v_order.status,
    'payment_status', v_order.payment_status,
    'placed_at', v_order.placed_at,
    'estimated_delivery_at', v_order.estimated_delivery_at,
    'delivered_at', v_order.delivered_at,
    'tracking_notes', v_order.tracking_notes,
    'customer_name', v_order.customer_name,
    'address', jsonb_build_object(
      'line1', v_order.address_line1, 'line2', v_order.address_line2,
      'city', v_order.city, 'province', v_order.province, 'postal_code', v_order.postal_code
    ),
    'subtotal_cents', v_order.subtotal_cents,
    'discount_cents', v_order.discount_cents,
    'coupon_code', v_order.coupon_code,
    'coupon_label', v_order.coupon_label,
    'delivery_fee_cents', v_order.delivery_fee_cents,
    'delivery_discount_label', v_order.delivery_discount_label,
    'tax_cents', v_order.tax_cents,
    'total_cents', v_order.total_cents,
    'payment_method', v_order.payment_method,
    'usdc', case
      when v_order.payment_method = 'usdc_solana' then jsonb_build_object(
        'address', v_order.usdc_address,
        'amount_micros', v_order.usdc_amount_micros,
        'amount_display', to_char(v_order.usdc_amount_micros::numeric / 1000000, 'FM999999990.00'),
        'rate_cad', v_order.usdc_rate_cad,
        'quote_expires_at', v_order.usdc_quote_expires_at,
        'expired', v_order.usdc_quote_expires_at is not null
                   and v_order.usdc_quote_expires_at < now(),
        'received_micros', v_order.usdc_received_micros,
        'confirmed_at', v_order.usdc_confirmed_at
      )
      else null
    end,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', name, 'sku', sku, 'quantity', quantity,
        'unit_price_cents', unit_price_cents, 'line_total_cents', line_total_cents
      ) order by name), '[]'::jsonb)
      from order_items where order_id = v_order.id
    )
  );
end;
$$;

grant execute on function lookup_order(text, text) to anon, authenticated;
grant execute on function usdc_available() to anon, authenticated;
grant execute on function usdc_quote(int) to anon, authenticated;

-- --- Row level security ------------------------------------------------------
-- The pool is staff-only. A customer learns their own address through
-- lookup_order, which is scoped to their order number and email, and never sees
-- the table.

alter table usdc_addresses  enable row level security;
alter table fx_rate_cache enable row level security;

create policy "staff read usdc addresses" on usdc_addresses
  for select using (is_staff());

create policy "managers write usdc addresses" on usdc_addresses
  for all using (has_min_role('manager')) with check (has_min_role('manager'));

-- Readable by anyone: it is a public market price, and checkout needs it before
-- the customer has any kind of session. Writes are service-role only, which
-- bypasses RLS, so no write policy is granted here at all.
create policy "anyone reads fx rate" on fx_rate_cache for select using (true);

-- --- Gate wording ------------------------------------------------------------
-- The required payment acknowledgement named Interac e-Transfer specifically,
-- which stopped being true the moment a second payment method existed. A
-- required acknowledgement has to describe what the customer is agreeing to.

update site_acknowledgements
set label = 'I understand my order is not confirmed until my payment is received',
    body  = 'We hold your items while we wait. Nothing is packed or dispatched before payment clears, whether you pay by Interac e-Transfer or in USDC.'
where key = 'etransfer_payment';
