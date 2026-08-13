-- =============================================================================
-- 0012  Flat delivery pricing with modifier rules
-- =============================================================================
-- Zones turned out to be more machinery than most shops need. The default is now
-- a single flat fee an administrator types into Settings, adjusted by rules like
-- "5 or more items ships free" or "spend $75 and pay half".
--
-- Zones are not deleted — a shop that genuinely charges by area can switch
-- `delivery_mode` back to 'zones' and its existing rules still work. Modifiers
-- apply in both modes, so the two features compose rather than compete.

create type delivery_mode as enum ('flat', 'zones');

create type modifier_condition as enum (
  'always',                -- an unconditional override, e.g. a promo period
  'item_count_at_least',   -- total units in the order
  'subtotal_at_least'      -- order value in cents, before tax and delivery
);

create type modifier_effect as enum (
  'free',        -- delivery becomes $0
  'set_fee',     -- delivery becomes exactly `amount` cents
  'amount_off',  -- take `amount` cents off, never below zero
  'percent_off'  -- take `amount` basis points off (2500 = 25%)
);

alter table settings
  add column delivery_mode                delivery_mode not null default 'flat',
  add column delivery_flat_fee_cents      int not null default 500
    check (delivery_flat_fee_cents >= 0),
  add column delivery_minimum_order_cents int not null default 0
    check (delivery_minimum_order_cents >= 0),
  add column delivery_eta_min_minutes     int not null default 60 check (delivery_eta_min_minutes >= 0),
  add column delivery_eta_max_minutes     int not null default 120 check (delivery_eta_max_minutes >= 0),
  -- Off means deliver anywhere a customer types. On means the address must
  -- still match a postal rule, while the price stays flat.
  add column delivery_restrict_area       boolean not null default false,
  add constraint settings_delivery_eta_order
    check (delivery_eta_max_minutes >= delivery_eta_min_minutes);

-- --- Modifiers ---------------------------------------------------------------

create table delivery_modifiers (
  id         uuid primary key default gen_random_uuid(),
  -- Shown to the customer when it applies, so write it as a sentence:
  -- "Free delivery on 5 items or more".
  label      text not null,
  condition  modifier_condition not null,
  threshold  int not null default 0 check (threshold >= 0),
  effect     modifier_effect not null,
  amount     int not null default 0 check (amount >= 0),
  priority   int not null default 100,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint delivery_modifiers_percent_range
    check (effect <> 'percent_off' or amount between 0 and 10000),
  constraint delivery_modifiers_threshold_required
    check (condition = 'always' or threshold > 0)
);

create index delivery_modifiers_active_idx on delivery_modifiers (priority) where is_active;

create trigger delivery_modifiers_updated_at
  before update on delivery_modifiers
  for each row execute function set_updated_at();

alter table delivery_modifiers enable row level security;

create policy "anyone reads active modifiers" on delivery_modifiers
  for select using (is_active or is_staff());

create policy "managers write modifiers" on delivery_modifiers
  for all using (has_min_role('manager')) with check (has_min_role('manager'));

-- --- Applying a modifier -----------------------------------------------------
-- Every matching rule is costed and the cheapest result wins. Customers get the
-- best deal they qualify for without staff having to reason about rule order,
-- and `priority` only breaks ties between two rules landing on the same price.

