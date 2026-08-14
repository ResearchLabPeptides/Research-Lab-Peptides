'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { saveCryptoDiscount } from '@/lib/actions/usdc';
import { formatMoney } from '@/lib/format';
import { cryptoDiscountCents, priceOrder } from '@/lib/pricing';

export interface CryptoDiscountSettingsRow {
  crypto_discount_enabled: boolean;
  crypto_discount_bps: number;
  crypto_discount_label: string;
  crypto_discount_stacks: boolean;
  crypto_discount_max_cents: number;
  tax_rate_bps: number;
}

/**
 * A standing percentage off for paying in USDC, set here rather than as a
 * coupon code because there is nothing for the customer to enter — it applies
 * itself when they choose that payment method.
 *
 * It lives on the Coupons screen because that is where someone goes looking for
 * "how do I take money off an order", even though it is not a code.
 */
export function CryptoDiscountPanel({
  settings,
  usdcAvailable,
  addressesAvailable,
}: {
  settings: CryptoDiscountSettingsRow;
  usdcAvailable: boolean;
  addressesAvailable: number;
}) {
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    enabled: settings.crypto_discount_enabled,
    percent: (settings.crypto_discount_bps / 100).toFixed(2),
    label: settings.crypto_discount_label || 'Crypto payment discount',
    stacks: settings.crypto_discount_stacks,
    maxAmount:
      settings.crypto_discount_max_cents > 0
        ? (settings.crypto_discount_max_cents / 100).toFixed(2)
        : '',
  });

  const bps = Math.round((Number(form.percent) || 0) * 100);
  const maxCents = form.maxAmount.trim() === '' ? 0 : Math.round(Number(form.maxAmount) * 100);

  // A worked example on a round number, priced through the same module the
  // checkout uses. The saving is more than the headline percentage because the
  // tax comes down with it, and showing that here avoids the surprise later.
  const example = (() => {
    const subtotal = 10_000;
    const discount = cryptoDiscountCents(subtotal, 0, {
      enabled: true,
      bps,
      stacks: form.stacks,
      maxCents,
    });
    const withoutIt = priceOrder({
      subtotalCents: subtotal,
      couponOnSubtotalCents: 0,
      deliveryFeeCents: 0,
      taxRateBps: settings.tax_rate_bps,
      cryptoCents: 0,
    });
    const withIt = priceOrder({
      subtotalCents: subtotal,
      couponOnSubtotalCents: 0,
      deliveryFeeCents: 0,
      taxRateBps: settings.tax_rate_bps,
      cryptoCents: discount,
    });
    return {
      etransfer: withoutIt.totalCents,
      usdc: withIt.totalCents,
      saving: withoutIt.totalCents - withIt.totalCents,
    };
  })();

  function save() {
    startTransition(async () => {
      const result = await saveCryptoDiscount({
        enabled: form.enabled,
        bps,
        label: form.label.trim() || 'Crypto payment discount',
        stacks: form.stacks,
        maxCents,
      });
      result.ok ? toast.success(result.message) : toast.error(result.message);
    });
  }

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="font-display text-lg font-semibold">Crypto payment discount</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A standing percentage off for customers who pay in USDC rather than by e-Transfer. There
          is no code to enter — it applies itself when they pick USDC at checkout, and the saving is
          shown beside the option so they can see why to choose it.
        </p>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-background p-3">
        <input
          type="checkbox"
          checked={form.enabled}
          disabled={!usdcAvailable}
          onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
          className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
        />
        <span className="min-w-0 text-sm">
          Offer a discount for paying in USDC
          {!usdcAvailable ? (
            <span className="mt-0.5 block text-xs text-muted-foreground">
              USDC is not being offered at checkout right now
              {addressesAvailable === 0 ? ' — the address pool is empty' : ''}, so this would have no
              effect. Sort that out on the Payments screen first.
            </span>
          ) : null}
        </span>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="cd-percent">Discount (%)</Label>
          <Input
            id="cd-percent"
            inputMode="decimal"
            className="tabular"
            value={form.percent}
            onChange={(event) => setForm({ ...form, percent: event.target.value })}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Taken off the goods total before tax, so the customer is not taxed on money they did not
            pay.
          </p>
        </div>

        <div>
          <Label htmlFor="cd-label">Label on the receipt</Label>
          <Input
            id="cd-label"
            value={form.label}
            onChange={(event) => setForm({ ...form, label: event.target.value })}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            What the customer sees on their order summary.
          </p>
        </div>

        <div>
          <Label htmlFor="cd-max">Most it can be worth</Label>
          <Input
            id="cd-max"
            inputMode="decimal"
            className="tabular"
            placeholder="No limit"
            value={form.maxAmount}
            onChange={(event) => setForm({ ...form, maxAmount: event.target.value })}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Optional ceiling, so a percentage cannot run away on an unusually large order.
          </p>
        </div>

        <div>
          <Label htmlFor="cd-stacks">With a coupon code</Label>
          <label className="mt-1 flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-background p-3">
            <input
              id="cd-stacks"
              type="checkbox"
              checked={form.stacks}
              onChange={(event) => setForm({ ...form, stacks: event.target.checked })}
              className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
            />
            <span className="min-w-0 text-sm">Allow both at once</span>
          </label>
          <p className="mt-1 text-xs text-muted-foreground">
            {form.stacks
              ? 'A customer using a coupon and paying in USDC gets both discounts.'
              : 'A coupon wins outright — the customer keeps the better deal they already had.'}
          </p>
        </div>
      </div>

      {form.enabled && bps > 0 ? (
        <div className="rounded-lg border-l-2 border-primary bg-muted/40 p-3 text-sm">
          <strong>On a {formatMoney(10_000)} order:</strong> an e-Transfer customer pays{' '}
          {formatMoney(example.etransfer)}, a USDC customer pays {formatMoney(example.usdc)} — a
          saving of {formatMoney(example.saving)}, and you receive that much less per order.
          Excludes shipping.
        </div>
      ) : null}

      <Button onClick={save} disabled={pending}>
        {pending ? 'Saving…' : 'Save discount settings'}
      </Button>
    </Card>
  );
}
