import 'server-only';
import { REPORTS, resolveRange, type RangeKey } from '@/lib/reports';
import { createClient } from '@/lib/supabase/server';
import type { AdminOrderRow, DashboardMetrics, OrderStatus } from '@/lib/types';

export interface AlertRow {
  id: number;
  type: string;
  message: string;
  created_at: string;
  product_id: string;
  sku: string;
  product_name: string;
  quantity: number;
}

export interface DailySalesRow {
  day: string;
  order_count: number;
  revenue_cents: number;
}

export interface TopProductRow {
  sku: string;
  name: string;
  units_sold: number;
  revenue_cents: number;
}

export async function getDashboard() {
  const supabase = await createClient();

  const [metrics, sales, top, alerts, recent] = await Promise.all([
    supabase.from('dashboard_metrics').select('*').single(),
    supabase.from('daily_sales').select('day, order_count, revenue_cents'),
    supabase.from('top_selling_products').select('sku, name, units_sold, revenue_cents').limit(6),
    supabase.from('open_alerts').select('*').limit(8),
    supabase
      .from('orders')
      .select(
        'id, order_number, status, payment_status, payment_method, crypto_discount_cents, ' +
          'customer_name, total_cents, placed_at, delivery_zone_name',
      )
      .order('placed_at', { ascending: false })
      .limit(8),
  ]);

  return {
    metrics: (metrics.data ?? null) as DashboardMetrics | null,
    dailySales: (sales.data ?? []) as DailySalesRow[],
    topProducts: (top.data ?? []) as TopProductRow[],
    alerts: (alerts.data ?? []) as AlertRow[],
    recentOrders: (recent.data ?? []) as Pick<
      AdminOrderRow,
      | 'id'
      | 'order_number'
      | 'status'
      | 'payment_status'
      | 'customer_name'
      | 'total_cents'
      | 'placed_at'
      | 'delivery_zone_name'
    >[],
  };
}

export interface OrderFilters {
  search?: string;
  status?: OrderStatus | 'all';
  page?: number;
  pageSize?: number;
}

export async function getOrders(filters: OrderFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, filters.pageSize ?? 25);
  const from = (page - 1) * pageSize;

  const supabase = await createClient();
  let query = supabase
    .from('orders')
    .select(
      `id, order_number, status, payment_status, payment_method, crypto_discount_cents,
       customer_name, customer_email, customer_phone,
       city, postal_code, delivery_zone_name, subtotal_cents, delivery_fee_cents, tax_cents,
       total_cents, amount_paid_cents, placed_at, estimated_delivery_at`,
      { count: 'exact' },
    )
    .order('placed_at', { ascending: false })
    .range(from, from + pageSize - 1);

  if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status);

  if (filters.search?.trim()) {
    const term = filters.search.trim();
    // Matches an order number, a name, an email, or a phone number, which is
    // every way a customer identifies themselves on the phone.
    query = query.or(
      `order_number.ilike.%${term}%,customer_name.ilike.%${term}%,customer_email.ilike.%${term}%,customer_phone.ilike.%${term}%`,
    );
  }

  const { data, count, error } = await query;
  if (error) throw new Error(`Could not load orders: ${error.message}`);

  return {
    orders: (data ?? []) as AdminOrderRow[],
    total: count ?? 0,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
  };
}

export async function getOrderDetail(orderId: string) {
  const supabase = await createClient();

  const [order, items, history, payments] = await Promise.all([
    supabase.from('orders').select('*').eq('id', orderId).single(),
    supabase.from('order_items').select('*').eq('order_id', orderId).order('name'),
    supabase
      .from('order_status_history')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false }),
    supabase
      .from('payments')
      .select('*')
      .eq('order_id', orderId)
      .order('received_at', { ascending: false }),
  ]);

  if (order.error || !order.data) return null;

  return {
    order: order.data as AdminOrderRow & {
      address_line1: string;
      address_line2: string;
      province: string;
      delivery_notes: string;
      tracking_notes: string;
      internal_notes: string;
      inventory_reserved: boolean;
      inventory_deducted: boolean;
      paid_at: string | null;
      delivered_at: string | null;
    },
    items: (items.data ?? []) as {
      id: string;
      sku: string;
      name: string;
      unit: string;
      quantity: number;
      unit_price_cents: number;
      line_total_cents: number;
    }[],
    history: (history.data ?? []) as {
      id: number;
      from_status: OrderStatus | null;
      to_status: OrderStatus;
      note: string;
      created_at: string;
    }[],
    payments: (payments.data ?? []) as {
      id: string;
      amount_cents: number;
      reference: string;
      notes: string;
      received_at: string;
    }[],
  };
}

