'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StockAdjustDialog } from '@/components/admin/stock-adjust-dialog';
import { setProductStatusBulk } from '@/lib/actions/products';
import { formatDate, formatMoney } from '@/lib/format';
import type { ProductRow } from '@/lib/queries/admin';
import { cn } from '@/lib/utils';

type Status = 'active' | 'inactive' | 'discontinued' | 'archived';

const STATUS_LABELS: Record<Status, string> = {
  active: 'Active — customers can buy it',
  inactive: 'Inactive — hidden, keep for later',
  discontinued: 'Discontinued — not coming back',
  archived: 'Archived — hidden from everything',
};

/**
 * The inventory list, with selection.
 *
 * "Select all" ticks what is currently on screen, not the whole catalog. After
 * a search that is the difference between hiding four products and hiding four
 * hundred, so the bar always names the count and the search term it came from.
 */
export function ProductTable({
  products,
  canAdjust,
  canManage,
  search,
}: {
  products: ProductRow[];
  canAdjust: boolean;
  canManage: boolean;
  search: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [status, setStatus] = React.useState<Status>('archived');
  const [feedback, setFeedback] = React.useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = React.useTransition();
  const headerCheckbox = React.useRef<HTMLInputElement>(null);

  const visibleIds = React.useMemo(() => products.map((p) => p.id), [products]);

  // Selections are per-view. Anything filtered out of sight is dropped, so a
  // later bulk action can never touch a row the person cannot see.
  React.useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => visibleIds.includes(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [visibleIds]);

  const allSelected = products.length > 0 && selected.size === products.length;
  const someSelected = selected.size > 0 && !allSelected;

  React.useEffect(() => {
    if (headerCheckbox.current) headerCheckbox.current.indeterminate = someSelected;
  }, [someSelected]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setFeedback(null);
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(visibleIds));
    setFeedback(null);
  }

  function apply() {
    startTransition(async () => {
      const result = await setProductStatusBulk([...selected], status);
      setFeedback(result);
      if (result.ok) {
        setSelected(new Set());
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      {canManage && selected.size > 0 ? (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-3 rounded-xl border border-primary/40 bg-card p-3 shadow-sm">
          <p className="text-sm font-medium">
            <span className="tabular">{selected.size}</span>{' '}
            {selected.size === 1 ? 'product' : 'products'} selected
            {search ? (
              <span className="font-normal text-muted-foreground">
                {' '}
                from your search for &ldquo;{search}&rdquo;
              </span>
            ) : null}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
              <SelectTrigger className="h-9 w-[15rem]" aria-label="New status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(STATUS_LABELS) as Status[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {STATUS_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button size="sm" onClick={apply} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {pending ? 'Applying' : `Apply to ${selected.size}`}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set())}
              disabled={pending}
            >
              <X className="size-4" aria-hidden />
              Clear
            </Button>
          </div>
        </div>
      ) : null}

      {feedback ? (
        <p
          role="status"
          className={
            feedback.ok
              ? 'rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground'
              : 'rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive'
          }
        >
          {feedback.message}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-muted/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              {canManage ? (
                <th scope="col" className="w-10 px-4 py-2.5">
                  <input
                    ref={headerCheckbox}
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="size-4 accent-[var(--primary)]"
                    aria-label={
                      allSelected
                        ? 'Clear selection'
                        : `Select all ${products.length} products shown`
                    }
                  />
                </th>
              ) : null}
              <th scope="col" className="px-4 py-2.5 font-medium">
                Product
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Category
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Status
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                On hand
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                Held
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                Available
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                Price
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Expiry
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {products.map((product) => {
              const isSelected = selected.has(product.id);
              return (
                <tr
                  key={product.id}
                  className={cn(
                    'transition-colors',
                    isSelected ? 'bg-accent/60' : 'hover:bg-muted/40',
                  )}
                >
                  {canManage ? (
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggle(product.id)}
                        className="size-4 accent-[var(--primary)]"
                        aria-label={`Select ${product.name}`}
                      />
                    </td>
                  ) : null}

                  <td className="px-4 py-3">
                    {canManage ? (
                      <Link
                        href={`/admin/products/${product.id}`}
                        className="font-medium text-primary underline-offset-2 hover:underline"
                      >
                        {product.name}
                      </Link>
                    ) : (
                      <p className="font-medium">{product.name}</p>
                    )}
                    <p className="font-mono text-xs text-muted-foreground">{product.sku}</p>
                  </td>

                  <td className="px-4 py-3 text-muted-foreground">
                    {product.category_name ?? '—'}
                  </td>

                  <td className="px-4 py-3">
                    {product.status === 'active' ? (
                      <Badge tone="green">Active</Badge>
                    ) : (
                      <Badge tone="slate">{product.status}</Badge>
                    )}
                  </td>

                  <td className="tabular px-4 py-3 text-right">
                    {product.is_out_of_stock ? (
                      <Badge tone="red">Out</Badge>
                    ) : product.is_low_stock ? (
                      <Badge tone="amber">{product.quantity} low</Badge>
                    ) : (
                      product.quantity
                    )}
                  </td>
                  <td className="tabular px-4 py-3 text-right text-muted-foreground">
                    {product.quantity_reserved || '—'}
                  </td>
                  <td className="tabular px-4 py-3 text-right font-medium">
                    {product.quantity_available}
                  </td>
                  <td className="tabular px-4 py-3 text-right">
                    {formatMoney(product.price_cents)}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {product.expiry_date ? formatDate(product.expiry_date) : '—'}
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      {canAdjust ? (
                        <StockAdjustDialog
                          productId={product.id}
                          productName={product.name}
                          currentQuantity={product.quantity}
                        />
                      ) : null}
                      {canManage ? (
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/admin/products/${product.id}`}>Edit</Link>
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canManage ? (
        <p className="text-xs text-muted-foreground">
          Tick products to change several at once. Hiding a product does not affect orders already
          placed for it, and held stock stays held.
        </p>
      ) : null}
    </div>
  );
}
