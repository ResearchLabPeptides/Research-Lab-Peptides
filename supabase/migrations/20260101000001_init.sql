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
