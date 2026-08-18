'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Loader2, Receipt, ShoppingBasket, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/field';
import { CHECKOUT_DETAILS_KEY } from '@/lib/constants';
import { cryptoDiscountCents, cryptoSavingCents, priceOrder } from '@/lib/pricing';
import { PaymentMethodPicker } from './payment-method-picker';
import type { PaymentMethod } from '@/lib/types';
import { formatMoney } from '@/lib/format';
import { PROVINCES, checkoutSchema, type CheckoutInput } from '@/lib/validation';
import type { PlacedOrder, PublicSettings } from '@/lib/types';
import { text, type ContentMap } from '@/lib/content';
import { cn } from '@/lib/utils';
import { useCart } from './cart-provider';
import { QuantityStepper } from './quantity-stepper';
import { useDeliveryQuote } from './use-delivery-quote';
import { CouponField, type AppliedCoupon } from './coupon-field';

type Mode = 'items' | 'checkout';

const BLANK: CheckoutInput = {
  name: '',
  email: '',
  phone: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  province: '',
  postalCode: '',
  deliveryNotes: '',
};

/**
 * The order ticket.
 *
 * There is no cart page in this application, so this panel has to do the whole
 * job: show the order, take the address, price the delivery, and submit. It is
 * a sticky rail on desktop and a bottom drawer on mobile, but it is the same
 * component and the same markup in both — one place for the whole flow.
 */
