import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ProductImport } from '@/components/admin/product-import';
import { requireStaff } from '@/lib/auth';

export const metadata = { title: 'Import products' };
export const dynamic = 'force-dynamic';

export default async function ImportProductsPage() {
  await requireStaff('manager');

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
        <h1 className="font-display text-2xl font-bold tracking-tight">Import products</h1>
        <p className="text-sm text-muted-foreground">
          Bring a catalog in from a spreadsheet. Only product names are required — prices, photos,
          and the rest can be filled in afterwards in the product editor.
        </p>
      </div>

      <ProductImport />
    </div>
  );
}
