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
