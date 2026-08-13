'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import { sendOrderStatusEmail } from '@/lib/order-email';
import { orderStatusSchema, recordPaymentSchema } from '@/lib/validation';
import type { OrderStatus } from '@/lib/types';

export interface ActionResult {
  ok: boolean;
  message: string;
}

/**
 * Records an Interac e-Transfer against an order.
 *
 * The RPC does the real work under its own permission check, so a stale page or
 * a hand-crafted request cannot get further than a demoted user's actual role.
 */
export async function recordPayment(input: unknown): Promise<ActionResult> {
  await requireStaff('employee');

  const parsed = recordPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the amount.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('confirm_payment', {
    p_order_id: parsed.data.orderId,
    p_amount_cents: parsed.data.amountCents,
    p_received_at: parsed.data.receivedAt ?? new Date().toISOString(),
    p_reference: parsed.data.reference ?? '',
    p_notes: parsed.data.notes ?? '',
  });

  if (error) return { ok: false, message: error.message };

  const result = data as { fully_paid: boolean; balance_cents?: number };

  if (result.fully_paid) {
    await emailCustomer(parsed.data.orderId, 'preparing', 'Thanks — we have your payment.');
  }

  revalidatePath('/admin/orders');
  revalidatePath(`/admin/orders/${parsed.data.orderId}`);

  return {
    ok: true,
    message: result.fully_paid
      ? 'Payment confirmed. Stock deducted and the order is now preparing.'
      : 'Partial payment recorded. The order still has a balance.',
  };
}

export async function changeOrderStatus(input: unknown): Promise<ActionResult> {
  await requireStaff('employee');

  const parsed = orderStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Pick a status.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('set_order_status', {
    p_order_id: parsed.data.orderId,
    p_status: parsed.data.status,
    p_note: parsed.data.note ?? '',
  });

  if (error) return { ok: false, message: error.message };

  await emailCustomer(parsed.data.orderId, parsed.data.status, parsed.data.note ?? '');

  revalidatePath('/admin/orders');
  revalidatePath(`/admin/orders/${parsed.data.orderId}`);

  return { ok: true, message: 'Status updated and the customer has been emailed.' };
}

export async function saveTrackingNote(orderId: string, note: string): Promise<ActionResult> {
  await requireStaff('employee');

  const supabase = await createClient();
  const { error } = await supabase
    .from('orders')
    .update({ tracking_notes: note.slice(0, 1000) })
    .eq('id', orderId);

  if (error) return { ok: false, message: error.message };

  revalidatePath(`/admin/orders/${orderId}`);
  return { ok: true, message: 'Note saved. The customer sees this on their tracking page.' };
}

/** Best effort. An email that fails to send must not roll back the status change. */
async function emailCustomer(orderId: string, status: OrderStatus, note: string): Promise<void> {
  try {
    await sendOrderStatusEmail(orderId, status, note);
  } catch (error) {
    console.error('[email] status notification failed', error);
  }
}
