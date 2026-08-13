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