export interface ProductRow {
  id: string;
  sku: string;
  name: string;
  slug: string;
  status: string;
  unit: string;
  price_cents: number;
  cost_cents: number;
  quantity: number;
  quantity_reserved: number;
  quantity_available: number;
  min_quantity: number;
  expiry_date: string | null;
  category_name: string | null;
  supplier_name: string | null;
  stock_value_cents: number;
  is_out_of_stock: boolean;
  is_low_stock: boolean;
}

export async function getProducts(search?: string) {
  const supabase = await createClient();
  let query = supabase.from('product_stock').select('*').order('name').limit(500);

  if (search?.trim()) {
    const term = search.trim();
    query = query.or(`name.ilike.%${term}%,sku.ilike.%${term}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Could not load inventory: ${error.message}`);
  return (data ?? []) as ProductRow[];
}

export async function getDeliveryConfig() {
  const supabase = await createClient();

  const [zones, rules] = await Promise.all([
    supabase.from('delivery_zones').select('*').order('priority'),
    supabase.from('delivery_rules').select('*').order('match_value'),
  ]);

  return {
    zones: (zones.data ?? []) as {
      id: string;
      name: string;
      code: string;
      description: string;
      fee_cents: number;
      free_delivery_threshold_cents: number | null;
      minimum_order_cents: number;
      max_distance_km: number | null;
      estimated_minutes_min: number;
      estimated_minutes_max: number;
      priority: number;
      is_active: boolean;
    }[],
    rules: (rules.data ?? []) as {
      id: string;
      zone_id: string;
      match_type: string;
      match_value: string;
      is_active: boolean;
    }[],
  };
}

export async function getSettings() {
  const supabase = await createClient();
  const { data } = await supabase.from('settings').select('*').single();
  return data as {
    company_name: string;
    currency: string;
    tax_rate_bps: number;
    payment_email: string;
    delivery_email: string;
    support_phone: string;
    order_prefix: string;
    low_stock_threshold_default: number;
    expiry_warning_days: number;
    gate_enabled: boolean;
    gate_title: string;
    gate_intro: string;
    gate_confirm_label: string;
    gate_decline_label: string;
    gate_decline_url: string;
    gate_optional_label: string;
    gate_remaining_label: string;
    gate_done_label: string;
    gate_pending_label: string;
    gate_link_label: string;
  } | null;
}

export async function getAcknowledgements() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('site_acknowledgements')
    .select('*')
    .order('sort_order')
    .order('key');

  return (data ?? []) as {
    id: string;
    key: string;
    label: string;
    body: string;
    link_url: string | null;
    link_label: string;
    is_required: boolean;
    sort_order: number;
    is_active: boolean;
  }[];
}

export async function getActivity(limit = 100) {
  const supabase = await createClient();
  const { data } = await supabase
    .from('activity_log')
    .select('id, actor_label, action, entity_type, entity_id, metadata, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data ?? []) as {
    id: number;
    actor_label: string;
    action: string;
    entity_type: string | null;
    entity_id: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
  }[];
}

export interface EditableProduct {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  slug: string;
  description: string;
  category_id: string | null;
  supplier_id: string | null;
  manufacturer: string;
  cost_cents: number;
  price_cents: number;
  compare_at_cents: number | null;
  quantity: number;
  quantity_reserved: number;
  min_quantity: number;
  max_quantity: number | null;
  unit: string;
  storage_location: string;
  shelf: string;
  bin: string;
  batch_number: string;
  lot_number: string;
  expiry_date: string | null;
  status: 'active' | 'inactive' | 'discontinued' | 'archived';
  is_featured: boolean;
  is_new: boolean;
  tags: string[];
  notes: string;
  product_images: {
    id: string;
    storage_path: string;
    alt_text: string;
    sort_order: number;
    is_primary: boolean;
  }[];
}

