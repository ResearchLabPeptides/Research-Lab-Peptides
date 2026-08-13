-- =============================================================================
-- Complete schema — every migration, in order, in one file.
-- =============================================================================
-- Paste this into the Supabase SQL Editor and press Run. That is the whole
-- database setup; no command line, no Docker, nothing installed locally.
--
-- Generated from supabase/migrations/. If you change a migration, regenerate
-- this file rather than editing it by hand:
--   cat supabase/migrations/*.sql > supabase/schema.sql
--
-- Run supabase/seed.sql afterwards if you want the sample catalog.
-- =============================================================================


-- =============================================================================
-- 0001  Extensions, enums, and shared helpers
-- =============================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "citext";     -- case-insensitive email
create extension if not exists "pg_trgm";    -- fuzzy product search

-- --- Enums -------------------------------------------------------------------

create type user_role as enum ('read_only', 'employee', 'manager', 'administrator');

create type product_status as enum ('active', 'inactive', 'discontinued', 'archived');

create type order_status as enum (
  'pending_payment',
  'payment_received',
  'preparing',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'refunded'
);

create type payment_status as enum ('unpaid', 'partially_paid', 'paid', 'refunded');

-- Every way stock can move. `reservation` / `reservation_release` are internal
-- movements used to hold stock between checkout and payment confirmation.
create type movement_type as enum (
  'receiving',
  'sale',
  'adjustment',
  'return',
  'damaged',
  'expired',
  'transfer',
  'cycle_count',
  'reservation',
  'reservation_release'
);

create type alert_type as enum ('low_stock', 'out_of_stock', 'expiring', 'expired');

create type delivery_match_type as enum ('postal_prefix', 'postal_exact', 'city');

-- --- Shared helpers ----------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Rank used for role comparisons. Higher wins.
create or replace function role_rank(r user_role)
returns int
language sql
immutable
as $$
  select case r
    when 'read_only'     then 1
    when 'employee'      then 2
    when 'manager'       then 3
    when 'administrator' then 4
  end;
$$;

-- Normalizes Canadian postal codes: "v3s 1a4" -> "V3S1A4".
create or replace function normalize_postal(p text)
returns text
language sql
immutable
as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), '');
$$;


-- =============================================================================
-- 0002  Staff identity, settings, activity log
-- =============================================================================

-- Staff accounts. Customers never appear here — they never sign in.
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       citext not null unique,
  full_name   text   not null default '',
  role        user_role not null default 'read_only',
  is_active   boolean not null default true,
  last_seen_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index profiles_role_idx on profiles (role) where is_active;

create trigger profiles_updated_at
  before update on profiles
  for each row execute function set_updated_at();

-- New auth users get a matching, deliberately powerless profile. An existing
-- administrator promotes them afterwards.
create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- --- Authorization helpers ---------------------------------------------------
-- security definer so policies can read `profiles` without recursing into its
-- own RLS policies.

create or replace function current_role_name()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid() and is_active;
$$;

create or replace function has_min_role(required user_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(role_rank(current_role_name()) >= role_rank(required), false);
$$;

create or replace function is_staff()
returns boolean
language sql
stable
as $$
  select has_min_role('read_only');
$$;

-- --- Business settings -------------------------------------------------------
-- Single-row table. The `id` check keeps it that way.

create table settings (
  id                          boolean primary key default true check (id),
  company_name                text not null default 'Fernwood Provisions',
  logo_url                    text,
  currency                    text not null default 'CAD',
  tax_rate_bps                int  not null default 500 check (tax_rate_bps between 0 and 10000),
  payment_email               citext not null default 'payments@example.ca',
  delivery_email              citext not null default 'delivery@example.ca',
  support_phone               text not null default '',
  order_prefix                text not null default 'ORD',
  low_stock_threshold_default int not null default 10 check (low_stock_threshold_default >= 0),
  expiry_warning_days         int not null default 30 check (expiry_warning_days >= 0),
  business_hours              jsonb not null default '[
    {"day":"monday","open":"09:00","close":"18:00","closed":false},
    {"day":"tuesday","open":"09:00","close":"18:00","closed":false},
    {"day":"wednesday","open":"09:00","close":"18:00","closed":false},
    {"day":"thursday","open":"09:00","close":"18:00","closed":false},
    {"day":"friday","open":"09:00","close":"20:00","closed":false},
    {"day":"saturday","open":"10:00","close":"17:00","closed":false},
    {"day":"sunday","open":"10:00","close":"16:00","closed":true}
  ]'::jsonb,
  email_templates             jsonb not null default '{}'::jsonb,
  updated_at                  timestamptz not null default now()
);

create trigger settings_updated_at
  before update on settings
  for each row execute function set_updated_at();

insert into settings (id) values (true) on conflict do nothing;

-- --- Activity log ------------------------------------------------------------

create table activity_log (
  id          bigserial primary key,
  actor_id    uuid references profiles(id) on delete set null,
  actor_label text not null default 'system',
  action      text not null,            -- 'order.placed', 'product.updated', ...
  entity_type text,
  entity_id   text,
  metadata    jsonb not null default '{}'::jsonb,
  ip_address  inet,
  created_at  timestamptz not null default now()
);

create index activity_log_created_idx on activity_log (created_at desc);
create index activity_log_entity_idx  on activity_log (entity_type, entity_id);
create index activity_log_actor_idx   on activity_log (actor_id, created_at desc);

create or replace function log_activity(
  p_action      text,
  p_entity_type text default null,
  p_entity_id   text default null,
  p_metadata    jsonb default '{}'::jsonb,
  p_actor_id    uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := coalesce(p_actor_id, auth.uid());
  v_label text;
begin
  select coalesce(nullif(full_name, ''), email::text) into v_label
  from profiles where id = v_actor;

  insert into activity_log (actor_id, actor_label, action, entity_type, entity_id, metadata)
  values (v_actor, coalesce(v_label, 'system'), p_action, p_entity_type, p_entity_id, p_metadata);
end;
$$;


-- =============================================================================
-- 0003  Catalog: categories, suppliers, products, media
-- =============================================================================

create table categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  description text not null default '',
  image_url   text,
  sort_order  int  not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index categories_active_idx on categories (sort_order, name) where is_active;

create trigger categories_updated_at
  before update on categories
  for each row execute function set_updated_at();

create table suppliers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  contact_name text not null default '',
  email        citext,
  phone        text not null default '',
  address      text not null default '',
  website      text,
  notes        text not null default '',
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index suppliers_name_key on suppliers (lower(name));

create trigger suppliers_updated_at
  before update on suppliers
  for each row execute function set_updated_at();

-- --- Products ----------------------------------------------------------------
-- All money is stored as integer cents. Never floats.
--
-- `quantity`          physical stock on the shelf
-- `quantity_reserved` held for orders awaiting payment
-- available to sell = quantity - quantity_reserved

create table products (
  id                uuid primary key default gen_random_uuid(),
  sku               text not null,
  barcode           text,
  name              text not null,
  slug              text not null unique,
  description       text not null default '',
  category_id       uuid references categories(id) on delete set null,
  supplier_id       uuid references suppliers(id) on delete set null,
  manufacturer      text not null default '',

  cost_cents        int not null default 0 check (cost_cents >= 0),
  price_cents       int not null check (price_cents >= 0),
  compare_at_cents  int check (compare_at_cents is null or compare_at_cents >= 0),

  quantity          int not null default 0 check (quantity >= 0),
  quantity_reserved int not null default 0 check (quantity_reserved >= 0),
  min_quantity      int not null default 0 check (min_quantity >= 0),
  max_quantity      int check (max_quantity is null or max_quantity >= 0),
  unit              text not null default 'each',

  storage_location  text not null default '',
  shelf             text not null default '',
  bin               text not null default '',
  batch_number      text not null default '',
  lot_number        text not null default '',
  expiry_date       date,

  status            product_status not null default 'active',
  is_featured       boolean not null default false,
  is_new            boolean not null default false,
  tags              text[] not null default '{}',
  notes             text not null default '',

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint products_reserved_within_stock check (quantity_reserved <= quantity),
  constraint products_max_gte_min check (max_quantity is null or max_quantity >= min_quantity)
);

create unique index products_sku_key     on products (upper(sku));
create unique index products_barcode_key on products (barcode) where barcode is not null;

-- Storefront listing: the common "active products in a category, newest first"
-- and "featured" paths.
create index products_storefront_idx on products (category_id, created_at desc) where status = 'active';
create index products_featured_idx   on products (created_at desc) where status = 'active' and is_featured;
create index products_price_idx      on products (price_cents) where status = 'active';
create index products_tags_idx       on products using gin (tags);

-- Live search across name + SKU + description.
create index products_search_idx on products using gin (
  (name || ' ' || sku || ' ' || description) gin_trgm_ops
);

-- Admin alert queries.
create index products_expiry_idx on products (expiry_date) where expiry_date is not null;
create index products_low_stock_idx on products (quantity) where status = 'active';

create trigger products_updated_at
  before update on products
  for each row execute function set_updated_at();

-- --- Media -------------------------------------------------------------------

create table product_images (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references products(id) on delete cascade,
  storage_path text not null,          -- path inside the `product-images` bucket
  alt_text     text not null default '',
  sort_order   int  not null default 0,
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now()
);

create index product_images_product_idx on product_images (product_id, sort_order);
create unique index product_images_one_primary on product_images (product_id) where is_primary;

create table product_documents (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references products(id) on delete cascade,
  storage_path text not null,
  file_name    text not null,
  mime_type    text not null default 'application/octet-stream',
  size_bytes   bigint not null default 0,
  uploaded_by  uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index product_documents_product_idx on product_documents (product_id);

create table supplier_documents (
  id           uuid primary key default gen_random_uuid(),
  supplier_id  uuid not null references suppliers(id) on delete cascade,
  storage_path text not null,
  file_name    text not null,
  mime_type    text not null default 'application/octet-stream',
  size_bytes   bigint not null default 0,
  uploaded_by  uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index supplier_documents_supplier_idx on supplier_documents (supplier_id);


-- =============================================================================
-- 0004  Delivery zones and pricing rules
-- =============================================================================
-- Admins build zones in the dashboard; nothing here requires a code change.
-- A zone owns the pricing. Rules attach postal codes / cities to a zone.
-- Lowest `priority` wins when an address matches more than one rule.

create table delivery_zones (
  id                           uuid primary key default gen_random_uuid(),
  name                         text not null,
  code                         text not null,
  description                  text not null default '',
  fee_cents                    int not null default 0 check (fee_cents >= 0),
  free_delivery_threshold_cents int check (free_delivery_threshold_cents is null or free_delivery_threshold_cents >= 0),
  minimum_order_cents          int not null default 0 check (minimum_order_cents >= 0),
  max_distance_km              numeric(6,2) check (max_distance_km is null or max_distance_km > 0),
  estimated_minutes_min        int not null default 60,
  estimated_minutes_max        int not null default 120,
  priority                     int not null default 100,
  is_active                    boolean not null default true,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),

  constraint delivery_zones_eta_order check (estimated_minutes_max >= estimated_minutes_min)
);

create unique index delivery_zones_code_key on delivery_zones (upper(code));
create index delivery_zones_priority_idx on delivery_zones (priority) where is_active;

create trigger delivery_zones_updated_at
  before update on delivery_zones
  for each row execute function set_updated_at();

create table delivery_rules (
  id          uuid primary key default gen_random_uuid(),
  zone_id     uuid not null references delivery_zones(id) on delete cascade,
  match_type  delivery_match_type not null,
  match_value text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Postal values are stored normalized; city values are stored lowercased.
create or replace function normalize_delivery_rule()
returns trigger
language plpgsql
as $$
begin
  if new.match_type in ('postal_prefix', 'postal_exact') then
    new.match_value := normalize_postal(new.match_value);
  else
    new.match_value := lower(trim(new.match_value));
  end if;

  if new.match_value is null or new.match_value = '' then
    raise exception 'A delivery rule needs a postal code or city to match on.';
  end if;

  return new;
end;
$$;

create trigger delivery_rules_normalize
  before insert or update on delivery_rules
  for each row execute function normalize_delivery_rule();

create trigger delivery_rules_updated_at
  before update on delivery_rules
  for each row execute function set_updated_at();

create unique index delivery_rules_unique_match on delivery_rules (match_type, match_value) where is_active;
create index delivery_rules_zone_idx on delivery_rules (zone_id);
create index delivery_rules_lookup_idx on delivery_rules (match_type, match_value) where is_active;

-- --- Zone resolution ---------------------------------------------------------
-- Most specific match first: exact postal, then longest postal prefix, then
-- city. Ties broken by zone priority.

create or replace function resolve_delivery_zone(p_postal text, p_city text default null)
returns delivery_zones
language sql
stable
as $$
  with normalized as (
    select normalize_postal(p_postal) as postal,
           lower(trim(coalesce(p_city, ''))) as city
  )
  select z.*
  from delivery_rules r
  join delivery_zones z on z.id = r.zone_id
  cross join normalized n
  where r.is_active
    and z.is_active
    and (
      (r.match_type = 'postal_exact'  and n.postal is not null and r.match_value = n.postal)
      or (r.match_type = 'postal_prefix' and n.postal is not null and n.postal like r.match_value || '%')
      or (r.match_type = 'city'        and n.city <> '' and r.match_value = n.city)
    )
  order by
    case r.match_type
      when 'postal_exact'  then 0
      when 'postal_prefix' then 1
      when 'city'          then 2
    end,
    length(r.match_value) desc,
    z.priority asc
  limit 1;
$$;

-- Public-facing quote used by the checkout panel. Returns a shape the UI can
-- render directly, including why an address was rejected.
create or replace function quote_delivery(p_postal text, p_city text default null, p_subtotal_cents int default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_zone delivery_zones;
  v_fee  int;
  v_free boolean := false;
begin
  v_zone := resolve_delivery_zone(p_postal, p_city);

  if v_zone.id is null then
    return jsonb_build_object(
      'deliverable', false,
      'reason', 'outside_zone',
      'message', 'We don''t deliver to that postal code yet.'
    );
  end if;

  if p_subtotal_cents < v_zone.minimum_order_cents then
    return jsonb_build_object(
      'deliverable', false,
      'reason', 'below_minimum',
      'message', 'Orders to ' || v_zone.name || ' start at $'
                 || to_char(v_zone.minimum_order_cents / 100.0, 'FM999999990.00') || '.',
      'zone_id', v_zone.id,
      'zone_name', v_zone.name,
      'minimum_order_cents', v_zone.minimum_order_cents
    );
  end if;

  v_fee := v_zone.fee_cents;

  if v_zone.free_delivery_threshold_cents is not null
     and p_subtotal_cents >= v_zone.free_delivery_threshold_cents then
    v_fee := 0;
    v_free := true;
  end if;

  return jsonb_build_object(
    'deliverable', true,
    'zone_id', v_zone.id,
    'zone_name', v_zone.name,
    'zone_code', v_zone.code,
    'fee_cents', v_fee,
    'base_fee_cents', v_zone.fee_cents,
    'free_delivery_applied', v_free,
    'free_delivery_threshold_cents', v_zone.free_delivery_threshold_cents,
    'minimum_order_cents', v_zone.minimum_order_cents,
    'eta_min_minutes', v_zone.estimated_minutes_min,
    'eta_max_minutes', v_zone.estimated_minutes_max
  );
end;
$$;

grant execute on function quote_delivery(text, text, int) to anon, authenticated;


-- =============================================================================
-- 0005  Orders, payments, inventory ledger, alerts
-- =============================================================================

-- --- Sequential, human-readable order numbers --------------------------------
-- ORD-2026-000001. Restarts each calendar year. A dedicated table (rather than
-- a PG sequence) keeps the counter transactional and per-year.

create table order_counters (
  year       int primary key,
  last_value bigint not null default 0
);

create or replace function next_order_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year   int := extract(year from now() at time zone 'UTC')::int;
  v_next   bigint;
  v_prefix text;
begin
  select order_prefix into v_prefix from settings where id;

  insert into order_counters (year, last_value)
  values (v_year, 1)
  on conflict (year) do update set last_value = order_counters.last_value + 1
  returning last_value into v_next;

  return format('%s-%s-%s', coalesce(v_prefix, 'ORD'), v_year, lpad(v_next::text, 6, '0'));
end;
$$;

-- --- Orders ------------------------------------------------------------------

create table orders (
  id                  uuid primary key default gen_random_uuid(),
  order_number        text not null unique,

  status              order_status  not null default 'pending_payment',
  payment_status      payment_status not null default 'unpaid',

  customer_name       text   not null,
  customer_email      citext not null,
  customer_phone      text   not null,

  address_line1       text not null,
  address_line2       text not null default '',
  city                text not null,
  province            text not null default 'BC',
  postal_code         text not null,
  delivery_notes      text not null default '',

  delivery_zone_id    uuid references delivery_zones(id) on delete set null,
  delivery_zone_name  text not null default '',

  subtotal_cents      int not null check (subtotal_cents >= 0),
  delivery_fee_cents  int not null default 0 check (delivery_fee_cents >= 0),
  tax_cents           int not null default 0 check (tax_cents >= 0),
  total_cents         int not null check (total_cents >= 0),
  tax_rate_bps        int not null default 0,
  amount_paid_cents   int not null default 0 check (amount_paid_cents >= 0),

  -- Inventory bookkeeping. Reserved at checkout, deducted at payment.
  inventory_reserved  boolean not null default false,
  inventory_deducted  boolean not null default false,

  tracking_notes      text not null default '',
  internal_notes      text not null default '',

  estimated_delivery_at timestamptz,
  placed_at           timestamptz not null default now(),
  paid_at             timestamptz,
  delivered_at        timestamptz,
  cancelled_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index orders_status_idx        on orders (status, placed_at desc);
create index orders_placed_idx        on orders (placed_at desc);
create index orders_email_idx         on orders (customer_email, placed_at desc);
create index orders_payment_idx       on orders (payment_status) where payment_status <> 'paid';
create index orders_phone_idx         on orders (customer_phone);
create index orders_number_trgm_idx   on orders using gin (order_number gin_trgm_ops);
create index orders_customer_trgm_idx on orders using gin (customer_name gin_trgm_ops);

create trigger orders_updated_at
  before update on orders
  for each row execute function set_updated_at();

create table order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references orders(id) on delete cascade,
  product_id       uuid references products(id) on delete set null,
  -- Denormalized on purpose: an order is a historical record and must survive
  -- the product being renamed, repriced, or deleted.
  sku              text not null,
  name             text not null,
  unit             text not null default 'each',
  unit_price_cents int  not null check (unit_price_cents >= 0),
  quantity         int  not null check (quantity > 0),
  line_total_cents int  not null check (line_total_cents >= 0),
  created_at       timestamptz not null default now()
);

create index order_items_order_idx   on order_items (order_id);
create index order_items_product_idx on order_items (product_id);

create table order_status_history (
  id          bigserial primary key,
  order_id    uuid not null references orders(id) on delete cascade,
  from_status order_status,
  to_status   order_status not null,
  note        text not null default '',
  changed_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index order_status_history_order_idx on order_status_history (order_id, created_at desc);

create table payments (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references orders(id) on delete cascade,
  amount_cents   int not null check (amount_cents <> 0),  -- negative = refund
  method         text not null default 'interac_etransfer',
  reference      text not null default '',
  notes          text not null default '',
  received_at    timestamptz not null default now(),
  recorded_by    uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index payments_order_idx on payments (order_id, received_at desc);

-- --- Inventory ledger --------------------------------------------------------
-- Append-only. Stock is never edited directly; every change lands here first.

create table inventory_movements (
  id              bigserial primary key,
  product_id      uuid not null references products(id) on delete cascade,
  order_id        uuid references orders(id) on delete set null,
  type            movement_type not null,
  quantity_before int not null,
  quantity_change int not null,
  quantity_after  int not null,
  reason          text not null default '',
  notes           text not null default '',
  reference       text not null default '',
  performed_by    uuid references profiles(id) on delete set null,
  performed_label text not null default 'system',
  created_at      timestamptz not null default now()
);

create index inventory_movements_product_idx on inventory_movements (product_id, created_at desc);
create index inventory_movements_order_idx   on inventory_movements (order_id);
create index inventory_movements_type_idx    on inventory_movements (type, created_at desc);
create index inventory_movements_created_idx on inventory_movements (created_at desc);

-- The ledger is history. Rewriting it defeats the point.
create or replace function forbid_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Inventory history cannot be changed. Record a correcting adjustment instead.';
end;
$$;

create trigger inventory_movements_immutable
  before update or delete on inventory_movements
  for each row execute function forbid_ledger_mutation();

-- --- Alerts ------------------------------------------------------------------

create table inventory_alerts (
  id             bigserial primary key,
  product_id     uuid not null references products(id) on delete cascade,
  type           alert_type not null,
  message        text not null,
  is_resolved    boolean not null default false,
  resolved_at    timestamptz,
  resolved_by    uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);

create unique index inventory_alerts_open_key on inventory_alerts (product_id, type) where not is_resolved;
create index inventory_alerts_open_idx on inventory_alerts (created_at desc) where not is_resolved;


-- =============================================================================
-- 0006  Operational functions — the only supported way to move stock or money
-- =============================================================================

-- Applies one movement and updates the product atomically.
--
-- For physical types (receiving, sale, adjustment, return, damaged, expired,
-- transfer, cycle_count) the before/change/after columns describe
-- `products.quantity`.
--
-- For the two holding types (reservation, reservation_release) they describe
-- `products.quantity_reserved` instead — physical stock has not moved, it is
-- just spoken for. Both live in one ledger so a single query answers
-- "everything that ever happened to this product".
create or replace function apply_inventory_movement(
  p_product_id uuid,
  p_type       movement_type,
  p_change     int,
  p_reason     text default '',
  p_notes      text default '',
  p_reference  text default '',
  p_order_id   uuid default null,
  p_actor_id   uuid default null
)
returns inventory_movements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product   products;
  v_before    int;
  v_after     int;
  v_actor     uuid := coalesce(p_actor_id, auth.uid());
  v_label     text;
  v_movement  inventory_movements;
  v_reserved  boolean := p_type in ('reservation', 'reservation_release');
begin
  select * into v_product from products where id = p_product_id for update;

  if not found then
    raise exception 'Product % no longer exists.', p_product_id using errcode = 'no_data_found';
  end if;

  v_before := case when v_reserved then v_product.quantity_reserved else v_product.quantity end;
  v_after  := v_before + p_change;

  if v_after < 0 then
    raise exception 'Not enough stock for %: % on hand, % requested.',
      v_product.name, v_before, abs(p_change)
      using errcode = 'check_violation';
  end if;

  if v_reserved then
    if v_after > v_product.quantity then
      raise exception 'Cannot hold % units of %; only % in stock.',
        v_after, v_product.name, v_product.quantity
        using errcode = 'check_violation';
    end if;
    update products set quantity_reserved = v_after where id = p_product_id;
  else
    -- Shrinking physical stock must not strand an existing hold.
    if v_after < v_product.quantity_reserved then
      update products set quantity_reserved = v_after where id = p_product_id;
    end if;
    update products set quantity = v_after where id = p_product_id;
  end if;

  select coalesce(nullif(full_name, ''), email::text) into v_label from profiles where id = v_actor;

  insert into inventory_movements (
    product_id, order_id, type, quantity_before, quantity_change, quantity_after,
    reason, notes, reference, performed_by, performed_label
  )
  values (
    p_product_id, p_order_id, p_type, v_before, p_change, v_after,
    p_reason, p_notes, p_reference, v_actor, coalesce(v_label, 'system')
  )
  returning * into v_movement;

  perform refresh_product_alerts(p_product_id);

  return v_movement;
end;
$$;

-- Opens and closes stock alerts for one product. Idempotent.
create or replace function refresh_product_alerts(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product   products;
  v_threshold int;
  v_warn_days int;
begin
  select * into v_product from products where id = p_product_id;
  if not found then return; end if;

  select low_stock_threshold_default, expiry_warning_days
    into v_threshold, v_warn_days
  from settings where id;

  v_threshold := greatest(coalesce(nullif(v_product.min_quantity, 0), v_threshold), 0);

  -- Out of stock
  if v_product.quantity = 0 and v_product.status = 'active' then
    insert into inventory_alerts (product_id, type, message)
    values (p_product_id, 'out_of_stock', v_product.name || ' is out of stock.')
    on conflict do nothing;
  else
    update inventory_alerts set is_resolved = true, resolved_at = now()
    where product_id = p_product_id and type = 'out_of_stock' and not is_resolved;
  end if;

  -- Low stock
  if v_product.quantity > 0 and v_product.quantity <= v_threshold and v_product.status = 'active' then
    insert into inventory_alerts (product_id, type, message)
    values (p_product_id, 'low_stock',
            v_product.name || ' is down to ' || v_product.quantity || ' ' || v_product.unit || '.')
    on conflict do nothing;
  else
    update inventory_alerts set is_resolved = true, resolved_at = now()
    where product_id = p_product_id and type = 'low_stock' and not is_resolved;
  end if;

  -- Expired / expiring
  if v_product.expiry_date is not null then
    if v_product.expiry_date < current_date then
      insert into inventory_alerts (product_id, type, message)
      values (p_product_id, 'expired',
              v_product.name || ' expired on ' || to_char(v_product.expiry_date, 'Mon DD, YYYY') || '.')
      on conflict do nothing;
      update inventory_alerts set is_resolved = true, resolved_at = now()
      where product_id = p_product_id and type = 'expiring' and not is_resolved;
    elsif v_product.expiry_date <= current_date + v_warn_days then
      insert into inventory_alerts (product_id, type, message)
      values (p_product_id, 'expiring',
              v_product.name || ' expires ' || to_char(v_product.expiry_date, 'Mon DD, YYYY') || '.')
      on conflict do nothing;
    else
      update inventory_alerts set is_resolved = true, resolved_at = now()
      where product_id = p_product_id and type in ('expiring', 'expired') and not is_resolved;
    end if;
  end if;
end;
$$;

-- Keeps alerts honest when an admin edits thresholds, expiry, or status by hand.
create or replace function products_refresh_alerts_trigger()
returns trigger
language plpgsql
as $$
begin
  perform refresh_product_alerts(new.id);
  return new;
end;
$$;

create trigger products_alerts_sync
  after insert or update of quantity, min_quantity, expiry_date, status on products
  for each row execute function products_refresh_alerts_trigger();

-- =============================================================================
-- Checkout
-- =============================================================================
-- Called by the server with the service role. Prices, delivery fees, and taxes
-- are all recomputed here — the browser's numbers are treated as a suggestion,
-- never as input.
--
-- p_payload:
-- {
--   "customer": { "name", "email", "phone" },
--   "address":  { "line1", "line2", "city", "province", "postal_code", "notes" },
--   "items":    [ { "product_id": uuid, "quantity": int }, ... ]
-- }

create or replace function place_order(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item          jsonb;
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
    inventory_reserved, estimated_delivery_at
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
    now() + make_interval(mins => v_eta_max)
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

-- =============================================================================
-- Payment confirmation
-- =============================================================================
-- Interac e-Transfers are matched by hand. When the full amount is in, the held
-- stock converts to a permanent sale and the order moves to Preparing.

create or replace function confirm_payment(
  p_order_id     uuid,
  p_amount_cents int,
  p_received_at  timestamptz default now(),
  p_reference    text default '',
  p_notes        text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders;
  v_item  order_items;
  v_paid  int;
  v_advance boolean;
begin
  if not has_min_role('employee') then
    raise exception 'You do not have permission to record payments.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.' using errcode = 'no_data_found';
  end if;

  if v_order.status in ('cancelled', 'refunded') then
    raise exception 'Order % is %.', v_order.order_number, v_order.status
      using errcode = 'check_violation';
  end if;

  insert into payments (order_id, amount_cents, reference, notes, received_at, recorded_by)
  values (p_order_id, p_amount_cents, p_reference, p_notes, p_received_at, auth.uid());

  v_paid := v_order.amount_paid_cents + p_amount_cents;

  if v_paid < v_order.total_cents then
    update orders
       set amount_paid_cents = v_paid,
           payment_status = 'partially_paid'
     where id = p_order_id;

    perform log_activity('payment.partial', 'order', v_order.order_number,
      jsonb_build_object('amount_cents', p_amount_cents, 'paid_cents', v_paid));

    return jsonb_build_object('fully_paid', false, 'amount_paid_cents', v_paid,
                              'balance_cents', v_order.total_cents - v_paid);
  end if;

  -- Paid in full. Release each hold and post the sale against physical stock.
  if not v_order.inventory_deducted then
    for v_item in select * from order_items where order_id = p_order_id
    loop
      if v_item.product_id is not null then
        if v_order.inventory_reserved then
          perform apply_inventory_movement(
            v_item.product_id, 'reservation_release', -v_item.quantity,
            'Payment received', '', v_order.order_number, p_order_id);
        end if;

        perform apply_inventory_movement(
          v_item.product_id, 'sale', -v_item.quantity,
          'Payment received', '', v_order.order_number, p_order_id);
      end if;
    end loop;
  end if;

  -- Only advance an order that is still waiting on money. A late or corrected
  -- payment against an order that already shipped must not drag it backwards.
  v_advance := v_order.status in ('pending_payment', 'payment_received');

  update orders
     set amount_paid_cents = v_paid,
         payment_status = 'paid',
         paid_at = coalesce(paid_at, p_received_at),
         status = case when v_advance then 'preparing'::order_status else status end,
         inventory_reserved = false,
         inventory_deducted = true
   where id = p_order_id;

  if v_advance then
    insert into order_status_history (order_id, from_status, to_status, note, changed_by)
    values (p_order_id, v_order.status, 'preparing', 'Interac e-Transfer confirmed.', auth.uid());
  end if;

  perform log_activity('payment.confirmed', 'order', v_order.order_number,
    jsonb_build_object('amount_cents', p_amount_cents));

  return jsonb_build_object(
    'fully_paid', true,
    'amount_paid_cents', v_paid,
    'status', case when v_advance then 'preparing' else v_order.status::text end);
end;
$$;

-- =============================================================================
-- Status changes
-- =============================================================================

create or replace function set_order_status(
  p_order_id uuid,
  p_status   order_status,
  p_note     text default ''
)
returns orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order    orders;
  v_item     order_items;
  v_previous order_status;
begin
  if not has_min_role('employee') then
    raise exception 'You do not have permission to change order status.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.' using errcode = 'no_data_found';
  end if;

  if v_order.status = p_status then
    return v_order;
  end if;

  -- Cancelling or refunding puts stock back where it came from.
  if p_status in ('cancelled', 'refunded') then
    for v_item in select * from order_items where order_id = p_order_id
    loop
      if v_item.product_id is null then continue; end if;

      if v_order.inventory_reserved then
        perform apply_inventory_movement(
          v_item.product_id, 'reservation_release', -v_item.quantity,
          initcap(p_status::text), p_note, v_order.order_number, p_order_id);
      elsif v_order.inventory_deducted then
        perform apply_inventory_movement(
          v_item.product_id, 'return', v_item.quantity,
          initcap(p_status::text), p_note, v_order.order_number, p_order_id);
      end if;
    end loop;
  end if;

  v_previous := v_order.status;

  update orders
     set status = p_status,
         inventory_reserved = case when p_status in ('cancelled','refunded') then false else inventory_reserved end,
         inventory_deducted = case when p_status in ('cancelled','refunded') then false else inventory_deducted end,
         payment_status     = case when p_status = 'refunded' then 'refunded'::payment_status else payment_status end,
         delivered_at       = case when p_status = 'delivered' then now() else delivered_at end,
         cancelled_at       = case when p_status in ('cancelled','refunded') then now() else cancelled_at end
   where id = p_order_id
  returning * into v_order;

  insert into order_status_history (order_id, from_status, to_status, note, changed_by)
  values (p_order_id, v_previous, p_status, p_note, auth.uid());

  perform log_activity('order.status_changed', 'order', v_order.order_number,
    jsonb_build_object('to', p_status, 'note', p_note));

  return v_order;
end;
$$;

-- =============================================================================
-- Customer order lookup — order number + email, no account
-- =============================================================================

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
    -- Deliberately vague: this endpoint is unauthenticated, so it must not
    -- confirm whether an order number exists.
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
    'delivery_fee_cents', v_order.delivery_fee_cents,
    'tax_cents', v_order.tax_cents,
    'total_cents', v_order.total_cents,
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


-- =============================================================================
-- 0007  Reporting views
-- =============================================================================
-- security_invoker keeps RLS in force: a view can never be a way around a policy.

create view product_stock with (security_invoker = true) as
select
  p.id,
  p.sku,
  p.name,
  p.slug,
  p.status,
  p.unit,
  p.price_cents,
  p.cost_cents,
  p.quantity,
  p.quantity_reserved,
  p.quantity - p.quantity_reserved            as quantity_available,
  p.min_quantity,
  p.expiry_date,
  c.name                                      as category_name,
  s.name                                      as supplier_name,
  p.quantity * p.cost_cents                   as stock_value_cents,
  (p.quantity = 0)                            as is_out_of_stock,
  (p.quantity > 0 and p.quantity <= greatest(p.min_quantity, 0)) as is_low_stock
from products p
left join categories c on c.id = p.category_id
left join suppliers  s on s.id = p.supplier_id;

-- One row. Everything the dashboard tiles need, in a single round trip.
create view dashboard_metrics with (security_invoker = true) as
select
  (select coalesce(sum(total_cents), 0) from orders
    where placed_at >= date_trunc('day', now()) and status <> 'cancelled')      as sales_today_cents,
  (select count(*) from orders
    where placed_at >= date_trunc('day', now()))                                as orders_today,
  (select count(*) from orders where status = 'pending_payment')                as pending_payments,
  (select coalesce(sum(total_cents), 0) from orders
    where status = 'pending_payment')                                           as pending_payment_cents,
  (select count(*) from orders
    where status in ('preparing', 'out_for_delivery'))                          as pending_deliveries,
  (select coalesce(sum(quantity * cost_cents), 0) from products
    where status = 'active')                                                    as inventory_value_cents,
  (select count(*) from products
    where status = 'active' and quantity > 0 and quantity <= greatest(min_quantity, 0)) as low_stock_count,
  (select count(*) from products
    where status = 'active' and quantity = 0)                                   as out_of_stock_count,
  (select coalesce(sum(total_cents), 0) from orders
    where placed_at >= date_trunc('month', now()) and status <> 'cancelled')    as revenue_month_cents,
  (select coalesce(sum(delivery_fee_cents), 0) from orders
    where placed_at >= date_trunc('month', now()) and status <> 'cancelled')    as delivery_fees_month_cents,
  (select count(*) from inventory_alerts where not is_resolved)                 as open_alerts;

-- Last 30 days of sales, one row per day, gaps filled with zero so charts do
-- not lie by omission.
create view daily_sales with (security_invoker = true) as
select
  d.day::date                              as day,
  coalesce(count(o.id), 0)                 as order_count,
  coalesce(sum(o.total_cents), 0)          as revenue_cents,
  coalesce(sum(o.delivery_fee_cents), 0)   as delivery_fee_cents
from generate_series(current_date - interval '29 days', current_date, interval '1 day') as d(day)
left join orders o
  on o.placed_at >= d.day
 and o.placed_at <  d.day + interval '1 day'
 and o.status <> 'cancelled'
group by d.day
order by d.day;

create view top_selling_products with (security_invoker = true) as
select
  oi.product_id,
  oi.sku,
  oi.name,
  sum(oi.quantity)         as units_sold,
  sum(oi.line_total_cents) as revenue_cents,
  count(distinct oi.order_id) as order_count
from order_items oi
join orders o on o.id = oi.order_id
where o.status not in ('cancelled', 'refunded')
  and o.placed_at >= now() - interval '90 days'
group by oi.product_id, oi.sku, oi.name
order by units_sold desc;

create view inventory_movement_report with (security_invoker = true) as
select
  m.id,
  m.created_at,
  m.type,
  p.sku,
  p.name          as product_name,
  m.quantity_before,
  m.quantity_change,
  m.quantity_after,
  m.reason,
  m.notes,
  m.reference,
  m.performed_label,
  o.order_number
from inventory_movements m
join products p on p.id = m.product_id
left join orders o on o.id = m.order_id;

create view open_alerts with (security_invoker = true) as
select
  a.id,
  a.type,
  a.message,
  a.created_at,
  p.id   as product_id,
  p.sku,
  p.name as product_name,
  p.quantity,
  p.expiry_date
from inventory_alerts a
join products p on p.id = a.product_id
where not a.is_resolved
order by
  case a.type
    when 'out_of_stock' then 0
    when 'expired'      then 1
    when 'low_stock'    then 2
    when 'expiring'     then 3
  end,
  a.created_at desc;

create view delivery_charge_report with (security_invoker = true) as
select
  date_trunc('day', o.placed_at)::date as day,
  o.delivery_zone_name                 as zone,
  count(*)                             as orders,
  sum(o.delivery_fee_cents)            as delivery_fees_cents,
  sum(o.subtotal_cents)                as subtotal_cents
from orders o
where o.status <> 'cancelled'
group by 1, 2
order by 1 desc, 2;


-- =============================================================================
-- 0008  Row Level Security
-- =============================================================================
-- Default posture: deny. The storefront (anon) may read active catalog data and
-- nothing else. It cannot read orders, costs, suppliers, or stock ledgers.
-- Orders are created only through place_order(), which runs as definer.

alter table profiles            enable row level security;
alter table settings            enable row level security;
alter table activity_log        enable row level security;
alter table categories          enable row level security;
alter table suppliers           enable row level security;
alter table products            enable row level security;
alter table product_images      enable row level security;
alter table product_documents   enable row level security;
alter table supplier_documents  enable row level security;
alter table delivery_zones      enable row level security;
alter table delivery_rules      enable row level security;
alter table orders              enable row level security;
alter table order_items         enable row level security;
alter table order_status_history enable row level security;
alter table payments            enable row level security;
alter table inventory_movements enable row level security;
alter table inventory_alerts    enable row level security;
alter table order_counters      enable row level security;

-- --- Profiles ----------------------------------------------------------------

create policy "staff read profiles" on profiles
  for select using (is_staff());

create policy "own profile update" on profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and role = current_role_name());  -- cannot self-promote

create policy "admins manage profiles" on profiles
  for all using (has_min_role('administrator')) with check (has_min_role('administrator'));

-- --- Settings ----------------------------------------------------------------
-- Anonymous visitors need company name, currency, tax rate, and the payment
-- email to render the storefront. Those columns carry no risk; the row is
-- readable and only administrators may write it.

create policy "anyone reads settings" on settings for select using (true);
create policy "admins write settings" on settings
  for update using (has_min_role('administrator')) with check (has_min_role('administrator'));

-- --- Catalog -----------------------------------------------------------------

create policy "anyone reads active categories" on categories
  for select using (is_active or is_staff());
create policy "managers write categories" on categories
  for all using (has_min_role('manager')) with check (has_min_role('manager'));

create policy "anyone reads active products" on products
  for select using (status = 'active' or is_staff());
create policy "managers write products" on products
  for all using (has_min_role('manager')) with check (has_min_role('manager'));

create policy "anyone reads images of active products" on product_images
  for select using (
    is_staff() or exists (
      select 1 from products p where p.id = product_id and p.status = 'active'
    )
  );
create policy "managers write product images" on product_images
  for all using (has_min_role('manager')) with check (has_min_role('manager'));

create policy "staff read product documents" on product_documents
  for select using (is_staff());
create policy "managers write product documents" on product_documents
  for all using (has_min_role('manager')) with check (has_min_role('manager'));

create policy "staff read suppliers" on suppliers for select using (is_staff());
create policy "managers write suppliers" on suppliers
  for all using (has_min_role('manager')) with check (has_min_role('manager'));

create policy "staff read supplier documents" on supplier_documents
  for select using (is_staff());
create policy "managers write supplier documents" on supplier_documents
  for all using (has_min_role('manager')) with check (has_min_role('manager'));

-- --- Delivery ----------------------------------------------------------------
-- Zones are readable so the storefront can show a coverage map and fee table.

create policy "anyone reads active zones" on delivery_zones
  for select using (is_active or is_staff());
create policy "managers write zones" on delivery_zones
  for all using (has_min_role('manager')) with check (has_min_role('manager'));

create policy "anyone reads active rules" on delivery_rules
  for select using (is_active or is_staff());
create policy "managers write rules" on delivery_rules
  for all using (has_min_role('manager')) with check (has_min_role('manager'));

-- --- Orders ------------------------------------------------------------------
-- No anon policy at all. Customers reach their own order through lookup_order(),
-- which requires the order number and the matching email.

create policy "staff read orders" on orders for select using (is_staff());
create policy "employees update orders" on orders
  for update using (has_min_role('employee')) with check (has_min_role('employee'));
create policy "managers delete orders" on orders
  for delete using (has_min_role('manager'));

create policy "staff read order items" on order_items for select using (is_staff());
create policy "managers write order items" on order_items
  for all using (has_min_role('manager')) with check (has_min_role('manager'));

create policy "staff read status history" on order_status_history
  for select using (is_staff());

create policy "staff read payments" on payments for select using (is_staff());
create policy "employees record payments" on payments
  for insert with check (has_min_role('employee'));

-- --- Inventory ---------------------------------------------------------------

create policy "staff read movements" on inventory_movements
  for select using (is_staff());
create policy "employees record movements" on inventory_movements
  for insert with check (has_min_role('employee'));

create policy "staff read alerts" on inventory_alerts for select using (is_staff());
create policy "employees resolve alerts" on inventory_alerts
  for update using (has_min_role('employee')) with check (has_min_role('employee'));

-- --- Audit -------------------------------------------------------------------

create policy "admins read activity log" on activity_log
  for select using (has_min_role('administrator'));

-- order_counters intentionally has no policy: only next_order_number() touches
-- it, and that function is security definer.

-- --- Realtime ----------------------------------------------------------------
-- Dashboard tiles and the order board subscribe to these.

alter publication supabase_realtime add table orders;
alter publication supabase_realtime add table inventory_alerts;
alter publication supabase_realtime add table products;


-- =============================================================================
-- 0009  Storage buckets
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('product-images', 'product-images', true,  5 * 1024 * 1024,
    array['image/jpeg','image/png','image/webp','image/avif']),
  ('product-documents', 'product-documents', false, 25 * 1024 * 1024, null),
  ('supplier-documents', 'supplier-documents', false, 25 * 1024 * 1024, null),
  ('branding', 'branding', true, 2 * 1024 * 1024,
    array['image/jpeg','image/png','image/webp','image/svg+xml'])
on conflict (id) do nothing;

-- Product images and branding are world-readable; everything else is staff-only.

create policy "public read product images" on storage.objects
  for select using (bucket_id in ('product-images', 'branding'));

create policy "managers write product images" on storage.objects
  for all to authenticated
  using (bucket_id in ('product-images', 'branding') and has_min_role('manager'))
  with check (bucket_id in ('product-images', 'branding') and has_min_role('manager'));

create policy "staff read private documents" on storage.objects
  for select to authenticated
  using (bucket_id in ('product-documents', 'supplier-documents') and is_staff());

create policy "managers write private documents" on storage.objects
  for all to authenticated
  using (bucket_id in ('product-documents', 'supplier-documents') and has_min_role('manager'))
  with check (bucket_id in ('product-documents', 'supplier-documents') and has_min_role('manager'));


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


-- =============================================================================
-- 0011  Let referential cascades through the inventory ledger
-- =============================================================================
-- The immutability trigger on `inventory_movements` was doing its job too well.
-- It blocked two writes that the database itself issues on our behalf:
--
--   1. `products.id` cascades a DELETE into the ledger. Deleting a product that
--      had ever moved stock therefore failed outright.
--   2. `orders.id` is ON DELETE SET NULL, so removing an order UPDATEs the
--      ledger's `order_id`. That failed too.
--
-- Both are the database enforcing referential integrity, not a person editing
-- history, so both are allowed now. Everything else still raises.
--
-- The tell is that a cascade runs *after* the parent row is gone: inside this
-- trigger the parent no longer exists. A hand-written DELETE or UPDATE against
-- a live product or order still finds its parent, and is still refused.

create or replace function forbid_ledger_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    -- Cascade from a deleted product: the product row is already gone.
    if not exists (select 1 from products where id = old.product_id) then
      return old;
    end if;

    raise exception
      'Inventory history cannot be deleted. Record a correcting adjustment instead.'
      using errcode = 'check_violation';
  end if;

  -- ON DELETE SET NULL from a removed order: the only permitted update, and
  -- only the order_id column may differ.
  if new.order_id is null
     and old.order_id is not null
     and not exists (select 1 from orders where id = old.order_id)
     and new.product_id      is not distinct from old.product_id
     and new.type            is not distinct from old.type
     and new.quantity_before is not distinct from old.quantity_before
     and new.quantity_change is not distinct from old.quantity_change
     and new.quantity_after  is not distinct from old.quantity_after
     and new.created_at      is not distinct from old.created_at
  then
    return new;
  end if;

  raise exception
    'Inventory history cannot be changed. Record a correcting adjustment instead.'
    using errcode = 'check_violation';
end;
$$;

-- The old trigger fired per row for both operations; keep that, but the
-- function now distinguishes between them.
drop trigger if exists inventory_movements_immutable on inventory_movements;

create trigger inventory_movements_immutable
  before update or delete on inventory_movements
  for each row execute function forbid_ledger_mutation();


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


-- =============================================================================
-- 0013  Branding and editable content
-- =============================================================================
-- Three things move out of code and into the database here:
--
--   * Colours, fonts, and corner radius, so one deployment can look like a
--     grocer for one client and a florist for the next.
--   * Short pieces of copy — the homepage headline, empty states, the wording
--     on the payment screen — as named keys.
--   * Whole pages (About, FAQ, Delivery Info) written in Markdown.
--
-- Markdown rather than stored HTML is deliberate. HTML written by one staff
-- member and rendered to every customer is a stored-XSS surface; Markdown is
-- escaped first and then rendered by a small allow-list renderer in the app.

-- --- Branding ----------------------------------------------------------------
-- Held as two jsonb blobs rather than a dozen columns. The set of tokens will
-- grow, and adding one should not mean a migration each time. The app validates
-- the shape and every value is checked as a hex colour before it is saved.

alter table settings
  add column brand_light jsonb not null default jsonb_build_object(
    'background', '#F7F8FA',
    'card',       '#FFFFFF',
    'foreground', '#0B1220',
    'primary',    '#0F7B5A',
    'warning',    '#E0A106',
    'border',     '#E3E7EC'
  ),
  add column brand_dark jsonb not null default jsonb_build_object(
    'background', '#0B1220',
    'card',       '#131C2B',
    'foreground', '#E8ECF2',
    'primary',    '#3ECF97',
    'warning',    '#F0B429',
    'border',     '#222E42'
  ),
  add column brand_font_display text not null default 'Bricolage Grotesque',
  add column brand_font_body    text not null default 'Inter',
  add column brand_font_mono    text not null default 'JetBrains Mono',
  add column brand_radius_px    int  not null default 12
    check (brand_radius_px between 0 and 32);

-- --- Short copy --------------------------------------------------------------
-- Rows are seeded and then only ever updated, never created by staff — a key
-- that nothing renders would be a dead end. `content_group` is what the admin
-- screen uses to put related fields on the same tab.

create table site_content (
  key           text primary key
    constraint site_content_key_format check (key ~ '^[a-z][a-z0-9_.]{1,60}$'),
  content_group text not null,
  label         text not null,
  help          text not null default '',
  is_multiline  boolean not null default false,
  value         text not null default '',
  sort_order    int not null default 0,
  updated_at    timestamptz not null default now()
);

create index site_content_group_idx on site_content (content_group, sort_order);

create trigger site_content_updated_at
  before update on site_content
  for each row execute function set_updated_at();

-- --- Full pages --------------------------------------------------------------

create table site_pages (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null
    constraint site_pages_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{0,80}$'),
  title            text not null,
  body_markdown    text not null default '',
  meta_description text not null default '',
  is_published     boolean not null default false,
  show_in_nav      boolean not null default false,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index site_pages_slug_key on site_pages (slug);
create index site_pages_nav_idx on site_pages (sort_order) where is_published and show_in_nav;

create trigger site_pages_updated_at
  before update on site_pages
  for each row execute function set_updated_at();

-- --- Row Level Security ------------------------------------------------------

alter table site_content enable row level security;
alter table site_pages   enable row level security;

-- Copy is public by definition: it is rendered to anonymous visitors.
create policy "anyone reads content" on site_content for select using (true);
create policy "managers write content" on site_content
  for update using (has_min_role('manager')) with check (has_min_role('manager'));

-- Drafts stay invisible until published.
create policy "anyone reads published pages" on site_pages
  for select using (is_published or is_staff());
create policy "managers write pages" on site_pages
  for all using (has_min_role('manager')) with check (has_min_role('manager'));

-- --- Seed --------------------------------------------------------------------

insert into site_content (key, content_group, label, help, is_multiline, value, sort_order) values
  ('home.eyebrow', 'Home', 'Small line above the headline',
   'Good place for your delivery area.', false,
   'Delivering across Surrey, Delta & Langley', 10),

  ('home.heading', 'Home', 'Headline',
   'The first thing a visitor reads. Short beats clever.', false,
   'Order in two minutes. No account, no app.', 20),

  ('home.subheading', 'Home', 'Paragraph under the headline', '', true,
   'Add what you need, tell us where to bring it, and send an Interac e-Transfer when you are ready. That is the whole thing.', 30),

  ('home.empty_title', 'Home', 'When a search finds nothing — title', '', false,
   'Nothing matches that', 40),

  ('home.empty_body', 'Home', 'When a search finds nothing — text', '', true,
   'Try a shorter search, or clear the filters to see the whole shop.', 50),

  ('header.tagline', 'Header', 'Text beside your business name', '', false,
   'Delivery only', 10),

  ('cart.empty_title', 'Order ticket', 'Empty basket — title', '', false,
   'Nothing here yet', 10),

  ('cart.empty_body', 'Order ticket', 'Empty basket — text', '', true,
   'Add something from the shelves and it will show up on this ticket.', 20),

  ('cart.checkout_button', 'Order ticket', 'Button that opens the address form', '', false,
   'Continue to delivery', 30),

  ('cart.reassurance', 'Order ticket', 'Small print under the order button', '', true,
   'No account needed. You will pay by Interac e-Transfer after you place the order.', 40),

  ('payment.heading', 'Payment screen', 'Heading', '', false,
   'Send your e-Transfer', 10),

  ('payment.intro', 'Payment screen', 'Text under the heading', '', true,
   'We hold your items while we wait. Nothing ships until the transfer clears.', 20),

  ('payment.reference_label', 'Payment screen', 'Label above the order number',
   'Explain that the number goes in the e-Transfer message.', false,
   'Message field — this is how we find your order', 30),

  ('track.heading', 'Order tracking', 'Heading', '', false,
   'Track an order', 10),

  ('track.intro', 'Order tracking', 'Text under the heading', '', true,
   'No password to remember. Your order number and the email you used are enough.', 20),

  ('footer.note', 'Footer', 'Small line at the bottom of the shop', '', true,
   '', 10)
on conflict (key) do nothing;

insert into site_pages (slug, title, body_markdown, meta_description, is_published, show_in_nav, sort_order) values
  ('about', 'About us',
'## Who we are

Replace this with your own story. Everything on this page is edited from
**Content → Pages** in the dashboard — you never need a developer to change it.

## What you can write here

You can use **bold**, *italic*, [links](https://example.com), headings, and:

- bulleted lists
- with as many points as you need

1. Numbered lists work too
2. Like this

> Quotes look like this, which is handy for a customer testimonial.',
   'Learn more about our delivery-only shop.', true, true, 10),

  ('delivery', 'Delivery information',
'## How delivery works

We deliver only — there is no pickup option.

## What it costs

Delivery is a flat fee, and it drops or disappears once your order is large
enough. The exact price shows at checkout as soon as you enter your address, so
there are no surprises.

## When it arrives

You will see an estimated window at checkout and again on your tracking page.',
   'Delivery areas, fees, and timing.', true, true, 20),

  ('faq', 'Questions',
'## Do I need an account?

No. There is nothing to sign up for and no password to remember.

## How do I pay?

By Interac e-Transfer, after you place the order. We send you the amount, the
address to send it to, and your order number — put that number in the message
field so we can match your payment.

## How do I check on my order?

Use the tracking link in your confirmation email, or enter your order number and
email on the tracking page.

## Can I pick up instead?

No, we deliver only.',
   'Common questions about ordering and delivery.', true, true, 30)
on conflict (slug) do nothing;


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


-- =============================================================================
-- 0015  The last five strings on the entry gate
-- =============================================================================
-- The gate's heading, introduction, and buttons were already editable. These
-- five were still baked into the component, which meant a shop that needed
-- different phrasing — a different language, a regulator's exact wording, or
-- simply a friendlier tone — had to change code to get it.
--
-- Nothing on the gate is hardcoded after this.

alter table settings
  add column gate_optional_label text not null default 'Optional',
  -- {n} is replaced with how many boxes are still unticked. A shop that would
  -- rather not show a count can just write a sentence without the placeholder.
  add column gate_remaining_label text not null default '{n} left to confirm',
  add column gate_done_label     text not null default 'All set.',
  add column gate_pending_label  text not null default 'Confirming',
  add column gate_link_label     text not null default 'Read more';

comment on column settings.gate_remaining_label is
  'Shown under the confirm button while boxes are unticked. {n} is replaced with the count.';
comment on column settings.gate_link_label is
  'Fallback text for an acknowledgement that has a URL but no link text of its own.';


-- =============================================================================
-- 0016  Show the discount on the customer's tracking page
-- =============================================================================
-- lookup_order() predates coupons. It returned the subtotal, delivery, tax, and
-- total, so an order with a coupon on it did not add up on screen:
--
--   $49.90 + $0.00 delivery + $2.25 tax  ≠  $47.16 total
--
-- The total was right; the line explaining the gap was missing. A customer
-- seeing that has every reason to think they have been overcharged, and it is
-- the sort of thing that generates a phone call rather than a complaint.
--
-- Also surfaces the delivery promotion label, so "Free delivery on 5 items or
-- more" is visible on the receipt rather than an unexplained zero.

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
    -- Deliberately vague: this endpoint is unauthenticated, so it must not
    -- confirm whether an order number exists.
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


-- =============================================================================
-- 0017  A sales-by-day view that is not capped at 30 days
-- =============================================================================
-- `daily_sales` exists to feed the dashboard chart, so it is a fixed 30-day
-- window built from generate_series — gaps filled with zeroes so the chart does
-- not lie by omission.
--
-- That makes it wrong as a report source. Asking for "this year" and getting
-- thirty rows back, labelled as a year, is worse than getting an error.
--
-- This view covers every day that actually has an order, with no upper bound.
-- It has no zero-filled gaps, which is correct for a spreadsheet: a day with no
-- orders is a day you do not want a row for.

create view sales_by_day with (security_invoker = true) as
select
  date_trunc('day', o.placed_at)::date        as day,
  count(*)                                    as order_count,
  sum(o.subtotal_cents)                       as subtotal_cents,
  sum(o.discount_cents)                       as discount_cents,
  sum(o.delivery_fee_cents)                   as delivery_fee_cents,
  sum(o.tax_cents)                            as tax_cents,
  sum(o.total_cents)                          as revenue_cents,
  sum(o.amount_paid_cents)                    as collected_cents,
  count(*) filter (where o.status = 'pending_payment') as awaiting_payment,
  count(*) filter (where o.coupon_id is not null)      as orders_with_coupon
from orders o
where o.status <> 'cancelled'
group by 1
order by 1 desc;


-- =============================================================================
-- 0018  Import products from a spreadsheet
-- =============================================================================
-- Typing a few hundred products by hand is the single biggest barrier to
-- getting a shop live, so this takes a spreadsheet and does it in one go.
--
-- Only a name is required. Everything else can be blank and filled in later
-- through the normal product editor — the point is to get the catalog listed,
-- not to demand a perfect file on the first attempt.
--
-- Three things this deliberately does NOT do:
--
--   * It never writes `products.quantity` directly. An opening count arrives as
--     a `receiving` movement, exactly as it would through the Adjust button, so
--     imported stock has the same ledger trail as stock counted by hand.
--   * It never deletes. A row missing from the file is left alone, because a
--     truncated export should not wipe a catalog.
--   * It is one transaction. A bad row on line 400 rolls the whole thing back
--     rather than leaving half a catalog behind.

-- Turns a name into a URL segment. Mirrors slugify() in the application.
create or replace function slugify_text(p_value text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(lower(coalesce(p_value, '')), '[^a-z0-9]+', '-', 'g'));
$$;

/**
 * p_rows is an array of objects. Every key is optional except `name`:
 *
 *   { "name", "sku", "barcode", "description", "category", "supplier",
 *     "unit", "price", "cost", "compare_at", "quantity", "min_quantity",
 *     "manufacturer", "tags", "status" }
 *
 * Money arrives already converted to integer cents — the browser does that
 * because it can show the person what it parsed before they commit.
 *
 * p_mode:
 *   'update' — a row whose SKU already exists updates that product
 *   'skip'   — existing SKUs are left untouched and counted as skipped
 */
