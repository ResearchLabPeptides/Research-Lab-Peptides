import 'server-only';
import { createServiceClient } from './supabase/admin';
import { formatMoney, formatPostalCode } from './format';
import {
  formatItemLines,
  sendTemplatedEmail,
  templateForStatus,
  type TemplateKey,
  type TemplateVars,
} from './email';

/**
 * Gathers everything a template can reference for one order.
 *
 * Reads with the service client because the customer emails are sent on behalf
 * of people who have no session — the same reason checkout itself does.
 */
async function loadVars(
  orderId: string,
  note = '',
): Promise<{ to: string; vars: TemplateVars } | null> {
  const supabase = createServiceClient();

  const [
    { data: order, error: orderError },
    { data: items, error: itemsError },
    { data: settings, error: settingsError },
  ] = await Promise.all([
    supabase.from('orders').select('*').eq('id', orderId).maybeSingle(),
    supabase
      .from('order_items')
      .select('name, quantity, line_total_cents')
      .eq('order_id', orderId)
      .order('name'),
    supabase
      .from('settings')
      .select('company_name, payment_email, crypto_discount_label')
      .maybeSingle(),
  ]);

  // Reported, not discarded. These reads go through the service role key, so
  // when that key is wrong they are refused by row level security and every one
  // of them comes back empty — which used to look exactly like "no such order".
  if (orderError) console.error('[email] could not read the order:', orderError.message);
  if (itemsError) console.error('[email] could not read the order items:', itemsError.message);
  if (settingsError) console.error('[email] could not read settings:', settingsError.message);

  if (!order) {
    console.error(
      `[email] no order row came back for ${orderId}.`,
      orderError
        ? 'The error above says why.'
        : 'No error was returned either, which means the row was filtered out — check that SUPABASE_SERVICE_ROLE_KEY in Vercel is the service_role secret, not the anon key.',
    );
    return null;
  }

  const o = order as Record<string, unknown>;
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? '';
  const email = String(o.customer_email);
  const orderNumber = String(o.order_number);

  const address = [
    String(o.address_line1),
    o.address_line2 ? String(o.address_line2) : '',
    `${String(o.city)}, ${String(o.province)} ${formatPostalCode(String(o.postal_code))}`,
  ]
    .filter(Boolean)
    .join('\n');

  const paymentEmail = String((settings as { payment_email?: string } | null)?.payment_email ?? '');
  const cryptoLabel = String(
    (settings as { crypto_discount_label?: string } | null)?.crypto_discount_label ?? '',
  );
  const usdcAmount = (Number(o.usdc_amount_micros ?? 0) / 1_000_000).toFixed(2);

  const shippingCents = Number(o.delivery_fee_cents);
  const discountCents = Number(o.discount_cents ?? 0);
  const cryptoCents = Number(o.crypto_discount_cents ?? 0);
  const couponCents = Math.max(0, discountCents - cryptoCents);
  const isUsdc = String(o.payment_method ?? 'interac') === 'usdc_solana';

  // Every discount, itemised. {discount} gives the single combined figure and
  // is kept for templates that already use it; this gives a customer the
  // breakdown, which matters once there is more than one reason their price
  // came down and they are trying to reconcile it against what they were shown
  // at checkout.
  const discountLines = [
    couponCents > 0
      ? `${o.coupon_code ? `${String(o.coupon_code)} — ` : ''}${
          o.coupon_label ? String(o.coupon_label) : 'Discount'
        }: -${formatMoney(couponCents)}`
      : '',
    cryptoCents > 0
      ? `${cryptoLabel || 'Crypto payment discount'}: -${formatMoney(cryptoCents)}`
      : '',
    o.delivery_discount_label ? `Shipping — ${String(o.delivery_discount_label)}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  // The instructions differ entirely by payment method, so a single template
  // cannot carry both. Hard-coding e-Transfer wording here would tell a USDC
  // customer to send money to an email address.
  const paymentInstructions = isUsdc
    ? [
        `Send exactly ${usdcAmount} USDC on the Solana network to:`,
        String(o.usdc_address ?? ''),
        '',
        'That address belongs to this order and no other.',
        'Only send USDC on the Solana network — anything else cannot be recovered.',
      ].join('\n')
    : [
        `Send an Interac e-Transfer of ${formatMoney(Number(o.total_cents))} to:`,
        paymentEmail,
        '',
        `Put ${orderNumber} in the message field so we can match it to your order.`,
      ].join('\n');

  return {
    to: email,
    vars: {
      company_name: String(
        (settings as { company_name?: string } | null)?.company_name ?? 'Our Shop',
      ),
      customer_name: String(o.customer_name),
      order_number: orderNumber,
      subtotal: formatMoney(Number(o.subtotal_cents)),
      shipping: shippingCents === 0 ? 'Free' : formatMoney(shippingCents),
      discount: discountCents > 0 ? `-${formatMoney(discountCents)}` : '—',
      discount_lines: discountLines || 'None',
      payment_method: isUsdc ? 'USDC on Solana' : 'Interac e-Transfer',
      payment_instructions: paymentInstructions,
      usdc_address: String(o.usdc_address ?? ''),
      usdc_amount: isUsdc ? `${usdcAmount} USDC` : '',
      tax: formatMoney(Number(o.tax_cents)),
      total: formatMoney(Number(o.total_cents)),
      items: formatItemLines(
        (items ?? []) as { name: string; quantity: number; line_total_cents: number }[],
      ),
      address,
      payment_email: paymentEmail,
      track_url: `${base}/orders/${orderNumber}?email=${encodeURIComponent(email)}`,
      note,
    },
  };
}

/**
 * The confirmation, sent the moment an order is placed.
 *
 * Every exit says why. An earlier version returned quietly when the order could
 * not be loaded, which meant a failure to send looked identical to a send that
 * never happened: nothing in the application log, nothing at the provider, and
 * no way to tell which of the two it was.
 */
export async function sendOrderPlacedEmail(orderId: string): Promise<void> {
  console.info('[email] order_placed: starting for', orderId);

  const loaded = await loadVars(orderId);
  if (!loaded) {
    console.error('[email] order_placed: could not load the order or its settings', orderId);
    return;
  }

  console.info('[email] order_placed: sending to', loaded.to);
  await sendTemplatedEmail('order_placed', loaded.to, loaded.vars);
  console.info('[email] order_placed: handed to the provider for', loaded.to);
}

/** The follow-up for a status change, if that status has a template. */
export async function sendOrderStatusEmail(
  orderId: string,
  status: string,
  note = '',
): Promise<void> {
  const key: TemplateKey | null = templateForStatus(status);
  if (!key) return;

  const loaded = await loadVars(orderId, note);
  if (!loaded) return;
  await sendTemplatedEmail(key, loaded.to, loaded.vars);
}
