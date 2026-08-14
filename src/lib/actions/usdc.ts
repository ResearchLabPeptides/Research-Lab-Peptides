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

/**
 * Saves the crypto payment discount.
 *
 * Capped at 50% for the same reason the database caps it: a larger figure is
 * far more likely to be a typo than an intention, and the cost of that typo is
 * every order that day going out at a fraction of its price.
 */
export async function saveCryptoDiscount(input: {
  enabled: boolean;
  bps: number;
  label: string;
  stacks: boolean;
  maxCents: number;
}): Promise<ActionResult> {
  await requireStaff('administrator');

  if (!Number.isFinite(input.bps) || input.bps < 0 || input.bps > 5000) {
    return { ok: false, message: 'Enter a discount between 0% and 50%.' };
  }

  if (input.enabled && input.bps === 0) {
    return { ok: false, message: 'Set a percentage above 0, or switch the discount off.' };
  }

  if (!Number.isFinite(input.maxCents) || input.maxCents < 0) {
    return { ok: false, message: 'The ceiling must be a positive amount, or blank for no limit.' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('settings')
    .update({
      crypto_discount_enabled: input.enabled,
      crypto_discount_bps: input.bps,
      crypto_discount_label: input.label,
      crypto_discount_stacks: input.stacks,
      crypto_discount_max_cents: input.maxCents,
    })
    .eq('id', true);

  // Checked rather than assumed: an unchecked write here would leave the screen
  // showing a saved setting that never reached the database.
  if (error) return { ok: false, message: `Could not save: ${error.message}` };

  revalidatePath('/admin/coupons');
  revalidatePath('/');

  return {
    ok: true,
    message: input.enabled
      ? `Saved. USDC customers get ${(input.bps / 100).toFixed(2)}% off.`
      : 'Saved. The crypto discount is off.',
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

export async function refreshRateNow(): Promise<ActionResult> {
  await requireStaff('manager');

  const { fetchUsdcCadRate } = await import('@/lib/fx');
  const supabase = await createClient();

  // Counted, not refused. A person asking for a rate should always get one.
  await supabase.rpc('record_rate_call');

  const result = await fetchUsdcCadRate();

  // Saved through the same security definer function the automatic path uses,
  // so a misconfigured service role key cannot make this fail silently.
  const { error } = await supabase.rpc('save_fx_rate', {
    p_rate: result.ok ? result.rate : null,
    p_source: result.source ?? '',
    p_error: result.ok ? '' : (result.message ?? 'Unknown error'),
  });

  revalidatePath('/admin/payments');
  revalidatePath('/');

  if (error) {
    return { ok: false, message: `Could not save the result: ${error.message}` };
  }

  if (!result.ok) {
    return { ok: false, message: result.message ?? 'Could not reach the rate service.' };
  }

  return {
    ok: true,
    message: `Rate updated: 1 USDC = ${result.rate?.toFixed(4)} CAD, from ${result.source}.`,
  };
}

/** Sets the rate by hand when no service is reachable. */
export async function setRateManually(input: string): Promise<ActionResult> {
  await requireStaff('manager');

  const rate = Number(String(input).trim().replace(/[^0-9.]/g, ''));

  if (!Number.isFinite(rate) || rate <= 0) {
    return { ok: false, message: 'Enter the rate as a number, for example 1.37.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('save_fx_rate', {
    p_rate: rate,
    p_source: 'set by hand',
    p_error: '',
  });

  if (error) return { ok: false, message: `Could not save the rate: ${error.message}` };

  // save_fx_rate refuses an implausible figure rather than trusting the caller,
  // so its answer is reported instead of assuming the write took.
  const saved = (data as { ok?: boolean } | null)?.ok === true;
  if (!saved) {
    return { ok: false, message: `${rate} CAD per USDC is outside the plausible range.` };
  }

  revalidatePath('/admin/payments');
  revalidatePath('/');

  return { ok: true, message: `Rate set to 1 USDC = ${rate.toFixed(4)} CAD.` };
}

// Re-exported so the address paste box can validate as the user types without
// pulling a server module into the browser bundle.
export async function validateAddressLine(line: string): Promise<string | null> {
  return isValidSolanaAddress(line) ? null : describeAddressProblem(line);
}
