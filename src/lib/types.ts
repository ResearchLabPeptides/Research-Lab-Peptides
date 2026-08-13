/**
 * Domain types.
 *
 * These are hand-written so the repository type-checks before you have a
 * Supabase project. Once your project is up, `npm run db:types` regenerates
 * `src/lib/supabase/database.types.ts` from the live schema; the two are kept
 * deliberately compatible.
 */

export type UserRole = 'read_only' | 'employee' | 'manager' | 'administrator';
export type ProductStatus = 'active' | 'inactive' | 'discontinued' | 'archived';
export type PaymentStatus = 'unpaid' | 'partially_paid' | 'paid' | 'refunded';

/** Futurelite adds a second way to pay alongside the original e-Transfer. */
export type PaymentMethod = 'interac' | 'usdc_solana';

export interface UsdcQuote {
  address: string;
  amount_micros: number;
  amount_display: string;
  rate_cad: number;
  quote_expires_at: string | null;
  expired: boolean;
  received_micros: number;
  confirmed_at: string | null;
}

/**
 * A receiving address, not a wallet. Every address in the pool belongs to the
 * same wallet on the shop's phone.
 */
export interface UsdcAddress {
  id: string;
  address: string;
  position: number;
  label: string;
  order_id: string | null;
  assigned_at: string | null;
  is_retired: boolean;
  notes: string;
  created_at: string;
}

export interface UsdcPoolStats {
  total: number;
  available: number;
  assigned: number;
  retired: number;
  low: boolean;
  threshold: number;
  enabled: boolean;
  rate_ok: boolean;
}
export type AlertType = 'low_stock' | 'out_of_stock' | 'expiring' | 'expired';

export type OrderStatus =
  | 'pending_payment'
  | 'payment_received'
  | 'preparing'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'
  | 'refunded';

export type MovementType =
  | 'receiving'
  | 'sale'
  | 'adjustment'
  | 'return'
  | 'damaged'
  | 'expired'
  | 'transfer'
  | 'cycle_count'
  | 'reservation'
  | 'reservation_release';

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string;
  sort_order: number;
  is_active: boolean;
}

export interface ProductImage {
  id: string;
  storage_path: string;
  alt_text: string;
  sort_order: number;
  is_primary: boolean;
}

/** What the storefront is allowed to know about a product. No cost, no supplier. */
export interface StorefrontProduct {
  id: string;
  sku: string;
  name: string;
  slug: string;
  description: string;
  price_cents: number;
  compare_at_cents: number | null;
  unit: string;
  quantity: number;
  quantity_reserved: number;
  is_featured: boolean;
  is_new: boolean;
  tags: string[];
  category_id: string | null;
  created_at: string;
  categories: { name: string; slug: string } | null;
  product_images: ProductImage[];
}

/** Stock a shopper can actually add. Reserved units belong to someone else. */
export function availableStock(product: Pick<StorefrontProduct, 'quantity' | 'quantity_reserved'>) {
  return Math.max(0, product.quantity - product.quantity_reserved);
}

export interface CartLine {
  productId: string;
  slug: string;
  name: string;
  unit: string;
  priceCents: number;
  quantity: number;
  imagePath: string | null;
}

export interface DeliveryQuote {
  deliverable: boolean;
  reason?: 'outside_zone' | 'below_minimum';
  message?: string;
  zone_id?: string;
  zone_name?: string;
  zone_code?: string;
  fee_cents?: number;
  base_fee_cents?: number;
  free_delivery_applied?: boolean;
  discount_applied?: boolean;
  /** Wording of the modifier that lowered the fee, e.g. "Free shipping on 5 items or more". */
  discount_label?: string | null;
  free_delivery_threshold_cents?: number | null;
  minimum_order_cents?: number;
  eta_min_minutes?: number;
  eta_max_minutes?: number;
}

export interface OrderTotals {
  subtotalCents: number;
  deliveryFeeCents: number;
  taxCents: number;
  totalCents: number;
}

export interface PlacedOrder {
  order_id: string;
  order_number: string;
  subtotal_cents: number;
  delivery_fee_cents: number;
  tax_cents: number;
  total_cents: number;
  zone_name: string;
  estimated_delivery_at: string;
}

export interface OrderLookupItem {
  name: string;
  sku: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
}

export type OrderLookupResult =
  | { found: false; message: string }
  | {
      found: true;
      order_number: string;
      status: OrderStatus;
      payment_status: PaymentStatus;
      placed_at: string;
      estimated_delivery_at: string | null;
      delivered_at: string | null;
      tracking_notes: string;
      customer_name: string;
      address: {
        line1: string;
        line2: string;
        city: string;
        province: string;
        postal_code: string;
      };
      subtotal_cents: number;
      discount_cents: number;
      coupon_code: string;
      coupon_label: string;
      crypto_discount_cents: number;
      crypto_discount_label: string;
      delivery_fee_cents: number;
      delivery_discount_label: string;
      tax_cents: number;
      total_cents: number;
      payment_method: PaymentMethod;
      usdc: UsdcQuote | null;
      items: OrderLookupItem[];
    };

export interface AdminOrderRow {
  id: string;
  order_number: string;
  status: OrderStatus;
  payment_status: PaymentStatus;
  payment_method: PaymentMethod;
  crypto_discount_cents: number;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  city: string;
  postal_code: string;
  delivery_zone_name: string;
  subtotal_cents: number;
  delivery_fee_cents: number;
  tax_cents: number;
  total_cents: number;
  amount_paid_cents: number;
  placed_at: string;
  estimated_delivery_at: string | null;
}

export interface DashboardMetrics {
  sales_today_cents: number;
  orders_today: number;
  pending_payments: number;
  pending_payment_cents: number;
  pending_deliveries: number;
  inventory_value_cents: number;
  low_stock_count: number;
  out_of_stock_count: number;
  revenue_month_cents: number;
  delivery_fees_month_cents: number;
  open_alerts: number;
}

export interface PublicSettings {
  company_name: string;
  currency: string;
  tax_rate_bps: number;
  payment_email: string;
  support_phone: string;
  logo_url: string | null;

  // Futurelite. Checkout needs these to show the same total the database will
  // charge, so they travel with the rest of the public settings.
  usdc_available: boolean;
  crypto_discount_enabled: boolean;
  crypto_discount_bps: number;
  crypto_discount_label: string;
  crypto_discount_stacks: boolean;
  crypto_discount_max_cents: number;
}

export type CouponKind = 'percent_off' | 'amount_off' | 'free_delivery';

export type CouponEvaluation =
  | {
      valid: false;
      reason:
        | 'empty'
        | 'unknown'
        | 'not_started'
        | 'expired'
        | 'exhausted'
        | 'per_customer'
        | 'below_minimum';
      message: string;
      minimum_order_cents?: number;
    }
  | {
      valid: true;
      coupon_id: string;
      code: string;
      kind: CouponKind;
      label: string;
      description: string;
      discount_cents: number;
      applies_to: 'subtotal' | 'delivery';
      message: string;
    };