create or replace function import_products(p_rows jsonb, p_mode text default 'update')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row        jsonb;
  v_index      int := 0;
  v_created    int := 0;
  v_updated    int := 0;
  v_skipped    int := 0;
  v_name       text;
  v_sku        text;
  v_slug       text;
  v_base_slug  text;
  v_suffix     int;
  v_existing   products;
  -- FOUND reflects the last statement executed, and the category/supplier
  -- lookups below run between the existence check and the branch on it. Keep
  -- the answer in a variable rather than trusting FOUND to survive.
  v_exists     boolean;
  v_category   uuid;
  v_supplier   uuid;
  v_quantity   int;
  v_product_id uuid;
  v_text       text;
  v_errors     jsonb := '[]'::jsonb;
begin
  if not has_min_role('manager') then
    raise exception 'Your role cannot import products.' using errcode = 'insufficient_privilege';
  end if;

  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'There is nothing to import.' using errcode = 'check_violation';
  end if;

  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'Import up to 2000 products at a time. Split the file and run it twice.'
      using errcode = 'check_violation';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_index := v_index + 1;
    v_name := nullif(trim(coalesce(v_row ->> 'name', '')), '');

    if v_name is null then
      v_errors := v_errors || jsonb_build_object('row', v_index, 'message', 'No product name.');
      continue;
    end if;

    -- A blank SKU gets a generated one. Staff can rewrite it in the editor; the
    -- alternative is refusing a file whose only flaw is not having invented
    -- codes yet.
    v_sku := upper(nullif(regexp_replace(coalesce(v_row ->> 'sku', ''), '\s+', '', 'g'), ''));
    if v_sku is null then
      -- Derived from the name alone, so re-running the same file updates the
      -- catalog instead of duplicating it. Accidentally importing twice is a
      -- far more likely mistake than two different products sharing a name.
      v_sku := 'IMP-' || upper(substr(md5(lower(v_name)), 1, 8));
    end if;

    v_existing := null;
    select * into v_existing from products where upper(sku) = v_sku;
    v_exists := v_existing.id is not null;

    if v_exists and p_mode = 'skip' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Categories and suppliers are matched by name and created when new, so a
    -- spreadsheet can introduce both without a separate setup pass.
    v_category := null;
    v_text := nullif(trim(coalesce(v_row ->> 'category', '')), '');
    if v_text is not null then
      select id into v_category from categories where lower(name) = lower(v_text) limit 1;
      if v_category is null then
        insert into categories (name, slug, sort_order)
        values (v_text, slugify_text(v_text), 99)
        on conflict (slug) do update set name = excluded.name
        returning id into v_category;
      end if;
    end if;

    v_supplier := null;
    v_text := nullif(trim(coalesce(v_row ->> 'supplier', '')), '');
    if v_text is not null then
      select id into v_supplier from suppliers where lower(name) = lower(v_text) limit 1;
      if v_supplier is null then
        insert into suppliers (name) values (v_text) returning id into v_supplier;
      end if;
    end if;

    if v_exists then
      -- Update. Only columns present in the file are touched, so a partial
      -- spreadsheet cannot blank out details entered by hand.
      update products set
        name             = v_name,
        barcode          = coalesce(nullif(trim(coalesce(v_row ->> 'barcode', '')), ''), barcode),
        description      = coalesce(nullif(v_row ->> 'description', ''), description),
        category_id      = coalesce(v_category, category_id),
        supplier_id      = coalesce(v_supplier, supplier_id),
        manufacturer     = coalesce(nullif(v_row ->> 'manufacturer', ''), manufacturer),
        unit             = coalesce(nullif(trim(coalesce(v_row ->> 'unit', '')), ''), unit),
        price_cents      = coalesce((v_row ->> 'price')::int, price_cents),
        cost_cents       = coalesce((v_row ->> 'cost')::int, cost_cents),
        compare_at_cents = coalesce((v_row ->> 'compare_at')::int, compare_at_cents),
        min_quantity     = coalesce((v_row ->> 'min_quantity')::int, min_quantity)
      where id = v_existing.id;

      v_updated := v_updated + 1;
    else
      -- Slugs are unique. Two products legitimately sharing a name get a
      -- numbered suffix rather than failing the whole import.
      v_base_slug := nullif(slugify_text(v_name), '');
      if v_base_slug is null then v_base_slug := 'product'; end if;
      v_slug := v_base_slug;
      v_suffix := 1;
      while exists (select 1 from products where slug = v_slug) loop
        v_suffix := v_suffix + 1;
        v_slug := v_base_slug || '-' || v_suffix;
      end loop;

      insert into products (
        sku, barcode, name, slug, description, category_id, supplier_id, manufacturer,
        unit, price_cents, cost_cents, compare_at_cents, quantity, min_quantity, status, tags
      )
      values (
        v_sku,
        nullif(trim(coalesce(v_row ->> 'barcode', '')), ''),
        v_name,
        v_slug,
        coalesce(v_row ->> 'description', ''),
        v_category,
        v_supplier,
        coalesce(v_row ->> 'manufacturer', ''),
        coalesce(nullif(trim(coalesce(v_row ->> 'unit', '')), ''), 'each'),
        coalesce((v_row ->> 'price')::int, 0),
        coalesce((v_row ->> 'cost')::int, 0),
        (v_row ->> 'compare_at')::int,
        0,                                    -- opening count is posted below
        coalesce((v_row ->> 'min_quantity')::int, 0),
        coalesce(nullif(v_row ->> 'status', ''), 'active')::product_status,
        coalesce(
          (select array_agg(trim(t)) from jsonb_array_elements_text(
             case when jsonb_typeof(v_row -> 'tags') = 'array' then v_row -> 'tags' else '[]'::jsonb end
           ) t),
          '{}'::text[])
      )
      returning id into v_product_id;

      v_quantity := coalesce((v_row ->> 'quantity')::int, 0);
      if v_quantity > 0 then
        perform apply_inventory_movement(
          v_product_id, 'receiving', v_quantity,
          'Imported from spreadsheet', '', 'import');
      end if;

      v_created := v_created + 1;
    end if;
  end loop;

  perform log_activity('products.imported', 'import', null,
    jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', v_skipped));

  return jsonb_build_object(
    'created', v_created,
    'updated', v_updated,
    'skipped', v_skipped,
    'errors', v_errors
  );
end;
$$;


-- =============================================================================
-- 0019  Canada-wide shipping, optional SKUs, new products start hidden
-- =============================================================================

-- --- 1. No region lock ------------------------------------------------------
-- The pricing model is unchanged — a base charge plus the free/discount rules.
-- The only thing going away is the postal-code gate that refused addresses
-- outside a listed area. Shops that want it back can switch it on in Settings.

alter table settings alter column delivery_restrict_area set default false;
update settings set delivery_restrict_area = false;

-- --- 2. A product no longer needs a SKU -------------------------------------
-- Requiring one blocks the common case: someone listing what they sell before
-- they have invented codes for any of it. A blank SKU now gets a generated one
-- derived from the name, so it is stable if the same product is added twice.

create or replace function fill_missing_sku()
returns trigger
language plpgsql
as $$
declare
  v_base text;
  v_try  text;
  v_n    int := 1;
begin
  if new.sku is not null and trim(new.sku) <> '' then
    return new;
  end if;

  -- Hash the whole name. Taking the first few letters would collide across
  -- products that merely start alike.
  v_base := 'SKU-' || upper(substr(md5(lower(coalesce(new.name, 'product'))), 1, 6));
  v_try  := v_base;

  while exists (select 1 from products where upper(sku) = v_try and id is distinct from new.id) loop
    v_n := v_n + 1;
    v_try := v_base || '-' || v_n;
  end loop;

  new.sku := v_try;
  return new;
end;
$$;

-- BEFORE INSERT, so the generated value satisfies the NOT NULL and the unique
-- index without either having to be relaxed.
create trigger products_fill_sku
  before insert on products
  for each row execute function fill_missing_sku();

-- --- 3. New products start hidden -------------------------------------------
-- A product created without a price would otherwise appear on the shop at
-- $0.00 the moment it is saved. Starting inactive makes listing something and
-- finishing it later the safe default rather than a race.

alter table products alter column status set default 'inactive';

-- Imports follow the same rule, unless the file says otherwise.
create or replace function import_products(p_rows jsonb, p_mode text default 'update')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb; v_index int := 0; v_created int := 0; v_updated int := 0; v_skipped int := 0;
  v_name text; v_sku text; v_slug text; v_base_slug text; v_suffix int;
  v_existing products; v_exists boolean; v_category uuid; v_supplier uuid;
  v_quantity int; v_product_id uuid; v_text text; v_errors jsonb := '[]'::jsonb;
begin
  if not has_min_role('manager') then
    raise exception 'Your role cannot import products.' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'There is nothing to import.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'Import up to 2000 products at a time. Split the file and run it twice.'
      using errcode = 'check_violation';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_index := v_index + 1;
    v_name := nullif(trim(coalesce(v_row ->> 'name', '')), '');

    if v_name is null then
      v_errors := v_errors || jsonb_build_object('row', v_index, 'message', 'No product name.');
      continue;
    end if;

    v_sku := upper(nullif(regexp_replace(coalesce(v_row ->> 'sku', ''), '\s+', '', 'g'), ''));
    if v_sku is null then
      v_sku := 'IMP-' || upper(substr(md5(lower(v_name)), 1, 8));
    end if;

    v_existing := null;
    select * into v_existing from products where upper(sku) = v_sku;
    v_exists := v_existing.id is not null;

    if v_exists and p_mode = 'skip' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_category := null;
    v_text := nullif(trim(coalesce(v_row ->> 'category', '')), '');
    if v_text is not null then
      select id into v_category from categories where lower(name) = lower(v_text) limit 1;
      if v_category is null then
        insert into categories (name, slug, sort_order)
        values (v_text, slugify_text(v_text), 99)
        on conflict (slug) do update set name = excluded.name
        returning id into v_category;
      end if;
    end if;

    v_supplier := null;
    v_text := nullif(trim(coalesce(v_row ->> 'supplier', '')), '');
    if v_text is not null then
      select id into v_supplier from suppliers where lower(name) = lower(v_text) limit 1;
      if v_supplier is null then
        insert into suppliers (name) values (v_text) returning id into v_supplier;
      end if;
    end if;

    if v_exists then
      update products set
        name             = v_name,
        barcode          = coalesce(nullif(trim(coalesce(v_row ->> 'barcode', '')), ''), barcode),
        description      = coalesce(nullif(v_row ->> 'description', ''), description),
        category_id      = coalesce(v_category, category_id),
        supplier_id      = coalesce(v_supplier, supplier_id),
        manufacturer     = coalesce(nullif(v_row ->> 'manufacturer', ''), manufacturer),
        unit             = coalesce(nullif(trim(coalesce(v_row ->> 'unit', '')), ''), unit),
        price_cents      = coalesce((v_row ->> 'price')::int, price_cents),
        cost_cents       = coalesce((v_row ->> 'cost')::int, cost_cents),
        compare_at_cents = coalesce((v_row ->> 'compare_at')::int, compare_at_cents),
        min_quantity     = coalesce((v_row ->> 'min_quantity')::int, min_quantity)
      where id = v_existing.id;
      v_updated := v_updated + 1;
    else
      v_base_slug := nullif(slugify_text(v_name), '');
      if v_base_slug is null then v_base_slug := 'product'; end if;
      v_slug := v_base_slug; v_suffix := 1;
      while exists (select 1 from products where slug = v_slug) loop
        v_suffix := v_suffix + 1;
        v_slug := v_base_slug || '-' || v_suffix;
      end loop;

      insert into products (
        sku, barcode, name, slug, description, category_id, supplier_id, manufacturer,
        unit, price_cents, cost_cents, compare_at_cents, quantity, min_quantity, status, tags
      )
      values (
        v_sku,
        nullif(trim(coalesce(v_row ->> 'barcode', '')), ''),
        v_name, v_slug,
        coalesce(v_row ->> 'description', ''),
        v_category, v_supplier,
        coalesce(v_row ->> 'manufacturer', ''),
        coalesce(nullif(trim(coalesce(v_row ->> 'unit', '')), ''), 'each'),
        coalesce((v_row ->> 'price')::int, 0),
        coalesce((v_row ->> 'cost')::int, 0),
        (v_row ->> 'compare_at')::int,
        0,
        coalesce((v_row ->> 'min_quantity')::int, 0),
        -- Imported products stay hidden until someone has checked the prices.
        coalesce(nullif(v_row ->> 'status', ''), 'inactive')::product_status,
        coalesce(
          (select array_agg(trim(t)) from jsonb_array_elements_text(
             case when jsonb_typeof(v_row -> 'tags') = 'array' then v_row -> 'tags' else '[]'::jsonb end
           ) t),
          '{}'::text[])
      )
      returning id into v_product_id;

      v_quantity := coalesce((v_row ->> 'quantity')::int, 0);
      if v_quantity > 0 then
        perform apply_inventory_movement(
          v_product_id, 'receiving', v_quantity, 'Imported from spreadsheet', '', 'import');
      end if;

      v_created := v_created + 1;
    end if;
  end loop;

  perform log_activity('products.imported', 'import', null,
    jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', v_skipped));

  return jsonb_build_object('created', v_created, 'updated', v_updated,
                            'skipped', v_skipped, 'errors', v_errors);
end;
$$;


-- =============================================================================
-- 0020  Editable email templates
-- =============================================================================
-- Two problems this fixes.
--
-- First, an order placed by a customer sent them nothing. Status changes
-- emailed them, but the confirmation with their order number and the
-- e-Transfer instructions — the single most important message the shop sends —
-- was never wired up. The function existed and was simply never called.
--
-- Second, all the wording lived in code. A shop that wanted to sound like
-- itself, or write to customers in French, had to change TypeScript.
--
-- Templates are plain text with {placeholders}. Not HTML: the person editing
-- these is a shop owner, and a stray unclosed tag should not be able to break
-- the one email that carries the payment instructions.

create table email_templates (
  key         text primary key,
  name        text not null,
  description text not null default '',
  subject     text not null,
  body        text not null,
  is_active   boolean not null default true,
  sort_order  int not null default 0,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references profiles(id) on delete set null
);

create trigger email_templates_updated_at
  before update on email_templates
  for each row execute function set_updated_at();

alter table email_templates enable row level security;

create policy "staff read email templates" on email_templates for select using (is_staff());
create policy "admins write email templates" on email_templates
  for all using (has_min_role('administrator')) with check (has_min_role('administrator'));

insert into email_templates (key, name, description, subject, body, sort_order) values
(
  'order_placed',
  'Order received',
  'Sent the moment someone checks out. Carries the payment instructions, so this is the one that matters most.',
  '{order_number} — send your e-Transfer to start your order',
  'Hi {customer_name},

Thanks for your order. We have it, and we are holding your items.

To start it, send an Interac e-Transfer of {total} to:
{payment_email}

Put {order_number} in the message field so we can match it to your order.

WHAT YOU ORDERED
{items}

Subtotal: {subtotal}
Discount: {discount}
Shipping: {shipping}
Tax: {tax}
Total: {total}

Shipping to:
{address}

Track your order any time:
{track_url}

— {company_name}',
  0
),
(
  'payment_received',
  'Payment confirmed',
  'Sent when a staff member confirms the e-Transfer arrived.',
  '{order_number} — payment received, we are packing your order',
  'Hi {customer_name},

We have your payment for {order_number}. Your order is being packed now.

{note}

Track your order:
{track_url}

— {company_name}',
  1
),
(
  'out_for_delivery',
  'On the way',
  'Sent when the order goes out for delivery.',
  '{order_number} — on the way to you',
  'Hi {customer_name},

Your order {order_number} is on its way to:
{address}

{note}

Track it here:
{track_url}

— {company_name}',
  2
),
(
  'delivered',
  'Delivered',
  'Sent when the order is marked delivered.',
  '{order_number} — delivered',
  'Hi {customer_name},

Your order {order_number} has been delivered. We hope everything is as it should be.

{note}

If anything is wrong, reply to this email and a person will read it.

— {company_name}',
  3
),
(
  'cancelled',
  'Cancelled',
  'Sent when an order is cancelled or refunded.',
  '{order_number} — cancelled',
  'Hi {customer_name},

Your order {order_number} has been cancelled and everything on it has gone back into stock.

{note}

If you have already sent payment, reply to this email and we will sort out a refund.

— {company_name}',
  4
);


-- =============================================================================
-- 0021  A de-duplicated customer list
-- =============================================================================
-- Customers have no account, so until now the only record of anyone was the
-- orders they placed. Ordering four times meant appearing four times, and there
-- was no way to answer "who has bought from us" without deduplicating by hand.
--
-- One row per email address, updated as orders arrive.
--
-- Marketing consent is recorded separately from the fact of having ordered,
-- because they are different things. Someone buying groceries has not agreed to
-- receive advertising, and under Canada's anti-spam law that distinction is the
-- whole point. `marketing_opt_in` is true only when the customer ticked the
-- optional box on the entry gate.

create table customer_contacts (
  id                  uuid primary key default gen_random_uuid(),
  email               citext not null unique,
  name                text not null default '',
  phone               text not null default '',

  order_count         int not null default 0,
  total_spent_cents   bigint not null default 0,
  first_order_at      timestamptz,
  last_order_at       timestamptz,

  -- Consent, and where it came from.
  marketing_opt_in    boolean not null default false,
  opted_in_at         timestamptz,
  unsubscribed        boolean not null default false,
  unsubscribed_at     timestamptz,

  notes               text not null default '',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index customer_contacts_last_order_idx on customer_contacts (last_order_at desc nulls last);
create index customer_contacts_mailable_idx on customer_contacts (email)
  where marketing_opt_in and not unsubscribed;
create index customer_contacts_name_trgm_idx on customer_contacts using gin (name gin_trgm_ops);

create trigger customer_contacts_updated_at
  before update on customer_contacts
  for each row execute function set_updated_at();

alter table customer_contacts enable row level security;

create policy "staff read contacts" on customer_contacts for select using (is_staff());
create policy "managers write contacts" on customer_contacts
  for all using (has_min_role('manager')) with check (has_min_role('manager'));

/**
 * Records one order against its customer. Called from place_order().
 *
 * The email is the identity, matched case-insensitively via citext, so
 * Priya@Example.com and priya@example.com are one person rather than two.
 */
create or replace function record_customer_contact(
  p_email        text,
  p_name         text,
  p_phone        text,
  p_total_cents  int,
  p_opted_in     boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email citext := nullif(trim(p_email), '')::citext;
begin
  if v_email is null then return; end if;

  insert into customer_contacts (
    email, name, phone, order_count, total_spent_cents,
    first_order_at, last_order_at, marketing_opt_in, opted_in_at
  )
  values (
    v_email, coalesce(p_name, ''), coalesce(p_phone, ''), 1, greatest(p_total_cents, 0),
    now(), now(), coalesce(p_opted_in, false),
    case when p_opted_in then now() end
  )
  on conflict (email) do update set
    -- The newest order wins for the details people change over time.
    name              = coalesce(nullif(trim(excluded.name), ''), customer_contacts.name),
    phone             = coalesce(nullif(trim(excluded.phone), ''), customer_contacts.phone),
    order_count       = customer_contacts.order_count + 1,
    total_spent_cents = customer_contacts.total_spent_cents + greatest(p_total_cents, 0),
    last_order_at     = now(),
    -- Consent only ever moves up from an order, never down: not ticking the box
    -- this time is not a withdrawal of consent given before. Unsubscribing is
    -- the way out, and it is never undone by placing another order.
    marketing_opt_in  = customer_contacts.marketing_opt_in or coalesce(p_opted_in, false),
    opted_in_at       = coalesce(
                          customer_contacts.opted_in_at,
                          case when p_opted_in then now() end
                        );
end;
$$;

-- --- Fold in the orders that already exist ----------------------------------
-- Consent is deliberately left false for these: nobody who ordered before this
-- table existed agreed to anything, and assuming otherwise is how a business
-- ends up sending unlawful mail.

insert into customer_contacts (email, name, phone, order_count, total_spent_cents,
                               first_order_at, last_order_at)
select
  o.customer_email,
  (array_agg(o.customer_name order by o.placed_at desc))[1],
  (array_agg(o.customer_phone order by o.placed_at desc))[1],
  count(*),
  sum(o.total_cents),
  min(o.placed_at),
  max(o.placed_at)
from orders o
where o.status <> 'cancelled'
group by o.customer_email
on conflict (email) do nothing;

-- --- Reporting --------------------------------------------------------------

create view customer_list with (security_invoker = true) as
select
  c.email,
  c.name,
  c.phone,
  c.order_count,
  c.total_spent_cents,
  round(c.total_spent_cents::numeric / nullif(c.order_count, 0))::bigint as average_order_cents,
  c.first_order_at,
  c.last_order_at,
  c.marketing_opt_in,
  c.unsubscribed,
  (c.marketing_opt_in and not c.unsubscribed) as can_be_emailed
from customer_contacts c
order by c.last_order_at desc nulls last;

-- Exactly the people you may lawfully send a marketing email to, and nothing
-- else — so exporting the mailing list cannot accidentally include anyone.
create view marketing_list with (security_invoker = true) as
select c.email, c.name, c.order_count, c.total_spent_cents, c.last_order_at, c.opted_in_at
from customer_contacts c
where c.marketing_opt_in and not c.unsubscribed
order by c.last_order_at desc nulls last;

-- --- Wire it into checkout ---------------------------------------------------
-- The existing implementation is renamed rather than duplicated, so there is
-- one copy of the checkout logic and no chance of two versions drifting apart.

alter function place_order(jsonb) rename to place_order_core;

-- place_order() already validates the acknowledgements; this reads the optional
-- marketing box out of the result so consent is captured at the same moment.

create or replace function place_order(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_opted  boolean;
begin
  v_result := place_order_core(p_payload);

  -- The gate's optional marketing box. Absent means no consent, which is the
  -- only safe reading of a box nobody ticked.
  v_opted := coalesce(p_payload -> 'acknowledgements' @> '["marketing_optin"]'::jsonb, false);

  perform record_customer_contact(
    p_payload #>> '{customer,email}',
    p_payload #>> '{customer,name}',
    p_payload #>> '{customer,phone}',
    (v_result ->> 'total_cents')::int,
    v_opted
  );

  return v_result;
end;
$$;


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


-- =============================================================================
-- 0024  Marketing consent: purchase counts as consent
-- =============================================================================
-- Until now the mailing list held only customers who ticked the optional box at
-- checkout, which left most of the customer base unreachable. This widens it to
-- everyone who has bought something.
--
-- The widening is not unlimited, because it cannot be. Canada's anti-spam law
-- (CASL) recognises two different bases for sending a commercial email, and
-- this migration models both rather than flattening them into one flag:
--
--   express  — the customer ticked the box. Lasts until they unsubscribe.
--   implied  — the customer bought something. Lasts two years from that
--              purchase, and every new order restarts the clock.
--
-- Implied consent from an existing business relationship is what makes it
-- lawful to email a purchaser who never ticked anything. It is a real basis,
-- not a loophole, and it covers the great majority of a repeat-purchase
-- grocery business indefinitely, because buying again renews it.
--
-- Two things this migration will not do, because they are what turns a lawful
-- mailing list into an unlawful one:
--
--   * An unsubscribe is absolute. It outranks both bases and every setting
--     here. There is no configuration that re-enables someone who opted out.
--   * Consent that has aged out is dropped rather than quietly kept. The
--     mailing list only ever contains people there is a live basis to email.
--
-- Every message still needs the sender identified and a working unsubscribe
-- link — those live in the email templates, not the database.
--
-- This is a description of how the code behaves, not legal advice.

-- --- Settings ----------------------------------------------------------------

alter table settings
  -- Two years is the statutory window. Configurable downward for a shop that
  -- wants to be more conservative; capped at 24 because setting it higher would
  -- not make a longer window lawful.
  add column implied_consent_months int not null default 24
    check (implied_consent_months between 1 and 24);

-- --- Contacts ----------------------------------------------------------------

alter table customer_contacts
  -- Recorded at the moment of the order so the basis for emailing someone can
  -- be evidenced later. CASL puts the burden of proving consent on the sender,
  -- and "they bought something" is only a defence if the purchase is on record.
  add column implied_consent_at timestamptz;

-- Backfill: everyone who has already ordered has an existing business
-- relationship dating from their most recent order.
update customer_contacts
set implied_consent_at = last_order_at
where last_order_at is not null;

comment on column customer_contacts.marketing_opt_in is
  'Express consent — the customer ticked the box. Does not expire.';
comment on column customer_contacts.implied_consent_at is
  'Implied consent — the date of the most recent purchase. Expires after the window in settings.';

-- --- Consent basis -----------------------------------------------------------

-- Returns why this person may be emailed, or why they may not. Written as one
-- function so that every screen, export, and query answers the question the
-- same way; a second implementation somewhere would eventually disagree with
-- this one and the disagreement would be an unlawful send.
create or replace function marketing_consent_basis(
  p_opted_in    boolean,
  p_unsubscribed boolean,
  p_implied_at  timestamptz
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    -- Checked first, always. An unsubscribe overrides every other basis.
    when p_unsubscribed then 'unsubscribed'
    when p_opted_in then 'express'
    when p_implied_at is not null
     and p_implied_at > now() - make_interval(months =>
           (select implied_consent_months from settings where id))
      then 'implied'
    when p_implied_at is not null then 'expired'
    else 'none'
  end;
$$;

-- When implied consent runs out, so the admin screen can show it and a shop can
-- see who is about to age out. Null for express consent, which does not expire.
create or replace function marketing_consent_expires(
  p_opted_in   boolean,
  p_implied_at timestamptz
)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_opted_in then null
    when p_implied_at is null then null
    else p_implied_at + make_interval(months =>
           (select implied_consent_months from settings where id))
  end;
$$;

-- --- Views -------------------------------------------------------------------

drop view if exists customer_directory;
create view customer_directory with (security_invoker = true) as
select
  c.id,
  c.email,
  c.name,
  c.phone,
  c.order_count,
  c.total_spent_cents,
  c.first_order_at,
  c.last_order_at,
  c.marketing_opt_in,
  c.unsubscribed,
  c.implied_consent_at,
  marketing_consent_basis(c.marketing_opt_in, c.unsubscribed, c.implied_consent_at)
    as consent_basis,
  marketing_consent_expires(c.marketing_opt_in, c.implied_consent_at)
    as consent_expires_at,
  marketing_consent_basis(c.marketing_opt_in, c.unsubscribed, c.implied_consent_at)
    in ('express', 'implied') as can_be_emailed,
  c.notes,
  c.created_at
from customer_contacts c;

-- Exactly the people there is a live basis to email, and nobody else. Exporting
-- this view is the only supported way to get a mailing list out of the system,
-- so an export cannot accidentally include an unsubscribe or an expired
-- relationship.
drop view if exists marketing_list;
create view marketing_list with (security_invoker = true) as
select
  c.email,
  c.name,
  c.order_count,
  c.total_spent_cents,
  c.last_order_at,
  marketing_consent_basis(c.marketing_opt_in, c.unsubscribed, c.implied_consent_at)
    as consent_basis,
  -- Carried into the export so the basis for each address can be evidenced
  -- without going back to the database.
  case when c.marketing_opt_in then c.opted_in_at else c.implied_consent_at end
    as consent_dated,
  marketing_consent_expires(c.marketing_opt_in, c.implied_consent_at)
    as consent_expires_at
from customer_contacts c
where marketing_consent_basis(c.marketing_opt_in, c.unsubscribed, c.implied_consent_at)
      in ('express', 'implied');

-- --- Recording consent at checkout -------------------------------------------

-- Wrapped rather than rewritten, following the pattern in 0021 and 0023.
alter function record_customer_contact(text, text, text, int, boolean)
  rename to record_customer_contact_express;

create or replace function record_customer_contact(
  p_email        text,
  p_name         text,
  p_phone        text,
  p_total_cents  int,
  p_opted_in     boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform record_customer_contact_express(p_email, p_name, p_phone, p_total_cents, p_opted_in);

  -- The purchase itself is the consent. Stamped on every order, so a customer
  -- who keeps shopping never ages out.
  update customer_contacts
  set implied_consent_at = now()
  where email = trim(p_email)::citext;
end;
$$;

-- --- Unsubscribe -------------------------------------------------------------

-- Deliberately clears express consent as well as setting the flag. Leaving
-- marketing_opt_in true on someone who has unsubscribed would mean the raw
-- column disagrees with the view, and sooner or later somebody queries the
-- column.
create or replace function unsubscribe_contact(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_found boolean;
begin
  update customer_contacts
  set unsubscribed    = true,
      unsubscribed_at = coalesce(unsubscribed_at, now()),
      marketing_opt_in = false
  where email = trim(p_email)::citext
  returning true into v_found;

  -- Says the same thing either way. Confirming whether an address is on the
  -- list would leak customer information to anyone who can guess an email.
  return jsonb_build_object(
    'ok', true,
    'message', 'That address will not receive marketing email from us again.'
  );
end;
$$;

grant execute on function unsubscribe_contact(text) to anon, authenticated;

-- --- Statistics --------------------------------------------------------------

create or replace function marketing_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'total',        count(*),
    'reachable',    count(*) filter (where basis in ('express', 'implied')),
    'express',      count(*) filter (where basis = 'express'),
    'implied',      count(*) filter (where basis = 'implied'),
    'expired',      count(*) filter (where basis = 'expired'),
    'unsubscribed', count(*) filter (where basis = 'unsubscribed'),
    -- Worth surfacing: these are customers who can be emailed today and cannot
    -- be in three months unless they order again.
    'expiring_90d', count(*) filter (
      where basis = 'implied'
        and implied_consent_at < now() - make_interval(months =>
              (select implied_consent_months from settings where id)) + interval '90 days'
    ),
    'window_months', (select implied_consent_months from settings where id)
  )
  from (
    select
      implied_consent_at,
      marketing_consent_basis(marketing_opt_in, unsubscribed, implied_consent_at) as basis
    from customer_contacts
  ) t;
$$;

grant execute on function marketing_consent_basis(boolean, boolean, timestamptz) to authenticated;
grant execute on function marketing_consent_expires(boolean, timestamptz) to authenticated;
grant execute on function marketing_stats() to authenticated;

-- --- Gate wording ------------------------------------------------------------
-- The optional box used to read as though not ticking it meant no marketing
-- email. That is no longer true: buying something is itself a basis to email
-- for two years. Leaving the old wording up would be offering a choice the
-- system does not honour, which is worse than not offering one — so the box is
-- reworded to describe what it actually controls, which is whether consent
-- survives after someone stops ordering.

update site_acknowledgements
set label = 'Keep emailing me even if I stop ordering',
    body  = 'Either way you will get the occasional email about seasonal items and specials, and every one of them has an unsubscribe link. Ticking this keeps them coming once it has been a while since your last order.'
where key = 'marketing_optin';


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

