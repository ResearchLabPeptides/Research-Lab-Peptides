'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/field';
import { CheckboxField } from '@/components/ui/checkbox-field';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { centsToInput, inputToCents, slugify } from '@/lib/format';
import {
  createProduct,
  deleteProduct,
  setProductStatus,
  updateProduct,
} from '@/lib/actions/products';
import type { EditableProduct } from '@/lib/queries/admin';

type Status = 'active' | 'inactive' | 'discontinued' | 'archived';

interface FormState {
  name: string;
  slug: string;
  sku: string;
  barcode: string;
  description: string;
  categoryId: string;
  newCategoryName: string;
  supplierId: string;
  newSupplierName: string;
  manufacturer: string;
  price: string;
  compareAt: string;
  cost: string;
  openingQuantity: string;
  minQuantity: string;
  maxQuantity: string;
  unit: string;
  storageLocation: string;
  shelf: string;
  bin: string;
  batchNumber: string;
  lotNumber: string;
  expiryDate: string;
  status: Status;
  isFeatured: boolean;
  isNew: boolean;
  tags: string;
  notes: string;
}

const NEW_OPTION = '__new__';
const NONE_OPTION = '__none__';

const STATUS_LABELS: Record<Status, string> = {
  active: 'Active — customers can buy it',
  inactive: 'Inactive — hidden, keep for later',
  discontinued: 'Discontinued — not coming back',
  archived: 'Archived — hidden from everything',
};

function blankForm(): FormState {
  return {
    name: '',
    slug: '',
    sku: '',
    barcode: '',
    description: '',
    categoryId: NONE_OPTION,
    newCategoryName: '',
    supplierId: NONE_OPTION,
    newSupplierName: '',
    manufacturer: '',
    price: '',
    compareAt: '',
    cost: '',
    openingQuantity: '',
    minQuantity: '0',
    maxQuantity: '',
    unit: 'each',
    storageLocation: '',
    shelf: '',
    bin: '',
    batchNumber: '',
    lotNumber: '',
    expiryDate: '',
    status: 'active',
    isFeatured: false,
    isNew: false,
    tags: '',
    notes: '',
  };
}

function fromProduct(product: EditableProduct): FormState {
  return {
    name: product.name,
    slug: product.slug,
    sku: product.sku,
    barcode: product.barcode ?? '',
    description: product.description,
    categoryId: product.category_id ?? NONE_OPTION,
    newCategoryName: '',
    supplierId: product.supplier_id ?? NONE_OPTION,
    newSupplierName: '',
    manufacturer: product.manufacturer,
    price: centsToInput(product.price_cents),
    compareAt: centsToInput(product.compare_at_cents),
    cost: centsToInput(product.cost_cents),
    openingQuantity: '',
    minQuantity: String(product.min_quantity),
    maxQuantity: product.max_quantity === null ? '' : String(product.max_quantity),
    unit: product.unit,
    storageLocation: product.storage_location,
    shelf: product.shelf,
    bin: product.bin,
    batchNumber: product.batch_number,
    lotNumber: product.lot_number,
    expiryDate: product.expiry_date ?? '',
    status: product.status,
    isFeatured: product.is_featured,
    isNew: product.is_new,
    tags: product.tags.join(', '),
    notes: product.notes,
  };
}

