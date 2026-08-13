-- =============================================================================
-- 0010  Entry gate — required acknowledgements before using the shop
-- =============================================================================
-- The wording is data, not code: administrators add, edit, reorder, and retire
-- acknowledgements from the dashboard. Editing any active one automatically
-- re-prompts everyone, because the gate's version is a hash of its contents
-- rather than a number someone has to remember to bump.

create table site_acknowledgements (
  id          uuid primary key default gen_random_uuid(),
  key         text not null,            -- stable identifier stored on the order
  label       text not null,            -- the checkbox text itself
  body        text not null default '', -- optional supporting detail
  link_url    text,                     -- optional "read the policy" link
  link_label  text not null default '',
  is_required boolean not null default true,
  sort_order  int     not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint site_acknowledgements_key_format
    check (key ~ '^[a-z0-9_]+$')
);

create unique index site_acknowledgements_key_idx on site_acknowledgements (key);
create index site_acknowledgements_active_idx on site_acknowledgements (sort_order) where is_active;

create trigger site_acknowledgements_updated_at
  before update on site_acknowledgements
  for each row execute function set_updated_at();

alter table settings
  add column gate_enabled       boolean not null default true,
  add column gate_title         text not null default 'Before you order',
  add column gate_intro         text not null default
    'A few things to confirm. These apply to every order we deliver.',
  add column gate_confirm_label text not null default 'Confirm and enter the shop',
  add column gate_decline_label text not null default 'Leave',
  add column gate_decline_url   text not null default 'https://www.google.com';

-- What a customer agreed to has to survive the acknowledgement text being
-- edited later, so the order stores a full snapshot rather than a foreign key.
alter table orders
  add column acknowledgements jsonb not null default '[]'::jsonb,
  add column acknowledged_at  timestamptz;

-- --- Helpers -----------------------------------------------------------------

create or replace function active_acknowledgements()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'key', key, 'label', label, 'body', body,
        'link_url', link_url, 'link_label', link_label,
        'is_required', is_required
      ) order by sort_order, key
    ),
    '[]'::jsonb
  )
  from site_acknowledgements
  where is_active;
$$;

create or replace function required_acknowledgement_keys()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(key order by key), '{}')
  from site_acknowledgements
  where is_active and is_required;
$$;

grant execute on function active_acknowledgements() to anon, authenticated;

-- --- Enforcement at checkout -------------------------------------------------
-- The overlay is a courtesy. This is the part that actually holds: an order
-- cannot be written unless every currently-required acknowledgement was
-- confirmed, whatever the browser claims to have shown.

create or replace function assert_acknowledgements(p_accepted jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_required text[] := required_acknowledgement_keys();
  v_enabled  boolean;
  v_given    text[];
  v_missing  text[];
begin
  select gate_enabled into v_enabled from settings where id;

  if not coalesce(v_enabled, false) or array_length(v_required, 1) is null then
    return '[]'::jsonb;
  end if;

  select coalesce(array_agg(value #>> '{}'), '{}')
    into v_given
  from jsonb_array_elements(coalesce(p_accepted, '[]'::jsonb));

  select array_agg(r) into v_missing
  from unnest(v_required) r
  where not (r = any(v_given));

  if v_missing is not null then
    raise exception 'Please confirm all required acknowledgements before ordering.'
      using errcode = 'check_violation';
  end if;

  -- Snapshot the exact wording that was in force at this moment.
  return (
    select coalesce(jsonb_agg(jsonb_build_object('key', key, 'label', label) order by sort_order), '[]'::jsonb)
    from site_acknowledgements
    where is_active and key = any(v_given)
  );
end;
$$;

-- --- Row Level Security ------------------------------------------------------

alter table site_acknowledgements enable row level security;

create policy "anyone reads active acknowledgements" on site_acknowledgements
  for select using (is_active or is_staff());

create policy "managers write acknowledgements" on site_acknowledgements
  for all using (has_min_role('manager')) with check (has_min_role('manager'));

-- --- Starting set ------------------------------------------------------------
-- Placeholders. The wording below is not legal advice — replace it in
-- /admin/settings with text your own counsel is comfortable with before launch.

insert into site_acknowledgements (key, label, body, is_required, sort_order) values
  ('age_of_majority',
   'I am 19 years of age or older',
   'We may ask for government-issued photo ID at the door. If nobody of age is there to receive the order, the driver cannot leave it.',
   true, 10),
  ('delivery_only',
   'I understand this is a delivery-only shop with no pickup',
   'Every order is brought to the address you enter at checkout.',
   true, 20),
  ('etransfer_payment',
   'I understand my order is not confirmed until my Interac e-Transfer is received',
   'We hold your items while we wait. Nothing is packed or dispatched before payment clears.',
   true, 30),
  ('marketing_optin',
   'Email me occasionally about seasonal items and specials',
   'Optional. You can unsubscribe from any email we send.',
   false, 40)
on conflict (key) do nothing;

-- --- Checkout, now gated ------------------------------------------------------
-- Same function as migration 0006, with one addition: it refuses to write an
-- order unless the required acknowledgements were confirmed, and records what
-- was confirmed on the order row.

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

  -- Raises unless every currently-required acknowledgement was confirmed, and
  -- returns the exact wording that was in force, to store on the order.
  v_acknowledged := assert_acknowledgements(p_payload -> 'acknowledgements');

  v_postal := normalize_postal(p_payload #>> '{address,postal_code}');
  if v_postal is null then
    raise exception 'A postal code is required.' using errcode = 'check_violation';
  end if;

  -- Lock every product in a stable order so concurrent checkouts queue instead
  -- of deadlocking.
  perform 1
  from products
  where id in (
    select (value ->> 'product_id')::uuid
    from jsonb_array_elements(p_payload -> 'items')
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

    v_subtotal := v_subtotal + (v_product.price_cents * v_quantity);
  end loop;

  v_quote := quote_delivery(v_postal, p_payload #>> '{address,city}', v_subtotal);

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
    (v_quote ->> 'zone_id')::uuid,
    v_quote ->> 'zone_name',
    v_subtotal, v_delivery_fee, v_tax, v_total, v_tax_rate,
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

    -- Hold the stock. It stays held until payment lands or the order is cancelled.
    perform apply_inventory_movement(
      v_product.id, 'reservation', v_quantity,
      'Order placed', '', v_order_number, v_order_id
    );
  end loop;

  insert into order_status_history (order_id, to_status, note)
  values (v_order_id, 'pending_payment', 'Order placed. Awaiting Interac e-Transfer.');

  perform log_activity('order.placed', 'order', v_order_number,
    jsonb_build_object('total_cents', v_total, 'items', jsonb_array_length(p_payload -> 'items')));

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'subtotal_cents', v_subtotal,
    'delivery_fee_cents', v_delivery_fee,
    'tax_cents', v_tax,
    'total_cents', v_total,
    'zone_name', v_quote ->> 'zone_name',
    'estimated_delivery_at', (now() + make_interval(mins => v_eta_max))
  );
end;
$$;
