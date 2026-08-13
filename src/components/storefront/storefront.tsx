'use client';

import * as React from 'react';
import { PackageSearch } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import {
  availableStock,
  type Category,
  type PublicSettings,
  type StorefrontProduct,
} from '@/lib/types';
import { text, type ContentMap } from '@/lib/content';
import { CartProvider } from './cart-provider';
import { CatalogFilters, EMPTY_FILTERS, type FilterState } from './catalog-filters';
import { OrderRail } from './order-rail';
import { ProductCard } from './product-card';

/**
 * Filtering happens in the browser against the full active catalog, which is
 * what makes search feel instant. Past a few thousand products this should move
 * behind a server route — see the note in README under "Scaling the catalog".
 */
function applyFilters(products: StorefrontProduct[], filters: FilterState): StorefrontProduct[] {
  const query = filters.query.trim().toLowerCase();

  return products.filter((p) => {
    if (filters.categorySlug && p.categories?.slug !== filters.categorySlug) return false;
    if (filters.maxPriceCents !== null && p.price_cents > filters.maxPriceCents) return false;
    if (filters.flags.featured && !p.is_featured) return false;
    if (filters.flags.isNew && !p.is_new) return false;
    if (filters.flags.onSale && !(p.compare_at_cents && p.compare_at_cents > p.price_cents))
      return false;
    if (filters.flags.inStock && availableStock(p) === 0) return false;

    if (query) {
      const haystack = `${p.name} ${p.description} ${p.sku} ${p.tags.join(' ')}`.toLowerCase();
      if (!query.split(/\s+/).every((term) => haystack.includes(term))) return false;
    }
    return true;
  });
}

export function Storefront({
  products,
  categories,
  settings,
  content,
}: {
  products: StorefrontProduct[];
  categories: Category[];
  settings: PublicSettings;
  content: ContentMap;
}) {
  const [filters, setFilters] = React.useState<FilterState>(EMPTY_FILTERS);
  const visible = React.useMemo(() => applyFilters(products, filters), [products, filters]);

  return (
    <CartProvider>
      <div className="mx-auto w-full max-w-7xl px-4 pb-32 lg:flex lg:items-start lg:gap-8 lg:pb-12">
        <div className="min-w-0 flex-1 space-y-6 py-6">
          <CatalogFilters
            categories={categories}
            value={filters}
            onChange={setFilters}
            resultCount={visible.length}
          />

          {visible.length === 0 ? (
            <EmptyState
              icon={PackageSearch}
              title={text(content, 'home.empty_title', 'Nothing matches that')}
              description={text(
                content,
                'home.empty_body',
                'Try a shorter search, or clear the filters to see the whole shop.',
              )}
              action={
                <Button variant="outline" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4">
              {visible.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}
        </div>

        <OrderRail settings={settings} content={content} />
      </div>
    </CartProvider>
  );
}
