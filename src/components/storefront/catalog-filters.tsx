'use client';

import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { Category } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface FilterState {
  query: string;
  categorySlug: string | null;
  maxPriceCents: number | null;
  flags: { featured: boolean; isNew: boolean; onSale: boolean; inStock: boolean };
}

export const EMPTY_FILTERS: FilterState = {
  query: '',
  categorySlug: null,
  maxPriceCents: null,
  flags: { featured: false, isNew: false, onSale: false, inStock: false },
};

const PRICE_STEPS = [
  { label: 'Under $5', cents: 500 },
  { label: 'Under $10', cents: 1000 },
  { label: 'Under $20', cents: 2000 },
];

export function CatalogFilters({
  categories,
  value,
  onChange,
  resultCount,
}: {
  categories: Category[];
  value: FilterState;
  onChange: (next: FilterState) => void;
  resultCount: number;
}) {
  const flagKeys = Object.keys(value.flags) as (keyof FilterState['flags'])[];
  const isFiltered =
    value.query !== '' ||
    value.categorySlug !== null ||
    value.maxPriceCents !== null ||
    flagKeys.some((k) => value.flags[k]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={value.query}
          onChange={(e) => onChange({ ...value, query: e.target.value })}
          placeholder="Search the shelves"
          aria-label="Search products"
          className="h-11 pl-9"
        />
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        <Chip
          active={value.categorySlug === null}
          onClick={() => onChange({ ...value, categorySlug: null })}
        >
          Everything
        </Chip>
        {categories.map((c) => (
          <Chip
            key={c.id}
            active={value.categorySlug === c.slug}
            onClick={() =>
              onChange({ ...value, categorySlug: value.categorySlug === c.slug ? null : c.slug })
            }
          >
            {c.name}
          </Chip>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Chip
          active={value.flags.featured}
          onClick={() =>
            onChange({ ...value, flags: { ...value.flags, featured: !value.flags.featured } })
          }
        >
          Featured
        </Chip>
        <Chip
          active={value.flags.isNew}
          onClick={() =>
            onChange({ ...value, flags: { ...value.flags, isNew: !value.flags.isNew } })
          }
        >
          New
        </Chip>
        <Chip
          active={value.flags.onSale}
          onClick={() =>
            onChange({ ...value, flags: { ...value.flags, onSale: !value.flags.onSale } })
          }
        >
          On sale
        </Chip>
        <Chip
          active={value.flags.inStock}
          onClick={() =>
            onChange({ ...value, flags: { ...value.flags, inStock: !value.flags.inStock } })
          }
        >
          In stock
        </Chip>

        {PRICE_STEPS.map((p) => (
          <Chip
            key={p.cents}
            active={value.maxPriceCents === p.cents}
            onClick={() =>
              onChange({
                ...value,
                maxPriceCents: value.maxPriceCents === p.cents ? null : p.cents,
              })
            }
          >
            {p.label}
          </Chip>
        ))}

        {isFiltered ? (
          <button
            type="button"
            onClick={() => onChange(EMPTY_FILTERS)}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            <X className="size-3" aria-hidden />
            Clear filters
          </button>
        ) : null}
      </div>

      <p className="tabular text-xs text-muted-foreground" role="status" aria-live="polite">
        {resultCount} {resultCount === 1 ? 'product' : 'products'}
      </p>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
