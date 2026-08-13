# Futurelite 2.0

Futurelite is a delivery-only grocery ordering platform for small businesses in
British Columbia, with Canada-wide shipping. Version 2.0 adds USDC on Solana as
a second way to pay, sitting beside the original Interac e-Transfer flow.

**Futurelite is a separate product from Ordering Platform 1.0.** They share a
starting point and nothing else. Changes to one are not changes to the other.

---

## What is new in 2.0

| | |
|---|---|
| Second payment method | USDC on Solana, offered alongside Interac e-Transfer |
| Per-order addresses | Each order gets a receiving address used once and never reused |
| Daily exchange rate | CAD totals converted to USDC, rate stamped on the order |
| Quote expiry | Amounts hold for 15 minutes, then offer a refreshed figure |
| Address pool manager | Paste public addresses in; validated before anything is saved |
| Manual confirmation | Staff check their wallet and confirm, exactly as with Interac |
| Part-payment handling | A short payment is recorded honestly rather than forced |

Interac e-Transfer is untouched. An order placed with e-Transfer in 2.0 behaves
exactly as it did in 1.0.

### Crypto payment discount

A standing percentage off for paying in USDC, controlled from **Coupons**. No
code to enter — it applies when the customer picks USDC, and the saving is shown
beside the option so they can see why to choose it.

It is applied to the subtotal alongside any coupon, **not subtracted from the
final total**. Tax is charged on `(subtotal − discounts) + delivery`, so taking
it off the end would have charged the customer tax on money they never paid.

Controls: percentage (capped at 50%), receipt label, an optional ceiling in
cents, and whether it stacks with a coupon code. Stacking is off by default, in
which case a coupon wins outright and the customer keeps the better deal they
already had.

The order of operations at checkout matters and is enforced: price the order,
apply the discount, **then** convert to USDC. Quoting first would have quoted the
undiscounted figure and the customer would have sent too much.

One case needed handling explicitly. A customer can choose USDC, get the
discount, and then send an e-Transfer instead — leaving the order priced on a
promise they did not keep. `revoke_crypto_discount()` takes it back off and
reprices, recomputing rather than reversing arithmetic so rounding cannot leave
the order a cent adrift, and reconsiders the payment status rather than leaving
it saying paid.

#### Making the advertised saving true

The figure on the button has to be the figure on the receipt, and two things
made that harder than it looks.

The saving is **not** the discount percentage. Tax comes down with the discount,
so a 5% discount on a $100 order moves the customer's total by $5.25, not $5.00.
Both the app and the demo therefore compute the saving by **pricing the order
twice — with and without the discount — and subtracting**, rather than adding an
estimate of the tax back on. Any shortcut there is a place where the two figures
can quietly diverge.

The client also had to stop pricing orders independently of the database. The
checkout screen previously computed its own total inline, which meant a customer
choosing USDC would have seen the undiscounted price and then been charged less.
Pricing now goes through one module, `src/lib/pricing.ts`, and the demo has a
single `priceBasket()` that every total and every saving passes through — the
whole file computes tax in exactly one place.

Verified rather than assumed: **600 baskets** were priced client-side and
compared against PostgreSQL — varying subtotals, coupon amounts, delivery fees,
six tax rates, seven discount rates, stacking on and off, and ceilings — plus a
run of consecutive subtotals chosen to land on half-cent tax boundaries where
floating point and exact numeric are most likely to disagree. Discount, tax,
total and advertised saving matched exactly on every one. A further **240
baskets** were swept through the demo's live UI, and five placed order pairs
were checked end to end against what the database actually charged.

#### Where the discount is shown

A discount that only appears at checkout is a support call waiting to happen, so
it now shows on every surface that states a price: the confirmation screen, the
customer's tracking page, the admin order detail, and the confirmation email.

The tracking page previously showed one combined discount line labelled with the
coupon code, which credited the coupon for a saving the customer got for paying
in crypto. Coupon and crypto are now separate lines everywhere.

The `order_placed` email needed more than a line. It hard-coded Interac wording,
so a USDC customer was being told to send money to an email address. There are
now `{payment_instructions}`, which renders the block matching the method the
customer actually chose, and `{discount_lines}`, which itemises each discount
rather than giving one combined figure. `{payment_method}`, `{usdc_address}` and
`{usdc_amount}` are available too. The migration only rewrites the template if
the shop has not already edited it.

