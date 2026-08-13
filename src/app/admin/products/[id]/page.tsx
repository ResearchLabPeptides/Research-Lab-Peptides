import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ProductForm } from '@/components/admin/product-form';
import { ProductImageManager } from '@/components/admin/product-image-manager';
import { requireStaff } from '@/lib/auth';
import { getCatalogLookups, getProductForEdit } from '@/lib/queries/admin';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const product = await getProductForEdit((await params).id);
  return { title: product ? product.name : 'Product' };
}

export default async function EditProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  await requireStaff('manager');

  const [{ id }, { created }] = await Promise.all([params, searchParams]);
  const [product, lookups] = await Promise.all([getProductForEdit(id), getCatalogLookups()]);

  if (!product) notFound();

  return (
    <div className="space-y-5">
      <Link
        href="/admin/products"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Inventory
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-bold tracking-tight">{product.name}</h1>
        <Badge tone={product.status === 'active' ? 'green' : 'slate'}>{product.status}</Badge>
        <span className="font-mono text-xs text-muted-foreground">{product.sku}</span>
        {product.status === 'active' ? (
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            View on the shop
            <ExternalLink className="size-3" aria-hidden />
          </Link>
        ) : null}
      </div>

      {created ? (
        <p
          role="status"
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground"
        >
          Product created. Add a photo below and it will appear on the shop grid.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Photos</CardTitle>
        </CardHeader>
        <CardContent>
          <ProductImageManager
            productId={product.id}
            productName={product.name}
            images={product.product_images}
          />
        </CardContent>
      </Card>

      <ProductForm
        product={product}
        categories={lookups.categories}
        suppliers={lookups.suppliers}
      />
    </div>
  );
}
