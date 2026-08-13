import Link from 'next/link';
import { Package, Plus, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ProductSearch } from '@/components/admin/product-search';
import { ProductTable } from '@/components/admin/product-table';
import { hasMinRole, requireStaff } from '@/lib/auth';
import { getProducts } from '@/lib/queries/admin';
import { formatMoney } from '@/lib/format';

export const metadata = { title: 'Inventory' };
export const dynamic = 'force-dynamic';

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const profile = await requireStaff();
  const { q } = await searchParams;
  const products = await getProducts(q);
  const canAdjust = hasMinRole(profile.role, 'employee');
  const canManage = hasMinRole(profile.role, 'manager');

  const totalValue = products.reduce((sum, p) => sum + p.stock_value_cents, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Inventory</h1>
          <p className="tabular text-sm text-muted-foreground">
            {products.length} products · {formatMoney(totalValue)} at cost
          </p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link href="/admin/products/import">
                <Upload className="size-4" aria-hidden />
                Import spreadsheet
              </Link>
            </Button>
            <Button asChild>
              <Link href="/admin/products/new">
                <Plus className="size-4" aria-hidden />
                New product
              </Link>
            </Button>
          </div>
        ) : null}
      </div>

      <ProductSearch defaultQuery={q ?? ''} />

      {products.length === 0 ? (
        <EmptyState
          icon={Package}
          title={q ? 'No products match' : 'Nothing in the catalog yet'}
          description={
            q
              ? 'Try a different search, or clear it to see the whole catalog.'
              : 'Add your first product and it appears on the shop page straight away.'
          }
          action={
            canManage && !q ? (
              <Button asChild size="sm">
                <Link href="/admin/products/new">Add a product</Link>
              </Button>
            ) : null
          }
        />
      ) : (
        <ProductTable
          products={products}
          canAdjust={canAdjust}
          canManage={canManage}
          search={q ?? ''}
        />
      )}
    </div>
  );
}
