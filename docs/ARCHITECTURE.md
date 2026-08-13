# Architecture

## The one idea worth understanding

**Money and stock are decided in PostgreSQL, not in TypeScript.**

Checkout does not compute a total in the browser and send it to the server.
It sends *intent* — a list of product IDs, quantities, and an address — and
`place_order()` re-derives everything: prices from `products`, the delivery fee
from the zone rules, tax from `settings`, and the order number from a
transactional counter. The number on the confirmation page came from the same
transaction that wrote the order.

This is what makes it safe for the checkout route to run with the service role.
A customer has no account and therefore no session, so *something* has to write
on their behalf. Because that something contributes no numbers of its own, the
blast radius of a compromised route handler is "can place a legitimate order",
not "can set the price to zero".

## Stock has two counters

| Column | Meaning |
| --- | --- |
| `quantity` | Physically on the shelf |
| `quantity_reserved` | Spoken for by an order awaiting payment |

Available to sell is `quantity - quantity_reserved`. The lifecycle:

1. **Checkout** — `quantity_reserved` goes up. Physical stock has not moved.
2. **Payment confirmed** — the hold is released and a `sale` movement reduces
   `quantity` for real.
3. **Cancelled before payment** — the hold is released, nothing else happens.
4. **Cancelled after payment** — a `return` movement puts the units back.

Two shoppers racing for the last units is handled by `SELECT … FOR UPDATE` in
`place_order()`. This is tested: with five units on the shelf and five
simultaneous checkouts for two units each, exactly two succeed.

## The ledger is append-only

`inventory_movements` has a trigger that raises on `UPDATE` and `DELETE`. There
is no code path anywhere — not in a server action, not in the admin UI — that
assigns to `products.quantity` directly. Everything goes through
`apply_inventory_movement()`, which writes the ledger row and the new quantity
in one transaction.

If a count was entered wrong, you record a correcting adjustment. You do not
edit history.

## Row Level Security is the boundary

The middleware redirect on `/admin` is a courtesy that saves a round trip. The
actual boundary is RLS:

- **anon** can read active products, active categories, active delivery zones,
  and the settings row. That is the entire surface.
- **anon cannot read `orders` at all** — there is no select policy for it.
  Customers reach their own order through `lookup_order()`, which is
  `SECURITY DEFINER` and requires both the order number and a matching email.
- **Staff** are gated by `has_min_role()`, which compares against the caller's
  row in `profiles`. Role ranks: `read_only` < `employee` < `manager` <
  `administrator`.

Reporting views are declared `WITH (security_invoker = true)`, so a view can
never become a way around a policy. The CSV export route runs under the
caller's own session for the same reason.

The UI hides controls a role cannot use, but that is cosmetic. Both the RPCs and
the policies re-check, so a stale page or a hand-crafted request gets no further
than the user's actual role allows.

## Delivery pricing is data

Zones own the pricing (fee, free-delivery threshold, minimum order, ETA). Rules
attach postal prefixes, exact postal codes, or city names to a zone. Resolution
goes most-specific-first: exact postal, then longest matching prefix, then city,
with zone `priority` breaking ties.

A unique index on `(match_type, match_value)` prevents one postal code from
belonging to two zones, which is what would otherwise make a fee ambiguous.

Administrators change all of this in the dashboard. No deploy is involved.

## Request paths

```
Customer                                      Staff
────────────────────────────────────────      ──────────────────────────────
GET  /                    RSC, anon key       POST server action, session
POST /api/delivery/quote  anon → RPC            → confirm_payment()  RPC
POST /api/orders          service → RPC         → set_order_status() RPC
POST /api/orders/lookup   service → RPC         → apply_inventory_movement()
```

Each RPC does its own permission check. The service-role client appears in
exactly two files' worth of call sites, both for customers who cannot have a
session.

## Money

Integer cents everywhere — in Postgres, over the wire, and in React state. It
becomes a decimal string only at the moment it is rendered, in
`lib/format.ts`. Nothing multiplies or divides a price in floating point.

Tax is applied to the subtotal **plus** delivery, which is correct for GST in
BC. If your jurisdiction taxes delivery differently, that is one line in
`place_order()`.

## The entry gate

Same principle as checkout: the browser is asked for intent, the server decides.

`<SiteGate>` covers the shop and marks it `inert`, but that only stops honest
visitors. `place_order()` calls `assert_acknowledgements()`, which compares what
was confirmed against `required_acknowledgement_keys()` at that instant and
raises if anything is missing. Removing the overlay in devtools yields a catalog
you cannot check out of.

The acknowledgements travel from the signed, `httpOnly` cookie — read server-side
in the checkout route — not from the request body. A page script can neither read
the cookie nor claim consent that was never given.

