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
