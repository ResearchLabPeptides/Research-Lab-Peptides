'use client';

import { useEffect, useState } from 'react';
import { Printer, RefreshCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/format';
import { CopyButton } from './copy-button';
import type { UsdcQuote } from '@/lib/types';

/**
 * What a customer sees after choosing USDC.
 *
 * Two things have to be right or the money is gone for good: the address and
 * the network. Both are stated plainly and the address is copyable rather than
 * readable, because nobody should ever be retyping one of these by hand.
 *
 * The quote expires. Rather than silently repricing underneath someone — which
 * would mean they send an amount that no longer matches and land in the part
 * paid tray — an expired quote says so and offers a fresh one.
 */
export function UsdcInstructions({
  orderNumber,
  email,
  totalCents,
  quote,
}: {
  orderNumber: string;
  email: string;
  totalCents: number;
  quote: UsdcQuote;
}) {
  const [current, setCurrent] = useState(quote);
  const [expired, setExpired] = useState(quote.expired);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  // Ticks the quote over to expired while the page is open, so someone sitting
  // on this screen sees it lapse rather than discovering it after sending.
  useEffect(() => {
    if (!current.quote_expires_at || expired) return;

    const deadline = new Date(current.quote_expires_at).getTime();
    const remaining = deadline - Date.now();

    if (remaining <= 0) {
      setExpired(true);
      return;
    }

    const timer = setTimeout(() => setExpired(true), remaining);
    return () => clearTimeout(timer);
  }, [current.quote_expires_at, expired]);

  async function refresh() {
    setRefreshing(true);
    setError('');

    try {
      const response = await fetch('/api/payments/usdc/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNumber, email }),
      });

      const body = await response.json();

      if (!response.ok) {
        setError(body.error ?? 'Could not refresh the amount. Give us a call.');
        return;
      }

      setCurrent({
        ...current,
        amount_micros: body.amount_micros,
        amount_display: body.amount_display,
        rate_cad: Number(body.rate_cad),
        quote_expires_at: body.expires_at,
        expired: false,
      });
      setExpired(false);
    } catch {
      setError('Could not reach us to refresh the amount. Check your connection.');
    } finally {
      setRefreshing(false);
    }
  }

  const instructions = [
    `Send exactly ${current.amount_display} USDC on the Solana network.`,
    `To this address: ${current.address}`,
    `This address belongs to order ${orderNumber} and no other order.`,
  ].join('\n');

  return (
    <section
      aria-labelledby="usdc-heading"
      className="rounded-xl border border-[var(--warning)]/40 bg-[var(--warning)]/8 p-5"
    >
      <h2 id="usdc-heading" className="font-display text-lg font-semibold">
        Send your USDC
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        We hold your items while we wait. Nothing ships until the payment lands.
      </p>

      <dl className="mt-4 space-y-3">
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">Send exactly</dt>
          <dd className="tabular font-display text-3xl font-bold">
            {current.amount_display} USDC
          </dd>
          <dd className="mt-1 text-sm text-muted-foreground">
            Your order total is {formatMoney(totalCents)} — converted at 1 USDC ={' '}
            {Number(current.rate_cad).toFixed(4)} CAD.
          </dd>
        </div>

        <div>
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">
            To this address — it belongs to your order alone
          </dt>
          <dd className="mt-1 rounded-md bg-background/70 p-3 font-mono text-sm break-all">
            {current.address}
          </dd>
        </div>
      </dl>

      {expired && (
        <div
          role="status"
          className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-[var(--warning)]/50 bg-background/60 p-3"
        >
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          <p className="flex-1 text-sm">
            This amount was worked out a while ago and the rate may have moved. Get an up-to-date
            figure before you send.
          </p>
          <Button size="sm" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={refreshing ? 'size-4 animate-spin' : 'size-4'} aria-hidden />
            {refreshing ? 'Checking…' : 'Refresh amount'}
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-[var(--destructive)]">
          {error}
        </p>
      )}

      <div className="mt-5 rounded-md border border-border/60 bg-background/50 p-4">
        <p className="text-sm font-semibold">Before you send</p>
        <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
          <li>
            Send <strong>USDC on the Solana network</strong>. USDC on any other network, or a
            different coin, cannot be recovered.
          </li>
          <li>Send the exact amount shown above.</li>
          <li>Do not send from an exchange that charges the fee out of the amount sent.</li>
          <li>We confirm payments by hand, usually within a few hours.</li>
        </ul>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <CopyButton value={current.address} label="Copy address" size="sm" />
        <CopyButton value={current.amount_display} label="Copy amount" size="sm" />
        <CopyButton value={instructions} label="Copy instructions" size="sm" />
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden />
          Print receipt
        </Button>
      </div>

      {/* No wallet is named here on purpose. Recommending one reads as an
          endorsement of a third party holding the customer's money, and the
          shop has no way to stand behind that. */}
      <p className="mt-4 text-xs text-muted-foreground">
        Any Solana wallet can send this payment. Order {orderNumber}.
      </p>
    </section>
  );
}
