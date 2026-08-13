-- =============================================================================
-- 0014  Coupon codes
-- =============================================================================
-- Three kinds of discount, each with its own guard rails:
--
--   percent_off    take N% off the items, optionally capped
--   amount_off     take a fixed amount off the items
--   free_delivery  waive the delivery charge
--
-- A coupon can be limited by date range, by total redemptions, and by
-- redemptions per customer email. All three are checked again inside
-- place_order() under a row lock, so a code with one use left cannot be spent
-- twice by two people checking out at the same moment.

create type coupon_kind as enum ('percent_off', 'amount_off', 'free_delivery');

create table coupons (
  id                  uuid primary key default gen_random_uuid(),
  code                citext not null,
  description         text not null default '',
  kind                coupon_kind not null,

  -- percent_off: basis points (2500 = 25%). amount_off: cents. free_delivery: unused.
  value               int not null default 0 check (value >= 0),
  max_discount_cents  int check (max_discount_cents is null or max_discount_cents > 0),
  minimum_order_cents int not null default 0 check (minimum_order_cents >= 0),

  usage_limit         int check (usage_limit is null or usage_limit > 0),
  per_customer_limit  int check (per_customer_limit is null or per_customer_limit > 0),
  times_redeemed      int not null default 0 check (times_redeemed >= 0),

  starts_at           timestamptz,
  expires_at          timestamptz,
  is_active           boolean not null default true,

  created_by          uuid references profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint coupons_percent_range check (kind <> 'percent_off' or value between 1 and 10000),
  constraint coupons_amount_positive check (kind <> 'amount_off' or value > 0),
  constraint coupons_dates_ordered check (expires_at is null or starts_at is null or expires_at > starts_at)
);

-- Codes are matched case-insensitively, so FALL25 and fall25 are the same coupon
-- and cannot both be created.
create unique index coupons_code_key on coupons (code);
create index coupons_active_idx on coupons (is_active, expires_at);

create trigger coupons_updated_at
  before update on coupons
  for each row execute function set_updated_at();

-- Codes are typed by hand off a printed card or a text message. Strip the
-- spaces and dashes people add, and store them upper case.
create or replace function normalize_coupon_code()
returns trigger
language plpgsql
as $$
begin
  new.code := upper(regexp_replace(coalesce(new.code, ''), '[^A-Za-z0-9]', '', 'g'));
  if new.code = '' then
    raise exception 'A coupon needs a code.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger coupons_normalize
  before insert or update on coupons
  for each row execute function normalize_coupon_code();

create table coupon_redemptions (
  id             bigserial primary key,
  coupon_id      uuid not null references coupons(id) on delete cascade,
  order_id       uuid references orders(id) on delete set null,
  order_number   text not null default '',
  customer_email citext not null,
  discount_cents int not null check (discount_cents >= 0),
  created_at     timestamptz not null default now()
);

create index coupon_redemptions_coupon_idx on coupon_redemptions (coupon_id, created_at desc);
create index coupon_redemptions_email_idx  on coupon_redemptions (coupon_id, customer_email);

-- --- Orders carry what was applied ------------------------------------------

alter table orders
  add column coupon_id      uuid references coupons(id) on delete set null,
  add column coupon_code    text not null default '',
  add column coupon_label   text not null default '',
  add column discount_cents int not null default 0 check (discount_cents >= 0);

create index orders_coupon_idx on orders (coupon_id) where coupon_id is not null;

-- =============================================================================
-- Evaluation
-- =============================================================================
-- Returns the same shape whether the code works or not, so the checkout panel
-- can render either outcome without branching on HTTP status.
--
-- Note what this does NOT do: it never reveals that a code exists but is
-- unusable for someone else. Unknown and inactive codes get one shared message,
-- so the endpoint cannot be used to enumerate valid codes.

