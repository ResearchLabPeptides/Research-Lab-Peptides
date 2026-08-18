'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import type { ActionResult } from './orders';

/** Lowercase, hyphenated, no punctuation — the same rule the product form uses. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Adds a category.
 *
 * Until now the only way to make one was while creating a product, which meant
 * you could not set the shop up before you had something to put in it, and a
 * typo in a category name was permanent.
 */
export async function createCategory(name: string): Promise<ActionResult> {
  await requireStaff('manager');

  const clean = name.trim();
  if (clean.length < 2) {
    return { ok: false, message: 'Give the category a name of at least two characters.' };
  }
  if (clean.length > 60) {
    return { ok: false, message: 'That name is too long — keep it under 60 characters.' };
  }

  const slug = slugify(clean);
  if (!slug) {
    return { ok: false, message: 'That name has no letters or numbers in it.' };
  }

  const supabase = await createClient();

  // Checked before inserting so the message says what happened, rather than
  // surfacing a unique-constraint error.
  const { data: existing } = await supabase
    .from('categories')
    .select('id, name')
    .eq('slug', slug)
    .maybeSingle();

  if (existing) {
    return { ok: false, message: `"${existing.name}" already exists.` };
  }

  // Sorted to the end. Reordering is a separate, deliberate act.
  const { data: last } = await supabase
    .from('categories')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1);

  const { error } = await supabase.from('categories').insert({
    name: clean,
    slug,
    sort_order: (last?.[0]?.sort_order ?? 0) + 10,
  });

  if (error) return { ok: false, message: `Could not add it: ${error.message}` };

  revalidatePath('/admin/products');
  revalidatePath('/');

  return { ok: true, message: `"${clean}" added.` };
}

/** Renames a category. The slug follows, so the storefront URL stays sensible. */
export async function renameCategory(id: string, name: string): Promise<ActionResult> {
  await requireStaff('manager');

  const clean = name.trim();
  if (clean.length < 2) {
    return { ok: false, message: 'Give the category a name of at least two characters.' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('categories')
    .update({ name: clean, slug: slugify(clean) })
    .eq('id', id);

  if (error) return { ok: false, message: `Could not rename it: ${error.message}` };

  revalidatePath('/admin/products');
  revalidatePath('/');

  return { ok: true, message: `Renamed to "${clean}".` };
}

/**
 * Shows or hides a category in the shop.
 *
 * Hiding is not deleting: the products keep their category, the reports keep
 * their history, and turning it back on restores everything. This is the right
 * tool for something seasonal, or for a range you have stopped stocking but may
 * return to.
 */
export async function setCategoryVisible(id: string, visible: boolean): Promise<ActionResult> {
  await requireStaff('manager');

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('categories')
    .update({ is_active: visible })
    .eq('id', id)
    .select('name')
    .single();

  if (error) return { ok: false, message: `Could not change it: ${error.message}` };

  revalidatePath('/admin/products');
  revalidatePath('/');

  return {
    ok: true,
    message: visible ? `"${data.name}" is showing in the shop.` : `"${data.name}" is hidden.`,
  };
}

/**
 * Deletes a category.
 *
 * Refused while any product still points at it. The alternative — deleting it
 * and leaving those products uncategorised — loses information silently, and
 * the person deleting has no idea how many products they just affected. Better
 * to say how many and let them decide.
 */
export async function deleteCategory(id: string): Promise<ActionResult> {
  await requireStaff('manager');

  const supabase = await createClient();

  const { count } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', id);

  if (count && count > 0) {
    return {
      ok: false,
      message: `${count} product${count === 1 ? '' : 's'} still ${
        count === 1 ? 'uses' : 'use'
      } this category. Move them first, or hide the category instead of deleting it.`,
    };
  }

  const { data, error } = await supabase
    .from('categories')
    .delete()
    .eq('id', id)
    .select('name')
    .single();

  if (error) return { ok: false, message: `Could not delete it: ${error.message}` };

  revalidatePath('/admin/products');
  revalidatePath('/');

  return { ok: true, message: `"${data.name}" deleted.` };
}
