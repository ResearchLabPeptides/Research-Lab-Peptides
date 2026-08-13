# Futurelite 2.0

A delivery-only storefront and back office. Customers order in about two minutes
with no account, no login, and no app, then pay by **Interac e-Transfer or USDC
on Solana**. Staff run inventory, orders, payments, and delivery pricing from a
dashboard.

Futurelite is version 2.0 of the ordering platform. It is a **separate product
from Ordering Platform 1.0** — the two share a starting point and nothing else,
and changes to one are not changes to the other. What 2.0 adds, and why each
decision was made, is in **[VERSION-2.0.md](VERSION-2.0.md)**.

Built with Next.js 15 (App Router), TypeScript, Tailwind CSS v4, shadcn/ui-style
components, and Supabase (Postgres, Auth, Storage, Realtime, RLS). Deploys to
Vercel.

The seed data is a fictional Surrey, BC grocer called **Fernwood Provisions**.
Everything about it is configurable in Settings.

---

## Status: what is built and what is not

This is a working application, not a mockup — but it is honest about its edges.
Read this section before you plan around it.

### Built and verified

- **Database.** 25 migrations, 29 tables, 12 reporting views, 49 functions, and
  RLS on every table. Also shipped concatenated as `supabase/schema.sql` so the
  whole thing installs by pasting one file into the Supabase SQL Editor. Applied
  against PostgreSQL 16 and exercised end to end: order placement, reservation,
  partial and full payment, permanent deduction, cancellation and restock,
  customer lookup, and concurrent checkout for limited stock and for payment
  addresses.
- **Storefront.** Catalog grid, live search, category/price/flag filters, the
  floating order rail with in-place checkout, delivery quoting as you type,
  order placement, payment instructions, order tracking.
- **Catalog management.** Create, edit, archive, and delete products entirely
  from `/admin/products` — every field in the spec, plus drag-and-drop photo
  upload straight to Supabase Storage. No Studio required for day-to-day work.
- **Branding.** Six hex colours per mode, three Google Fonts, and corner
  roundness, all set in `/admin/branding` and stored in the database. One
  deployment can serve businesses that look nothing alike.
- **Editable copy.** Storefront headings and labels in `/admin/content`, plus
  full Markdown pages (About, FAQ, terms) with a formatting toolbar and preview.
- **Delivery pricing.** A flat charge plus stacking free/discount rules keyed on
  item count or subtotal. When several match, the customer gets the cheapest.
- **Coupons.** Percentage, fixed-amount, and free-delivery codes with expiry
  dates, total-use caps, and per-customer limits. Redemption is re-checked under
  a row lock at checkout, so the last use of a code cannot be spent twice.
- **Entry gate.** Required acknowledgements before the shop can be used,
  enforced again at checkout so a bypassed dialog still cannot produce an order.
- **Back office.** Sign-in, dashboard with live metrics and a 30-day revenue
  chart, order list with search and status filters, order detail with payment
  confirmation and status changes, inventory table with audited stock
  adjustments, delivery zones and rules, settings, activity log.
- **USDC on Solana.** A second payment method beside e-Transfer. Each order gets
  a receiving address used once and never reused, enforced by a unique
  constraint rather than by application code. Daily CAD/USDC rate cached in
  Postgres, stamped onto the order, with a fifteen-minute quote and a re-quote
  path when it lapses. Addresses are pasted in as public strings and validated
  on the way in. Confirmation is manual, the same habit as e-Transfer.
- **Crypto payment discount.** An optional percentage off for paying in USDC,
  set under Coupons. Applied to the goods total alongside any coupon so tax is
  charged on what the customer actually pays, with an optional ceiling and a
  stacking rule. Client and database pricing were cross-checked on 600 baskets.
- **Marketing consent.** Everyone who buys can be emailed for 24 months from
  their last order, with each order restarting the clock; ticking the optional
  box extends that indefinitely. An unsubscribe is absolute and cannot be
  undone from the admin panel, by ordering again, or by ticking the box again.
