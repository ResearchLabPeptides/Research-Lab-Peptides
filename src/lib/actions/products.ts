'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import { slugify } from '@/lib/format';
import { productImageSchema, productSchema } from '@/lib/validation';
import type { ActionResult } from './orders';

export interface SaveProductResult extends ActionResult {
  productId?: string;
}

/**
 * Everything staff need to run the catalog lives here. Supabase Studio is not
 * part of anyone's day-to-day job.
 *
 * One rule holds throughout: these actions never assign to `products.quantity`.
 * A new product is created empty and its opening count is posted as a
 * `receiving` movement, so even the very first unit of stock has a ledger entry
 * explaining where it came from.
 */

/** Turns "Fresh Bread" into a category row, or reuses the one that exists. */
async function resolveLookup(
  table: 'categories' | 'suppliers',
  existingId: string | null | undefined,
  newName: string,
): Promise<{ id: string | null } | { error: string }> {
  if (!newName.trim()) return { id: existingId ?? null };

  const supabase = await createClient();
  const name = newName.trim();

  if (table === 'categories') {
    const slug = slugify(name);
    const { data: found } = await supabase
      .from('categories')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();
    if (found) return { id: found.id as string };

    const { data, error } = await supabase
      .from('categories')
      .insert({ name, slug, sort_order: 99 })
      .select('id')
      .single();
    if (error) return { error: `Could not create the category: ${error.message}` };
    return { id: data.id as string };
  }

  // limit(1) before maybeSingle: two suppliers with names differing only by
  // case would otherwise throw instead of reusing the first.
  const { data: found } = await supabase
    .from('suppliers')
    .select('id')
    .ilike('name', name)
    .limit(1)
    .maybeSingle();
  if (found) return { id: found.id as string };

  const { data, error } = await supabase.from('suppliers').insert({ name }).select('id').single();
  if (error) return { error: `Could not create the supplier: ${error.message}` };
  return { id: data.id as string };
}

function friendlyWriteError(code: string | undefined, message: string): string {
  if (code === '23505') {
    if (message.includes('sku')) return 'Another product already uses that SKU.';
    if (message.includes('slug')) return 'Another product already uses that web address.';
    if (message.includes('barcode')) return 'Another product already uses that barcode.';
    return 'Another product already uses one of those identifiers.';
  }
  if (code === '42501') return 'Your role can view the catalog but not change it.';
  return message;
}

function toRow(
  input: ReturnType<typeof productSchema.parse>,
  categoryId: string | null,
  supplierId: string | null,
) {
  return {
    sku: input.sku,
    barcode: input.barcode?.trim() ? input.barcode.trim() : null,
    name: input.name,
    slug: input.slug,
    description: input.description ?? '',
    category_id: categoryId,
    supplier_id: supplierId,
    manufacturer: input.manufacturer ?? '',
    cost_cents: input.costCents,
    price_cents: input.priceCents,
    compare_at_cents: input.compareAtCents ?? null,
    min_quantity: input.minQuantity,
    max_quantity: input.maxQuantity ?? null,
    unit: input.unit,
    storage_location: input.storageLocation ?? '',
    shelf: input.shelf ?? '',
    bin: input.bin ?? '',
    batch_number: input.batchNumber ?? '',
    lot_number: input.lotNumber ?? '',
    expiry_date: input.expiryDate ?? null,
    status: input.status,
    is_featured: input.isFeatured,
    is_new: input.isNew,
    tags: input.tags,
    notes: input.notes ?? '',
  };
}

export async function createProduct(input: unknown): Promise<SaveProductResult> {
  await requireStaff('manager');

  const parsed = productSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the details.' };
  }

  const category = await resolveLookup(
    'categories',
    parsed.data.categoryId,
    parsed.data.newCategoryName,
  );
  if ('error' in category) return { ok: false, message: category.error };

  const supplier = await resolveLookup(
    'suppliers',
    parsed.data.supplierId,
    parsed.data.newSupplierName,
  );
  if ('error' in supplier) return { ok: false, message: supplier.error };

  const supabase = await createClient();

  // Created empty on purpose. The opening count is posted below as a movement
  // so the ledger explains the stock instead of it simply appearing.
  const { data, error } = await supabase
    .from('products')
    .insert({ ...toRow(parsed.data, category.id, supplier.id), quantity: 0 })
    .select('id')
    .single();

  if (error) return { ok: false, message: friendlyWriteError(error.code, error.message) };

  const productId = data.id as string;
  const opening = parsed.data.openingQuantity ?? 0;

  if (opening > 0) {
    const { error: movementError } = await supabase.rpc('apply_inventory_movement', {
      p_product_id: productId,
      p_type: 'receiving',
      p_change: opening,
      p_reason: 'Opening stock',
      p_notes: 'Recorded when the product was created',
    });

    if (movementError) {
      // The product saved; only the count did not. Say so plainly rather than
      // reporting success and leaving someone to find a zero later.
      return {
        ok: true,
        productId,
        message: `Product saved, but the opening count did not record: ${movementError.message}. Add it from the Adjust button.`,
      };
    }
  }

  await supabase.rpc('log_activity', {
    p_action: 'product.created',
    p_entity_type: 'product',
    p_entity_id: parsed.data.sku,
    p_metadata: { name: parsed.data.name, opening_quantity: opening },
  });

  revalidatePath('/admin/products');
  revalidatePath('/');

  return { ok: true, productId, message: `${parsed.data.name} added.` };
}

