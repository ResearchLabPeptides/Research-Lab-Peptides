'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Check, ChevronDown, Eye, EyeOff, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  createCategory,
  deleteCategory,
  renameCategory,
  setCategoryVisible,
} from '@/lib/actions/categories';
import { cn } from '@/lib/utils';

export interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  product_count: number;
}

/**
 * Categories, managed where the products are.
 *
 * Previously the only way to create one was mid-way through adding a product,
 * so you could not set the shop up before you had stock, and a mistyped name
 * was permanent.
 *
 * Collapsed by default: most visits to this page are about stock, not about
 * reorganising the catalogue, and an always-open panel pushes the product table
 * below the fold for no reason.
 */
export function CategoryManager({ categories }: { categories: CategoryRow[] }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [pending, startTransition] = useTransition();

  const hidden = categories.filter((c) => !c.is_active).length;
  const empty = categories.filter((c) => c.product_count === 0 && c.is_active).length;

  function run(action: () => Promise<{ ok: boolean; message: string }>, after?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(result.message);
        after?.();
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <Card className="overflow-hidden p-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-muted/50"
      >
        <span className="min-w-0">
          <span className="text-sm font-semibold">Categories</span>
          <span className="ml-2 text-sm text-muted-foreground">
            {categories.length}
            {hidden > 0 ? ` · ${hidden} hidden` : ''}
            {empty > 0 ? ` · ${empty} empty` : ''}
          </span>
        </span>
        <ChevronDown
          className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {open ? (
        <div className="border-t border-border px-5 py-4">
          {/* Empty categories are hidden from the shop automatically, so this is
              information rather than a task — but staff should know why a
              category they can see here is not on the storefront. */}
          {empty > 0 ? (
            <p className="mb-3 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              A category with nothing in stock is not shown in the shop, so customers never hit an
              empty page. It reappears on its own once a product is in it.
            </p>
          ) : null}

          <ul className="divide-y divide-border">
            {categories.map((category) => {
              const isEditing = editingId === category.id;

              return (
                <li key={category.id} className="flex items-center gap-2 py-2.5">
                  {isEditing ? (
                    <>
                      <Input
                        value={editingName}
                        autoFocus
                        onChange={(event) => setEditingName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') setEditingId(null);
                          if (event.key === 'Enter') {
                            run(() => renameCategory(category.id, editingName), () =>
                              setEditingId(null),
                            );
                          }
                        }}
                        className="h-9 flex-1"
                      />
                      <button
                        type="button"
                        disabled={pending}
                        aria-label="Save name"
                        onClick={() =>
                          run(() => renameCategory(category.id, editingName), () =>
                            setEditingId(null),
                          )
                        }
                        className="grid size-9 place-items-center rounded-md border border-border hover:bg-muted"
                      >
                        <Check className="size-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label="Cancel"
                        onClick={() => setEditingId(null)}
                        className="grid size-9 place-items-center rounded-md border border-border hover:bg-muted"
                      >
                        <X className="size-4" aria-hidden />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1">
                        <span className="text-sm font-medium">{category.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {category.product_count}{' '}
                          {category.product_count === 1 ? 'product' : 'products'}
                        </span>
                        {!category.is_active ? (
                          <Badge tone="slate" className="ml-2">
                            Hidden
                          </Badge>
                        ) : null}
                      </span>

                      <button
                        type="button"
                        disabled={pending}
                        aria-label={`Rename ${category.name}`}
                        onClick={() => {
                          setEditingId(category.id);
                          setEditingName(category.name);
                        }}
                        className="grid size-9 place-items-center rounded-md border border-border text-muted-foreground hover:bg-muted"
                      >
                        <Pencil className="size-4" aria-hidden />
                      </button>

                      <button
                        type="button"
                        disabled={pending}
                        aria-label={
                          category.is_active
                            ? `Hide ${category.name} from the shop`
                            : `Show ${category.name} in the shop`
                        }
                        onClick={() =>
                          run(() => setCategoryVisible(category.id, !category.is_active))
                        }
                        className="grid size-9 place-items-center rounded-md border border-border text-muted-foreground hover:bg-muted"
                      >
                        {category.is_active ? (
                          <Eye className="size-4" aria-hidden />
                        ) : (
                          <EyeOff className="size-4" aria-hidden />
                        )}
                      </button>

                      <button
                        type="button"
                        disabled={pending}
                        aria-label={`Delete ${category.name}`}
                        onClick={() => {
                          if (category.product_count > 0) {
                            toast.error(
                              `${category.product_count} product${
                                category.product_count === 1 ? '' : 's'
                              } still in it. Move them first, or hide it instead.`,
                            );
                            return;
                          }
                          if (!confirm(`Delete "${category.name}"? This cannot be undone.`)) return;
                          run(() => deleteCategory(category.id));
                        }}
                        className="grid size-9 place-items-center rounded-md border border-border text-muted-foreground hover:bg-muted disabled:opacity-40"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <Input
              value={adding}
              placeholder="New category name"
              className="h-9 max-w-56"
              onChange={(event) => setAdding(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && adding.trim()) {
                  run(() => createCategory(adding), () => setAdding(''));
                }
              }}
            />
            <Button
              size="sm"
              disabled={pending || adding.trim().length < 2}
              onClick={() => run(() => createCategory(adding), () => setAdding(''))}
            >
              <Plus className="size-4" aria-hidden />
              Add
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
