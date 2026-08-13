/**
 * Order pricing, shared by the checkout screen and anything else that needs to
 * show a total before the order exists.
 *
 * This mirrors what the database does in place_order_core and
 * crypto_discount_for. Two implementations of a price is one more than is safe:
 * if they ever disagree, the customer is shown one figure and charged another,
 * and the version nobody is looking at is the one that drifts. Keeping the
 * client's copy in a single file with the arithmetic written out plainly is the
 * best available guard, and the test suite checks the two against each other
 * across a wide range of baskets rather than trusting that they match.
 *
 * The ordering that matters: discounts come off the goods total, and tax is
 * charged on what is left plus delivery. A discount taken off the final figure
 * would tax the customer on money they never paid.
 */

export interface CryptoDiscountSettings {
  enabled: boolean;
  bps: number;
  stacks: boolean;
  maxCents: number;
}

/**
 * The USDC discount in cents. Mirrors crypto_discount_for().
 *
 * Takes the coupon discount rather than ignoring it, because the two interact
 * and because together they must never exceed the goods value.
 */
export function cryptoDiscountCents(
  subtotalCents: number,
  couponOnSubtotalCents: number,
  settings: CryptoDiscountSettings,
): number {
  if (!settings.enabled || settings.bps <= 0) return 0;

  // Not stacking means the coupon wins outright, so a customer never loses a
  // better deal by choosing USDC.
  if (couponOnSubtotalCents > 0 && !settings.stacks) return 0;

  let amount = Math.round((subtotalCents * settings.bps) / 10000);

  if (settings.maxCents > 0) amount = Math.min(amount, settings.maxCents);

  return Math.max(0, Math.min(amount, subtotalCents - couponOnSubtotalCents));
}

export interface PricedOrder {
  subtotalCents: number;
  couponCents: number;
  cryptoCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  taxCents: number;
  totalCents: number;
}

/** Prices a basket. Mirrors the totals block of place_order_core. */
export function priceOrder({
  subtotalCents,
  couponOnSubtotalCents,
  deliveryFeeCents,
  taxRateBps,
  cryptoCents,
}: {
  subtotalCents: number;
  couponOnSubtotalCents: number;
  deliveryFeeCents: number;
  taxRateBps: number;
  cryptoCents: number;
}): PricedOrder {
  const discountCents = couponOnSubtotalCents + cryptoCents;
  const taxCents = Math.round(
    ((subtotalCents - discountCents + deliveryFeeCents) * taxRateBps) / 10000,
  );

  return {
    subtotalCents,
    couponCents: couponOnSubtotalCents,
    cryptoCents,
    discountCents,
    deliveryFeeCents,
    taxCents,
    totalCents: subtotalCents - discountCents + deliveryFeeCents + taxCents,
  };
}

/**
 * What choosing USDC is actually worth, in cents.
 *
 * Deliberately computed as the difference between two fully priced orders
 * rather than as "the discount, plus some tax". The customer's saving is
 * whatever their total moves by, and the only way to be certain the advertised
 * figure matches the charged one is to price it both ways and subtract. Any
 * shortcut here is a place where the number on the button and the number on the
 * receipt can quietly diverge.
 */
export function cryptoSavingCents({
  subtotalCents,
  couponOnSubtotalCents,
  deliveryFeeCents,
  taxRateBps,
  settings,
}: {
  subtotalCents: number;
  couponOnSubtotalCents: number;
  deliveryFeeCents: number;
  taxRateBps: number;
  settings: CryptoDiscountSettings;
}): number {
  const cryptoCents = cryptoDiscountCents(subtotalCents, couponOnSubtotalCents, settings);
  if (cryptoCents <= 0) return 0;

  const withoutIt = priceOrder({
    subtotalCents,
    couponOnSubtotalCents,
    deliveryFeeCents,
    taxRateBps,
    cryptoCents: 0,
  });
  const withIt = priceOrder({
    subtotalCents,
    couponOnSubtotalCents,
    deliveryFeeCents,
    taxRateBps,
    cryptoCents,
  });

  return withoutIt.totalCents - withIt.totalCents;
}
