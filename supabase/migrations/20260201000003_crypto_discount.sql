-- =============================================================================
-- 0025  Crypto payment discount
-- =============================================================================
-- A percentage off for paying in USDC, controlled from the Coupons screen.
--
-- The discount is applied to the subtotal alongside any coupon, not subtracted
-- from the final total. That ordering matters: tax is charged on
-- (subtotal - discount) + delivery, so a discount taken off the end would
-- charge the customer tax on money they never paid. Point-of-sale discounts
-- reduce the taxable amount, and this one behaves like the coupon that already
-- exists rather than inventing a second shape.
--
-- The one genuinely awkward case is a customer who chooses USDC, gets the
-- discount, and then sends an e-Transfer instead. The order would have been
-- priced on a promise they did not keep. There is a function below to take the
-- discount back off, and the admin order screen warns when it applies.

-- --- Settings ----------------------------------------------------------------

alter table settings
  add column crypto_discount_enabled boolean not null default false,

  -- Basis points, so 250 is 2.5%. Capped at 50%: a larger figure is far more
  -- likely to be a typo than an intention, and the cost of that typo is every
  -- order that day going out at a fraction of its price.
  add column crypto_discount_bps int not null default 0
    check (crypto_discount_bps between 0 and 5000),

  add column crypto_discount_label text not null default 'Crypto payment discount',

  -- Whether it combines with a coupon code. Off by default: a shop running a
  -- 20% promotion should not silently be giving 25% to anyone who pays in USDC.
  add column crypto_discount_stacks boolean not null default false,

  -- Optional ceiling in cents. Zero means no ceiling. Protects a percentage
  -- discount from becoming very large on an unusually big order.
  add column crypto_discount_max_cents int not null default 0
    check (crypto_discount_max_cents >= 0);

-- --- Orders ------------------------------------------------------------------

alter table orders
  add column crypto_discount_cents int not null default 0
    check (crypto_discount_cents >= 0),
  -- The rate in force when the order was placed, kept so an old order can be
  -- explained after the setting has moved on.
  add column crypto_discount_bps int not null default 0;

-- --- Calculation -------------------------------------------------------------

-- How much the crypto discount is worth on this order, in cents.
--
-- Takes the coupon discount as an argument rather than ignoring it, because the
-- two interact in two different ways depending on the stacking setting, and
-- because the pair together must never exceed the subtotal.
create or replace function crypto_discount_for(
  p_subtotal_cents        int,
  p_coupon_discount_cents int
)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_on      boolean;
  v_bps     int;
  v_stacks  boolean;
  v_max     int;
  v_amount  int;
begin
  select crypto_discount_enabled, crypto_discount_bps,
         crypto_discount_stacks, crypto_discount_max_cents
    into v_on, v_bps, v_stacks, v_max
  from settings where id;

  if not v_on or v_bps <= 0 then
    return 0;
  end if;

  -- Not stacking means a coupon wins outright. The customer keeps the better
  -- deal they already had rather than losing it by choosing USDC.
  if p_coupon_discount_cents > 0 and not v_stacks then
    return 0;
  end if;

  -- Charged against the subtotal, not against what is left after the coupon,
  -- so the advertised percentage is the percentage the customer sees.
  v_amount := round(p_subtotal_cents * v_bps / 10000.0);

  if v_max > 0 then
    v_amount := least(v_amount, v_max);
  end if;

  -- The two discounts together can never exceed the subtotal, or the order
  -- would carry a negative goods value and the tax line would go negative
  -- with it.
  v_amount := greatest(0, least(v_amount, p_subtotal_cents - p_coupon_discount_cents));

  return v_amount;
end;
$$;

grant execute on function crypto_discount_for(int, int) to anon, authenticated;

-- What the storefront needs to show the saving before an order exists.
create or replace function crypto_discount_preview()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'enabled', crypto_discount_enabled and crypto_discount_bps > 0 and usdc_available(),
    'bps',     crypto_discount_bps,
    'percent', round(crypto_discount_bps / 100.0, 2),
    'label',   crypto_discount_label,
    'stacks',  crypto_discount_stacks,
    'max_cents', crypto_discount_max_cents
  )
  from settings where id;
$$;

grant execute on function crypto_discount_preview() to anon, authenticated;

-- --- Repricing ---------------------------------------------------------------

