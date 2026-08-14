'use client';

import * as React from 'react';
import Link from 'next/link';
import { Loader2, PackageSearch } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Separator } from '@/components/ui/separator';
import { ORDER_STATUS_FLOW, ORDER_STATUS_META } from '@/lib/constants';
import { formatDateTime, formatMoney, formatPostalCode, formatRelative } from '@/lib/format';
import type { OrderLookupResult } from '@/lib/types';
import { cn } from '@/lib/utils';
import { PaymentInstructions } from './payment-instructions';

export function OrderStatus({
  orderNumber,
  email,
  paymentEmail,
}: {
  orderNumber: string;
  email: string;
  paymentEmail: string;
}) {
  const [result, setResult] = React.useState<OrderLookupResult | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch('/api/orders/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderNumber, email }),
        });
        if (!res.ok) throw new Error('lookup failed');
        if (live) setResult((await res.json()) as OrderLookupResult);
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [orderNumber, email]);

  if (failed) {
  // discount_cents is every discount added together; the crypto part is broken
  // back out so each one can be named on its own line.
  const cryptoCents = Number(result?.crypto_discount_cents ?? 0);
  const couponCents = Math.max(0, Number(result?.discount_cents ?? 0) - cryptoCents);

    return (
      <EmptyState
        icon={PackageSearch}
        title="We could not reach your order"
        description="The connection dropped. Reload the page and it should come back."
        action={
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            Reload
          </Button>
        }
      />
    );
  }

  if (!result) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Looking up your order
      </div>
    );
  }

  if (!result.found) {
    return (
      <EmptyState
        icon={PackageSearch}
        title="No order matches those details"
        description="Check the order number and the email you used. They both have to match."
        action={
          <Button variant="outline" size="sm" asChild>
            <Link href="/orders">Try again</Link>
          </Button>
        }
      />
    );
  }

  const meta = ORDER_STATUS_META[result.status];
  const cancelled = result.status === 'cancelled' || result.status === 'refunded';
  const awaitingPayment = result.status === 'pending_payment';

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-bold tracking-tight">{result.order_number}</h1>
          <Badge tone={meta.tone}>{meta.customerLabel}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Placed {formatDateTime(result.placed_at)} for {result.customer_name}.
          {/* Delivery date only once it has actually happened. There is no
              estimated arrival: this ships anywhere in Canada, so any figure
              generated at checkout was wrong for most orders. */}
          {result.status === 'delivered' && result.delivered_at
            ? ` Delivered ${formatRelative(result.delivered_at)}.`
            : ''}
        </p>
      </header>

      {awaitingPayment ? (
        <PaymentInstructions
          orderNumber={result.order_number}
          totalCents={result.total_cents}
          paymentEmail={paymentEmail}
        />
      ) : null}

      {!cancelled ? <ProgressTrail step={meta.step} /> : null}

      {result.tracking_notes ? (
        <p className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm">
          {result.tracking_notes}
        </p>
      ) : null}

      <section className="rounded-xl border border-border bg-card">
        <h2 className="border-b border-border px-5 py-3 font-display text-sm font-semibold uppercase tracking-widest">
          What you ordered
        </h2>
        <ul className="divide-y divide-dashed divide-border px-5">
          {result.items.map((item) => (
            <li key={item.sku} className="flex items-baseline justify-between gap-4 py-3 text-sm">
              <span>
                <span className="tabular font-medium">{item.quantity}&times;</span> {item.name}
              </span>
              <span className="tabular font-medium">{formatMoney(item.line_total_cents)}</span>
            </li>
          ))}
        </ul>
        <Separator />
        <dl className="space-y-1.5 px-5 py-4 text-sm">
          <Line label="Subtotal" value={formatMoney(result.subtotal_cents)} />
          {/* Split rather than shown as one figure. discount_cents is the total of
              every discount, so labelling it with the coupon code would credit
              the coupon for a saving the customer got for paying in crypto, and
              the numbers would not match what they were shown at checkout. */}
          {couponCents > 0 ? (
            <Line
              label={
                result.coupon_code ? `${result.coupon_code} — ${result.coupon_label}` : 'Discount'
              }
              value={`-${formatMoney(couponCents)}`}
              discount
            />
          ) : null}
          {cryptoCents > 0 ? (
            <Line
              label={result.crypto_discount_label || 'Crypto payment discount'}
              value={`-${formatMoney(cryptoCents)}`}
              discount
            />
          ) : null}
          <Line
            label={
              result.delivery_discount_label
                ? `Shipping — ${result.delivery_discount_label}`
                : 'Shipping'
            }
            value={
              result.delivery_fee_cents === 0 ? 'Free' : formatMoney(result.delivery_fee_cents)
            }
          />
          <Line label="Tax" value={formatMoney(result.tax_cents)} />
          <Line label="Total" value={formatMoney(result.total_cents)} emphasis />
        </dl>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-display text-sm font-semibold uppercase tracking-widest">
          Shipping to
        </h2>
        <address className="mt-2 text-sm not-italic text-muted-foreground">
          {result.address.line1}
          {result.address.line2 ? `, ${result.address.line2}` : ''}
          <br />
          {result.address.city}, {result.address.province}{' '}
          {formatPostalCode(result.address.postal_code)}
        </address>
      </section>
    </div>
  );
}

function ProgressTrail({ step }: { step: number }) {
  return (
    <ol className="flex gap-1" aria-label="Order progress">
      {ORDER_STATUS_FLOW.map((status, index) => {
        const stepNumber = index + 1;
        const reached = step >= stepNumber;
        return (
          <li key={status} className="flex-1">
            <div
              className={cn('h-1.5 rounded-full', reached ? 'bg-primary' : 'bg-muted')}
              aria-hidden
            />
            <p
              className={cn(
                'mt-2 text-[11px] leading-tight',
                reached ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {ORDER_STATUS_META[status].customerLabel}
              {reached ? <span className="sr-only"> — done</span> : null}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function Line({
  label,
  value,
  emphasis,
  discount,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  /** Money coming off reads as good news, so it takes the accent colour. */
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
          discount && 'text-primary',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