export async function updateProduct(productId: string, input: unknown): Promise<SaveProductResult> {
  await requireStaff('manager');

  const parsed = productSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the details.' };
  }

  const category = await resolveLookup(
    'categories',
    parsed.data.categoryId,
    parsed.data.newCategoryName,
  );
  if ('error' in category) return { ok: false, message: category.error };

  const supplier = await resolveLookup(
    'suppliers',
    parsed.data.supplierId,
    parsed.data.newSupplierName,
  );
  if ('error' in supplier) return { ok: false, message: supplier.error };

  const supabase = await createClient();

  // `quantity` is deliberately absent from the update. Stock only moves through
  // apply_inventory_movement().
  const { error } = await supabase
    .from('products')
    .update(toRow(parsed.data, category.id, supplier.id))
    .eq('id', productId);

  if (error) return { ok: false, message: friendlyWriteError(error.code, error.message) };

  await supabase.rpc('log_activity', {
    p_action: 'product.updated',
    p_entity_type: 'product',
    p_entity_id: parsed.data.sku,
    p_metadata: { name: parsed.data.name },
  });

  revalidatePath('/admin/products');
  revalidatePath(`/admin/products/${productId}`);
  revalidatePath('/');

  return { ok: true, productId, message: 'Changes saved.' };
}

/**
 * Archiving is the safe option and the one the UI leads with: the product
 * disappears from the storefront but every past order still resolves against
 * it, and its stock history stays intact.
 */
export async function setProductStatus(
  productId: string,
  status: 'active' | 'inactive' | 'discontinued' | 'archived',
): Promise<ActionResult> {
  await requireStaff('manager');

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('products')
    .update({ status })
    .eq('id', productId)
    .select('name, sku')
    .single();

  if (error) return { ok: false, message: friendlyWriteError(error.code, error.message) };

  await supabase.rpc('log_activity', {
    p_action: 'product.status_changed',
    p_entity_type: 'product',
    p_entity_id: data.sku as string,
    p_metadata: { status },
  });

  revalidatePath('/admin/products');
  revalidatePath(`/admin/products/${productId}`);
  revalidatePath('/');

  return {
    ok: true,
    message:
      status === 'active'
        ? `${data.name as string} is back on the storefront.`
        : `${data.name as string} is now ${status} and hidden from customers.`,
  };
}

export async function deleteProduct(productId: string): Promise<ActionResult> {
  await requireStaff('manager');

  const supabase = await createClient();

  // Stock held for an unpaid order would silently vanish. Make the person deal
  // with those orders first.
  const { data: product } = await supabase
    .from('products')
    .select('name, sku, quantity_reserved')
    .eq('id', productId)
    .single();

  if (product && (product.quantity_reserved as number) > 0) {
    return {
      ok: false,
      message:
        'This product is held for orders that have not been paid yet. Cancel or confirm those orders first, or archive it instead.',
    };
  }

  const { error } = await supabase.from('products').delete().eq('id', productId);
  if (error) return { ok: false, message: friendlyWriteError(error.code, error.message) };

  await supabase.rpc('log_activity', {
    p_action: 'product.deleted',
    p_entity_type: 'product',
    p_entity_id: (product?.sku as string) ?? productId,
    p_metadata: { name: product?.name ?? null },
  });

  revalidatePath('/admin/products');
  revalidatePath('/');

  return {
    ok: true,
    message: `${(product?.name as string) ?? 'Product'} deleted. Past orders kept their own record of it.`,
  };
}

// --- Images ------------------------------------------------------------------
// The file itself is uploaded straight from the browser to Supabase Storage
// under the staff member's own session, so a 5 MB photo never travels through a
// server action. These handlers only record and reorder the rows.

export async function attachProductImage(input: unknown): Promise<ActionResult> {
  await requireStaff('manager');

  const parsed = productImageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'That upload could not be recorded.' };

  const supabase = await createClient();

  const { count } = await supabase
    .from('product_images')
    .select('id', { count: 'exact', head: true })
    .eq('product_id', parsed.data.productId);

  const isFirst = (count ?? 0) === 0;

  const { error } = await supabase.from('product_images').insert({
    product_id: parsed.data.productId,
    storage_path: parsed.data.storagePath,
    alt_text: parsed.data.altText ?? '',
    sort_order: count ?? 0,
    is_primary: isFirst,
  });

  if (error) return { ok: false, message: friendlyWriteError(error.code, error.message) };

  revalidatePath(`/admin/products/${parsed.data.productId}`);
  revalidatePath('/');

  return { ok: true, message: isFirst ? 'Photo added and set as the main image.' : 'Photo added.' };
}