Two properties fall out of hashing the wording to derive the gate version:

- Editing a *required* acknowledgement re-prompts every visitor, with nothing to
  remember to increment.
- Editing an *optional* one, or the dialog's heading, prompts nobody.

`orders.acknowledgements` stores a snapshot of the wording rather than foreign
keys, for the same reason `order_items` denormalizes product names: an order is a
historical record and has to survive the thing it references being edited.

## Managing the catalog

Products are created, edited, archived, and deleted from `/admin/products`.
Three rules shape how that works.

**Stock never enters through the product form.** A new product is inserted with
`quantity = 0` and its opening count is posted separately as a `receiving`
movement. Editing a product cannot touch `quantity` at all — the column is
absent from the update statement. Counts only move through
`apply_inventory_movement()`, so the very first unit on the shelf has a ledger
row explaining where it came from.

**Photos bypass the server.** The browser uploads directly to Supabase Storage
under the staff member's own session; the server action only records the
resulting path. A 5 MB image never travels through a server action, and the
bucket policy — not the UI — is what stops a non-manager uploading. If the file
lands but the row fails, the uploader deletes the file rather than leaving an
orphan nobody can see.

**Archive is the default, delete is the exception.** Archiving hides a product
from customers and keeps its stock history. Deleting is offered behind a
confirmation, and refuses outright while stock is held for unpaid orders, since
those units would silently vanish. Past orders survive either way: `order_items`
stores its own copy of the SKU, name, unit, and price, and `product_id` is
`ON DELETE SET NULL`.

### A wrinkle the ledger trigger created

`inventory_movements` is append-only, enforced by a trigger that raises on
`UPDATE` and `DELETE`. That trigger originally fired on the database's own
referential cascades too, which made two legitimate operations impossible:
deleting a product (its ledger rows cascade) and deleting an order (its
`order_id` is set to null in the ledger).

Migration `0011` narrows it. The trigger now allows exactly those two writes and
still refuses everything else. It tells them apart by looking for the parent
row: a cascade runs after the parent is gone, so the lookup comes back empty,
while a hand-written `DELETE FROM inventory_movements` against a live product
still finds its product and is still refused.

> Deleting an *order* outright leaves any reservation it held on the books —
> `quantity_reserved` stays raised with nothing pointing at it. The admin UI
> only ever cancels orders, which releases the hold properly, so this is
> reachable only from SQL. Cancel first, then delete.

## Coupons

Three kinds — percentage off the items, a fixed amount off the items, and free
delivery — each limited by any combination of date range, total redemptions, and
redemptions per customer email.

**The browser's answer is advisory.** `/api/coupons/preview` calls
`evaluate_coupon()` so the shopper sees the discount before committing, but that
result is never trusted. `place_order()` locks the coupon row, re-checks every
limit inside that lock, recomputes the discount from the database's own prices,
and only then writes the order and the redemption row. A code with one use left
cannot be spent twice by two simultaneous checkouts — verified with five
concurrent orders against `usage_limit = 1`, of which exactly one succeeded.

**Enumeration is closed off.** `anon` has no select policy on `coupons`, so the
table is unreadable from the storefront. `evaluate_coupon()` is `SECURITY
DEFINER` and answers one code at a time, and it returns the same message for an
unknown code as for a paused one — so the endpoint cannot be used to discover
which codes exist.

**A coupon can never pay a customer.** Subtotal discounts are clamped to the
subtotal and delivery discounts to the delivery fee, so the worst case is a bill
of zero. A free-delivery coupon applied when delivery is already free from a
quantity rule takes nothing off twice.

**Order of operations.** The discount comes off the subtotal *before* tax is
calculated, because tax is owed on what the customer actually pays:

```
tax   = round((subtotal - discount + delivery) × rate)
total = (subtotal - discount) + delivery + tax
```

`orders` stores `coupon_code`, `coupon_label`, and `discount_cents` so an order
remains readable years later even if the coupon is deleted, and
`coupon_redemptions` records the money actually given away — including the
waived delivery fee, which is not part of `discount_cents`. That is what the
`coupon_performance` view reports against.

**Deleting a redeemed coupon is refused** by the server action. Cascading the
redemption rows away would quietly rewrite what past promotions appear to have
cost, so staff are told to pause instead.

## Rate limiting

Four public endpoints are limited, counted in Postgres rather than in memory —
the app runs on serverless functions, so there is no long-lived process to hold
state and two requests routinely land on different machines. A shared table is
the only place a count means anything.