export async function getProductForEdit(productId: string): Promise<EditableProduct | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('products')
    .select(`*, product_images ( id, storage_path, alt_text, sort_order, is_primary )`)
    .eq('id', productId)
    .single();

  if (error || !data) return null;
  return data as unknown as EditableProduct;
}

/** Category and supplier options for the product form's dropdowns. */
export async function getCatalogLookups() {
  const supabase = await createClient();

  const [categories, suppliers] = await Promise.all([
    supabase.from('categories').select('id, name').order('sort_order').order('name'),
    supabase.from('suppliers').select('id, name').eq('is_active', true).order('name'),
  ]);

  return {
    categories: (categories.data ?? []) as { id: string; name: string }[],
    suppliers: (suppliers.data ?? []) as { id: string; name: string }[],
  };
}

// --- Branding, wording, and pages --------------------------------------------

export interface ContentEntry {
  key: string;
  content_group: string;
  label: string;
  help: string;
  is_multiline: boolean;
  value: string;
  sort_order: number;
}

/** Every editable string, grouped the way the Content screen lays them out. */
export async function getContentEntries(): Promise<ContentEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('site_content')
    .select('key, content_group, label, help, is_multiline, value, sort_order')
    .order('content_group')
    .order('sort_order');

  if (error) throw new Error(`Could not load wording: ${error.message}`);
  return (data ?? []) as ContentEntry[];
}

export interface AdminPage {
  id: string;
  slug: string;
  title: string;
  body_markdown: string;
  meta_description: string;
  is_published: boolean;
  show_in_nav: boolean;
  sort_order: number;
  updated_at: string;
}

export async function getAdminPages(): Promise<AdminPage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('site_pages')
    .select(
      'id, slug, title, body_markdown, meta_description, is_published, show_in_nav, sort_order, updated_at',
    )
    .order('sort_order')
    .order('title');

  if (error) throw new Error(`Could not load pages: ${error.message}`);
  return (data ?? []) as AdminPage[];
}

export async function getAdminPage(pageId: string): Promise<AdminPage | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('site_pages')
    .select(
      'id, slug, title, body_markdown, meta_description, is_published, show_in_nav, sort_order, updated_at',
    )
    .eq('id', pageId)
    .maybeSingle();

  return (data as AdminPage) ?? null;
}

export interface DeliveryModifierRow {
  id: string;
  label: string;
  condition: 'always' | 'item_count_at_least' | 'subtotal_at_least';
  threshold: number;
  effect: 'free' | 'set_fee' | 'amount_off' | 'percent_off';
  amount: number;
  priority: number;
  is_active: boolean;
}

export interface DeliveryPricing {
  delivery_mode: 'flat' | 'zones';
  delivery_flat_fee_cents: number;
  delivery_minimum_order_cents: number;
  delivery_eta_min_minutes: number;
  delivery_eta_max_minutes: number;
  delivery_restrict_area: boolean;
}

export async function getDeliveryPricing(): Promise<{
  pricing: DeliveryPricing | null;
  modifiers: DeliveryModifierRow[];
}> {
  const supabase = await createClient();

  const [settings, modifiers] = await Promise.all([
    supabase
      .from('settings')
      .select(
        'delivery_mode, delivery_flat_fee_cents, delivery_minimum_order_cents, delivery_eta_min_minutes, delivery_eta_max_minutes, delivery_restrict_area',
      )
      .single(),
    supabase
      .from('delivery_modifiers')
      .select('id, label, condition, threshold, effect, amount, priority, is_active')
      .order('priority')
      .order('threshold', { ascending: false }),
  ]);

  return {
    pricing: (settings.data as DeliveryPricing) ?? null,
    modifiers: (modifiers.data ?? []) as DeliveryModifierRow[],
  };
}

