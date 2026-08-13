'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ORDER_STATUS_META } from '@/lib/constants';
import { cn } from '@/lib/utils';

const STATUSES = ['all', ...Object.keys(ORDER_STATUS_META)] as const;

export function OrderFilterBar({
  defaultQuery,
  defaultStatus,
}: {
  defaultQuery: string;
  defaultStatus: string;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState(defaultQuery);

  // Debounced so typing a phone number does not fire a query per digit.
  React.useEffect(() => {
    if (query === defaultQuery) return;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (defaultStatus !== 'all') params.set('status', defaultStatus);
      router.push(`/admin/orders?${params.toString()}`);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, defaultQuery, defaultStatus, router]);

  function setStatus(status: string) {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (status !== 'all') params.set('status', status);
    router.push(`/admin/orders?${params.toString()}`);
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
    </div>
  );
}
