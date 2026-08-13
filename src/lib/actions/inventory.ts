'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import { stockAdjustmentSchema } from '@/lib/validation';
import type { ActionResult } from './orders';

/**
 * The only route from the UI to a stock change. It calls
 * apply_inventory_movement(), which writes the ledger row and the new quantity
 * in one transaction — there is no code path anywhere that sets
 * products.quantity directly.
 */
export async function adjustStock(input: unknown): Promise<ActionResult> {
  await requireStaff('employee');

  const parsed = stockAdjustmentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the adjustment.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('apply_inventory_movement', {
    p_product_id: parsed.data.productId,
    p_type: parsed.data.type,
    p_change: parsed.data.quantityChange,
    p_reason: parsed.data.reason,
    p_notes: parsed.data.notes ?? '',
  });

  if (error) return { ok: false, message: error.message };

  revalidatePath('/admin/products');
  revalidatePath('/admin');
  revalidatePath('/', 'page');

  const verb = parsed.data.quantityChange > 0 ? 'Added' : 'Removed';
  return {
    ok: true,
    message: `${verb} ${Math.abs(parsed.data.quantityChange)} and logged it to the ledger.`,
  };
}

export async function resolveAlert(alertId: number): Promise<ActionResult> {
  await requireStaff('employee');

  const supabase = await createClient();
  const { error } = await supabase
    .from('inventory_alerts')
    .update({ is_resolved: true, resolved_at: new Date().toISOString() })
    .eq('id', alertId);

  if (error) return { ok: false, message: error.message };

  revalidatePath('/admin');
  return { ok: true, message: 'Alert cleared.' };
}
