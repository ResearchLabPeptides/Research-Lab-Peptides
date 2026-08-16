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

  // One call to a security definer function instead of three table reads.
  //
  // The email path has no session, and the only read policy on `orders` is for
  // signed-in staff — so those reads depended entirely on the service role key
  // bypassing row level security. When that key is wrong they return empty with
  // no error, which is indistinguishable from the order not existing, and the
  // confirmation silently never sends. This asks the database for one specific
  // order by id and gets the same answer regardless of which key is in play.
  const { data: payload, error } = await supabase.rpc('order_for_email', {
    p_order_id: orderId,
  });

  if (error) {
    console.error('[email] could not load the order:', error.message);
    return null;
  }

  if (!payload) {
    console.error('[email] no order found for', orderId);
    return null;
  }

  const loadedOrder = payload as Record<string, unknown>;
  const order = loadedOrder;
  const items = (loadedOrder.items ?? []) as {
    name: string;
    quantity: number;
    line_total_cents: number;
  }[];
  const settings = (loadedOrder.settings ?? {}) as {
    company_name?: string;
    payment_email?: string;
    crypto_discount_label?: string;
  };

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
