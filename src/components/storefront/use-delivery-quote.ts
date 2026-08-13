'use client';

import * as React from 'react';
import { normalizePostalCode } from '@/lib/format';
import type { DeliveryQuote } from '@/lib/types';

/**
 * Asks the server what delivery costs as soon as there is enough of a postal
 * code to answer. The fee comes from the database's own rules, so the number
 * the shopper sees is the number the order will be written with.
 */
export function useDeliveryQuote(
  postalCode: string,
  city: string,
  subtotalCents: number,
  itemCount: number,
) {
  const [quote, setQuote] = React.useState<DeliveryQuote | null>(null);
  const [loading, setLoading] = React.useState(false);
  const normalized = normalizePostalCode(postalCode);

  React.useEffect(() => {
    if (normalized.length < 3) {
      setQuote(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    // Debounced: a shopper typing "V3S 1A4" would otherwise fire six requests.
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch('/api/delivery/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postalCode: normalized, city, subtotalCents, itemCount }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error('quote failed');
        setQuote((await res.json()) as DeliveryQuote);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setQuote(null);
      } finally {
        setLoading(false);
      }
    }, 350);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [normalized, city, subtotalCents, itemCount]);

  return { quote, loading };
}
