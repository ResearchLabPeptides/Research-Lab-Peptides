/**
 * The report catalog.
 *
 * Both the Reports screen and the download route read from here, so the list a
 * person sees and the list the server will actually serve cannot drift apart.
 * Adding a report means adding a database view and one entry below.
 */

export type ReportKey =
  | 'orders'
  | 'daily-sales'
  | 'top-selling'
  | 'delivery-charges'
  | 'payments'
  | 'coupons'
  | 'coupon-redemptions'
  | 'customers'
  | 'mailing-list'
  | 'inventory'
  | 'inventory-movement'
  | 'alerts';

export type ReportGroup = 'Sales' | 'Money in' | 'Customers' | 'Inventory';

export interface ReportDefinition {
  key: ReportKey;
  /** A view or table. Read under the caller's own session, so RLS still applies. */
  source: string;
  group: ReportGroup;
  title: string;
  description: string;
  filename: string;
  /** Column the date range filters on. Omitted where a range makes no sense. */
  dateColumn?: string;
  /** Why a range does not apply, shown instead of the date hint. */
  rangeNote?: string;
  /** Newest first where there is a date to sort by. */
  orderBy?: string;
}

export const REPORTS: ReportDefinition[] = [
  {
    key: 'orders',
    source: 'orders',
    group: 'Sales',
    title: 'Orders',
    description:
      'Every order with customer, address, zone, coupon, totals, and status. The one to reach for when someone asks what you sold.',
    filename: 'orders',
    dateColumn: 'placed_at',
    orderBy: 'placed_at',
  },
  {
    key: 'daily-sales',
    source: 'sales_by_day',
    group: 'Sales',
    title: 'Sales by day',
    description:
      'One row per trading day: orders, subtotal, discounts, delivery, tax, revenue, and how much has actually been collected.',
    filename: 'sales-by-day',
    dateColumn: 'day',
    orderBy: 'day',
  },
  {
    key: 'top-selling',
    source: 'top_selling_products',
    group: 'Sales',
    title: 'Best sellers',
    description: 'Units sold and revenue per product, ranked.',
    filename: 'best-sellers',
    rangeNote: 'Always the last 90 days',
  },
  {
    key: 'delivery-charges',
    source: 'delivery_charge_report',
    group: 'Sales',
    title: 'Shipping charges',
    description: 'Shipping fees collected by day and zone, against the order subtotals.',
    filename: 'delivery-charges',
    dateColumn: 'day',
    orderBy: 'day',
  },
  {
    key: 'payments',
    source: 'payments',
    group: 'Money in',
    title: 'Payments received',
    description:
      'Every e-Transfer recorded, with the amount, reference, and who confirmed it. Use this to reconcile against your bank.',
    filename: 'payments',
    dateColumn: 'received_at',
    orderBy: 'received_at',
  },
  {
    key: 'coupons',
    source: 'coupon_performance',
    group: 'Money in',
    title: 'Coupon performance',
    description: 'Each code with its state, times used, customers reached, and money given away.',
    filename: 'coupon-performance',
    rangeNote: 'Lifetime totals per code',
  },
  {
    key: 'coupon-redemptions',
    source: 'coupon_redemptions',
    group: 'Money in',
    title: 'Coupon redemptions',
    description: 'Each individual use of a code, with the order it was applied to.',
    filename: 'coupon-redemptions',
    dateColumn: 'created_at',
    orderBy: 'created_at',
  },
  {
    key: 'customers',
    source: 'customer_list',
    group: 'Customers',
    title: 'Everyone who has ordered',
    description:
      'One row per person, however many times they have ordered. Includes whether they agreed to marketing.',
    filename: 'customers',
    rangeNote: 'Everyone, all time',
  },
  {
    key: 'mailing-list',
    source: 'marketing_list',
    group: 'Customers',
    title: 'Mailing list',
    description:
      'Only the people who ticked the marketing box and have not unsubscribed. This is the file to hand to a newsletter tool.',
    filename: 'mailing-list',
    rangeNote: 'Consented and still subscribed',
  },
  {
    key: 'inventory',
    source: 'product_stock',
    group: 'Inventory',
    title: 'Stock on hand',
    description:
      'Every product with quantity, held stock, availability, and value at cost. A snapshot of right now.',
    filename: 'stock-on-hand',
    rangeNote: 'A snapshot of right now',
  },
  {
    key: 'inventory-movement',
    source: 'inventory_movement_report',
    group: 'Inventory',
    title: 'Stock movements',
    description:
      'The full ledger: every change to every count, with who made it and why. This is your audit trail.',
    filename: 'stock-movements',
    dateColumn: 'created_at',
    orderBy: 'created_at',
  },
  {
    key: 'alerts',
    source: 'open_alerts',
    group: 'Inventory',
    title: 'Stock alerts',
    description: 'Everything currently low, out of stock, expiring, or expired.',
    filename: 'stock-alerts',
    rangeNote: 'Whatever is open right now',
  },
];

export const REPORT_GROUPS: ReportGroup[] = ['Sales', 'Money in', 'Customers', 'Inventory'];

export function findReport(key: string): ReportDefinition | undefined {
  return REPORTS.find((r) => r.key === key);
}

// --- Date ranges -------------------------------------------------------------

export type RangeKey = 'today' | '7d' | '30d' | 'month' | 'last-month' | 'year' | 'all';

export const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: 'year', label: 'This year' },
  { key: 'all', label: 'All time' },
];

export function isRangeKey(value: string | undefined): value is RangeKey {
  return RANGES.some((r) => r.key === value);
}

/**
 * Resolved as an inclusive start and an exclusive end, so a range never drops
 * an order placed at 11:58pm on the last day or counts one twice at a boundary.
 * `null` means unbounded on that side.
 */
export function resolveRange(
  range: RangeKey,
  now = new Date(),
): { from: Date | null; to: Date | null } {
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (range) {
    case 'today':
      return { from: startOfDay, to: null };
    case '7d':
      return { from: new Date(startOfDay.getTime() - 6 * 86_400_000), to: null };
    case '30d':
      return { from: new Date(startOfDay.getTime() - 29 * 86_400_000), to: null };
    case 'month':
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: null };
    case 'last-month':
      return {
        from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        to: new Date(now.getFullYear(), now.getMonth(), 1),
      };
    case 'year':
      return { from: new Date(now.getFullYear(), 0, 1), to: null };
    case 'all':
      return { from: null, to: null };
  }
}

export function rangeLabel(range: RangeKey): string {
  return RANGES.find((r) => r.key === range)?.label ?? 'All time';
}
