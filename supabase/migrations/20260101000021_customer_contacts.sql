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