create or replace function evaluate_coupon(
  p_code               text,
  p_subtotal_cents     int,
  p_delivery_fee_cents int default 0,
  p_email              text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_coupon   coupons;
  v_code     text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_discount int := 0;
  v_used     int;
  v_label    text;
begin
  if v_code = '' then
    return jsonb_build_object('valid', false, 'reason', 'empty',
      'message', 'Enter a code.');
  end if;

  select * into v_coupon from coupons where code = v_code::citext;

  if not found or not v_coupon.is_active then
    return jsonb_build_object('valid', false, 'reason', 'unknown',
      'message', 'That code isn''t valid.');
  end if;

  if v_coupon.starts_at is not null and now() < v_coupon.starts_at then
    return jsonb_build_object('valid', false, 'reason', 'not_started',
      'message', 'That code isn''t active yet.');
  end if;

  if v_coupon.expires_at is not null and now() >= v_coupon.expires_at then
    return jsonb_build_object('valid', false, 'reason', 'expired',
      'message', 'That code has expired.');
  end if;

  if v_coupon.usage_limit is not null and v_coupon.times_redeemed >= v_coupon.usage_limit then
    return jsonb_build_object('valid', false, 'reason', 'exhausted',
      'message', 'That code has been fully redeemed.');
  end if;

  if v_coupon.per_customer_limit is not null and coalesce(trim(p_email), '') <> '' then
    select count(*) into v_used
    from coupon_redemptions
    where coupon_id = v_coupon.id and customer_email = trim(p_email)::citext;

    if v_used >= v_coupon.per_customer_limit then
      return jsonb_build_object('valid', false, 'reason', 'per_customer',
        'message', 'You have already used that code.');
    end if;
  end if;

  if p_subtotal_cents < v_coupon.minimum_order_cents then
    return jsonb_build_object('valid', false, 'reason', 'below_minimum',
      'message', 'That code needs an order of at least $'
                 || to_char(v_coupon.minimum_order_cents / 100.0, 'FM999999990.00') || '.',
      'minimum_order_cents', v_coupon.minimum_order_cents);
  end if;

  if v_coupon.kind = 'percent_off' then
    v_discount := round(p_subtotal_cents * v_coupon.value / 10000.0);
    if v_coupon.max_discount_cents is not null then
      v_discount := least(v_discount, v_coupon.max_discount_cents);
    end if;
    -- FM leaves a trailing point on whole numbers, so 1000 bps would read "10.% off".
    v_label := rtrim(trim(to_char(v_coupon.value / 100.0, 'FM999990.99')), '.') || '% off';

  elsif v_coupon.kind = 'amount_off' then
    v_discount := v_coupon.value;
    v_label := '$' || to_char(v_coupon.value / 100.0, 'FM999999990.00') || ' off';

  else
    v_discount := p_delivery_fee_cents;
    v_label := 'Free delivery';
  end if;

  -- A discount can reduce a bill to nothing but never below it, so a coupon can
  -- never turn into a payout.
  if v_coupon.kind = 'free_delivery' then
    v_discount := greatest(0, least(v_discount, p_delivery_fee_cents));
  else
    v_discount := greatest(0, least(v_discount, p_subtotal_cents));
  end if;

  return jsonb_build_object(
    'valid', true,
    'coupon_id', v_coupon.id,
    'code', v_coupon.code,
    'kind', v_coupon.kind,
    'label', v_label,
    'description', v_coupon.description,
    'discount_cents', v_discount,
    'applies_to', case when v_coupon.kind = 'free_delivery' then 'delivery' else 'subtotal' end,
    'message', v_label || ' applied.'
  );
end;
$$;

grant execute on function evaluate_coupon(text, int, int, text) to anon, authenticated;

-- =============================================================================
-- Checkout, now coupon-aware
-- =============================================================================

create or replace function place_order(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item          jsonb;
  v_acknowledged  jsonb;
  v_product       products;
  v_quantity      int;
  v_subtotal      int := 0;
  v_item_count    int := 0;
  v_tax_rate      int;
  v_quote         jsonb;
  v_delivery_fee  int;
  v_tax           int;
  v_total         int;
  v_order_id      uuid := gen_random_uuid();
  v_order_number  text;
  v_postal        text;
  v_eta_max       int;
  v_line_total    int;
  v_email         text;
  v_code          text;
  v_coupon        coupons;
  v_eval          jsonb;
  v_discount      int := 0;
  v_given         int := 0;
  v_coupon_label  text := '';
  v_used          int;
begin
  if jsonb_array_length(coalesce(p_payload -> 'items', '[]'::jsonb)) = 0 then
    raise exception 'Add at least one item before checking out.' using errcode = 'check_violation';
  end if;

  v_acknowledged := assert_acknowledgements(p_payload -> 'acknowledgements');

  v_postal := normalize_postal(p_payload #>> '{address,postal_code}');
  if v_postal is null then
    raise exception 'A postal code is required.' using errcode = 'check_violation';
  end if;

  v_email := lower(trim(coalesce(p_payload #>> '{customer,email}', '')));

  perform 1
  from products
  where id in (
    select (value ->> 'product_id')::uuid from jsonb_array_elements(p_payload -> 'items')
  )
  order by id
  for update;

  for v_item in select * from jsonb_array_elements(p_payload -> 'items')
  loop
    v_quantity := (v_item ->> 'quantity')::int;

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Item quantities must be at least 1.' using errcode = 'check_violation';
    end if;

    select * into v_product from products where id = (v_item ->> 'product_id')::uuid;

    if not found or v_product.status <> 'active' then
      raise exception 'One of the items is no longer available.' using errcode = 'no_data_found';
    end if;

    if (v_product.quantity - v_product.quantity_reserved) < v_quantity then
      raise exception '% only has % left.', v_product.name,
        (v_product.quantity - v_product.quantity_reserved)
        using errcode = 'check_violation';
    end if;

    v_subtotal   := v_subtotal + (v_product.price_cents * v_quantity);
    v_item_count := v_item_count + v_quantity;
  end loop;

  v_quote := quote_delivery(v_postal, p_payload #>> '{address,city}', v_subtotal, v_item_count);

  if not (v_quote ->> 'deliverable')::boolean then
    raise exception '%', v_quote ->> 'message' using errcode = 'check_violation';
  end if;

  v_delivery_fee := (v_quote ->> 'fee_cents')::int;
  v_eta_max      := (v_quote ->> 'eta_max_minutes')::int;

  -- --- Coupon -----------------------------------------------------------
  -- The browser's evaluation was advisory. This is the one that counts, and it
  -- runs with the coupon row locked so two simultaneous checkouts cannot both
  -- take the last remaining use.
  v_code := upper(regexp_replace(coalesce(p_payload ->> 'coupon_code', ''), '[^A-Za-z0-9]', '', 'g'));

  if v_code <> '' then
    select * into v_coupon from coupons where code = v_code::citext for update;

    if not found then
      raise exception 'That code isn''t valid.' using errcode = 'check_violation';
    end if;

    -- Re-check the limits inside the lock rather than trusting the earlier read.
    if v_coupon.usage_limit is not null and v_coupon.times_redeemed >= v_coupon.usage_limit then
      raise exception 'That code has been fully redeemed.' using errcode = 'check_violation';
    end if;

    if v_coupon.per_customer_limit is not null then
      select count(*) into v_used
      from coupon_redemptions
      where coupon_id = v_coupon.id and customer_email = v_email::citext;

      if v_used >= v_coupon.per_customer_limit then
        raise exception 'You have already used that code.' using errcode = 'check_violation';
      end if;
    end if;

    v_eval := evaluate_coupon(v_code, v_subtotal, v_delivery_fee, v_email);

    if not (v_eval ->> 'valid')::boolean then
      raise exception '%', v_eval ->> 'message' using errcode = 'check_violation';
    end if;

    v_coupon_label := v_eval ->> 'label';
    v_given        := (v_eval ->> 'discount_cents')::int;

    if (v_eval ->> 'applies_to') = 'delivery' then
      v_delivery_fee := v_delivery_fee - v_given;   -- waived, so nothing to subtract later
    else
      v_discount := v_given;
    end if;
  end if;

  select tax_rate_bps into v_tax_rate from settings where id;

  -- Tax is charged on what the customer actually pays for goods and delivery,
  -- so the discount comes off before the tax is worked out.
  v_tax   := round(((v_subtotal - v_discount) + v_delivery_fee) * v_tax_rate / 10000.0);
  v_total := (v_subtotal - v_discount) + v_delivery_fee + v_tax;

  v_order_number := next_order_number();

  insert into orders (
    id, order_number, customer_name, customer_email, customer_phone,
    address_line1, address_line2, city, province, postal_code, delivery_notes,
    delivery_zone_id, delivery_zone_name,
    subtotal_cents, delivery_fee_cents, tax_cents, total_cents, tax_rate_bps,
    delivery_base_fee_cents, delivery_discount_label,
    coupon_id, coupon_code, coupon_label, discount_cents,
    inventory_reserved, estimated_delivery_at,
    acknowledgements, acknowledged_at
  )
  values (
    v_order_id, v_order_number,
    p_payload #>> '{customer,name}',
    p_payload #>> '{customer,email}',
    p_payload #>> '{customer,phone}',
    p_payload #>> '{address,line1}',
    coalesce(p_payload #>> '{address,line2}', ''),
    p_payload #>> '{address,city}',
    coalesce(p_payload #>> '{address,province}', 'BC'),
    v_postal,
    coalesce(p_payload #>> '{address,notes}', ''),
    nullif(v_quote ->> 'zone_id', '')::uuid,
    coalesce(v_quote ->> 'zone_name', ''),
    v_subtotal, v_delivery_fee, v_tax, v_total, v_tax_rate,
    (v_quote ->> 'base_fee_cents')::int,
    coalesce(v_quote ->> 'discount_label', ''),
    v_coupon.id, coalesce(v_coupon.code::text, ''), v_coupon_label, v_discount,
    true,
    now() + make_interval(mins => v_eta_max),
    v_acknowledged,
    case when jsonb_array_length(v_acknowledged) > 0 then now() end
  );

  if v_coupon.id is not null then
    update coupons set times_redeemed = times_redeemed + 1 where id = v_coupon.id;

    insert into coupon_redemptions (coupon_id, order_id, order_number, customer_email, discount_cents)
    values (v_coupon.id, v_order_id, v_order_number, v_email, v_given);
  end if;

  for v_item in select * from jsonb_array_elements(p_payload -> 'items')
  loop
    v_quantity := (v_item ->> 'quantity')::int;
    select * into v_product from products where id = (v_item ->> 'product_id')::uuid;
    v_line_total := v_product.price_cents * v_quantity;

    insert into order_items (
      order_id, product_id, sku, name, unit, unit_price_cents, quantity, line_total_cents
    )
    values (
      v_order_id, v_product.id, v_product.sku, v_product.name, v_product.unit,
      v_product.price_cents, v_quantity, v_line_total
    );

    perform apply_inventory_movement(
      v_product.id, 'reservation', v_quantity,
      'Order placed', '', v_order_number, v_order_id
    );
  end loop;

  insert into order_status_history (order_id, to_status, note)
  values (v_order_id, 'pending_payment', 'Order placed. Awaiting Interac e-Transfer.');

  perform log_activity('order.placed', 'order', v_order_number,
    jsonb_build_object('total_cents', v_total, 'items', v_item_count,
                       'coupon', nullif(v_code, '')));

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'subtotal_cents', v_subtotal,
    'discount_cents', v_discount,
    'coupon_code', coalesce(v_coupon.code::text, ''),
    'coupon_label', v_coupon_label,
    'delivery_fee_cents', v_delivery_fee,
    'delivery_discount_label', coalesce(v_quote ->> 'discount_label', ''),
    'tax_cents', v_tax,
    'total_cents', v_total,
    'zone_name', coalesce(v_quote ->> 'zone_name', ''),
    'estimated_delivery_at', (now() + make_interval(mins => v_eta_max))
  );
end;
$$;

-- =============================================================================
-- Reporting and access
-- =============================================================================

create view coupon_performance with (security_invoker = true) as
select
  c.id,
  c.code,
  c.kind,
  c.is_active,
  c.usage_limit,
  c.times_redeemed,
  c.expires_at,
  case
    when not c.is_active then 'Paused'
    when c.expires_at is not null and now() >= c.expires_at then 'Expired'
    when c.starts_at is not null and now() < c.starts_at then 'Scheduled'
    when c.usage_limit is not null and c.times_redeemed >= c.usage_limit then 'Fully redeemed'
    else 'Live'
  end                                              as state,
  coalesce(sum(r.discount_cents), 0)               as discount_given_cents,
  count(distinct r.customer_email)                 as customers,
  max(r.created_at)                                as last_used_at
from coupons c
left join coupon_redemptions r on r.coupon_id = c.id
group by c.id;

alter table coupons             enable row level security;
alter table coupon_redemptions  enable row level security;

-- Anonymous shoppers never read this table. They only ever reach a coupon
-- through evaluate_coupon(), which is security definer and answers one code at
-- a time.
create policy "staff read coupons" on coupons for select using (is_staff());
create policy "managers write coupons" on coupons
  for all using (has_min_role('manager')) with check (has_min_role('manager'));

create policy "staff read redemptions" on coupon_redemptions for select using (is_staff());