-- Recomputes an order's tax and total after the crypto discount is added.
--
-- The arithmetic here has to match place_order_core exactly, so it is written
-- once in this function and called, rather than inlined at each site that needs
-- it. Two copies of a tax formula is two things to keep in step, and the
-- version that drifts is the one nobody is looking at.
create or replace function apply_crypto_discount(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order   orders;
  v_extra   int;
  v_disc    int;
  v_tax     int;
  v_total   int;
begin
  select * into v_order from orders where id = p_order_id for update;

  if not found then
    raise exception 'Order not found.' using errcode = 'no_data_found';
  end if;

  v_extra := crypto_discount_for(v_order.subtotal_cents, v_order.discount_cents);

  if v_extra <= 0 then
    return jsonb_build_object('applied', false, 'amount_cents', 0,
      'total_cents', v_order.total_cents);
  end if;

  v_disc  := v_order.discount_cents + v_extra;
  v_tax   := round(((v_order.subtotal_cents - v_disc) + v_order.delivery_fee_cents)
                   * v_order.tax_rate_bps / 10000.0);
  v_total := (v_order.subtotal_cents - v_disc) + v_order.delivery_fee_cents + v_tax;

  update orders
  set discount_cents       = v_disc,
      crypto_discount_cents = v_extra,
      crypto_discount_bps  = (select crypto_discount_bps from settings where id),
      tax_cents            = v_tax,
      total_cents          = v_total
  where id = p_order_id;

  return jsonb_build_object('applied', true, 'amount_cents', v_extra,
    'total_cents', v_total);
end;
$$;

-- Takes the discount back off, for a customer who chose USDC and then paid some
-- other way. Recomputes rather than reversing arithmetic, so rounding cannot
-- leave the order a cent adrift.
create or replace function revoke_crypto_discount(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders;
  v_disc  int;
  v_tax   int;
  v_total int;
begin
  select * into v_order from orders where id = p_order_id for update;

  if not found then
    raise exception 'Order not found.' using errcode = 'no_data_found';
  end if;

  if v_order.crypto_discount_cents <= 0 then
    return jsonb_build_object('ok', false, 'message', 'That order has no USDC discount on it.');
  end if;

  v_disc  := greatest(0, v_order.discount_cents - v_order.crypto_discount_cents);
  v_tax   := round(((v_order.subtotal_cents - v_disc) + v_order.delivery_fee_cents)
                   * v_order.tax_rate_bps / 10000.0);
  v_total := (v_order.subtotal_cents - v_disc) + v_order.delivery_fee_cents + v_tax;

  update orders
  set discount_cents        = v_disc,
      crypto_discount_cents = 0,
      tax_cents             = v_tax,
      total_cents           = v_total,
      -- The order is now worth more than was paid against it, so the payment
      -- status has to be reconsidered rather than left saying paid.
      payment_status        = case
                                when amount_paid_cents >= v_total then 'paid'
                                when amount_paid_cents > 0 then 'partially_paid'
                                else payment_status
                              end,
      internal_notes        = trim(both E'\n' from
                                v_order.internal_notes || E'\n' ||
                                'USDC discount removed; order repriced to ' ||
                                to_char(v_total / 100.0, 'FM999999990.00') || '.')
  where id = p_order_id;

  return jsonb_build_object('ok', true, 'total_cents', v_total);
end;
$$;

-- --- Checkout ----------------------------------------------------------------
-- Replaces the wrapper from 0023. The order of operations is the whole point:
-- price the order, then discount it, and only then convert to USDC — quoting
-- first would quote the undiscounted figure and the customer would send too
-- much.

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
  v_disc     jsonb;
begin
  v_method := coalesce(p_payload ->> 'payment_method', 'interac');

  if v_method not in ('interac', 'usdc_solana') then
    raise exception 'Choose a payment method.' using errcode = 'check_violation';
  end if;

  if v_method = 'usdc_solana' and not usdc_available() then
    raise exception 'USDC payment is not available right now. Choose Interac e-Transfer instead.'
      using errcode = 'check_violation';
  end if;

  v_result := place_order_with_contact(p_payload);

  if v_method <> 'usdc_solana' then
    return v_result;
  end if;

  v_order_id := (v_result ->> 'order_id')::uuid;

  -- Discount first, then read the total back. Everything downstream — the USDC
  -- figure, the confirmation email, the amount staff expect to see arrive —
  -- has to come from the repriced total.
  v_disc := apply_crypto_discount(v_order_id);

  select total_cents into v_total from orders where id = v_order_id;

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
         'usdc_quote_expires_at', now() + make_interval(mins => v_minutes),
         'crypto_discount_cents', (v_disc ->> 'amount_cents')::int,
         -- The totals in the checkout response are now stale, so they are
         -- restated here rather than left for the caller to notice.
         'total_cents', v_total,
         'discount_cents', (select discount_cents from orders where id = v_order_id),
         'tax_cents', (select tax_cents from orders where id = v_order_id)
       );
end;
$$;

-- --- Re-quoting --------------------------------------------------------------
-- Unchanged in substance, but it must price from the order's stored total,
-- which already carries the discount. Restated here so a future reader does not
-- have to check 0023 to be sure.

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

  -- total_cents is post-discount, so the customer is re-quoted on the price
  -- they were actually given.
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

-- --- Customer tracking page --------------------------------------------------
-- Extends 0023 with the discount line, so a customer can see why their total is
-- what it is.

create or replace function lookup_order(p_order_number text, p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_order orders;
  v_label text;
begin
  select * into v_order
  from orders
  where upper(order_number) = upper(trim(p_order_number))
    and customer_email = trim(p_email)::citext;

  if not found then
    return jsonb_build_object('found', false,
      'message', 'No order matches that order number and email.');
  end if;

  select crypto_discount_label into v_label from settings where id;

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
    'crypto_discount_cents', v_order.crypto_discount_cents,
    'crypto_discount_label', case when v_order.crypto_discount_cents > 0 then v_label else '' end,
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

-- --- Email templates ---------------------------------------------------------
-- The order confirmation hard-coded Interac wording and a single Discount line.
-- Both stopped being right: a USDC customer was being told to send money to an
-- email address, and a customer with two discounts saw only their combined
-- total with no way to reconcile it against what checkout showed them.
--
-- Only updated where the shop has not already edited the template, so a
-- customised confirmation is never overwritten.

update email_templates
set body = 'Hi {customer_name},

Thanks for your order. We have it, and we are holding your items.

{payment_instructions}

WHAT YOU ORDERED
{items}

Subtotal: {subtotal}
{discount_lines}
Shipping: {shipping}
Tax: {tax}
Total: {total}

Shipping to:
{address}

Track your order any time:
{track_url}

— {company_name}',
    subject = '{order_number} — how to pay for your order'
where key = 'order_placed'
  and body like '%send an Interac e-Transfer of {total} to%';