In the back office, the orders list has a **Method** column and shows
`after -$X crypto` beneath a discounted total — without that, a lower figure
reads as an error. The order detail carries the method, the discount rate, and a
note of what the same order would have cost by e-Transfer.

#### Blank content fields

Clearing a field in the content editor used to look saved and change nothing:
the read helper swapped any blank for the wording shipped with the app. Emptying
a line is a real editorial choice — plenty of shops want no tagline, or no
footer note — so a blank now stays blank.

The fallback still applies to a key that has **never been set**, which is what it
is for: a fresh install, or a key added by an upgrade before anyone has written
copy for it. The distinction is between "blank on purpose" and "no value yet",
and only the second wants a default. Because clearing and restoring are now
different acts, there is a **Reset to built-in wording** button.

#### Page links

Published pages appear at the top of the shop beside *Track an order*, not only
in the footer, and a new page is listed by default — the reason to make one is
for people to find it.

#### Checkout without a scrollbar

Entering shipping details used to put a scroll area inside a scrolling page: the
rail was height-capped and sticky, so the form scrolled within a 178px window on
a laptop, hiding most of its own fields.

The cap and the inner scroll now come off in checkout, and the rail becomes an
ordinary block that is as tall as it needs to be. The content was tightened to
match — city, province and postal share one row instead of two, the shipping
banner folded into the summary row it was duplicating, and spacing is denser in
checkout than in the item list. The rail went from 1001px of content to 772px,
which fits entirely on screen from 800px of viewport height upward.

The item list keeps its old behaviour: sticky and internally scrollable, so the
summary follows the catalogue as you browse.

The USDC figure at checkout no longer reads "About 46.58 USDC". It is the exact
amount the customer will be asked to send, so hedging it invited them to round.

### Marketing consent

The mailing list used to hold only customers who ticked the optional box, which
left most of the customer base unreachable. It now includes **everyone who has
bought something**, for 24 months from their most recent order, with each new
order restarting the clock.

This rests on implied consent from an existing business relationship, which is a
real basis under Canada's anti-spam law rather than a workaround. Two limits are
enforced in the database and are not configurable away:

- An **unsubscribe is absolute and irreversible**. It outranks every other
  basis, survives further orders, survives ticking the box again, and there is
  no path back through the admin panel.
- Consent that has **aged out is dropped**, not quietly retained. The window is
  adjustable downward but capped at 24 months, because setting it higher would
  not make a longer window lawful.

The optional checkbox was reworded rather than removed. Leaving it saying "email
me about specials" while emailing everyone regardless would have been offering a
choice the system does not honour — worse than offering none. It now reads
"Keep emailing me even if I stop ordering", which is what it actually controls.

Sender identification and a working unsubscribe link are still required in every
message. Those live in the email templates, not the database.

### Also removed in 2.0

The checkout line reading **"Arrives in about 1–3 hr"** is gone. It dated from
when this was local Surrey delivery; once shipping went Canada-wide it became a
promise that was wrong for most orders and unkeepable for the rest. Checkout now
names the shipping zone and stops there.

One related thing is still live and worth a decision: `estimated_delivery_at` is
still set at checkout to *now plus the slowest estimate* from Shipping settings,
which defaults to three hours, and the order tracking page shows it as
"Estimated arrival". That is the same promise in a second place. The Shipping
settings that feed it ("Fastest estimate" and "Slowest estimate", in minutes)
now have no other purpose. Both can be removed on request.

---

## The security decision behind this design

**Futurelite never holds key material.** There is no seed phrase, no private
key, and no mnemonic anywhere in this repository, in any environment variable,
or in the database. The `.env.example` file has nothing to fill in for Solana
beyond a cron secret.

Payment addresses are generated on a phone and pasted into the admin panel as
public strings. The database stores text.

They are addresses, not wallets. The shop keeps **one** wallet, on that phone,
and every address in the pool is a receiving address belonging to it. Nothing
needs funding per order, nothing needs sweeping, and all the money lands in one
place. Even a total compromise of the Vercel
deployment and the Supabase project yields order data and a list of public
addresses — it does not yield the ability to move a single dollar.

This is a deliberate departure from the common pattern of deriving addresses
server-side from a stored mnemonic. Solana's key derivation is hardened-only,
so unlike Bitcoin or Ethereum there is no watch-only extended public key: the
seed itself would have to live on the server. That tradeoff was not worth
making for a grocery shop.

**Nothing here reads the Solana network.** There is no RPC endpoint and no
automated payment verification. Staff look at their own wallet and confirm what
they see — which is a stronger check than any automated one this system could
make, and it matches how e-Transfers are already handled.

