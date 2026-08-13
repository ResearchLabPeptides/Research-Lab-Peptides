# Deployment

## Where everything runs

| Piece | Where it lives | On your computer? |
| --- | --- | --- |
| Application code | GitHub | No |
| Build and hosting | Vercel | No |
| Database, auth, file storage | Supabase | No |
| Product photos | Supabase Storage | No |
| Transactional email | Resend, or logged if unconfigured | No |

There is no server to run and no machine to keep switched on. Setup is described
step by step in the [README](../README.md) and happens entirely in a browser.

## Environment variables

Set these in **Vercel → Settings → Environment Variables**, for Production,
Preview, and Development.

| Variable | From | Exposed to the browser |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API | yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API | **no** |
| `GATE_SECRET` | `select encode(gen_random_bytes(32), 'base64');` in the SQL Editor | no |
| `NEXT_PUBLIC_SITE_URL` | Your Vercel URL | yes |
| `RESEND_API_KEY` | Optional. Without it, emails are logged, not sent | no |
| `EMAIL_FROM` | Optional | no |

Changing an environment variable does not take effect until you redeploy:
**Deployments → ⋯ → Redeploy**.

## Region

`vercel.json` pins the deployment to `pdx1` (Portland). Set it to whichever
region is nearest your Supabase project — a mismatch adds a round trip to every
database query. You can edit that file directly on GitHub.

## Applying database changes later

New migrations arrive as files in `supabase/migrations/`. To apply one, open the
**SQL Editor**, paste that single file, and run it. Run them in filename order
and only the ones you have not already applied.

`supabase/schema.sql` is every migration concatenated. Use it for a fresh
database, not for updating one that already has data.

## Before you take a real order

Work through all of these. Most are one field, and every one of them has a
customer-visible failure mode.

- [ ] **Payment email** in `/admin/settings` is an address you actually monitor.
      This is where customers send money. Send yourself a $1 e-Transfer to
      confirm it arrives.
- [ ] **Tax rate** is right for your jurisdiction. The default is 5% GST and it
      applies to items *and* delivery, which is correct for BC.
- [ ] **Delivery zones** cover the postal codes you serve. Anything unmatched
      gets "we don't deliver there yet" at checkout — test a real address from
      each zone.
- [ ] **Minimum order and free-delivery thresholds** are what you intend. A
      minimum blocks checkout, so an accidental $250 minimum silently stops
      every order.
- [ ] **First administrator** exists and can sign in.
- [ ] **Email provider** is configured, or accept that customers get no
      confirmation email. Without `RESEND_API_KEY` messages are logged to the
      server console and never sent. The on-screen payment instructions still
      work, so this is degraded rather than broken.
- [ ] **Catalog** replaces the seed data. `supabase/seed.sql` sells fictional
      groceries from a fictional business.
- [ ] **Business name and support phone** in Settings.
- [ ] **Entry-gate acknowledgements** say what you want them to say. The seeded
      wording is a placeholder, not legal advice. If nothing should be confirmed,
      turn the gate off rather than leaving placeholder text up.
- [ ] **`GATE_SECRET`** is set in Vercel. Without it the gate falls back to
      signing with the service role key, which works but means rotating that key
      silently signs every visitor out of the gate.

## Verifying a deployment

Place a real order end to end:

1. Open `/` in a private window. If the gate is on, confirm it appears, that the
   confirm button stays disabled until every required box is ticked, and that
   Tab cannot reach the shop behind it.
2. Add items, enter an address in a zone you serve, and place the order.
3. Confirm the order number and total on the confirmation screen, and that the
   payment instructions name your e-Transfer address.
4. In `/admin/orders`, open the order. Stock should show as **held**, not
   deducted.
5. Record the payment. The order moves to **Preparing**, stock deducts
   permanently, and the ledger shows a `reservation_release` followed by a
   `sale`.
6. Visit `/orders/<order-number>?email=<the email>` and confirm the customer
   sees the same status.
7. Move it to **Cancelled** on a second test order and confirm the units return
   to stock.

## Backups and recovery

Supabase takes daily backups on paid plans; point-in-time recovery is available
above that. Turn one of them on before launch.

The append-only `inventory_movements` ledger means stock is reconstructible even
if `products.quantity` is ever corrupted:

```sql
select product_id, sum(quantity_change) as derived_quantity
from inventory_movements
where type not in ('reservation', 'reservation_release')
group by product_id;
```

Comparing that against `products.quantity` is a good weekly sanity check.


---

## Futurelite 2.0: USDC deployment notes

### Environment variables

One addition, and it is not a key:

```
CRON_SECRET=          # Vercel sets this when you add a cron job
```

There is deliberately no `SOLANA_SEED_PHRASE`, no private key, and no RPC URL.
If you find yourself being asked for any of those, something is wrong.

### Vercel Cron

`vercel.json` registers a daily job:

```json
{ "crons": [{ "path": "/api/fx/refresh", "schedule": "0 11 * * *" }] }
```

That is 11:00 UTC — early morning Pacific — so the day's rate is in place before
the shop opens. Cron jobs require a Vercel Pro plan. Without one, the rate can
be refreshed by hand from Admin → Payments; just watch that it does not go
stale past `usdc_rate_max_age_hours`, since USDC hides itself when it does.

### Migration

`20260201000001_futurelite_usdc.sql` is additive. It adds columns with
defaults, creates two tables, and replaces `place_order()` and `lookup_order()`
with wrapped versions. No existing data is modified and no column is dropped.
Existing orders are unaffected and read as `payment_method = 'interac'`.

For a fresh install, `supabase/schema.sql` includes it — paste and run as usual.

### Rollout order

Turn USDC on last. Add addresses, refresh the rate, place and confirm a real
test order end to end, and only then tick "Offer USDC at checkout". The switch
refuses to turn on with an empty pool, but it cannot tell you whether the
addresses you pasted are ones you actually control — only a test payment can.