- **Plumbing.** Middleware session refresh, role-gated server actions,
  transactional email (logs to console until you add a provider key), CSV export
  for seven reports, CI that type-checks, lints, and builds.

`npm run typecheck`, `npm run lint`, and `npm run build` all pass clean.

### Not built yet

These are stubs or absent. None of them is blocked by a design decision — the
schema and RLS already support all of them.

| Gap | What exists today |
| --- | --- |
| Staff management screen | Roles work and are enforced everywhere. Creating an account and promoting it is still two steps in the Supabase dashboard. |
| Supplier and category management screens | Both can be *created* inline from the product form, which covers the common case. Editing or deleting one still means Studio. |
| Product document upload | Product **photos** upload from the browser. The documents bucket and table exist but have no uploader. |
| Per-zone pricing UI | Flat pricing and discount rules are fully editable. Multi-zone pricing works and is seeded, but zones are still created in Studio. |
| Zone create/edit form | Rules can be added in the UI; zones are seeded or edited in Studio. |
| Reordering acknowledgements by drag | Order is a numeric field you type. Everything else about them is editable in the UI. |
| User management screen | Roles work and are enforced. Promoting a user is an `UPDATE` on `profiles`. |
| xlsx / PDF export | CSV export works for all seven reports. |
| Realtime subscriptions | Tables are added to the publication; the dashboard currently revalidates per request rather than subscribing. |
| Automatic USDC verification | Payments are confirmed by a person checking their own wallet. There is no RPC node and nothing reads the Solana network — see the tradeoffs below. |
| Refunding a USDC payment | Refunds are recorded, but sending USDC back is done by hand from your wallet. |
| Automated tests in the repo | The 2.0 work was verified against a real PostgreSQL 16 instance and a headless browser — 356 assertions covering pricing, consent, payment confirmation, concurrent address assignment, base58 validation, the checkout UI, and the accuracy of this README. Those harnesses are not checked in, so there is nothing for CI to run beyond typecheck, lint, and build. |

### Known tradeoffs

- **Storefront filtering happens in the browser** against the full active
  catalog. That is what makes search feel instant, and it is fine into the low
  thousands of products. Past that, move `applyFilters` in
  `src/components/storefront/storefront.tsx` behind a server route backed by the
  `products_search_idx` trigram index that already exists.
- **Fonts load from Google's CDN, not the build.** Runtime-selectable typography
  is the whole point of `/admin/branding`, and `next/font` self-hosts at build
  time, so the two are mutually exclusive. The cost is one extra stylesheet
  request; `preconnect` hints are emitted to soften it. If you are deploying a
  single fixed brand and want the last few milliseconds back, swap
  `BrandingStyle` for a `next/font` import.
- **`experimental.typedRoutes` is off.** It fights template-literal query strings
  and produced more false errors than caught bugs.
- **The entry gate makes the storefront dynamic.** Whether the gate shows differs
  per visitor, so those routes can no longer be served from the CDN as one
  shared document. Turning the gate off in Settings returns them to cacheable.
- **Payment is manual by design, for both methods.** Interac e-Transfer has no
  merchant callback, so a person matches the transfer to the order number. That
  is why the order number is the most prominent thing on the payment screen — if
  it does not travel with the money, staff cannot match it.

  USDC is manual for a different reason: it is safer. A naive on-chain check for
  "a transaction touching this address" is satisfied by sending dust, and
  verifying a USDC transfer properly means resolving the token account for the
  mint and reading balance changes at six-decimal precision. A person looking at
  their own wallet does all of that correctly and for free, and it is the same
  habit staff already have.
- **No key material anywhere.** Receiving addresses are generated on a phone and
  pasted in as public strings. Solana's key derivation is hardened-only, so
  unlike Bitcoin or Ethereum there is no watch-only extended public key —
  deriving addresses server-side would mean the seed phrase itself living in an
  environment variable. That trade was not worth making, so the pool is finite
  and needs topping up. Admin warns before it runs out, and USDC hides itself at
  checkout rather than breaking if it does.