---

## How the money flows

1. A customer picks USDC at checkout.
2. `place_order()` takes the lowest-numbered unused address, ties it to the
   order with a unique constraint, and stamps the current rate and the exact
   USDC figure onto the order row.
3. The customer sees the address and the amount, and pays from any Solana
   wallet.
4. Staff see the order in **Admin → Payments**, check the wallet, and enter the
   amount that arrived.
5. Short by a cent or less counts as paid. More than that is recorded as part
   paid and the order stays on hold.

The address is assigned inside the same transaction that creates the order, and
the unique constraint on `usdc_addresses.order_id` is what guarantees one address
per order. This is enforced by the database, not by application code, so a cold
start, a double submit, or two simultaneous checkouts cannot produce a
collision. Verified under concurrent load.

---

## When USDC hides itself

The option disappears from checkout — leaving Interac e-Transfer as the only
choice — whenever any of these is true:

- It is switched off in **Admin → Payments**
- The exchange rate is older than the configured maximum (default 36 hours)
- No unused addresses remain in the pool

Hiding it is deliberate. Quoting a customer a wrong amount, or accepting an
order that cannot be paid, both cost more than not offering the option.

---

## Things to know before going live

**Solana addresses carry no checksum.** Unlike Ethereum's EIP-55 or Bitcoin's
hash suffix, a raw ed25519 public key in base58 has no built-in error
detection. The paste box validates the character set, the length, and whether
the bytes land on the ed25519 curve, which together reject roughly half of
single-character slips. It cannot catch all of them. **Send a small test
payment to the first address of any new batch before relying on it.**

**The pool is finite.** Watch the count in Admin → Payments. Below the warning
threshold you get a banner; at zero, USDC stops being offered.

**Crypto payments are irreversible.** There is no chargeback. Decide a refund
policy before switching this on.

**Still outstanding from 1.0:** CAPTCHA on checkout. Rate limiting is in place.

---

## Files added in 2.0

```
supabase/migrations/20260201000001_futurelite_usdc.sql
src/lib/solana.ts                                  base58 + ed25519 curve check
src/lib/fx.ts                                      CAD/USDC rate, cached in Postgres
src/lib/actions/usdc.ts                            admin actions
src/app/admin/payments/page.tsx                    the Payments screen
src/app/api/fx/refresh/route.ts                    scheduled rate refresh
src/app/api/payments/usdc/quote/route.ts           customer re-quote
src/components/admin/usdc-address-manager.tsx      address pool
src/components/admin/usdc-rate-panel.tsx           rate and switches
src/components/storefront/payment-method-picker.tsx
src/components/storefront/usdc-instructions.tsx
demo.html                                          v1.0 demo, extended in place
```

## Testing

Verified against a real PostgreSQL 16 instance, not by inspection:

- 23 migrations apply cleanly, and `schema.sql` applies in a single paste
- 22 assertions on rate gating, address validation, quote maths, and pool exhaustion
- 15 assertions on payment confirmation, including short, over, and exact payments
- 33 end-to-end assertions covering both checkout paths and the customer tracking page
- 6 concurrent checkouts verified to receive 6 distinct addresses
- 35 JavaScript assertions on base58, curve checking, and amount parsing
- 64 assertions on the demo: 18 on its logic, 31 driving the real UI in a
  headless browser, 15 confirming the Interac path is unchanged
- Demo quote maths verified to match the database function figure for figure

### The demo

`demo.html` is the version 1.0 demo with the Futurelite changes applied in
place — same gate, same branding controls, same back-office panes, same seeded
catalogue. Nothing was rebuilt or replaced.

Three defects surfaced only by running it in a real browser rather than by
reading it:

- The stylesheet's `.field input{width:100%}` rule stretched the new radio
  buttons and checkbox to full width, pushing their labels outside the option
  boxes. Fixed with a scoped rule that also covers any future checkbox.
- The gate carried a required acknowledgement reading "I understand payment is
  by Interac e-Transfer after I place my order" — untrue the moment a second
  payment method existed. Reworded, along with the checkout microcopy.
- The rate conversion line was rendering as an uppercase `<dt>`, reading as a
  heading rather than a note.

One test failure turned out to be correct behaviour: pool-exhaustion tests were
tripping the demo's own five-orders-per-ten-minutes limiter before reaching the
empty pool. The harness clears it; the app was untouched.
