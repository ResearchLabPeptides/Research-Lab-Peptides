import { cookies } from 'next/headers';
import { NextResponse, after } from 'next/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { sendOrderPlacedEmail } from '@/lib/order-email';
import { LIMITS, callerKey, checkRateLimit, tooManyRequests } from '@/lib/rate-limit';
import { GATE_COOKIE, verifyGate } from '@/lib/gate';
import { placeOrderSchema } from '@/lib/validation';
import type { PlacedOrder } from '@/lib/types';

/**
 * Checkout.
 *
 * Runs with the service role because the customer has no account and therefore
 * no session. That is safe only because every decision that matters — prices,
 * stock, delivery fee, tax, order number — is made inside place_order() in the
 * database. This route contributes nothing to the total; it only forwards
 * validated intent.
 *
 * The acknowledgements come from the signed, httpOnly gate cookie rather than
 * from the request body, so the browser cannot claim consent it was never
 * given. place_order() then re-checks them against what is currently required.
 */
export async function POST(request: Request) {
  // Checked before the body is even parsed, so a flood costs as little as possible.
  const ip = await checkRateLimit(`checkout:${callerKey(request)}`, LIMITS.checkout);
  if (!ip.allowed) {
    return tooManyRequests(
      ip,
      'That is a lot of orders in a short time. Wait a few minutes and try again, or call us.',
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const parsed = placeOrderSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Check your details and try again.' },
      { status: 400 },
    );
  }

  const { customer, items, couponCode, paymentMethod } = parsed.data;

  // Temporary: says what actually arrived and what is being forwarded, so a
  // browser sending the wrong thing can be told apart from a database ignoring
  // the right thing. Both look identical from the orders list.
  console.info(
    '[checkout] payment method — raw body:',
    JSON.stringify((payload as { paymentMethod?: unknown })?.paymentMethod),
    '| after validation:',
    paymentMethod,
  );

  // Keyed on the email as well, so rotating addresses does not reset the count.
  const byEmail = await checkRateLimit(
    `checkout-email:${customer.email.toLowerCase()}`,
    LIMITS.checkoutEmail,
  );
  if (!byEmail.allowed) {
    return tooManyRequests(
      byEmail,
      'That is a lot of orders on this email in a short time. Give us a call and we will sort it out.',
    );
  }

  // Two lines for the same product would each pass validation but double-count
  // against stock. Merge them before the database sees them.
  const merged = new Map<string, number>();
  for (const item of items) {
    merged.set(item.productId, (merged.get(item.productId) ?? 0) + item.quantity);
  }

  const cookieStore = await cookies();
  const gate = verifyGate(cookieStore.get(GATE_COOKIE)?.value);

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc('place_order', {
    p_payload: {
      customer: { name: customer.name, email: customer.email, phone: customer.phone },
      address: {
        line1: customer.addressLine1,
        line2: customer.addressLine2,
        city: customer.city,
        province: customer.province,
        postal_code: customer.postalCode,
        notes: customer.deliveryNotes,
      },
      acknowledgements: gate?.keys ?? [],
      coupon_code: couponCode,
      // Was missing entirely: the schema validated it and the route then
      // dropped it, so place_order() fell back to its 'interac' default and
      // every USDC order was recorded — and given payment instructions — as an
      // e-Transfer. The customer got the wrong instructions and staff had no
      // way to tell the two apart.
      payment_method: paymentMethod,
      items: [...merged].map(([product_id, quantity]) => ({ product_id, quantity })),
    },
  });

  if (data) {
    const placed = data as { order_number?: string; payment_method?: string };
    console.info(
      '[checkout] order',
      placed.order_number,
      'stored as',
      placed.payment_method ?? '(place_order returned no payment_method)',
    );
  }

  if (error) {
    // place_order() raises messages written for customers ("Sourdough Loaf only
    // has 0 left"), so they can be shown as-is. Anything else is a real fault.
    const expected =
      error.code === 'P0001' ||
      /only has|no longer|deliver to|start at|at least one|acknowledg/i.test(error.message);

    if (!expected) console.error('[checkout] place_order failed', error);

    return NextResponse.json(
      { error: expected ? error.message : 'We could not place your order. Please try again.' },
      { status: expected ? 409 : 500 },
    );
  }

  const placed = data as PlacedOrder;

  // The confirmation carries the payment instructions, so it matters — but the
  // order already exists and is on screen. Never make the customer wait on an
  // email provider, and never fail their order because one is down.
  //
  // after(), not a floating promise. On serverless the instance is frozen as
  // soon as the response is sent, so `void sendOrderPlacedEmail(...)` starts
  // the send and then has it killed part-way through: the order succeeds and
  // the customer silently never gets their payment instructions. after() keeps
  // the invocation alive until the send finishes, while still returning the
  // response immediately.
  after(async () => {
    try {
      await sendOrderPlacedEmail(placed.order_id);
    } catch (error) {
      console.error('[checkout] confirmation email failed', error);
    }
  });

  return NextResponse.json(placed, { status: 201 });
}
