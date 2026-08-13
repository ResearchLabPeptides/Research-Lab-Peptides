'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

export function ProductSearch({ defaultQuery }: { defaultQuery: string }) {
  const router = useRouter();
  const [query, setQuery] = React.useState(defaultQuery);

  React.useEffect(() => {
    if (query === defaultQuery) return;
    const timer = window.setTimeout(() => {
      router.push(query ? `/admin/products?q=${encodeURIComponent(query)}` : '/admin/products');
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, defaultQuery, router]);

  return (
    <div className="relative max-w-md">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name or SKU"
        aria-label="Search inventory"
        className="pl-9"
      />
    </div>
  );
}