export function ProductForm({
  product,
  categories,
  suppliers,
}: {
  product?: EditableProduct;
  categories: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const isEdit = Boolean(product);

  const [form, setForm] = React.useState<FormState>(() =>
    product ? fromProduct(product) : blankForm(),
  );
  // Only auto-fill the web address until someone types their own. Silently
  // rewriting a live product's URL would break links customers already have.
  const [slugTouched, setSlugTouched] = React.useState(isEdit);
  const [feedback, setFeedback] = React.useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = React.useTransition();

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function setName(value: string) {
    setForm((prev) => ({
      ...prev,
      name: value,
      slug: slugTouched ? prev.slug : slugify(value),
    }));
  }

  function buildPayload() {
    const price = inputToCents(form.price);
    const cost = inputToCents(form.cost);
    const compareAt = inputToCents(form.compareAt);

    return {
      name: form.name,
      slug: form.slug,
      sku: form.sku.trim(),
      barcode: form.barcode,
      description: form.description,
      categoryId:
        form.categoryId === NONE_OPTION || form.categoryId === NEW_OPTION ? null : form.categoryId,
      newCategoryName: form.categoryId === NEW_OPTION ? form.newCategoryName : '',
      supplierId:
        form.supplierId === NONE_OPTION || form.supplierId === NEW_OPTION ? null : form.supplierId,
      newSupplierName: form.supplierId === NEW_OPTION ? form.newSupplierName : '',
      manufacturer: form.manufacturer,
      priceCents: price ?? 0,
      costCents: cost ?? 0,
      compareAtCents: compareAt,
      openingQuantity: Number(form.openingQuantity) || 0,
      minQuantity: Number(form.minQuantity) || 0,
      maxQuantity: form.maxQuantity.trim() === '' ? null : Number(form.maxQuantity),
      unit: form.unit,
      storageLocation: form.storageLocation,
      shelf: form.shelf,
      bin: form.bin,
      batchNumber: form.batchNumber,
      lotNumber: form.lotNumber,
      expiryDate: form.expiryDate.trim() === '' ? null : form.expiryDate,
      status: form.status,
      isFeatured: form.isFeatured,
      isNew: form.isNew,
      tags: form.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      notes: form.notes,
    };
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setFeedback(null);

    if (inputToCents(form.price) === null) {
      setFeedback({ ok: false, message: 'Enter a selling price.' });
      return;
    }

    startTransition(async () => {
      const payload = buildPayload();
      const result = product
        ? await updateProduct(product.id, payload)
        : await createProduct(payload);

      setFeedback(result);

      // New products go straight to their edit page, which is where photos are
      // added — an image needs a product to belong to.
      if (result.ok && !product && result.productId) {
        router.push(`/admin/products/${result.productId}?created=1`);
      } else if (result.ok) {
        router.refresh();
      }
    });
  }

  const margin =
    inputToCents(form.price) !== null && inputToCents(form.cost)
      ? (inputToCents(form.price)! - inputToCents(form.cost)!) / 100
      : null;

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>What it is</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field id="p-name" label="Product name" required>
                <Input value={form.name} onChange={(e) => setName(e.target.value)} />
              </Field>

              <Field
                id="p-desc"
                label="Description"
                hint="Shown under the name on the shop page. Two lines is about what fits."
              >
                <Textarea
                  rows={4}
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="p-category" className="text-sm font-medium">
                    Category
                  </label>
                  <Select value={form.categoryId} onValueChange={(v) => set('categoryId', v)}>
                    <SelectTrigger id="p-category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_OPTION}>No category</SelectItem>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                      <SelectItem value={NEW_OPTION}>Add a new category…</SelectItem>
                    </SelectContent>
                  </Select>
                  {form.categoryId === NEW_OPTION ? (
                    <Input
                      value={form.newCategoryName}
                      onChange={(e) => set('newCategoryName', e.target.value)}
                      placeholder="New category name"
                      aria-label="New category name"
                    />
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="p-supplier" className="text-sm font-medium">
                    Supplier
                  </label>
                  <Select value={form.supplierId} onValueChange={(v) => set('supplierId', v)}>
                    <SelectTrigger id="p-supplier">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_OPTION}>No supplier</SelectItem>
                      {suppliers.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                      <SelectItem value={NEW_OPTION}>Add a new supplier…</SelectItem>
                    </SelectContent>
                  </Select>
                  {form.supplierId === NEW_OPTION ? (
                    <Input
                      value={form.newSupplierName}
                      onChange={(e) => set('newSupplierName', e.target.value)}
                      placeholder="New supplier name"
                      aria-label="New supplier name"
                    />
                  ) : null}
                </div>
              </div>

              <Field id="p-manufacturer" label="Manufacturer or brand">
                <Input
                  value={form.manufacturer}
                  onChange={(e) => set('manufacturer', e.target.value)}
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Price</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field id="p-price" label="Selling price" required>
                  <Input
                    inputMode="decimal"
                    className="tabular"
                    value={form.price}
                    onChange={(e) => set('price', e.target.value)}
                    placeholder="0.00"
                  />
                </Field>
                <Field id="p-compare" label='"Was" price' hint="Leave blank if not on sale">
                  <Input
                    inputMode="decimal"
                    className="tabular"
                    value={form.compareAt}
                    onChange={(e) => set('compareAt', e.target.value)}
                    placeholder="0.00"
                  />
                </Field>
                <Field id="p-cost" label="Your cost" hint="Never shown to customers">
                  <Input
                    inputMode="decimal"
                    className="tabular"
                    value={form.cost}
                    onChange={(e) => set('cost', e.target.value)}
                    placeholder="0.00"
                  />
                </Field>
              </div>

              {margin !== null ? (
                <p className="tabular rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                  Margin: ${margin.toFixed(2)} per {form.unit || 'unit'}
                </p>
              ) : null}

              <Field id="p-unit" label="Unit" hint="each, bag, loaf, lb, dozen…" required>
                <Input value={form.unit} onChange={(e) => set('unit', e.target.value)} />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Stock</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isEdit ? (
                <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                  On hand: <strong className="tabular text-foreground">{product!.quantity}</strong>
                  {product!.quantity_reserved > 0 ? (
                    <> ({product!.quantity_reserved} held for unpaid orders)</>
                  ) : null}
                  . Counts change through the Adjust button on the inventory list, so every movement
                  lands in the ledger with a reason.
                </p>
              ) : (
                <Field
                  id="p-opening"
                  label="Opening count"
                  hint="Recorded as a receiving movement, so the ledger starts off correct"
                >
                  <Input
                    type="number"
                    min="0"
                    className="tabular"
                    value={form.openingQuantity}
                    onChange={(e) => set('openingQuantity', e.target.value)}
                    placeholder="0"
                  />
                </Field>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="p-min"
                  label="Low-stock threshold"
                  hint="Alerts once stock drops to this. 0 uses the shop default."
                >
                  <Input
                    type="number"
                    min="0"
                    className="tabular"
                    value={form.minQuantity}
                    onChange={(e) => set('minQuantity', e.target.value)}
                  />
                </Field>
                <Field id="p-max" label="Maximum to hold" hint="Optional, for reorder planning">
                  <Input
                    type="number"
                    min="0"
                    className="tabular"
                    value={form.maxQuantity}
                    onChange={(e) => set('maxQuantity', e.target.value)}
                  />
                </Field>
              </div>

              <Field
                id="p-expiry"
                label="Expiry date"
                hint="Leave blank for anything that does not expire"
              >
                <Input
                  type="date"
                  value={form.expiryDate}
                  onChange={(e) => set('expiryDate', e.target.value)}
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Where it lives</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <Field id="p-loc" label="Storage location">
                <Input
                  value={form.storageLocation}
                  onChange={(e) => set('storageLocation', e.target.value)}
                  placeholder="Cooler 1"
                />
              </Field>
              <Field id="p-shelf" label="Shelf">
                <Input value={form.shelf} onChange={(e) => set('shelf', e.target.value)} />
              </Field>
              <Field id="p-bin" label="Bin">
                <Input value={form.bin} onChange={(e) => set('bin', e.target.value)} />
              </Field>
              <Field id="p-batch" label="Batch number">
                <Input
                  value={form.batchNumber}
                  onChange={(e) => set('batchNumber', e.target.value)}
                />
              </Field>
              <Field id="p-lot" label="Lot number">
                <Input value={form.lotNumber} onChange={(e) => set('lotNumber', e.target.value)} />
              </Field>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Visibility</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="p-status" className="text-sm font-medium">
                  Status
                </label>
                <Select value={form.status} onValueChange={(v) => set('status', v as Status)}>
                  <SelectTrigger id="p-status">
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
              </div>

              <CheckboxField
                id="p-featured"
                label="Featured"
                description="Sorted to the top of the shop page"
                checked={form.isFeatured}
                onChange={(v) => set('isFeatured', v)}
              />
              <CheckboxField
                id="p-new"
                label="Mark as new"
                description="Shows a New badge on the product block"
                checked={form.isNew}
                onChange={(v) => set('isNew', v)}
              />

              <Field id="p-tags" label="Tags" hint="Comma separated. Customers can search these.">
                <Input
                  value={form.tags}
                  onChange={(e) => set('tags', e.target.value)}
                  placeholder="local, fresh, gluten-free"
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Identifiers</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field id="p-sku" label="SKU" hint="Must be unique" required>
                <Input
                  value={form.sku}
                  onChange={(e) => set('sku', e.target.value.toUpperCase())}
                  className="font-mono"
                />
              </Field>
              <Field id="p-barcode" label="Barcode">
                <Input
                  value={form.barcode}
                  onChange={(e) => set('barcode', e.target.value)}
                  className="font-mono"
                />
              </Field>
              <Field
                id="p-slug"
                label="Web address"
                hint={
                  isEdit ? 'Changing this breaks any existing links' : 'Filled in from the name'
                }
              >
                <Input
                  value={form.slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    set('slug', e.target.value);
                  }}
                  className="font-mono"
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Internal notes</CardTitle>
            </CardHeader>
            <CardContent>
              <Field id="p-notes" label="Staff only" hint="Customers never see this">
                <Textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => set('notes', e.target.value)}
                />
              </Field>
            </CardContent>
          </Card>
        </div>
      </div>

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

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {pending ? 'Saving' : isEdit ? 'Save changes' : 'Create product'}
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link href="/admin/products">Cancel</Link>
        </Button>

        {product ? <DangerZone product={product} /> : null}
      </div>
    </form>
  );
}

/**
 * Archive is offered first because it is almost always the right answer:
 * it hides the product without touching its stock history.
 */
function DangerZone({ product }: { product: EditableProduct }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  return (
    <div className="ml-auto flex items-center gap-2">
      {error ? (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}

      {product.status === 'archived' ? (
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await setProductStatus(product.id, 'active');
              if (!result.ok) setError(result.message);
              else router.refresh();
            })
          }
        >
          Restore to the shop
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await setProductStatus(product.id, 'archived');
              if (!result.ok) setError(result.message);
              else router.refresh();
            })
          }
        >
          Archive
        </Button>
      )}

      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Delete this product permanently"
        disabled={pending}
        onClick={() => {
          if (
            !window.confirm(
              `Delete ${product.name} permanently?\n\nIts stock history goes with it. Past orders keep their own copy of the name and price. Archiving is usually the better choice.`,
            )
          ) {
            return;
          }
          startTransition(async () => {
            const result = await deleteProduct(product.id);
            if (!result.ok) setError(result.message);
            else router.push('/admin/products');
          });
        }}
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}
