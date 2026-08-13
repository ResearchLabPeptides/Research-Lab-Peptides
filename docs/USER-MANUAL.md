# User Manual

How to run the store day to day. Written for the people using it, not for
developers — you never need to touch code or open the Supabase dashboard.

If you are setting the system up for the first time, do the
[README](../README.md) first. This manual assumes it is already running and you
have an account.

---

## Contents

1. [Who can do what](#who-can-do-what)
2. [Signing in](#signing-in)
3. [The daily routine](#the-daily-routine)
4. [Taking payment](#taking-payment)
5. [Moving an order along](#moving-an-order-along)
6. [Cancelling and refunding](#cancelling-and-refunding)
7. [How customers check their own order](#how-customers-check-their-own-order)
8. [Adding a product](#adding-a-product)
9. [Importing a catalog from a spreadsheet](#importing-a-catalog-from-a-spreadsheet)
10. [Product photos](#product-photos)
11. [Editing, hiding, and deleting products](#editing-hiding-and-deleting-products)
12. [Stock: receiving, damage, and counts](#stock-receiving-damage-and-counts)
13. [Alerts](#alerts)
14. [Shipping charges and free shipping](#shipping-charges-and-free-shipping)
15. [Coupon codes](#coupon-codes)
16. [Branding: colours and fonts](#branding-colours-and-fonts)
17. [Editing the words on your site](#editing-the-words-on-your-site)
18. [Store settings](#store-settings)
19. [The entry gate](#the-entry-gate)
20. [Customer emails](#customer-emails)
21. [Customers and the mailing list](#customers-and-the-mailing-list)
22. [Reports](#reports)
23. [Adding and removing staff](#adding-and-removing-staff)
24. [Answering customer questions](#answering-customer-questions)
25. [When something looks wrong](#when-something-looks-wrong)

---

## Who can do what

There are four roles. Each one includes everything the role below it can do.

| | Read only | Employee | Manager | Administrator |
| --- | :---: | :---: | :---: | :---: |
| See dashboard, orders, inventory | ✅ | ✅ | ✅ | ✅ |
| Record payments | | ✅ | ✅ | ✅ |
| Change order status | | ✅ | ✅ | ✅ |
| Adjust stock counts | | ✅ | ✅ | ✅ |
| Write notes customers can see | | ✅ | ✅ | ✅ |
| Add and edit products | | | ✅ | ✅ |
| Import a spreadsheet | | | ✅ | ✅ |
| Upload product photos | | | ✅ | ✅ |
| Delivery zones and fees | | | ✅ | ✅ |
| Shipping charges and free-shipping rules | | | ✅ | ✅ |
| Create and pause coupon codes | | | ✅ | ✅ |
| Store settings and tax rate | | | | ✅ |
| Colours and fonts | | | | ✅ |
| Site wording and pages | | | | ✅ |
| Customer email wording | | | | ✅ |
| Mailing list opt-outs | | | ✅ | ✅ |
| Entry-gate wording | | | | ✅ |
| Activity log | | | | ✅ |

Menu items you cannot use are hidden. If you think you are missing something,
ask an administrator to check your role.

> Hiding a button is only the polite half. The database checks your role again
> on every action, so nothing can be forced through by fiddling with the page.

---

## Signing in

Go to **yoursite.com/admin**. Enter your work email and password.

There is no self-signup — an administrator creates your account for you.

**Customers never sign in.** They order without an account and check their order
with an order number and email. If a customer asks for a login, there isn't one,
and that's deliberate.

Use the moon/sun button in the top right to switch between light and dark mode.
It remembers your choice.

---

## The daily routine

Most days look like this.

**Morning**

1. Open the **Dashboard**. The tiles across the top tell you where the day
   stands.
2. Look at **Awaiting payment** (the amber tile). Those orders are being held
   but nothing has been packed.
3. Check your Interac e-Transfer inbox and
   [record anything that arrived](#taking-payment).
4. Read **Needs attention** on the right — anything low, out of stock, or
   expiring.

**Through the day**

5. Orders you have marked paid appear as **Preparing**. Pack them.
6. When a driver leaves, set those orders to **Out for delivery**.
7. When a delivery is done, set it to **Delivered**.

**End of day**

8. Record any stock that came in from suppliers.
9. Glance at **Sales today** and **Orders today** on the dashboard.

---

## Taking payment

This is the most important job in the system, because payment is what actually
releases stock and starts an order.

Customers pay by Interac e-Transfer and put their order number in the message
field. Your job is to match the transfer to the order.

**To record a payment:**

1. Go to **Orders**.
2. Search for the order. The search box takes an **order number, name, email, or
   phone number** — whatever the customer or the transfer gives you.
3. Open the order and check the amount matches.
4. In **Record an e-Transfer** on the right, the amount is already filled in with
   the balance owing. Change it only if a different amount arrived.
5. Put the e-Transfer confirmation number in **Reference**. This is how you prove
   later which transfer paid which order — it's worth the ten seconds.
6. Press **Confirm payment**.

**What happens the moment you press it:**

- Stock comes off the shelf permanently.
- The order moves to **Preparing**.
- The customer gets an email.

**If the amount is short**, record what actually arrived. The order stays in
Pending payment, shows a balance owing, and you can record the rest later. It
does not move to Preparing until it is paid in full.

**If a customer overpays or sends a tip**, record the extra amount. It will not
push a delivered order backwards.

> ### Before you press Confirm
> Make sure the money is really in your account. Confirming a payment takes
> stock off the shelf. There is no undo — you would have to cancel the order to
> put it back.

---

## Moving an order along

Open any order and use **Update status** on the right.

| Status | What it means |
| --- | --- |
| Pending payment | Waiting on the e-Transfer. Stock is held, not deducted. |
| Payment received | Money in, not started yet. |
| Preparing | Being packed. Set automatically when payment is confirmed. |
| Out for delivery | On the road. |
| Delivered | Done. |
| Cancelled | Called off. Stock goes back. |
| Refunded | Money returned. Stock goes back. |

**Every status change emails the customer**, so keep it accurate.

The **Note to the customer** box is included in that email. Use it for anything
they'd want to know: *"Running about 20 minutes behind — sorry about that."*

**Customer-facing note** (the panel below) is different: it sits on the
customer's tracking page permanently and does not send an email. Use it for
standing information like *"Left with the building concierge."*

---

## Cancelling and refunding

Both put every item back into stock automatically. You do not adjust stock by
hand afterwards — doing so would double-count it.

1. Open the order.
2. Set the status to **Cancelled** or **Refunded**.
3. Write a note explaining why. The customer sees it.

**Which to use:** Cancelled is for an order that was never paid, or was paid and
you're returning the money outside the system. Refunded records that money went
back. Either way, send the customer's money back yourself by e-Transfer — the
system does not move money.

---

## How customers check their own order

Customers have no account and no password, so this is the only way they see
their own order — and it is the thing you will be asked about most.

### What they do

1. Go to **your site → Track an order** (top right of the shop).
2. Enter their **order number** and the **email they ordered with**.

Both have to match. The order number on its own is not enough.

They then see the status, a progress trail, everything they ordered with the
full totals, the delivery address, and any customer-facing note you have
written. If they have not paid yet, the e-Transfer instructions appear again —
amount, your payment email, and the order number to put in the message.

There is also a shortcut: straight after checkout, a **Track this order** button
takes them there with the email already filled in.

### Helping someone who is stuck

**They have lost the order number.** Search their email or phone number in
**Orders** and read it to them. It is on their confirmation screen and in their
email too.

**They say it will not find their order.** Nine times out of ten the email is
the problem — they ordered with a work address and are typing their personal
one, or there is a typo. Open the order in **Orders** and check the email on
file, then tell them exactly which one to use.

**The message says "No order matches that order number and email."** That is the
only failure message there is, and it appears for a wrong email *and* for an
order number that does not exist. It is deliberately vague: the page needs no
login, so telling people which half was wrong would let a stranger fish for
valid order numbers. It does mean you cannot tell from the message alone which
one they got wrong — look the order up yourself.

### What they cannot see

The page shows one order and only what is on it. Your cost prices, your internal
notes, stock levels, and every other customer's order are not part of what gets
sent to their browser.

The **customer-facing note** on an order is the exception — that is written for
them and appears on this page. Keep internal remarks in the internal notes
field instead.

---

## Adding a product

**Inventory → New product.** Only three fields are required: **name**,
**selling price**, and **SKU**.

**What it is**

- **Product name** — what customers see.
- **Description** — shows under the name on the shop page. About three lines
  fit. Say what it is and why someone would want it.
- **Category** — groups it in the shop filters. Pick *Add a new category…* to
  create one on the spot.
- **Supplier** — who you buy it from. Also has an *Add a new supplier…* option.

**Price**

- **Selling price** — what customers pay.
- **"Was" price** — leave blank unless it's on sale. Fill it in and the shop
  shows the old price crossed out with a Sale badge. It must be higher than the
  selling price.
- **Your cost** — never shown to customers. Used for inventory value and the
  margin figure under the boxes.
- **Unit** — *each*, *bag*, *loaf*, *lb*, *dozen*. Appears as "per bag" on the
  shop.

**Stock**

- **Opening count** — how many you have right now. Recorded as a delivery so the
  history is right from the start.
- **Low-stock threshold** — you get an alert at this number. Leave 0 to use the
  store default from Settings.
- **Expiry date** — leave blank for anything that doesn't expire.

**Visibility** (right-hand side)

- **Status** — *Active* means customers can buy it.
- **Featured** — pushes it to the top of the shop page.
- **Mark as new** — puts a New badge on it.
- **Tags** — comma separated. Customers can search these, so *local, gluten-free*
  is worth adding.

**Identifiers**

- **SKU** — your own code. **Leave it blank** and one is made from the product
name. Must be unique if you do fill it in.
- **Web address** — fills in from the name. Leave it alone unless you have a
  reason.

Press **Create product**. You'll land on its page, where you add photos.

> ### Only the name is required, and new products start hidden
> Everything else can wait. A new product saves as **Inactive**, so it will not
> appear on the shop at $0.00 while you are still filling it in. Set the status
> to **Active** when it is ready. The same is true of imported products.

---

## Importing a catalog from a spreadsheet

**Inventory → Import spreadsheet.** Manager or administrator.

If you already have your products in a spreadsheet — from a supplier, an old
till system, or one you typed yourself — this brings them in at once instead of
one at a time.

### What your file needs

**A column of product names. That is the only requirement.** Everything else is
optional and can be filled in afterwards in the product editor.

Save it as **CSV** — in Excel or Google Sheets that is
**File → Download → CSV**. Or press **Download a template** on the import
screen to start from a working file.

### The columns

Put the column names in the first row. Capitals and spaces do not matter, and
several common spellings are recognised for each — so an export from another
system usually needs no editing at all.

| Column | What it is | Also accepts |
| --- | --- | --- |
| **name** | The product name. **Required.** | product, product name, item, item name, title |
| sku | Your own code. Made up from the name if blank. | code, item code, product code, item number, part number, id |
| barcode | Scannable code | upc, ean, gtin, scan code |
| description | Shown under the name on the shop | details, long description, about |
| category | Created if it does not exist yet | dept, department, group, type, section, aisle |
| supplier | Created if it does not exist yet | vendor, distributor, supplier name |
| manufacturer | The brand behind it | brand, maker, producer |
| unit | each, bag, loaf, lb… defaults to *each* | uom, unit of measure, size, pack size |
| price | What customers pay | sell price, selling price, retail, retail price, unit price, msrp |
| cost | What you pay. Never shown to customers. | cost price, wholesale, wholesale price, buy price, unit cost |
| compare_at | The "was" price, for sale items | was price, regular price, list price, rrp, original price |
| quantity | Opening stock count | qty, stock, on hand, stock on hand, soh, count, inventory |
| min_quantity | Low-stock alert threshold | min, reorder point, reorder level, low stock, min stock |
| tags | Words customers can search | labels, keywords |

Anything the importer guesses wrong you can correct on screen before importing,
and any column it does not recognise is simply ignored.

### A file that works

```
name,sku,category,supplier,unit,price,cost,quantity,min_quantity,barcode,description,tags
Ambrosia Apples 2 lb,PRD-1001,Produce,Fraser Valley Growers,bag,5.49,2.80,140,20,0627843001001,"Crisp, low-acid, grown in Cawston.","fresh;local"
Sourdough Loaf,,Bakery,Boundary Bay Bakehouse,loaf,6.99,2.90,42,10,,48-hour ferment.,bakery
Olive Oil 750 ml,PRD-4001,Pantry,,bottle,22.99,11.80,74,10,,"Single estate, harvested last November.",pantry
```

Note the second row has no SKU and no barcode — blank cells are fine. Leave the
commas in place so the remaining values stay in their columns.

### And the smallest file that works

```
name
Kalamata Olives 320 g
Rye Crackers
Marinated Artichokes
```

Three products, listed. Prices, photos, and stock counts get added afterwards
in the product editor.

### How values are read

**Prices** are forgiving. `$12.99`, `12.99`, `1,234.56`, and even `12,99` all
work. Anything unreadable is flagged in the preview rather than quietly
becoming zero.

**Tags** separate on commas, semicolons, or pipes. Because a comma also
separates columns, wrap the whole cell in quotes: `"fresh;local"` or
`"fresh, local"`.

**Text containing a comma** — most descriptions — must be wrapped in quotes.
Excel and Google Sheets do this for you automatically when they export.

**Quantities** must be whole numbers. Decimals are rounded.

### The four steps
### The four steps

1. **Drop the file in** or choose it.
2. **Check the column matching.** It guesses from your headers, and copes with
   the usual variations — "Item Code", "Retail Price", "Qty On Hand", "Dept".
   Anything that landed in the wrong field, correct with the dropdowns.
3. **Read the preview.** It shows the first dozen rows exactly as they will be
   imported, with a count of how many are ready and how many will be skipped.
   Prices are shown as money so you can see at a glance whether they were read
   properly.
4. **Import.**

### Things worth knowing

**Nothing is written until you press Import.** The preview is just a reading of
your file.

**All or nothing.** If anything fails, the whole import rolls back and your
catalog is left exactly as it was. You will never end up half imported.

**Rows without a name are skipped, not fatal.** They are counted and listed;
everything else still comes in.

**Missing SKUs are generated** from the product name. That also means
**importing the same file twice updates your catalog rather than duplicating
it** — a useful safety net, since importing twice by accident is easy.

**Existing products** are matched on SKU. You choose whether they get updated
from the file or left alone. Updating only touches columns your file actually
has, so descriptions and photos you added by hand are not wiped by a
price-only spreadsheet.

**Stock counts come in as a receipt.** An opening count on a new product is
recorded as a stock movement with the reason "Imported from spreadsheet", so
your ledger explains where it came from. Existing products never have their
counts changed by an import — use **Adjust** for that.

**Prices are read forgivingly.** `$12.99`, `12.99`, `1,234.56`, and `12,99` all
work. Anything unreadable is flagged in the preview rather than silently
becoming zero.

**Up to 2000 products per file.** Split a bigger one and run it twice.

### After importing

Imported products are live on the shop straight away. Two things to do next:

- **Check the prices.** Anything without a price column comes in at $0.00.
- **Add photos.** Products without one show a generated tile with their
  initials — never broken, but a real photo sells better.

---

## Product photos

Photos are added after the product exists, on its edit page.

1. Open the product from **Inventory**.
2. In the **Photos** box, drag image files in, or press **Choose files**.
3. The first photo becomes the **main image** — the one customers see in the shop
   grid.

**To change which photo is the main one**, press **Make main** under a different
photo. **To delete one**, press the bin icon.

**What works:** JPEG, PNG, WebP, or AVIF, up to 5 MB each. **Square photos look
best**, because the shop grid crops everything to a square. A photo that is much
wider than it is tall will get its top and bottom cut off.

A product with no photo still works — the shop shows a coloured tile with its
initials, so nothing ever looks broken. But a real photo sells better.

---

## Editing, hiding, and deleting products

Open any product from **Inventory** by clicking its name.

Change what you need and press **Save changes**. Updates appear on the shop
straight away.

**You cannot change the stock count here.** That's on purpose — see
[Stock](#stock-receiving-damage-and-counts). The current count is shown for
reference.

### Changing several at once

Every row in **Inventory** has a tick box, and the header box selects everything
currently shown. Tick what you want, choose a status, and press **Apply**.

Useful for seasonal lines, a supplier you have stopped carrying, or bringing a
whole category back at the start of a season.

> **Select all means everything on screen, not the whole catalog.** Search for
> "bread" first and the header box ticks only those rows — the bar tells you how
> many are selected and which search they came from. Clear the search first if
> you really do mean all of them.

Hiding products in bulk is safe: orders already placed keep their own copy of
the name and price, and stock held for unpaid orders stays held.

**To take something off the shop:**

- **Archive** (button at the bottom) — hides it from customers, keeps everything.
  Press **Restore to the shop** to bring it back. **This is almost always what
  you want.**
- Or set **Status** to *Inactive* (hidden, coming back) or *Discontinued* (not
  coming back).

**Deleting** is the bin icon, behind a confirmation. It removes the product and
its stock history for good. Past orders still show what was bought, at the price
that was paid — that information is stored on the order itself.

The system refuses to delete a product that is being held for an unpaid order.
Deal with those orders first, or archive instead.

---

## Stock: receiving, damage, and counts

Every change to a stock count is recorded with who did it, when, and why. You
cannot simply type a new number over the old one, and that is the point — six
months from now, "why do we have 14 of these?" has an answer.

**To change a count:** go to **Inventory**, find the product, press **Adjust**.

Pick what happened:

| Choose | When |
| --- | --- |
| Received from supplier | A delivery arrived |
| Customer return | Something came back in sellable condition |
| Correction | The count was simply wrong |
| Cycle count | You counted the shelf and it differs |
| Damaged | Broken, dropped, unsellable |
| Expired | Past its date, thrown out |
| Transferred out | Moved somewhere else |

Enter the quantity, write a real reason, and press **Record movement**. The box
shows you the before-and-after before you commit.

For *Correction* and *Cycle count*, use a **negative number to remove** stock.
For the others, just enter how many — the system knows which direction it goes.

**Write reasons a stranger could understand.** "Delivery from Pacific Dry Goods,
invoice 4417" is useful. "fix" is not.

### What "held" means

The Inventory table has three stock columns:

- **On hand** — physically on the shelf.
- **Held** — spoken for by orders that haven't been paid yet.
- **Available** — what customers can still buy. This is On hand minus Held.

Held stock is still on your shelf. It converts to a real sale when you confirm
payment, or goes back to available if the order is cancelled.

---

## Alerts

The dashboard's **Needs attention** panel raises four kinds of alert:

- **Out of stock** — nothing left.
- **Low stock** — at or below the threshold.
- **Expiring** — within the warning window set in Settings.
- **Expired** — past its date. Pull it off the shelf and record it as *Expired*.

Alerts clear themselves when the situation is fixed. Restock something and its
low-stock alert disappears.

---

## Shipping charges and free shipping

**Shipping** in the menu. Manager or administrator.

### The base charge

Everyone pays this unless a rule below reduces it.

- **Shipping fee** — the standard charge.
- **Minimum order** — below this, checkout is blocked. Use `0.00` for no minimum.
- **Fastest / slowest estimate** — the arrival window customers see.
- **Only deliver to the postal codes listed below** — leave this off and you
  deliver anywhere at the flat rate. Turn it on and anything unlisted is refused
  at checkout.

### Free and discounted delivery

This is where you reward bigger orders. Press **Add rule** and answer three
questions.

**When does this apply?**

| Option | Meaning |
| --- | --- |
| Every order | Always on — use it to run a sale on delivery |
| Order has at least this many items | Counts total units, not distinct products |
| Order subtotal is at least | Before delivery and tax |

**What happens?**

| Option | Meaning |
| --- | --- |
| Delivery is free | Fee drops to zero |
| Charge this flat amount instead | Replaces the fee, e.g. $2.00 |
| Take this much off the fee | e.g. $3.00 off |
| Take this percentage off the fee | e.g. 50 for half price |

**What the customer sees** — write it as a sentence, because it is shown to them
on the order ticket the moment the rule kicks in. *"Free shipping on 5 items or
more"* is right. *"promo3"* is not.

Before you save, the box shows you the rule in plain English. Read that line
back to yourself — it is the fastest way to catch a rule that says something
other than what you meant.

### Worked example

You want: normal delivery $6, half price from 3 items, free from 5.

1. Set the base **Shipping fee** to `6.00` and save.
2. Add a rule → *Order has at least this many items* → `3` → *Take this
   percentage off the fee* → `50` → label it "Half price delivery on 3 items or
   more".
3. Add a rule → *Order has at least this many items* → `5` → *Delivery is free*
   → label it "Free shipping on 5 items or more".

Customers now pay $6.00 for one or two items, $3.00 for three or four, and
nothing from five up.

> ### If two rules both match, the customer gets the cheapest
> Rules do not fight each other and order does not matter. Someone who qualifies
> for both a half-price rule and a free rule gets it free. This is deliberate —
> adding a generous promotion can never accidentally make delivery *dearer* for
> a customer who also qualifies for an older rule.
>
> A discount also never pushes the fee below zero. You will not end up paying
> someone to take a delivery.

### Where you deliver

This section appears only when it decides something — when you have turned on
the area restriction, or when you are running priced zones.

Add a postal code or city with **Add a postal code or city**:

- **Postal code starts with** — the first three characters, like `V3S`. This is
  the usual choice and covers a whole neighbourhood.
- **Exact postal code** — one specific code.
- **City name** — a whole city.

Changes apply to the very next order. Nothing needs to be deployed.

> A postal code can only belong to one zone. If it were in two, the price would
> be ambiguous, so adding a duplicate is refused.

---

## Coupon codes

**Coupons** in the menu. Manager or administrator.

Customers type a code on the order ticket before they check out, and the
discount appears in the totals straight away.

### Creating one

Press **New coupon** and answer four things.

**Code** — what the customer types. Case and spacing are forgiven, so `welcome
10` and `WELCOME10` reach the same coupon. Keep it short and easy to read aloud
over the phone.

**What it does:**

| Option | Use it for |
| --- | --- |
| Percentage off the items | "10% off your first order" |
| Fixed amount off the items | "$5 off" |
| Free shipping | Waives the shipping charge only |

**Limits** — all optional, and they stack:

| Field | Effect |
| --- | --- |
| Most it can take off | Caps a percentage. A 25% code on a $400 order costs you $100 without one. |
| Minimum order | Below this, the code is refused with a message saying the minimum. |
| Total uses | The code stops working once this many orders have used it. |
| Uses per customer | Matched on email address. Set to 1 for a one-per-person offer. |
| Last day it works | The code works all of that day and stops at midnight. |

**Internal note** is staff-only — customers never see it. Use it to record which
flyer or campaign a code belongs to.

Before you save, the box shows the rule in plain English. Read that line back to
yourself.

### Watching them

Each coupon shows its live state and how it is doing:

| State | Meaning |
| --- | --- |
| Live | Working now |
| Scheduled | Set up, not started yet |
| Paused | Switched off by you |
| Expired | Past its end date |
| Fully redeemed | Hit its total-uses limit |

Under the code you get the number used, how many are left, and how much money
the coupon has given away in total.

### Stopping one

**Pause** is the right answer almost always. The code stops working immediately
and the history survives, so next quarter you can still answer "what did that
promotion cost us". Press **Resume** to switch it back on.

**Delete** is only offered for codes nobody has used. Once a coupon has been
redeemed the system refuses to delete it and tells you to pause it instead —
deleting would take the redemption records with it and quietly rewrite your
numbers.

> ### Two things that protect you
> **A coupon can never pay a customer.** A discount larger than the order is
> capped at the order. A $50 code on a $30 basket takes off $30, not $50.
>
> **The last use can't be spent twice.** If a code has one use left and two
> people check out at the same instant, exactly one gets it. The other is told
> the code has been fully redeemed before their order is created.

### How it works with free shipping

Delivery rules and coupons are separate systems and they do not fight. If
someone already has free shipping from a "5 items or more" rule and then enters
a free-delivery coupon, the delivery stays free — it is not discounted twice,
and the total never goes negative.

---

## Branding: colours and fonts

**Branding** in the menu. Administrators only.

This is how one installation becomes *your* shop — or a different shop for each
client, if you resell it.

**Colours.** Six of them, set with a colour picker or by typing a hex code
straight in (`#0F7B5A`). There is a separate set for light mode and dark mode,
because a colour that reads well on white rarely reads well on near-black.

| Colour | Where it shows |
| --- | --- |
| Page background | Behind everything |
| Card background | Product blocks, panels, the order ticket |
| Text | All body text |
| Primary | Buttons, links, prices, anything you want people to click |
| Awaiting payment | Reserved for money that has not arrived yet |
| Borders | Dividing lines and outlines |

**Fonts.** Three choices — headings, body text, and numbers. Order numbers and
prices use the third one, so pick something with even digit widths for it.

**Roundness** controls how rounded corners are, from sharp square to fully
rounded.

Changes apply to the storefront *and* the back office, so you can see exactly
what customers see.

> ### Two things worth knowing
> **Check the contrast.** Pale grey text on a white background is legal to save
> and hard to read. Look at the preview before you commit.
>
> **The "awaiting payment" colour earns its keep.** It is used for one thing
> only — money that has not arrived. Keeping it distinct is what lets you scan
> the dashboard and spot unpaid orders instantly. Setting it to the same colour
> as everything else will cost you that.

---

## Editing the words on your site

**Content** in the menu. Administrators only.

### Wording

Short strings — the home page headline, section headings, button labels, empty
states.

**Nothing goes live until you press Save.** A **Preview** panel at the top shows
your changes as you type, and a badge tells you whether what you are looking at
matches the live site or is still unsaved. Customers keep seeing the old wording
the whole time you are working, so nobody browses the shop through a
half-rewritten headline.

Edit as many fields as you like and press **Save wording** once. The footer
counts the pending changes, and **Undo** appears next to anything you have
touched.

Clear a field completely and the built-in wording comes back, so you cannot
accidentally ship a blank heading.

### Pages

Full pages: About, FAQ, delivery information, terms — whatever you need.

1. **New page**, give it a title. The web address fills in automatically.
2. Write the content. Select some text and use the toolbar for **bold**,
   *italic*, headings, lists, quotes, and links — you do not need to know any
   syntax.
3. **Preview** shows exactly how it will look.
4. Tick **Published** to make it live, and **Show in the footer menu** to add a
   link on every storefront page.

**Menu order** controls the order of those footer links, lowest first.

**Search listing** is the grey description under your title in Google results.
Around 150 characters.

> Pages are written in a simple formatting language, not raw HTML. If you paste
> in HTML or a script, it appears on the page as plain text and does nothing.
> That is intentional — it means a page can never break the site or be used to
> attack a visitor.

---

## Store settings

**Settings** in the menu. Administrators only.

- **Business name** — appears throughout the site and in emails.
- **Tax rate** — applied to items *and* delivery.
- **Interac e-Transfer email** — where customers send money. **Get this right.**
  Send yourself a $1 transfer to confirm it arrives before going live.
- **Shipping team email**, **Support phone**.
- **Order number prefix** — the `ORD` in `ORD-2026-000001`. Changing it only
  affects new orders; existing numbers stay as they are.
- **Default low-stock threshold** — used for products that don't set their own.
- **Expiry warning days** — how far ahead to warn.

---

## The entry gate

The gate is the panel visitors see before they can use the shop, confirming
things like being of age, that you deliver only, and that payment is by
e-Transfer.

**Settings → Entry gate.** Administrators only.

### Every word is yours

Nothing on the gate is fixed in code. The main fields are:

| Field | Where it shows |
| --- | --- |
| Heading | The title at the top |
| Introduction | The sentence under it |
| Confirm button | The button that lets them in |
| Leave link | The way out for anyone who won't confirm |
| Where the leave link goes | The site they're sent to instead |

Open **The smaller wording** for the rest — the phrase under the button while
boxes are still unticked, the one once everything is ticked, the tag beside
optional items, the button's label while it saves, and the default text for a
"read more" link.

In the "while boxes are unticked" field, `{n}` is replaced with how many are
still outstanding. So *"{n} left to confirm"* shows as *"2 left to confirm"*. If
you'd rather not show a count, write a sentence without `{n}` and it appears
as-is.

### The acknowledgements themselves

Each one has the sentence they tick, optional supporting detail underneath, and
an optional link — to your terms or delivery policy, say. Mark each as required
or optional:

- **Required** must be ticked before anyone can order.
- **Optional** is recorded but doesn't block them. A marketing opt-in is the
  usual case.

You can add, edit, reorder, and retire them.

> ### Changing wording re-prompts everyone
> Someone who agreed to the old text is asked again on their next visit, so what
> people have agreed to always matches what's currently on screen. Each order
> also stores the exact wording that was in force when it was placed, so you can
> always show what a specific customer agreed to.

**Say what you actually mean here.** This is the text you'd point at in a
dispute. The wording that ships is a placeholder — replace it before you go
live, and have someone qualified read it if it carries legal weight.

If you retire every acknowledgement, the gate stops appearing rather than
showing an empty box.

---

## Customer emails

**Emails** in the menu. Administrators only.

Five messages go out over the life of an order. You can rewrite any of them,
see exactly what arrives, or switch one off.

| Email | Sent when |
| --- | --- |
| Order received | The moment someone checks out. Carries the e-Transfer instructions, so this is the one that matters most. |
| Payment confirmed | You confirm the transfer arrived |
| On the way | You mark the order out for delivery |
| Delivered | You mark it delivered |
| Cancelled | You cancel or refund it |

### Editing one

Pick a message, change the subject or the wording, press **Save changes**. The
panel beside it shows what a customer receives, filled in with example order
details, and updates as you type.

**Inserting details.** The row of buttons under the message drops in things
like `{order_number}` or `{total}` at your cursor. You never have to remember
them or type the braces.

**Formatting.** Plain text. A blank line starts a new paragraph, a line in
CAPITALS becomes a small heading, and the tracking link becomes a button. There
is no HTML to get wrong.

> ### A typo in a detail is caught before it goes out
> If you write `{ordernumber}` instead of `{order_number}`, a warning appears
> telling you it is not something the email knows — because otherwise it would
> be sent to the customer exactly as written, braces and all.

**Switching one off** stops it sending without losing the wording. Useful if
you would rather phone people about cancellations, for instance.

### If emails are not arriving

Emails only send once an email provider is configured. Until then they are
written to the server log instead. **The on-screen payment instructions still
work**, so an order can be placed and paid without any email at all — customers
just do not get a copy. Ask whoever set the system up to add the provider key.

---

## Customers and the mailing list

**Customers** in the menu. Everyone can view it; managers can change who is on
the mailing list.

Anyone who places an order appears here **once**, however many times they order.
Matching is on email address and ignores capitals and stray spaces, so
`Priya@Example.com` and `priya@example.com` are one person, not two.

Each row shows how many orders they have placed, what they have spent, their
average order, when they last bought, and whether you may email them.

### Who you may actually email

| Badge | Meaning |
| --- | --- |
| Opted in | Ticked the marketing box on the entry gate. You may email them. |
| Not opted in | Has ordered, but never agreed to marketing. **Do not email them.** |
| Unsubscribed | Asked to be taken off. |

> ### Ordering is not consent
> Buying groceries is not the same as agreeing to receive advertising, and under
> Canada's anti-spam law that difference carries real penalties. Only people who
> ticked the optional box on the entry gate count as opted in.
>
> Two things follow from that, and both are deliberate:
>
> **Customers from before this list existed show as "not opted in"** — nobody
> who ordered back then agreed to anything, and assuming otherwise is how a
> business ends up sending unlawful mail.
>
> **Unsubscribing is permanent unless they ask.** Ordering again does not put
> someone back on the list, even if they tick the box.

### Getting the list out

Two downloads, and the difference matters:

- **Download mailing list** — only people who consented and have not
  unsubscribed. This is the file to hand to a newsletter tool.
- **Download everyone** — every customer, with their consent status as a
  column. For your own records, not for sending.

Both are also under **Reports → Customers**.

If your entry gate has no marketing box, nobody will ever be opted in. Add one
under **Settings → Entry gate** as an *optional* acknowledgement — required
would mean forcing consent to shop, which is not consent at all.

---

## Reports

**Reports** in the menu, or the buttons at the top of the Dashboard. Everyone
can reach these; what you get back is limited to what your role is allowed to
see.

### Getting one

1. Pick a **period** at the top — Today, Last 7 days, Last 30 days, This month,
   Last month, This year, or All time.
2. Find the report you want.
3. Press **Download CSV**.

The file lands in your downloads folder and opens in Excel, Numbers, or Google
Sheets.

Each card tells you **how many rows you would get** before you download, so you
never open an empty file wondering what went wrong. If a report has nothing in
it for that period, the button says *Nothing to download* instead.

### The shortcuts on the Dashboard

The two most-asked-for are one press from the Dashboard: **Orders, last 30
days** and **Stock on hand**. Everything else is behind **All reports**.

### What each one contains

**Sales**

| Report | What's in it |
| --- | --- |
| Orders | Every order — customer, address, zone, coupon, totals, status |
| Sales by day | One row per trading day: orders, subtotal, discounts, delivery, tax, revenue, and how much you've actually collected |
| Best sellers | Units sold and revenue per product, ranked |
| Shipping charges | Shipping fees collected by day and zone |

**Money in**

| Report | What's in it |
| --- | --- |
| Payments received | Every e-Transfer recorded, with amount, reference, and who confirmed it — this is the one to reconcile against your bank |
| Coupon performance | Each code with its state, times used, customers reached, and money given away |
| Coupon redemptions | Each individual use of a code, with the order it applied to |

**Inventory**

| Report | What's in it |
| --- | --- |
| Stock on hand | Every product with quantity, held stock, availability, and value at cost |
| Stock movements | The full ledger — every change to every count, with who and why. This is your audit trail |
| Stock alerts | Everything currently low, out of stock, expiring, or expired |

### Which ones ignore the period

Four are snapshots rather than history, and their cards say so:

- **Stock on hand** and **Stock alerts** describe right now.
- **Best sellers** is always the last 90 days.
- **Coupon performance** is lifetime totals per code.

Changing the period does not affect those four.

### Two practical notes

**Downloads are capped at 20,000 rows.** If a report is bigger, narrow the
period and take it in pieces.

**Reconciling the month.** *Payments received* for last month against your bank
statement is the fastest way to catch a transfer that arrived but never got
recorded — the order would still be sitting in Pending payment with the stock
held.

---

## Adding and removing staff

Staff accounts are created in the Supabase dashboard (**Authentication → Users →
Add user**, tick *Auto Confirm User*). New accounts start at **Read only** and
have to be promoted with a one-line SQL command — the README covers this.

To take someone's access away immediately, set them inactive:

```sql
update profiles set is_active = false where email = 'them@yourbusiness.ca';
```

They lose access on their next page load, and their name stays attached to
everything they did.

> This is the one job still not built into the app. There is no staff-management
> screen yet.

---

## Answering customer questions

**"Where's my order?"**
Send them to **your site → Track an order**. They need their order number and
the email they ordered with. Or search their name, email, or phone in **Orders**
and read them the status. See
[How customers check their own order](#how-customers-check-their-own-order).

**"I lost my order number."**
Search their email or phone in **Orders**.

**"I sent the e-Transfer, why isn't it moving?"**
Someone has to confirm it by hand. Check your e-Transfer inbox and record it.
If they sent it without the order number in the message, match it by name and
amount, then record the payment with a note explaining that.

**"Can I change my order?"**
There's no self-service editing. Either cancel and have them reorder, or take
the change over the phone and adjust the stock yourself with a note.

**"Do you deliver to me?"**
Have them type their postal code at checkout — it prices instantly. Or check the
zone rules under **Delivery**.

**"Can I pick it up?"**
No. The store is delivery only, and there is no pickup option anywhere.

**"Can I pay by card?"**
No. Interac e-Transfer only.

**"It says I've made too many orders."**
There is a limit on how many orders one person can place in a short time — five
in ten minutes — to stop automated junk. A real customer will almost never see
it. Take the order over the phone and enter it yourself, or ask them to wait a
few minutes.

**"My coupon code isn't working."**
Look it up under Coupons. The state tells you why: Expired, Fully redeemed,
Paused, or Scheduled. If it says Live, check whether the order meets the minimum
or whether that customer has already used it.

---

## When something looks wrong

**A customer says they can't check out.**
Usually one of three things: their postal code isn't in any shipping zone,
they're under that zone's minimum order, or an item sold out while they were
shopping. The message on their screen says which.

**An order is stuck in Pending payment.**
It's waiting for you to confirm the e-Transfer. Nothing happens automatically.

**Stock looks too low.**
Check the **Held** column. Those units are reserved for orders that haven't been
paid. They come back if those orders are cancelled.

**A product isn't showing on the shop.**
Check its **Status** is *Active*. Archived, inactive, and discontinued products
are all hidden from customers.

**A photo isn't appearing.**
Confirm it uploaded (it should show in the Photos box) and that one photo is
marked **Main image**.

**Customers aren't getting emails.**
Email needs a provider key configured. If it isn't set up, the on-screen payment
instructions still work — but nobody gets an email. Ask whoever set the system
up.

**A customer says the discount disappeared.**
Changing the basket re-checks the coupon. If they removed items and dropped
under the minimum, the code comes off with a message explaining why.

**I changed a colour and it looks wrong on the other mode.**
Light and dark are set separately under Branding. Switch modes with the
moon/sun button and check both.

**I changed a price and the shop still shows the old one.**
Give it a moment and reload. If it persists after a minute, tell whoever
maintains the site.

**I recorded a payment on the wrong order.**
Don't delete anything. Cancel that order (which returns its stock), record the
payment on the correct order, and write notes on both explaining what happened.
The trail matters more than tidiness.

---

## Pages and the shop menu

Pages you publish with **Show in the menu** ticked appear along the top of the
shop, beside *Track an order*, and in the footer. New pages have that ticked by
default.

Untick it for something you want to exist but not advertise — a returns policy
you link to from an email, say. Leave a page unpublished and only you can see it.

---

## Changing the wording on the shop

**Content** in the back office edits the short copy on the storefront. Two things
worth knowing:

**Leaving a field blank leaves it blank.** If you clear the tagline, no tagline
shows. That is deliberate — some shops do not want one — so the field will not
quietly refill itself with the original wording.

**To get the original wording back**, use *Reset to built-in wording*. That puts
the shipped text back in every field at once, so use it when you want a clean
slate rather than to undo one edit. To undo one edit before saving, use *Discard
changes*.

---

## Giving a discount for paying in USDC

Under **Coupons** there is a panel called *Crypto payment discount*. Switch it on,
set a percentage, and anyone who chooses USDC at checkout gets that much off
automatically. There is no code for them to enter, and the saving is shown next
to the payment option so they can see the reason to pick it.

A few things worth knowing:

- The discount comes off the goods total **before** tax, so the customer is not
  taxed on money they did not pay. Their saving is therefore slightly more than
  the percentage, because the tax comes down with it.
- **Most it can be worth** puts a ceiling on it, so a percentage cannot run away
  on an unusually large order. Leave it blank for no limit.
- **Allow both at once** decides what happens when someone also has a coupon
  code. Left off, the coupon wins and they do not get both. Turned on, they get
  both, which can add up to more than you intended — the worked example in the
  panel shows the effect on a $100 order.

If a customer chooses USDC, gets the discount, and then sends you an e-Transfer
instead, they have been priced on a promise they did not keep. Their order will
show as short paid. Remove the discount from the order before you chase them for
the difference, or the figures will not add up.

---

## Who you can email

Every customer who buys from you can be sent marketing email for **24 months**
from their most recent order, whether or not they ticked anything. Ordering
again restarts the clock, so a regular customer never drops off.

The optional box at the entry gate is still there and still means something: it
keeps someone on the list *after* they stop ordering. Without it, a customer who
has not bought in two years drops off automatically.

In the Customers screen each person shows why they can be emailed:

- **Opted in** — ticked the box. Stays on the list indefinitely.
- **Customer** — bought something. Shows the date they drop off.
- **Lapsed** — has not ordered inside the window. Not on the list.
- **Unsubscribed** — asked to be removed.

**Unsubscribing is permanent.** You cannot put someone back from the admin
panel, ordering again will not do it, and neither will ticking the box again.
That is deliberate: honouring an unsubscribe is the single hardest requirement
in Canadian anti-spam law, and the system will not let anyone undo one by
accident. If someone genuinely wants back on, they have to ask you and you would
need to record that separately.

The **Download mailing list** button only ever gives you people there is a live
basis to email. It is safe to hand straight to a newsletter tool, and it
includes the reason and date for each address so you can show your working if
you are ever asked.

Two things the software cannot do for you: every marketing email you send must
identify your business with a real mailing address, and every one must carry a
working unsubscribe link that you action within ten business days. Those live in
your email templates. This is a description of how the system behaves, not legal
advice — if you are sending at any volume, it is worth half an hour with someone
who knows CASL.

---

## Taking payment in USDC

This is optional. Interac e-Transfer works whether or not you ever switch this
on, and if you turn USDC off again, nothing else changes.

### What this actually is

USDC is a digital dollar. One USDC is meant to be worth one US dollar, and in
practice it stays very close. Customers who hold it send it from an app on
their phone, the same way they would send an e-Transfer from their banking app.

Your side of it works the same way e-Transfers already do: money arrives, you
look at it, you confirm it, the order moves on. Nothing is automatic and
nothing happens without you.

### Setting it up, once

**You will never type a seed phrase or a private key into Futurelite.** There is
nowhere to put one. If any instructions ever tell you to paste a seed phrase
into this system, or into a web page claiming to be this system, stop — that is
how wallets get emptied.

**1. Make some addresses on your phone.**
Open your Solana wallet app and create receiving addresses. Copy the public
address for each one. Make five to start with.

These are addresses in your one wallet, not separate wallets. Every payment
still arrives in the same place — the address just tells you which order it
belongs to. There is nothing to fund and nothing to move around afterwards.

**2. Paste them in.**
Go to **Payments** in the admin menu, find **Add payment addresses**, and paste
them one per line. Each line is checked as you type. If anything is wrong you
will be told which line and why, and nothing is saved until it is fixed.

**3. Get today's rate.**
Press **Refresh now** in the Exchange rate box. After this it updates on its own
each morning.

**4. Test it with your own money.**
Place a small order yourself, choose USDC, send the payment, and confirm it.
Do this before letting customers use it. A USDC payment sent to a wrong address
is gone permanently — there is no bank to call — so it is worth ten minutes to
prove the addresses are really yours.

**5. Turn it on.**
Tick **Offer USDC at checkout** and save.

### Every day

A USDC order shows up under **Waiting on payment** with the address and the
exact amount you should expect.

1. Look up that address in your wallet app.
2. When the USDC is there, click **Confirm**.
3. Type in the amount that actually arrived.

If it matches, the order moves to Payment received and carries on like any
other. If it is short by more than a cent, the order is marked part paid and
stays on hold — you can confirm again when the rest arrives.

### Adding more addresses

Each order uses up one address and never reuses it, so the pile shrinks. You
will see a warning when it gets low. If it ever runs out completely, USDC
quietly disappears from checkout and customers see Interac e-Transfer only —
your checkout keeps working, you just stop being offered the second option
until you paste in more.

### Questions customers ask

**"How much do I send?"**
The exact figure is on their order page. They should send that number, not the
Canadian dollar total.

**"The amount changed."**
Amounts hold for fifteen minutes. After that the page offers a **Refresh
amount** button. The address never changes — only the figure.

**"I sent the wrong amount."**
If they sent too little, confirm what arrived and the order sits as part paid
until they top it up. If they sent too much, confirm the full amount and sort
out the difference the way you would any overpayment.

**"I sent it to the wrong place."**
There is nothing anyone can do. This is worth saying kindly but plainly on the
phone — unlike a bank transfer, there is no reversal and no recovery.

**"Can I get a refund?"**
Decide this before you switch USDC on. Refunding means sending USDC back
yourself, by hand, from your wallet.

### If something looks wrong

**USDC is not showing at checkout.**
Check three things on the Payments screen: is it ticked on, is the exchange
rate recent, and are there addresses left. Any one of those being off hides it.

**The rate says it is too old.**
Press **Refresh now**. If that fails, the message will say why. Until it
refreshes, customers see Interac e-Transfer only — which is the safe outcome,
because quoting an amount from an out-of-date rate is worse than not quoting
one.

**A payment arrived that I cannot match to an order.**
Every address belongs to exactly one order. Search the address in the Payments
list to find which one.
