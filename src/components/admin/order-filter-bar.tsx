'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ORDER_STATUS_META } from '@/lib/constants';
import { cn } from '@/lib/utils';

const STATUSES = ['all', ...Object.keys(ORDER_STATUS_META)] as const;

/**
 * How the customer paid. Kept separate from the status filter because they
 * answer different questions: status is "where is this order up to", method is
 * "which inbox do I check to confirm it" — the e-Transfer ones need an email,
 * the USDC ones need a wallet.
 */
const METHODS = [
  { value: 'all', label: 'All methods' },
  { value: 'interac', label: 'e-Transfer' },
  { value: 'usdc_solana', label: 'USDC' },
] as const;

export function OrderFilterBar({
  defaultQuery,
  defaultStatus,
  defaultMethod = 'all',
}: {
  defaultQuery: string;
  defaultStatus: string;
  defaultMethod?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState(defaultQuery);

  // Debounced so typing a phone number does not fire a query per digit.
  React.useEffect(() => {
    if (query === defaultQuery) return;
    const timer = window.setTimeout(() => {
      router.push(link({ q: query }));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, defaultQuery, defaultStatus, defaultMethod, router]);

  /**
   * Builds the address with every filter carried over, changing only what is
   * passed in. Rebuilding the parameters from scratch at each call site is how
   * choosing a status quietly drops the search box.
   */
  function link(changes: { q?: string; status?: string; method?: string }) {
    const q = changes.q ?? query;
    const status = changes.status ?? defaultStatus;
    const method = changes.method ?? defaultMethod;

    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status !== 'all') params.set('status', status);
    if (method !== 'all') params.set('method', method);

    const search = params.toString();
    return search ? `/admin/orders?${search}` : '/admin/orders';
  }

  function setStatus(status: string) {
    router.push(link({ status }));
  }

  function setMethod(method: string) {
    router.push(link({ method }));
  }

  return (
    <div className="space-y-3">
      <div className="relative max-w-md">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Order number, name, email, or phone"
          aria-label="Search orders"
          className="pl-9"
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {STATUSES.map((status) => {
          const active = defaultStatus === status;
          const label =
            status === 'all'
              ? 'All'
              : ORDER_STATUS_META[status as keyof typeof ORDER_STATUS_META].label;
          return (
            <button
              key={status}
              type="button"
              onClick={() => setStatus(status)}
              aria-pressed={active}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* A second row rather than more chips in the first: mixing "Pending
          payment" and "USDC" in one line reads as one list of alternatives,
          when in fact one of each can be active at once. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Paid by</span>
        {METHODS.map((method) => {
          const active = defaultMethod === method.value;
          return (
            <button
              key={method.value}
              type="button"
              onClick={() => setMethod(method.value)}
              aria-pressed={active}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {method.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
