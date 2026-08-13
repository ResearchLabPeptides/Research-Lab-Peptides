'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/format';
import { CopyButton } from './copy-button';

/**
 * Shown the moment an order is placed and again on every visit until the
 * transfer lands. The order number has to travel with the money — if it does
 * not, staff cannot match the payment — so it is the most prominent thing here
 * and it is copyable on its own.
 */
export function PaymentInstructions({
  orderNumber,
  totalCents,
  paymentEmail,
}: {
  orderNumber: string;
  totalCents: number;
  paymentEmail: string;
}) {
  const instructions = [
    `Send an Interac e-Transfer of ${formatMoney(totalCents)} to ${paymentEmail}.`,
    `Put your order number ${orderNumber} in the message field.`,
    'Your order starts being packed as soon as we confirm the transfer.',
  ].join('\n');

  return (
    <section
      aria-labelledby="pay-heading"
      className="rounded-xl border border-[var(--warning)]/40 bg-[var(--warning)]/8 p-5"
    >
      <h2 id="pay-heading" className="font-display text-lg font-semibold">
        Send your e-Transfer
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        We hold your items while we wait. Nothing ships until the transfer clears.
      </p>

      <dl className="mt-4 space-y-3">
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">Amount</dt>
          <dd className="tabular font-display text-3xl font-bold">{formatMoney(totalCents)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">Send to</dt>
          <dd className="font-mono text-sm break-all">{paymentEmail}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">
            Message field — this is how we find your order
          </dt>
          <dd className="font-mono text-lg font-semibold tracking-tight">{orderNumber}</dd>
        </div>
      </dl>

      <div className="mt-5 flex flex-wrap gap-2">
        <CopyButton value={orderNumber} label="Copy order number" size="sm" />
        <CopyButton value={paymentEmail} label="Copy payment email" size="sm" />
        <CopyButton value={instructions} label="Copy instructions" size="sm" />
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden />
          Print receipt
        </Button>
      </div>
    </section>
  );
}