export interface CouponRow {
  id: string;
  code: string;
  description: string;
  kind: 'percent_off' | 'amount_off' | 'free_delivery';
  value: number;
  max_discount_cents: number | null;
  minimum_order_cents: number;
  usage_limit: number | null;
  per_customer_limit: number | null;
  times_redeemed: number;
  starts_at: string | null;
  expires_at: string | null;
  is_active: boolean;
  state: string;
  discount_given_cents: number;
  customers: number;
  last_used_at: string | null;
}

export async function getCoupons(): Promise<CouponRow[]> {
  const supabase = await createClient();

  // The view carries the derived state and totals; the table carries the rules.
  const [coupons, performance] = await Promise.all([
    supabase.from('coupons').select('*').order('created_at', { ascending: false }),
    supabase.from('coupon_performance').select('*'),
  ]);

  if (coupons.error) throw new Error(`Could not load coupons: ${coupons.error.message}`);

  const stats = new Map(
    (performance.data ?? []).map((row) => [
      (row as { id: string }).id,
      row as {
        state: string;
        discount_given_cents: number;
        customers: number;
        last_used_at: string | null;
      },
    ]),
  );

  return (coupons.data ?? []).map((c) => {
    const row = c as Record<string, unknown>;
    const stat = stats.get(row.id as string);
    return {
      ...(row as unknown as Omit<
        CouponRow,
        'state' | 'discount_given_cents' | 'customers' | 'last_used_at'
      >),
      state: stat?.state ?? 'Live',
      discount_given_cents: stat?.discount_given_cents ?? 0,
      customers: stat?.customers ?? 0,
      last_used_at: stat?.last_used_at ?? null,
    };
  });
}

/**
 * How many rows each report would return for the chosen range — shown on the
 * Reports screen so nobody downloads an empty file and wonders what broke.
 *
 * Uses head-only count queries, so nothing but the number crosses the wire.
 */
export async function getReportCounts(range: RangeKey): Promise<Record<string, number | null>> {
  const supabase = await createClient();

  const results = await Promise.all(
    REPORTS.map(async (report) => {
      let query = supabase.from(report.source).select('*', { count: 'exact', head: true });

      if (report.dateColumn) {
        const { from, to } = resolveRange(range);
        if (from) query = query.gte(report.dateColumn, from.toISOString());
        if (to) query = query.lt(report.dateColumn, to.toISOString());
      }

      const { count, error } = await query;
      // A null count means the caller's role cannot see that source. The screen
      // shows it as unavailable rather than as zero rows.
      return [report.key, error ? null : (count ?? 0)] as const;
    }),
  );

  return Object.fromEntries(results);
}

export interface EmailTemplateRow {
  key: string;
  name: string;
  description: string;
  subject: string;
  body: string;
  is_active: boolean;
  sort_order: number;
  updated_at: string;
}

export async function getEmailTemplates(): Promise<EmailTemplateRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('email_templates')
    .select('key, name, description, subject, body, is_active, sort_order, updated_at')
    .order('sort_order');

  if (error) throw new Error(`Could not load email templates: ${error.message}`);
  return (data ?? []) as EmailTemplateRow[];
}

export interface CustomerRow {
  email: string;
  name: string;
  phone: string;
  order_count: number;
  total_spent_cents: number;
  average_order_cents: number;
  first_order_at: string | null;
  last_order_at: string | null;
  marketing_opt_in: boolean;
  unsubscribed: boolean;
  can_be_emailed: boolean;
}

export async function getCustomers(search?: string, mailableOnly = false) {
  const supabase = await createClient();
  let query = supabase.from('customer_list').select('*').limit(1000);

  if (mailableOnly) query = query.eq('can_be_emailed', true);
  if (search?.trim()) {
    const term = search.trim();
    query = query.or(`email.ilike.%${term}%,name.ilike.%${term}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Could not load customers: ${error.message}`);

  const rows = (data ?? []) as CustomerRow[];
  return {
    customers: rows,
    mailable: rows.filter((c) => c.can_be_emailed).length,
  };
}
