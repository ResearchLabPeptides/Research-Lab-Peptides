'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import {
  acknowledgementSchema,
  deliveryRuleSchema,
  deliveryZoneSchema,
  gateSettingsSchema,
  settingsSchema,
} from '@/lib/validation';
import type { ActionResult } from './orders';

export async function saveSettings(input: unknown): Promise<ActionResult> {
  await requireStaff('administrator');

  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the values.' };
  }

  const s = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from('settings')
    .update({
      company_name: s.companyName,
      currency: s.currency,
      tax_rate_bps: s.taxRateBps,
      payment_email: s.paymentEmail,
      delivery_email: s.deliveryEmail,
      support_phone: s.supportPhone,
      order_prefix: s.orderPrefix,
      low_stock_threshold_default: s.lowStockThresholdDefault,
      expiry_warning_days: s.expiryWarningDays,
    })
    .eq('id', true);

  if (error) return { ok: false, message: error.message };

  revalidatePath('/admin/settings');
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Settings saved.' };
}

export async function saveDeliveryZone(input: unknown, zoneId?: string): Promise<ActionResult> {
  await requireStaff('manager');

  const parsed = deliveryZoneSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the zone.' };
  }

  const z = parsed.data;
  const row = {
    name: z.name,
    code: z.code,
    description: z.description,
    fee_cents: z.feeCents,
    free_delivery_threshold_cents: z.freeDeliveryThresholdCents ?? null,
    minimum_order_cents: z.minimumOrderCents,
    max_distance_km: z.maxDistanceKm ?? null,
    estimated_minutes_min: z.estimatedMinutesMin,
    estimated_minutes_max: z.estimatedMinutesMax,
    priority: z.priority,
    is_active: z.isActive,
  };

  const supabase = await createClient();
  const { error } = zoneId
    ? await supabase.from('delivery_zones').update(row).eq('id', zoneId)
    : await supabase.from('delivery_zones').insert(row);

  if (error) return { ok: false, message: error.message };

  revalidatePath('/admin/delivery');
  return { ok: true, message: zoneId ? 'Zone updated.' : 'Zone created.' };
}

export async function saveDeliveryRule(input: unknown): Promise<ActionResult> {
  await requireStaff('manager');

  const parsed = deliveryRuleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the rule.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.from('delivery_rules').insert({
    zone_id: parsed.data.zoneId,
    match_type: parsed.data.matchType,
    match_value: parsed.data.matchValue,
    is_active: parsed.data.isActive,
  });

  if (error) {
    // The unique index on (match_type, match_value) is what stops one postal
    // code from belonging to two zones and making the fee ambiguous.
    const duplicate = error.code === '23505';
    return {
      ok: false,
      message: duplicate
        ? 'That postal code or city is already assigned to a zone.'
        : error.message,
    };
  }

  revalidatePath('/admin/delivery');
  return { ok: true, message: 'Rule added. New orders price against it immediately.' };
}

export async function deleteDeliveryRule(ruleId: string): Promise<ActionResult> {
  await requireStaff('manager');

  const supabase = await createClient();
  const { error } = await supabase.from('delivery_rules').delete().eq('id', ruleId);
  if (error) return { ok: false, message: error.message };

  revalidatePath('/admin/delivery');
  return { ok: true, message: 'Rule removed.' };
}

// --- Entry gate ---------------------------------------------------------------

export async function saveGateSettings(input: {
  gateEnabled: boolean;
  gateTitle: string;
  gateIntro: string;
  gateConfirmLabel: string;
  gateDeclineLabel: string;
  gateDeclineUrl: string;
  gateOptionalLabel: string;
  gateRemainingLabel: string;
  gateDoneLabel: string;
  gatePendingLabel: string;
  gateLinkLabel: string;
}): Promise<ActionResult> {
  await requireStaff('administrator');

  const parsed = gateSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the values.' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('settings')
    .update({
      gate_enabled: parsed.data.gateEnabled,
      gate_title: parsed.data.gateTitle,
      gate_intro: parsed.data.gateIntro,
      gate_confirm_label: parsed.data.gateConfirmLabel,
      gate_decline_label: parsed.data.gateDeclineLabel,
      gate_decline_url: parsed.data.gateDeclineUrl,
      gate_optional_label: parsed.data.gateOptionalLabel,
      gate_remaining_label: parsed.data.gateRemainingLabel,
      gate_done_label: parsed.data.gateDoneLabel,
      gate_pending_label: parsed.data.gatePendingLabel,
      gate_link_label: parsed.data.gateLinkLabel,
    })
    .eq('id', true);

  if (error) return { ok: false, message: error.message };

  revalidatePath('/admin/settings');
  revalidatePath('/', 'layout');
  return {
    ok: true,
    message: parsed.data.gateEnabled
      ? 'Gate saved. Visitors see it on their next page load.'
      : 'Gate turned off. The shop is now open to everyone.',
  };
}

export async function saveAcknowledgement(
  input: unknown,
  acknowledgementId?: string,
): Promise<ActionResult> {
  await requireStaff('manager');

  const parsed = acknowledgementSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the wording.' };
  }

  const a = parsed.data;
  const row = {
    key: a.key,
    label: a.label,
    body: a.body,
    link_url: a.linkUrl || null,
    link_label: a.linkLabel,
    is_required: a.isRequired,
    sort_order: a.sortOrder,
    is_active: a.isActive,
  };

  const supabase = await createClient();
  const { error } = acknowledgementId
    ? await supabase.from('site_acknowledgements').update(row).eq('id', acknowledgementId)
    : await supabase.from('site_acknowledgements').insert(row);

  if (error) {
    return {
      ok: false,
      message:
        error.code === '23505' ? 'Another acknowledgement already uses that key.' : error.message,
    };
  }

  revalidatePath('/admin/settings');
  revalidatePath('/', 'layout');
  return {
    ok: true,
    // Worth saying plainly: editing wording invalidates every existing consent.
    message: acknowledgementId
      ? 'Saved. Because the wording changed, everyone will be asked to confirm again.'
      : 'Added. Everyone will be asked to confirm again.',
  };
}

export async function setAcknowledgementActive(
  acknowledgementId: string,
  isActive: boolean,
): Promise<ActionResult> {
  await requireStaff('manager');

  const supabase = await createClient();
  const { error } = await supabase
    .from('site_acknowledgements')
    .update({ is_active: isActive })
    .eq('id', acknowledgementId);

  if (error) return { ok: false, message: error.message };

  revalidatePath('/admin/settings');
  revalidatePath('/', 'layout');
  return { ok: true, message: isActive ? 'Now shown at the gate.' : 'Retired from the gate.' };
}