create or replace function best_delivery_modifier(
  p_base_fee_cents int,
  p_subtotal_cents int,
  p_item_count     int
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with matched as (
    select
      m.label,
      m.priority,
      greatest(0, case m.effect
        when 'free'        then 0
        when 'set_fee'     then m.amount
        when 'amount_off'  then p_base_fee_cents - m.amount
        when 'percent_off' then p_base_fee_cents
                                - round(p_base_fee_cents * m.amount / 10000.0)::int
      end) as fee_cents
    from delivery_modifiers m
    where m.is_active
      and case m.condition
        when 'always'              then true
        when 'item_count_at_least' then p_item_count >= m.threshold
        when 'subtotal_at_least'   then p_subtotal_cents >= m.threshold
      end
  )
  select jsonb_build_object('label', label, 'fee_cents', fee_cents)
  from matched
  where fee_cents < p_base_fee_cents   -- a rule that costs more is not a discount
  order by fee_cents asc, priority asc
  limit 1;
$$;

-- --- Quoting -----------------------------------------------------------------
-- Replaces the zone-only version. Item count is new: it is what makes
-- "buy 5, ship free" possible.

create or replace function quote_delivery(
  p_postal         text,
  p_city           text default null,
  p_subtotal_cents int default 0,
  p_item_count     int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_settings settings;
  v_zone     delivery_zones;
  v_base     int;
  v_minimum  int;
  v_eta_min  int;
  v_eta_max  int;
  v_zone_id  uuid;
  v_zone_nm  text := '';
  v_fee      int;
  v_mod      jsonb;
  v_label    text := '';
begin
  select * into v_settings from settings where id;

  if v_settings.delivery_mode = 'zones' then
    -- Area pricing: the zone supplies the fee, the minimum, and the window.
    v_zone := resolve_delivery_zone(p_postal, p_city);

    if v_zone.id is null then
      return jsonb_build_object('deliverable', false, 'reason', 'outside_zone',
        'message', 'We don''t deliver to that postal code yet.');
    end if;

    v_base    := v_zone.fee_cents;
    v_minimum := v_zone.minimum_order_cents;
    v_eta_min := v_zone.estimated_minutes_min;
    v_eta_max := v_zone.estimated_minutes_max;
    v_zone_id := v_zone.id;
    v_zone_nm := v_zone.name;

    if v_zone.free_delivery_threshold_cents is not null
       and p_subtotal_cents >= v_zone.free_delivery_threshold_cents then
      v_base  := 0;
      v_label := 'Free delivery over '
                 || to_char(v_zone.free_delivery_threshold_cents / 100.0, 'FM$999999990.00');
    end if;
  else
    -- Flat pricing: one fee, set in Settings, everywhere.
    v_base    := v_settings.delivery_flat_fee_cents;
    v_minimum := v_settings.delivery_minimum_order_cents;
    v_eta_min := v_settings.delivery_eta_min_minutes;
    v_eta_max := v_settings.delivery_eta_max_minutes;

    -- Optional: still refuse addresses outside the configured area, while
    -- charging the same everywhere inside it.
    if v_settings.delivery_restrict_area then
      v_zone := resolve_delivery_zone(p_postal, p_city);
      if v_zone.id is null then
        return jsonb_build_object('deliverable', false, 'reason', 'outside_zone',
          'message', 'We don''t deliver to that postal code yet.');
      end if;
      v_zone_id := v_zone.id;
      v_zone_nm := v_zone.name;
    end if;
  end if;

  if p_subtotal_cents < v_minimum then
    return jsonb_build_object(
      'deliverable', false,
      'reason', 'below_minimum',
      'message', 'Orders start at '
                 || to_char(v_minimum / 100.0, 'FM$999999990.00') || '.',
      'minimum_order_cents', v_minimum
    );
  end if;

  v_fee := v_base;

  -- A modifier can only ever lower the price the customer sees.
  v_mod := best_delivery_modifier(v_base, p_subtotal_cents, coalesce(p_item_count, 0));
  if v_mod is not null then
    v_fee   := (v_mod ->> 'fee_cents')::int;
    v_label := v_mod ->> 'label';
  end if;

  return jsonb_build_object(
    'deliverable', true,
    'zone_id', v_zone_id,
    'zone_name', v_zone_nm,
    'fee_cents', v_fee,
    'base_fee_cents', v_base,
    'discount_applied', v_fee < v_base or v_label <> '',
    'discount_label', nullif(v_label, ''),
    'free_delivery_applied', v_fee = 0,
    'minimum_order_cents', v_minimum,
    'eta_min_minutes', v_eta_min,
    'eta_max_minutes', v_eta_max
  );
end;
$$;

grant execute on function quote_delivery(text, text, int, int) to anon, authenticated;
grant execute on function best_delivery_modifier(int, int, int) to anon, authenticated;

-- The three-argument version is gone; anything still calling it should fail
-- loudly at deploy time rather than silently quoting without item counts.
drop function if exists quote_delivery(text, text, int);

-- --- Checkout ----------------------------------------------------------------
-- Same as before except it now counts units and passes them to the quote, and
-- records which delivery promotion the customer received.

alter table orders
  add column delivery_discount_label text not null default '',
  add column delivery_base_fee_cents int not null default 0;

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
begin
  if jsonb_array_length(coalesce(p_payload -> 'items', '[]'::jsonb)) = 0 then
    raise exception 'Add at least one item before checking out.' using errcode = 'check_violation';
  end if;

  v_acknowledged := assert_acknowledgements(p_payload -> 'acknowledgements');

  v_postal := normalize_postal(p_payload #>> '{address,postal_code}');
  if v_postal is null then
    raise exception 'A postal code is required.' using errcode = 'check_violation';
  end if;

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

  select tax_rate_bps into v_tax_rate from settings where id;
  v_tax   := round((v_subtotal + v_delivery_fee) * v_tax_rate / 10000.0);
  v_total := v_subtotal + v_delivery_fee + v_tax;

  v_order_number := next_order_number();

  insert into orders (
    id, order_number, customer_name, customer_email, customer_phone,
    address_line1, address_line2, city, province, postal_code, delivery_notes,
    delivery_zone_id, delivery_zone_name,
    subtotal_cents, delivery_fee_cents, tax_cents, total_cents, tax_rate_bps,
    delivery_base_fee_cents, delivery_discount_label,
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
    true,
    now() + make_interval(mins => v_eta_max),
    v_acknowledged,
    case when jsonb_array_length(v_acknowledged) > 0 then now() end
  );

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
    jsonb_build_object('total_cents', v_total, 'items', v_item_count));

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'subtotal_cents', v_subtotal,
    'delivery_fee_cents', v_delivery_fee,
    'delivery_discount_label', coalesce(v_quote ->> 'discount_label', ''),
    'tax_cents', v_tax,
    'total_cents', v_total,
    'zone_name', coalesce(v_quote ->> 'zone_name', ''),
    'estimated_delivery_at', (now() + make_interval(mins => v_eta_max))
  );
end;
$$;

-- --- Defaults ----------------------------------------------------------------
-- Flat $6 delivery, free once someone buys five or more items. Change or delete
-- both from the dashboard; they exist so a fresh install has something sensible.

update settings set
  delivery_mode                = 'flat',
  delivery_flat_fee_cents      = 600,
  delivery_minimum_order_cents = 0,
  delivery_eta_min_minutes     = 60,
  delivery_eta_max_minutes     = 180,
  delivery_restrict_area       = false
where id;

insert into delivery_modifiers (label, condition, threshold, effect, amount, priority)
values
  ('Free delivery on 5 items or more', 'item_count_at_least', 5, 'free', 0, 10),
  ('Half-price delivery over $75',     'subtotal_at_least',   7500, 'percent_off', 5000, 20)
on conflict do nothing;
