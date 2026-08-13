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