| Endpoint | Limit | Stops |
| --- | --- | --- |
| `POST /api/orders` | 5 per 10 min per IP | Junk order floods |
| `POST /api/orders` | 5 per hour per email | Cycling addresses to dodge the above |
| `POST /api/orders/lookup` | 10 per min per IP | Guessing order numbers |
| `POST /api/coupons/preview` | 10 per min per IP | Brute-forcing coupon codes |
| `POST /api/delivery/quote` | 40 per min per IP | Incidental abuse; roomy because it fires as the shopper types |

`check_rate_limit()` does the read and the increment in one `INSERT … ON
CONFLICT DO UPDATE`, so two simultaneous requests cannot both see "0 so far".
Verified with 20 concurrent calls against a limit of 5: exactly 5 allowed, and
all 20 counted with no lost writes.

Fixed windows, not a sliding log. A burst straddling a boundary can briefly
allow up to twice the limit; that is the trade for a check costing one upsert on
a primary key. `rate_limits` has RLS on and **no policies at all** — only the
definer function touches it, because a caller who could edit the table could
lift their own limit.

**If the limiter itself fails, the request is allowed** and the error is logged.
Blocking real customers because a counter is broken is the worse outcome.

**This is a speed bump, not a wall.** It stops a script; it will not stop an
attacker with a pool of addresses. For that, put a WAF in front of the site —
Vercel's is a checkbox. Old windows accumulate, so run
`select prune_rate_limits();` on a schedule, or occasionally by hand.


---

## Futurelite 2.0: USDC on Solana

### What this subsystem deliberately does not do

It does not hold keys, and it does not talk to the Solana network. Both are
choices, not gaps.

**One wallet, many addresses.** The pool holds receiving addresses, not wallets.
The shop has a single wallet on a phone and every address in the pool belongs to
it, so there is nothing per-order to fund, sweep, or reconcile — money simply
arrives in the one wallet, labelled by which address it came in on. This is the
main departure from the PDF's design, which treated each order as its own
wallet and inherited a sweeping problem it did not need.

**No key material.** Payment addresses are generated on that phone and pasted in
as public strings. Solana's SLIP-0010 derivation is hardened-only, so there is no
watch-only extended public key equivalent to a Bitcoin xpub — deriving
per-order addresses server-side would require the seed itself to sit in an
environment variable, where a leaked env or one compromised build dependency
drains every address ever derived. For a grocery shop taking a few USDC orders
a week, that risk buys nothing. A finite pasted pool with a low-stock warning
achieves the same per-order attribution at zero key-custody risk, and leaves
the funds consolidated in one place rather than scattered.

**No RPC.** Payment verification is manual. This is not weaker than the
automated alternative — it is stronger. A naive on-chain check that looks for
"a transaction touching this address" can be satisfied by sending dust, and
verifying a USDC transfer properly means resolving the Associated Token Account
for the mint and reading balance deltas at six-decimal precision. A person
looking at their own wallet does all of that correctly and for free. It also
matches the existing e-Transfer workflow exactly, so there is one habit to
learn rather than two.

### Where the guarantees live

Everything that must not go wrong is enforced in Postgres:

| Guarantee | Mechanism |
|---|---|
| One address per order, ever | `unique` on `usdc_addresses.order_id` |
| No address handed out twice | `for update skip locked` inside `assign_usdc_address()` |
| No malformed address in the pool | `check` constraint on `usdc_addresses.address` |
| Rate too stale to trust hides USDC | `usdc_available()`, checked at checkout |
| Empty pool cannot produce an order | `place_order()` raises before creating anything |
| Pool is staff-only | RLS: `is_staff()` read, `has_min_role('manager')` write |

Application code contributes validation and interface, never a guarantee. A
stale page, a replayed request, or two simultaneous checkouts all resolve
correctly because the database resolves them.

### Rounding

Quotes round to two decimal places, not six. A customer typing an amount into a
wallet should not be handling the sixth decimal, and the confirmation path
treats anything within one cent of the expected figure as paid, because wallets
and exchanges round. Amounts are stored as integer micros throughout, matching
the integer-cents rule the CAD side already follows.

### Rate handling

The CAD/USDC rate is fetched daily and cached in Postgres — not in memory, since
Vercel functions are stateless and an in-process cache would refetch on every
cold start while leaving no record of which rate was in force when an order was
quoted. Each order stores the rate, the source, and the fetch time, so a
disputed amount can always be reconstructed.

A failed refresh leaves the previous rate untouched and records only the error.
A rate a few hours old is still a good rate; `usdc_rate_max_age_hours` decides
when it stops being one, and past that point USDC is hidden rather than quoted
from a stale number.

The rate is quoted against USDC rather than USD on purpose. USDC usually tracks
the dollar but has drifted before, and on a day when it trades at 0.995 a pure
USD/CAD rate would silently undercharge every order.