- **Solana addresses carry no checksum.** Unlike Ethereum's EIP-55 or Bitcoin's
  hash suffix, a raw public key in base58 has no error detection. The paste box
  checks the character set, the length, and whether the bytes land on the
  ed25519 curve, which together reject about half of single-character slips. It
  cannot catch all of them, and a USDC transfer to a wrong address is
  unrecoverable — so send a small test payment to any new batch.
- **Crypto payments are irreversible.** There is no chargeback. Decide a refund
  policy before switching USDC on.

---

## Getting it running — entirely in the browser

Nothing runs on your computer. GitHub holds the code, Supabase runs the
database, and Vercel builds and serves the site. You need three free accounts
and a web browser.

> If you would rather work locally — running `npm run dev`, using the Supabase
> CLI — everything for that is still in the repository. See
> [Local development](#local-development-optional) at the end. It is optional.

### 1. Put the code on GitHub

1. Unzip `ordering-platform.zip`.
2. At [github.com/new](https://github.com/new), create a repository. Leave it
   empty — no README, no .gitignore.
3. On the next screen choose **uploading an existing file**, then drag in
   everything from the unzipped folder.

> **One thing the browser uploader skips.** Files whose names begin with a dot
> are usually hidden from the upload dialog, so `.gitignore` will not make it
> across. Nothing breaks without it, but add it: **Add file → Create new file**,
> name it `.gitignore`, and paste the contents of the `.gitignore` in the zip.
>
> `.env.example`, `.prettierrc`, and `.github/` are only useful if you later
> work locally. Skip them for now.

### 2. Create the database

1. Create a project at [supabase.com](https://supabase.com). Save the database
   password it gives you.
2. Open **SQL Editor → New query**.
3. Paste the entire contents of `supabase/schema.sql` and press **Run**.

That one file is every migration in order — the whole schema, all the functions,
and every security policy. It should report success in a few seconds.

**Sample catalog (optional but recommended).** New query, paste
`supabase/seed.sql`, Run. That gives you 30 products, delivery zones covering
real BC postal codes, and three coupon codes, so you can see the whole thing
working before you type in your own products.

**Generate the gate secret.** New query, run this, and keep the result for
step 4:

```sql
select encode(gen_random_bytes(32), 'base64');
```

### 3. Deploy on Vercel

1. At [vercel.com/new](https://vercel.com/new), import the GitHub repository.
   The framework is detected automatically — change nothing.
2. Expand **Environment Variables** and add the six below before deploying.

Find the first three under **Supabase → Project Settings → API**:

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The `anon` `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | The `service_role` `secret` key |
| `GATE_SECRET` | The string from step 2 |
| `NEXT_PUBLIC_SITE_URL` | `https://your-project.vercel.app` — set it after the first deploy, then redeploy |
| `CRON_SECRET` | Any long random string. Protects the daily exchange-rate refresh. Only needed if you turn USDC on; Vercel offers to set it for you when you add a cron job. |

There is deliberately **no seed phrase, no private key, and no RPC URL** in that
list. If something ever asks you for one, it is not this application.

> **The daily rate needs Vercel Cron.** `vercel.json` registers a job at 11:00
> UTC — early morning Pacific — so the day's CAD/USDC rate is in place before the
> shop opens. Cron jobs need a Vercel Pro plan. Without one, refresh the rate by
> hand from Admin → Payments; if it goes stale past the age limit in settings,
> USDC hides itself at checkout rather than quoting from an old number.

3. Press **Deploy**.

> `SUPABASE_SERVICE_ROLE_KEY` bypasses every security policy. It belongs in
> Vercel's environment variables and nowhere else — never in the repository,
> never in a `NEXT_PUBLIC_` variable. The code imports it through a
> `server-only` module, so using it in browser code is a build failure rather
> than a leaked key.

### 4. Point Supabase at your live site

In **Supabase → Authentication → URL Configuration**, set the site URL to your
Vercel address.

While you are there, under **Authentication → Providers → Email**, confirm
signup is disabled. Staff accounts are created by an administrator, not by
whoever finds the login page.

### 5. Make yourself an administrator

1. **Supabase → Authentication → Users → Add user.** Enter your email and a
   password, and tick **Auto Confirm User**.
2. Back in **SQL Editor**, run:

```sql
update profiles set role = 'administrator', full_name = 'Your Name'
where email = 'you@yourbusiness.ca';
```

A trigger creates every new account at the lowest role, so an account can never
promote itself. This is the only time you need the SQL editor after setup —
everything else is done in the app.

### 6. Open the shop

Your Vercel URL is the storefront. Add `/admin` for the back office.

Then follow **[docs/USER-MANUAL.md](docs/USER-MANUAL.md)** to add products, set
your delivery charges, and take a first order.

### Making changes later

Edit a file on GitHub — pencil icon, change, commit. Vercel rebuilds and
redeploys within about a minute. Database changes go in the SQL Editor.

Most day-to-day work needs neither: products, prices, delivery rules, coupons,
colours, fonts, and every word on the site are all edited inside the app.

---

## Local development (optional)

Skip this entirely if you are running in the cloud.

```bash
npm install
cp .env.example .env.local     # fill in the same values as Vercel
npm run dev
```

For a local database instead of the hosted one, with Docker running:

```bash
npm install -g supabase
supabase start
supabase db reset              # migrations plus seed
```

`supabase start` prints a local API URL and anon key to use in `.env.local`.
Emails appear in Inbucket at `http://localhost:54324` rather than being sent.

Regenerate `supabase/schema.sql` after changing a migration:

```bash
cat supabase/migrations/*.sql > supabase/schema.sql
```

---

---

## Making it yours

Everything below is configuration, not code.

| What | Where |
| --- | --- |
| Business name, tax rate, e-Transfer email, order prefix | `/admin/settings` |
| Delivery zones and postal-code rules | `/admin/delivery` |
| Entry-gate wording and acknowledgements | `/admin/settings` |
| Catalog | `/admin/products`, or replace `supabase/seed.sql` |
| Colours and type | The token block at the top of `src/app/globals.css` |
| Email wording | `src/lib/email.ts` |

The palette is a paper-and-ink base with one evergreen for affirmative actions
and one amber reserved exclusively for money that has not arrived yet — so
"awaiting e-Transfer" is legible at a glance anywhere in the dashboard. Both
light and dark modes are defined; the toggle is in both headers.

---

## Documentation

| Document | Read it when |
| --- | --- |
| **[docs/USER-MANUAL.md](docs/USER-MANUAL.md)** | You are running the store — taking payments, adding products, managing stock. Written for staff, no technical knowledge assumed. |
| **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** | The pre-launch checklist, and what to verify after deploying. |
| **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** | You are changing the code. Explains why totals are computed in Postgres and where the security boundary sits. |
| **[VERSION-2.0.md](VERSION-2.0.md)** | You want to know what 2.0 changed and why — the USDC design, the discount, marketing consent, and what was verified. |

---

## How it works

The design decisions that matter — why totals are computed in Postgres, how the
two stock counters interact, why the ledger is immutable, and where the real
security boundary sits — are written up in
**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**. Worth ten minutes before you
extend anything.

## Layout

```
src/
  app/
    page.tsx                    storefront
    (shop)/                     storefront + tracking, behind the entry gate
    admin/                      back office, session + role gated
    api/                        checkout, delivery quote, lookup, CSV export
  components/
    storefront/                 catalog, cart, the order rail
    admin/                      dashboard, orders, inventory, delivery
    ui/                         shared primitives
  lib/
    actions/                    server actions, all role-checked
    queries/                    server-side reads
    supabase/                   browser, server, and service-role clients
    validation.ts               Zod schemas, shared browser and server
    format.ts                   money and dates; cents in, strings out
    pricing.ts                  one copy of the order maths, shared by checkout
    solana.ts                   address validation; no keys, no network
    fx.ts                       CAD/USDC rate, fetched daily and cached
supabase/
  migrations/                   25 migrations, in order
  schema.sql                    all of them concatenated, for one-paste setup
  seed.sql                      sample catalog and delivery zones
```

## Scripts (local only)

```bash
npm run dev         npm run build       npm start
npm run typecheck   npm run lint        npm run format
npm run db:reset    npm run db:types    # regenerate types from the live schema
```

---

## The entry gate

Visitors confirm a set of acknowledgements before they can use the shop. What
those say is a dashboard edit, not a deploy: **/admin/settings → Before customers
can order**.

Three things are worth knowing about how it behaves.

**It is enforced where it counts.** The dialog blocks the page — the shop behind
it is marked `inert`, so it is unreachable by pointer, keyboard, and screen
reader — but a blocked dialog is a UX affordance, not a control. The real
enforcement is in `place_order()`, which refuses to write an order unless every
currently-required acknowledgement was confirmed. Someone who deletes the
overlay in devtools gets a catalog they cannot check out of.

**Consent is recorded, not just checked.** Each order stores a snapshot of the
exact wording that was in force when it was placed. Editing an acknowledgement
later does not rewrite history — an order from March still shows what March's
customers actually agreed to.

**Changing the wording re-prompts everyone, automatically.** The gate's version
is a hash of its required acknowledgements rather than a number someone has to
remember to increment. Edit a required one and every visitor confirms again on
their next page load. Edit an optional one, or fix a typo in the heading, and
nobody is bothered.

The acceptance cookie is `httpOnly` and HMAC-signed with `GATE_SECRET`, so page
scripts cannot read it and a hand-edited one is rejected rather than believed.

### The wording shipped in the migration is a placeholder

Migration `0010` seeds four acknowledgements — age of majority, delivery-only,
payment timing, and an optional marketing box — so the feature is demonstrable
out of the box. Later migrations reword two of them: the payment one covers both
e-Transfer and USDC, and the marketing one describes what it actually controls
now that buying something is itself a basis to email someone. **They are not legal advice and were not written for
your jurisdiction or your products.** Replace them with wording your own counsel
is comfortable with before you take a real order. If you are selling something
age-restricted, the age acknowledgement in particular is a starting point for
that conversation, not a substitute for it.


---

## Turning on USDC payments (optional)

Interac e-Transfer works out of the box. USDC is off until you do this.

**You will never enter a seed phrase or a private key. Futurelite does not have
anywhere to put one, and does not need one.**

1. **Generate addresses on your phone.** In your Solana wallet app, create the
   receiving addresses you want to use and copy the *public* addresses. Start
   with five while you are testing.

   These are addresses within your single wallet, not separate wallets. Every
   payment lands in that one wallet; the address only records which order it
   came from.

2. **Paste them in.** Admin → Payments → Add payment addresses, one per line.
   Every line is checked before anything is saved; if any line is wrong,
   nothing is added.

3. **Fetch the exchange rate.** Admin → Payments → Refresh now. After this it
   updates itself daily via Vercel Cron.

4. **Send a test payment.** Place a small order yourself, pay it, and confirm it
   from Admin → Payments. Do this before switching USDC on for customers — a
   USDC transfer to a wrong address cannot be recovered.

5. **Switch it on.** Tick "Offer USDC at checkout" and save.

**Optional: a discount for paying that way.** Under **Coupons** there is a
*Crypto payment discount* panel — a percentage off that applies itself when a
customer picks USDC, with no code to enter. It comes off the goods total before
tax, so the customer saves slightly more than the headline percentage. The panel
shows a worked example, including what you give up per order.

### Day to day

When a USDC order comes in, it appears under **Waiting on payment** with the
address and the exact amount. Check that address in your wallet, then click
**Confirm** and enter what actually arrived. Short by a cent or less counts as
paid; more than that is recorded as part paid and the order stays on hold.

### Adding more addresses

The pool is finite. You will see a warning when it runs low, and if it empties,
USDC quietly stops being offered and customers see Interac e-Transfer only —
checkout never breaks. Paste in more whenever you like.
