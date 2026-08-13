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
