'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import { describeAddressProblem, isValidSolanaAddress, parseUsdcToMicros } from '@/lib/solana';
import { confirmUsdcSchema, usdcSettingsSchema } from '@/lib/validation';
import type { ActionResult } from './orders';

/**
 * Adds receiving addresses to the pool from a pasted block of text.
 *
 * These are addresses, not wallets — they all belong to the one wallet on the
 * shop's phone, so there is nothing per-order to fund or sweep.
 *
 * Every line is validated before a single row is written, and the whole batch
 * is rejected if any line is bad. Partially importing a list and reporting
 * "14 of 20 added" invites someone to assume the rest went in too — and the
 * cost of an address that is not really in the pool is an order that cannot be
 * paid, while the cost of a wrong address is a customer's money gone for good.
 */
export async function addUsdcAddresses(rawText: string): Promise<ActionResult> {
  await requireStaff('manager');

  const lines = rawText
    .split(/[\s,;]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { ok: false, message: 'Paste at least one address.' };
  }

  if (lines.length > 500) {
    return { ok: false, message: 'Add at most 500 addresses at a time.' };
  }

  const problems: string[] = [];
  lines.forEach((line, index) => {
    const problem = describeAddressProblem(line);
    if (problem) problems.push(`Line ${index + 1}: ${problem}`);
  });

  if (problems.length > 0) {
    return {
      ok: false,
      message: `Nothing was added. Fix these first:\n${problems.slice(0, 8).join('\n')}${
        problems.length > 8 ? `\n…and ${problems.length - 8} more.` : ''
      }`,
    };
  }

  // A duplicate inside the pasted block would otherwise fail halfway through
  // the insert and leave the batch part-applied.
  const seen = new Set<string>();
  const duplicates = lines.filter((line) => {
    if (seen.has(line)) return true;
    seen.add(line);
    return false;
  });

  if (duplicates.length > 0) {
    return {
      ok: false,
      message: `That list repeats the same address: ${duplicates[0]}. Each address can only be used once.`,
    };
  }

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from('usdc_addresses')
    .select('position')
    .order('position', { ascending: false })
    .limit(1);

  const startAt = (existing?.[0]?.position ?? -1) + 1;

  const { error } = await supabase.from('usdc_addresses').insert(
    lines.map((address, index) => ({
      address,
      position: startAt + index,
    })),
  );

  if (error) {
    if (error.code === '23505') {
      return {
        ok: false,
        message: 'One of those addresses is already in the pool. Nothing was added.',
      };
    }
    return { ok: false, message: error.message };
  }

  revalidatePath('/admin/payments');

  return {
    ok: true,
    message: `Added ${lines.length} address${lines.length === 1 ? '' : 'es'} to the pool.`,
  };
}

/**
 * Takes an address out of circulation without deleting it.
 *
 * History has to survive: an address that already carried an order needs to
 * stay readable on that order forever, so this never removes a row.
 */
export async function retireUsdcAddress(id: string, note: string): Promise<ActionResult> {
  await requireStaff('manager');

  const supabase = await createClient();
  const { error } = await supabase
    .from('usdc_addresses')
    .update({ is_retired: true, notes: note })
    .eq('id', id);

  if (error) return { ok: false, message: error.message };

  revalidatePath('/admin/payments');
  return { ok: true, message: 'Address retired. It will not be handed out again.' };
}

/**
 * Records the USDC that actually arrived.
 *
 * Staff type in what they can see in their wallet. Nothing here reads the
 * Solana network, by design — the person confirming has already looked at the
 * real thing, which is a stronger check than any automated one this system
 * could make without an RPC node.
 */
export async function confirmUsdcPayment(input: unknown): Promise<ActionResult> {
  await requireStaff('employee');

  const parsed = confirmUsdcSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the amount.' };
  }

  const micros = parseUsdcToMicros(parsed.data.amount);
  if (micros === null || micros <= 0) {
    return { ok: false, message: 'Enter the USDC amount as a number, for example 36.50.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('confirm_usdc_payment', {
    p_order_id: parsed.data.orderId,
    p_received_micros: micros,
    p_note: parsed.data.note ?? '',
  });

  if (error) return { ok: false, message: error.message };

  const result = data as { payment_status: string; shortfall_micros: number };

  revalidatePath('/admin/orders');
  revalidatePath(`/admin/orders/${parsed.data.orderId}`);
  revalidatePath('/admin/payments');

  if (result.payment_status === 'paid') {
    return { ok: true, message: 'Payment confirmed. The order has moved to Payment received.' };
  }

  const short = (result.shortfall_micros / 1_000_000).toFixed(2);
  return {
    ok: true,
    message: `Recorded as part paid — ${short} USDC short. The order stays on hold until the rest arrives.`,
  };
}

/** Turns USDC on and off and adjusts the thresholds behind it. */
export async function saveUsdcSettings(input: unknown): Promise<ActionResult> {
  await requireStaff('administrator');

  const parsed = usdcSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the values.' };
  }

  const supabase = await createClient();

  // Switching it on with an empty pool would advertise a payment method that
  // cannot complete, so the check happens before the write rather than as a
  // surprise at someone's checkout.
  if (parsed.data.enabled) {
    const { count } = await supabase
      .from('usdc_addresses')
      .select('id', { count: 'exact', head: true })
      .is('order_id', null)
      .eq('is_retired', false);

    if (!count) {
      return {
        ok: false,
        message: 'Add some payment addresses before turning USDC on.',
      };
    }
  }

  const { error } = await supabase
    .from('settings')
    .update({
      usdc_enabled: parsed.data.enabled,
      usdc_markup_bps: parsed.data.markupBps,
      usdc_low_pool_threshold: parsed.data.lowPoolThreshold,
      usdc_quote_minutes: parsed.data.quoteMinutes,
      usdc_rate_max_age_hours: parsed.data.rateMaxAgeHours,
    })
    .eq('id', true);

  if (error) return { ok: false, message: error.message };

  revalidatePath('/admin/payments');
  revalidatePath('/');

  return { ok: true, message: 'Saved.' };
}

/** Manual rate refresh, for when staff do not want to wait for the schedule. */
export async function refreshRateNow(): Promise<ActionResult> {
  await requireStaff('manager');

  const { refreshCachedRate } = await import('@/lib/fx');
  const result = await refreshCachedRate();

  revalidatePath('/admin/payments');

  if (!result.ok) {
    return { ok: false, message: result.message ?? 'Could not reach the rate service.' };
  }

  return { ok: true, message: `Rate updated: 1 USDC = ${result.rate?.toFixed(4)} CAD.` };
}

// Re-exported so the address paste box can validate as the user types without
// pulling a server module into the browser bundle.
export async function validateAddressLine(line: string): Promise<string | null> {
  return isValidSolanaAddress(line) ? null : describeAddressProblem(line);
}