export async function removeProductImage(imageId: string): Promise<ActionResult> {
  await requireStaff('manager');

  const supabase = await createClient();
  const { data: image } = await supabase
    .from('product_images')
    .select('product_id, storage_path, is_primary')
    .eq('id', imageId)
    .single();

  if (!image) return { ok: false, message: 'That photo is already gone.' };

  const { error } = await supabase.from('product_images').delete().eq('id', imageId);
  if (error) return { ok: false, message: friendlyWriteError(error.code, error.message) };

  // Remove the file too, so deleting a photo does not quietly keep paying for it.
  const path = image.storage_path as string;
  if (!path.startsWith('http')) {
    await supabase.storage.from('product-images').remove([path]);
  }

  // A product with photos should always have a main one.
  if (image.is_primary) {
    const { data: next } = await supabase
      .from('product_images')
      .select('id')
      .eq('product_id', image.product_id as string)
      .order('sort_order')
      .limit(1)
      .maybeSingle();

    if (next) {
      await supabase
        .from('product_images')
        .update({ is_primary: true })
        .eq('id', next.id as string);
    }
  }

  revalidatePath(`/admin/products/${image.product_id as string}`);
  revalidatePath('/');

  return { ok: true, message: 'Photo removed.' };
}

export async function setPrimaryImage(productId: string, imageId: string): Promise<ActionResult> {
  await requireStaff('manager');

  const supabase = await createClient();

  // Clear first: a partial unique index allows only one primary per product, so
  // setting the new one before clearing the old would be rejected.
  const { error: clearError } = await supabase
    .from('product_images')
    .update({ is_primary: false })
    .eq('product_id', productId)
    .eq('is_primary', true);

  if (clearError)
    return { ok: false, message: friendlyWriteError(clearError.code, clearError.message) };

  const { error } = await supabase
    .from('product_images')
    .update({ is_primary: true })
    .eq('id', imageId);

  if (error) return { ok: false, message: friendlyWriteError(error.code, error.message) };

  revalidatePath(`/admin/products/${productId}`);
  revalidatePath('/');

  return { ok: true, message: 'Main image updated. This is the photo customers see in the grid.' };
}

export interface ImportResult extends ActionResult {
  created?: number;
  updated?: number;
  skipped?: number;
  rowErrors?: { row: number; message: string }[];
}

/**
 * Hands prepared spreadsheet rows to import_products(), which does the whole
 * batch in one transaction. A failure part way through leaves the catalog
 * exactly as it was rather than half-imported.
 */
export async function importProducts(
  rows: Record<string, string | number | string[]>[],
  mode: 'update' | 'skip',
): Promise<ImportResult> {
  await requireStaff('manager');

  if (rows.length === 0) return { ok: false, message: 'There is nothing to import.' };
  if (rows.length > 2000) {
    return {
      ok: false,
      message: 'Import up to 2000 products at a time. Split the file and run it twice.',
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('import_products', {
    p_rows: rows,
    p_mode: mode,
  });

  if (error) return { ok: false, message: friendlyWriteError(error.code, error.message) };

  const result = data as {
    created: number;
    updated: number;
    skipped: number;
    errors: { row: number; message: string }[];
  };

  revalidatePath('/admin/products');
  revalidatePath('/');

  const parts = [
    result.created ? `${result.created} added` : '',
    result.updated ? `${result.updated} updated` : '',
    result.skipped ? `${result.skipped} skipped` : '',
  ].filter(Boolean);

  return {
    ok: true,
    message: parts.length ? `Import finished — ${parts.join(', ')}.` : 'Nothing changed.',
    created: result.created,
    updated: result.updated,
    skipped: result.skipped,
    rowErrors: result.errors ?? [],
  };
}

export interface BulkStatusResult extends ActionResult {
  changed?: number;
}

/**
 * Changes the status of many products at once.
 *
 * Hiding a product does not disturb an order already placed for it — the order
 * keeps its own copy of the name and price, and held stock stays held. So this
 * is safe to do in bulk, and the only real risk is doing it to more rows than
 * you meant to. The UI states the count before it runs; this re-checks the role
 * and caps the batch.
 */
export async function setProductStatusBulk(
  productIds: string[],
  status: 'active' | 'inactive' | 'discontinued' | 'archived',
): Promise<BulkStatusResult> {
  await requireStaff('manager');

  const ids = [...new Set(productIds)].filter(Boolean);
  if (ids.length === 0) return { ok: false, message: 'Nothing was selected.' };
  if (ids.length > 1000) {
    return { ok: false, message: 'Change up to 1000 products at a time.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('products')
    .update({ status })
    .in('id', ids)
    .select('id');

  if (error) return { ok: false, message: friendlyWriteError(error.code, error.message) };

  const changed = data?.length ?? 0;

  await supabase.rpc('log_activity', {
    p_action: 'products.status_changed_bulk',
    p_entity_type: 'product',
    p_entity_id: null,
    p_metadata: { status, count: changed },
  });

  revalidatePath('/admin/products');
  revalidatePath('/');

  const noun = changed === 1 ? 'product' : 'products';
  return {
    ok: true,
    changed,
    message:
      status === 'active'
        ? `${changed} ${noun} back on the storefront.`
        : `${changed} ${noun} set to ${status} and hidden from customers.`,
  };
}
