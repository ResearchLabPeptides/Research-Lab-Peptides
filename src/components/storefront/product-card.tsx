'use client';

import Image from 'next/image';
import { Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatMoneyCompact } from '@/lib/format';
import { placeholderHue, productImageUrl } from '@/lib/supabase/images';
import { availableStock, type StorefrontProduct } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useCart } from './cart-provider';
import { QuantityStepper } from './quantity-stepper';

export function ProductCard({ product }: { product: StorefrontProduct }) {
  const { quantityOf, setQuantity } = useCart();
  const quantity = quantityOf(product.id);
  const stock = availableStock(product);
  const soldOut = stock === 0;

  const primary =
    product.product_images.find((i) => i.is_primary) ??
    [...product.product_images].sort((a, b) => a.sort_order - b.sort_order)[0];
  const imageUrl = productImageUrl(primary?.storage_path);
  const onSale =
    product.compare_at_cents !== null && product.compare_at_cents > product.price_cents;

  function change(next: number) {
    setQuantity(
      {
        productId: product.id,
        slug: product.slug,
        name: product.name,
        unit: product.unit,
        priceCents: product.price_cents,
        imagePath: primary?.storage_path ?? null,
      },
      next,
      stock,
    );
  }

  return (
    <article
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-shadow',
        'focus-within:shadow-md hover:shadow-md',
        soldOut && 'opacity-70',
      )}
    >
      <div className="relative aspect-square overflow-hidden bg-muted">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={primary?.alt_text || product.name}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 260px"
            className="object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transform-none"
          />
        ) : (
          <div
            aria-hidden
            className="grid size-full place-items-center"
            style={{
              background: `linear-gradient(140deg, hsl(${placeholderHue(product.name)} 40% 92%), hsl(${placeholderHue(product.name)} 30% 82%))`,
            }}
          >
            <span className="font-display text-3xl font-semibold text-black/25">
              {product.name.slice(0, 2).toUpperCase()}
            </span>
          </div>
        )}

        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          {product.is_new ? <Badge tone="green">New</Badge> : null}
          {onSale ? <Badge tone="red">Sale</Badge> : null}
          {soldOut ? <Badge tone="slate">Sold out</Badge> : null}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2.5 p-3.5">
        <div className="flex-1 space-y-1">
          {product.categories ? (
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {product.categories.name}
            </p>
          ) : null}
          <h3 className="text-sm font-semibold leading-snug">{product.name}</h3>
          {product.description ? (
            <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
              {product.description}
            </p>
          ) : null}
        </div>

        <div className="flex items-end justify-between gap-2">
          <div>
            <p className="tabular font-display text-base font-semibold">
              {formatMoneyCompact(product.price_cents)}
            </p>
            <p className="text-xs text-muted-foreground">
              {onSale ? (
                <span className="tabular mr-1 line-through">
                  {formatMoneyCompact(product.compare_at_cents!)}
                </span>
              ) : null}
              per {product.unit}
            </p>
          </div>

          {soldOut ? null : quantity === 0 ? (
            <button
              type="button"
              onClick={() => change(1)}
              className="inline-flex h-10 items-center gap-1 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="size-4" aria-hidden />
              <span>Add</span>
              <span className="sr-only">{product.name} to your order</span>
            </button>
          ) : (
            <QuantityStepper value={quantity} max={stock} onChange={change} label={product.name} />
          )}
        </div>

        {!soldOut && stock <= 5 ? (
          <p className="tabular text-xs font-medium text-[var(--warning)]">Only {stock} left</p>
        ) : null}
      </div>
    </article>
  );
}
