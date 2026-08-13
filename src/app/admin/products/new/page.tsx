import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ProductForm } from '@/components/admin/product-form';
import { requireStaff } from '@/lib/auth';
import { getCatalogLookups } from '@/lib/queries/admin';

export const metadata = { title: 'New product' };
export const dynamic = 'force-dynamic';

export default async function NewProductPage() {
  await requireStaff('manager');
  const { categories, suppliers } = await getCatalogLookups();

  return (
    <div className="space-y-5">
      <Link
        href="/admin/products"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Inventory
      </Link>

      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">New product</h1>
        <p className="text-sm text-muted-foreground">
          Name, price, and SKU are the only required fields. Photos come after you save.
        </p>
      </div>

      <ProductForm categories={categories} suppliers={suppliers} />
    </div>
  );
}
