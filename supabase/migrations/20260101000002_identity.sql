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