export function OrderRail({
  settings,
  content,
}: {
  settings: PublicSettings;
  content: ContentMap;
}) {
  const router = useRouter();
  const cart = useCart();
  const [mode, setMode] = React.useState<Mode>('items');
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<CheckoutInput>(BLANK);
  const [errors, setErrors] = React.useState<Partial<Record<keyof CheckoutInput, string>>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = React.useState(true);
  const [coupon, setCoupon] = React.useState<AppliedCoupon | null>(null);
  const [payMethod, setPayMethod] = React.useState<PaymentMethod>('interac');

  // Item count is passed too, so rules like "free shipping on 5 items or more"
  // can price correctly.
  const { quote, loading: quoteLoading } = useDeliveryQuote(
    form.postalCode,
    form.city,
    cart.subtotalCents,
    cart.itemCount,
  );

  // Returning customers should not retype their address every week.
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CHECKOUT_DETAILS_KEY);
      if (raw) setForm({ ...BLANK, ...(JSON.parse(raw) as Partial<CheckoutInput>) });
    } catch {
      /* storage unavailable; the form just starts empty */
    }
  }, []);

  const baseDeliveryCents = quote?.deliverable ? (quote.fee_cents ?? 0) : 0;

  // A coupon either takes money off the goods or waives the shipping charge.
  // Tax is then worked out on what the customer actually pays for both.
  const couponOnSubtotal =
    coupon && coupon.appliesTo === 'subtotal'
      ? Math.min(coupon.discountCents, cart.subtotalCents)
      : 0;
  const couponOnDelivery =
    coupon && coupon.appliesTo === 'delivery'
      ? Math.min(coupon.discountCents, baseDeliveryCents)
      : 0;

  const deliveryFeeCents = baseDeliveryCents - couponOnDelivery;
  // Priced through the shared module rather than inline, so this screen and the
  // database cannot drift apart on what an order costs.
  const discountSettings = {
    enabled: settings.crypto_discount_enabled,
    bps: settings.crypto_discount_bps,
    stacks: settings.crypto_discount_stacks,
    maxCents: settings.crypto_discount_max_cents,
  };

  const cryptoCents =
    payMethod === 'usdc_solana' && quote?.deliverable
      ? cryptoDiscountCents(cart.subtotalCents, couponOnSubtotal, discountSettings)
      : 0;

  const priced = priceOrder({
    subtotalCents: cart.subtotalCents,
    couponOnSubtotalCents: couponOnSubtotal,
    deliveryFeeCents,
    taxRateBps: settings.tax_rate_bps,
    cryptoCents,
  });

  const taxCents = quote?.deliverable ? priced.taxCents : 0;
  const totalCents = quote?.deliverable
    ? priced.totalCents
    : cart.subtotalCents - couponOnSubtotal + deliveryFeeCents;

  // What the customer would save by switching to USDC, priced both ways and
  // subtracted so the advertised figure is exactly the figure their total moves
  // by — never an approximation of it.
  const cryptoSaving = quote?.deliverable
    ? cryptoSavingCents({
        subtotalCents: cart.subtotalCents,
        couponOnSubtotalCents: couponOnSubtotal,
        deliveryFeeCents,
        taxRateBps: settings.tax_rate_bps,
        settings: discountSettings,
      })
    : 0;

  function update<K extends keyof CheckoutInput>(key: K, value: CheckoutInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setServerError(null);

    const parsed = checkoutSchema.safeParse(form);
    if (!parsed.success) {
      const next: Partial<Record<keyof CheckoutInput, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof CheckoutInput;
        if (!next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: parsed.data,
          items: cart.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
          couponCode: coupon?.code ?? '',
          paymentMethod: payMethod,
        }),
      });

      const body: unknown = await res.json();

      if (!res.ok) {
        const message =
          typeof body === 'object' && body !== null && 'error' in body
            ? String((body as { error: unknown }).error)
            : 'We could not place your order. Please try again.';
        // 429 means the rate limiter, and its message already explains itself.
        setServerError(message);
        return;
      }

      const order = body as PlacedOrder;
      try {
        window.localStorage.setItem(CHECKOUT_DETAILS_KEY, JSON.stringify(parsed.data));
      } catch {
        /* not important enough to fail checkout over */
      }
      cart.clear();
      router.push(`/orders/${order.order_number}?email=${encodeURIComponent(parsed.data.email)}`);
    } catch {
      setServerError('The network dropped out. Your order was not placed — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const canCheckout = cart.itemCount > 0 && quote?.deliverable === true;

  const ticket = (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Receipt className="size-4 text-primary" aria-hidden />
          <h2 className="font-display text-sm font-semibold uppercase tracking-widest">
            {mode === 'items' ? 'Your order' : 'Shipping details'}
          </h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground lg:hidden"
            aria-label="Close your order"
          >
            <ChevronDown className="size-5" aria-hidden />
          </button>
        </div>
      </header>

      <div
        className={cn(
          'px-4',
          // Sizes to its content in checkout so the scrolling region below can
          // take the remaining height; otherwise both claim flex-1 and the form
          // is squeezed to a few lines.
          mode === 'checkout' ? 'max-lg:shrink-0 lg:min-h-0 lg:flex-1' : 'min-h-0 flex-1',
          // Always scrollable on mobile: the rail is a bottom drawer capped at
          // 85dvh, so without an inner scroll everything past the first
          // screenful — payment options, the Place order button — is
          // unreachable. Only the desktop rail grows to fit the page instead.
          'overflow-y-auto',
          mode === 'checkout' ? 'lg:overflow-visible' : '',
        )}
      >
        {cart.itemCount === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <ShoppingBasket className="size-7 text-muted-foreground" aria-hidden />
            <p className="font-display text-sm font-semibold">
              {text(content, 'cart.empty_title', 'Nothing here yet')}
            </p>
            <p className="max-w-[26ch] text-xs text-muted-foreground">
              {text(
                content,
                'cart.empty_body',
                'Add something from the shelves and it will show up on this ticket.',
              )}
            </p>
          </div>
        ) : mode === 'items' ? (
          <ul className="divide-y divide-dashed divide-border">
            {cart.lines.map((line) => (
              <li key={line.productId} className="flex items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{line.name}</p>
                  <p className="tabular text-xs text-muted-foreground">
                    {formatMoney(line.priceCents)} / {line.unit}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <QuantityStepper
                      size="sm"
                      value={line.quantity}
                      max={999}
                      onChange={(next) =>
                        cart.setQuantity(
                          {
                            productId: line.productId,
                            slug: line.slug,
                            name: line.name,
                            unit: line.unit,
                            priceCents: line.priceCents,
                            imagePath: line.imagePath,
                          },
                          next,
                          999,
                        )
                      }
                      label={line.name}
                    />
                    <button
                      type="button"
                      onClick={() => cart.remove(line.productId)}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-destructive"
                      aria-label={`Remove ${line.name} from your order`}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                </div>
                <p className="tabular pt-0.5 text-sm font-semibold">
                  {formatMoney(line.priceCents * line.quantity)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <form id="checkout-form" onSubmit={submit} className="space-y-3 py-3" noValidate>
            {/* What they are buying, still editable. Sending someone back to a
                separate screen to change a quantity is how orders get abandoned. */}
            <section className="rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setSummaryOpen((v) => !v)}
                aria-expanded={summaryOpen}
                aria-controls="order-summary"
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
              >
                <span className="text-xs font-semibold uppercase tracking-widest">
                  Your order
                  <span className="tabular ml-1.5 font-normal normal-case tracking-normal text-muted-foreground">
                    {formatMoney(cart.subtotalCents)}
                  </span>
                </span>
                <ChevronDown
                  className={cn(
                    'size-4 shrink-0 text-muted-foreground transition-transform',
                    summaryOpen && 'rotate-180',
                  )}
                  aria-hidden
                />
              </button>

              {summaryOpen ? (
                <div id="order-summary" className="border-t border-border px-3 py-2">
                  <ul className="divide-y divide-dashed divide-border">
                    {cart.lines.map((line) => (
                      <li key={line.productId} className="flex items-center gap-2 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">{line.name}</p>
                          <p className="tabular text-[11px] text-muted-foreground">
                            {formatMoney(line.priceCents)} / {line.unit}
                          </p>
                        </div>

                        <QuantityStepper
                          size="sm"
                          value={line.quantity}
                          max={999}
                          onChange={(next) =>
                            cart.setQuantity(
                              {
                                productId: line.productId,
                                slug: line.slug,
                                name: line.name,
                                unit: line.unit,
                                priceCents: line.priceCents,
                                imagePath: line.imagePath,
                              },
                              next,
                              999,
                            )
                          }
                          label={line.name}
                        />

                        <p className="tabular w-16 shrink-0 text-right text-xs font-semibold">
                          {formatMoney(line.priceCents * line.quantity)}
                        </p>

                        <button
                          type="button"
                          onClick={() => cart.remove(line.productId)}
                          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-destructive"
                          aria-label={`Remove ${line.name} from your order`}
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>

            <Field id="co-name" label="Full name" error={errors.name} required>
              <Input
                value={form.name}
                autoComplete="name"
                onChange={(e) => update('name', e.target.value)}
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="co-email" label="Email" error={errors.email} required>
                <Input
                  type="email"
                  inputMode="email"
                  value={form.email}
                  autoComplete="email"
                  onChange={(e) => update('email', e.target.value)}
                />
              </Field>
              <Field id="co-phone" label="Phone" error={errors.phone} required>
                <Input
                  type="tel"
                  inputMode="tel"
                  value={form.phone}
                  autoComplete="tel"
                  onChange={(e) => update('phone', e.target.value)}
                />
              </Field>
            </div>

            <Field id="co-address" label="Shipping address" error={errors.addressLine1} required>
              <Input
                value={form.addressLine1}
                autoComplete="address-line1"
                placeholder="12850 96 Avenue"
                onChange={(e) => update('addressLine1', e.target.value)}
              />
            </Field>

            <Field id="co-address2" label="Unit or buzzer" error={errors.addressLine2}>
              <Input
                value={form.addressLine2}
                autoComplete="address-line2"
                onChange={(e) => update('addressLine2', e.target.value)}
              />
            </Field>

            {/* City, province and postal share one row. Postal is always six
                characters, so it takes a fixed narrow column and gives the rest
                to province, which carries the longest text in the form. */}
            {/* Two across on a phone, wrapping postal onto its own line: at 320px
                the three-column version leaves the province select about 120px,
                which is not enough for "British Columbia", and squeezes city to
                72px. The tighter row only applies once there is room for it. */}
            <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-3 sm:grid-cols-[4.5rem_minmax(0,1fr)_5rem] sm:gap-2">
              <Field id="co-city" label="City" error={errors.city} required>
                <Input
                  value={form.city}
                  autoComplete="address-level2"
                  onChange={(e) => update('city', e.target.value)}
                />
              </Field>
              <Field id="co-province" label="Province" error={errors.province} required>
                {/* A plain select, not the styled component: this one inherits the
                    browser's address autofill, which the custom one does not. */}
                <select
                  value={form.province}
                  autoComplete="address-level1"
                  onChange={(e) => update('province', e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background pl-2 pr-1 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive"
                >
                  <option value="">Choose…</option>
                  {PROVINCES.map((province) => (
                    <option key={province.code} value={province.code}>
                      {province.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                id="co-postal"
                label="Postal"
                error={errors.postalCode}
                hint={quoteLoading ? 'Checking…' : undefined}
                required
              >
                <Input
                  value={form.postalCode}
                  autoComplete="postal-code"
                  placeholder="V3S 1A4"
                  onChange={(e) => update('postalCode', e.target.value.toUpperCase())}
                />
              </Field>
            </div>

            <Field
              id="co-notes"
              label="Shipping instructions"
              hint="Gate code, buzzer number, or where to leave it"
            >
              <Textarea
                value={form.deliveryNotes}
                rows={2}
                onChange={(e) => update('deliveryNotes', e.target.value)}
              />
            </Field>
          </form>
        )}
      </div>

      {cart.itemCount > 0 ? (
        <footer
          className={cn(
            'ticket-rule space-y-3 px-4 py-3',
            // On a phone in checkout the summary, coupon and payment choice
            // scroll along with the address form rather than sitting in a fixed
            // block below it — fixed, they took most of the screen and squeezed
            // the fields into a window a couple of lines tall. The Place order
            // button is pinned separately, so it stays reachable.
            mode === 'checkout' && 'max-lg:min-h-0 max-lg:flex-1 max-lg:overflow-y-auto',
          )}
        >
          <dl className="space-y-1 text-sm">
            <Row label="Subtotal" value={formatMoney(cart.subtotalCents)} />
            {priced.cryptoCents > 0 ? (
              <Row
                label={settings.crypto_discount_label || 'Crypto payment discount'}
                value={`-${formatMoney(priced.cryptoCents)}`}
                discount
              />
            ) : null}
            {couponOnSubtotal > 0 ? (
              <Row
                label={`${coupon!.code} — ${coupon!.label}`}
                value={`-${formatMoney(couponOnSubtotal)}`}
                discount
              />
            ) : null}
            <Row
              label="Shipping"
              value={
                quoteLoading
                  ? '…'
                  : quote?.deliverable
                    ? quote.free_delivery_applied
                      ? 'Free'
                      : formatMoney(deliveryFeeCents)
                    : '—'
              }
              muted={!quote?.deliverable}
              was={
                quote?.deliverable &&
                (quote.discount_applied || couponOnDelivery > 0) &&
                typeof quote.base_fee_cents === 'number' &&
                quote.base_fee_cents > deliveryFeeCents
                  ? formatMoney(quote.base_fee_cents)
                  : undefined
              }
            />
            <Row
              label={`Tax (${(settings.tax_rate_bps / 100).toFixed(2).replace(/\.00$/, '')}%)`}
              value={quote?.deliverable ? formatMoney(taxCents) : '—'}
              muted={!quote?.deliverable}
            />
            <div className="ticket-rule pt-2">
              <Row
                label="Total"
                value={
                  quote?.deliverable ? formatMoney(totalCents) : formatMoney(cart.subtotalCents)
                }
                emphasis
              />
            </div>
          </dl>

          <CouponField
            subtotalCents={cart.subtotalCents}
            deliveryFeeCents={baseDeliveryCents}
            email={form.email}
            applied={coupon}
            onApply={setCoupon}
            onRemove={() => setCoupon(null)}
          />

          {mode === 'checkout' ? (
            <PaymentMethodPicker
              value={payMethod}
              onChange={setPayMethod}
              usdcAvailable={settings.usdc_available}
              savingCents={cryptoSaving}
            />
          ) : null}

          {mode === 'checkout' && quote && !quote.deliverable ? (
            <p className="rounded-md bg-[var(--warning)]/12 px-3 py-2 text-xs font-medium text-[var(--warning)]">
              {quote.message}
            </p>
          ) : null}

          {quote?.deliverable && quote.discount_label ? (
            <p className="rounded-md bg-accent px-3 py-2 text-xs font-medium text-accent-foreground">
              {quote.discount_label}
            </p>
          ) : null}

          {/* The zone is stated; an arrival time is not. This ships anywhere in
              Canada, so any hours-based estimate promised at checkout would be
              wrong for most orders and unkeepable for the rest. Staff set a real
              estimated date per order once it is packed. */}
          {mode === 'checkout' && quote?.deliverable && quote.zone_name ? (
            <p className="text-xs text-muted-foreground">{quote.zone_name}</p>
          ) : null}

          {serverError ? (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive"
            >
              {serverError}
            </p>
          ) : null}

          {mode === 'items' ? (
            <Button className="w-full" size="lg" onClick={() => setMode('checkout')}>
              {text(content, 'cart.checkout_button', 'Continue to shipping')}
            </Button>
          ) : (
            <div
              className={cn(
                'space-y-2',
                // Sticks to the bottom of the scrolling area on a phone, so the
                // button is always reachable however far down the summary you
                // have scrolled. The backdrop keeps the text above from showing
                // through as it passes underneath.
                'max-lg:sticky max-lg:bottom-0 max-lg:-mx-4 max-lg:bg-card max-lg:px-4 max-lg:pb-1 max-lg:pt-2',
              )}
            >
              <Button
                type="submit"
                form="checkout-form"
                className="w-full"
                size="lg"
                disabled={!canCheckout || submitting}
              >
                {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {submitting ? 'Placing your order' : `Place order · ${formatMoney(totalCents)}`}
              </Button>
              <button
                type="button"
                onClick={() => setMode('items')}
                className="w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                Back to items
              </button>
              <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
                {text(
                  content,
                  'cart.reassurance',
                  'No account needed. You will pay by Interac e-Transfer after you place the order.',
                )}
              </p>
            </div>
          )}
        </footer>
      ) : null}
    </div>
  );

  return (
    <>
      {/* Desktop: sticky rail */}
      <aside
        aria-label="Your order"
        className={cn(
          'ticket-edge hidden lg:block lg:w-[352px] lg:shrink-0 lg:overflow-hidden lg:rounded-xl lg:border lg:border-border lg:bg-card lg:shadow-sm',
          // Sticky and height-capped while browsing, so the summary follows the
          // catalogue. In checkout it becomes an ordinary block: a form inside
          // its own scroll area hides fields and traps the wheel.
          mode === 'checkout' ? 'lg:h-auto' : 'lg:sticky lg:top-20 lg:h-[calc(100dvh-6rem)]',
        )}
      >
        {ticket}
      </aside>

      {/* Mobile: bottom drawer */}
      {cart.itemCount > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-40 lg:hidden">
          {open ? (
            <>
              <button
                type="button"
                aria-label="Close your order"
                onClick={() => setOpen(false)}
                className="fixed inset-0 -z-10 bg-black/40"
              />
              <div
                className={cn(
                  'overflow-hidden rounded-t-2xl border-t border-border bg-card shadow-2xl',
                  // Nearly the whole screen while filling in an address; a
                  // shorter sheet for the item list, where seeing the shop
                  // behind it is useful.
                  mode === 'checkout' ? 'max-h-[96dvh]' : 'max-h-[85dvh]',
                )}
              >
                <div
                  className={cn('flex flex-col', mode === 'checkout' ? 'h-[96dvh]' : 'h-[85dvh]')}
                >
                  {ticket}
                </div>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="flex w-full items-center justify-between gap-3 border-t border-border bg-primary px-4 py-3 text-primary-foreground shadow-2xl"
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <ShoppingBasket className="size-4" aria-hidden />
                <span className="tabular">{cart.itemCount}</span>
                {cart.itemCount === 1 ? 'item' : 'items'}
              </span>
              <span className="tabular text-sm font-semibold">
                {formatMoney(cart.subtotalCents)} · Review order
              </span>
            </button>
          )}
        </div>
      ) : null}
    </>
  );
}

function Row({
  label,
  value,
  emphasis,
  muted,
  was,
  discount,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  muted?: boolean;
  /** The price before a delivery promotion, shown struck through beside it. */
  was?: string;
  /** Coupon lines read as money coming off, so they take the accent colour. */
  discount?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt
        className={cn(
          'text-muted-foreground',
          emphasis && 'font-medium text-foreground',
          discount && 'truncate font-medium text-primary',
        )}
      >
        {label}
      </dt>
      <dd
        className={cn(
          'tabular shrink-0 font-medium',
          emphasis && 'font-display text-lg font-semibold',
          muted && 'text-muted-foreground',
          discount && 'text-primary',
        )}
      >
        {was ? <s className="mr-1.5 font-normal text-muted-foreground">{was}</s> : null}
        {value}
      </dd>
    </div>
  );
}

