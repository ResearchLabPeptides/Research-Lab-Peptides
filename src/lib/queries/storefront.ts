import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { type ContentMap } from '@/lib/content';

export { text, type ContentMap } from '@/lib/content';
import type { AcknowledgementItem } from '@/lib/gate';
import type { Category, PublicSettings, StorefrontProduct } from '@/lib/types';
import { DEFAULT_BRANDING, isAllowedFont, normalizePalette, type Branding } from '@/lib/branding';

/**
 * Storefront reads. These run with the anon key under Row Level Security, so
 * they physically cannot return cost prices, suppliers, or another customer's
 * order — the policy does the enforcing, not this file.
 */

const PRODUCT_COLUMNS = `
  id, sku, name, slug, description, price_cents, compare_at_cents, unit,
  quantity, quantity_reserved, is_featured, is_new, tags, category_id, created_at,
  categories ( name, slug ),
  product_images ( id, storage_path, alt_text, sort_order, is_primary )
`;

export async function getStorefrontProducts(): Promise<StorefrontProduct[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_COLUMNS)
    .eq('status', 'active')
    .order('is_featured', { ascending: false })
    .order('name', { ascending: true })
    .limit(2000);

  if (error) throw new Error(`Could not load products: ${error.message}`);
  return (data ?? []) as unknown as StorefrontProduct[];
}

export async function getCategories(): Promise<Category[]> {
  const supabase = await createClient();
  // An empty category is a dead end: a customer taps it and lands on nothing.
  // The inner select counts active, in-stock products, and a category with none
  // is dropped from the storefront — it stays in the dashboard, so staff can
  // still see it and add products to it.
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, slug, description, sort_order, is_active, products!inner(id)')
    .eq('is_active', true)
    .eq('products.status', 'active')
    .gt('products.quantity', 0)
    .order('sort_order');

  if (error) throw new Error(`Could not load categories: ${error.message}`);

  // The join returns one row per product; collapse to one row per category.
  const seen = new Set<string>();
  return (data ?? [])
    .filter((row) => {
      const id = (row as { id: string }).id;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map(({ products: _products, ...category }) => category) as Category[];
}

export async function getPublicSettings(): Promise<PublicSettings> {
  const supabase = await createClient();

  // usdc_available() is asked rather than inferred, because "can we take USDC
  // right now" depends on the rate's age and the address pool as well as the
  // switch, and the database is the only place that knows all three.
  const [{ data, error }, { data: usdcOk }] = await Promise.all([
    supabase
      .from('settings')
      .select(
        'company_name, currency, tax_rate_bps, payment_email, support_phone, logo_url, ' +
          'crypto_discount_enabled, crypto_discount_bps, crypto_discount_label, ' +
          'crypto_discount_stacks, crypto_discount_max_cents',
      )
      .single(),
    supabase.rpc('usdc_available'),
  ]);

  if (error || !data) {
    // The storefront should still render if settings are unreachable, rather
    // than showing a customer an error page over a missing phone number.
    // Everything payment-related defaults to off: a checkout that quietly
    // stops offering USDC is recoverable, one that offers it without a rate is
    // not.
    return {
      company_name: 'Our Shop',
      currency: 'CAD',
      tax_rate_bps: 500,
      payment_email: '',
      support_phone: '',
      logo_url: null,
      usdc_available: false,
      crypto_discount_enabled: false,
      crypto_discount_bps: 0,
      crypto_discount_label: 'Crypto payment discount',
      crypto_discount_stacks: false,
      crypto_discount_max_cents: 0,
    };
  }

  return { ...data, usdc_available: usdcOk === true } as PublicSettings;
}

export interface GateConfig {
  enabled: boolean;
  title: string;
  intro: string;
  confirmLabel: string;
  declineLabel: string;
  declineUrl: string;
  optionalLabel: string;
  /** {n} is replaced with the number of unticked required boxes. */
  remainingLabel: string;
  doneLabel: string;
  pendingLabel: string;
  linkLabel: string;
  items: AcknowledgementItem[];
}

/**
 * The entry gate's wording and its acknowledgements. Both come from the
 * database, so changing either is a dashboard edit rather than a deploy.
 */
export async function getGateConfig(): Promise<GateConfig> {
  const supabase = await createClient();

  const [settings, acknowledgements] = await Promise.all([
    supabase
      .from('settings')
      .select(
        'gate_enabled, gate_title, gate_intro, gate_confirm_label, gate_decline_label, gate_decline_url, gate_optional_label, gate_remaining_label, gate_done_label, gate_pending_label, gate_link_label',
      )
      .single(),
    supabase.rpc('active_acknowledgements'),
  ]);

  const row = settings.data as {
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

  const items = (acknowledgements.data ?? []) as AcknowledgementItem[];

  return {
    // A gate with nothing to confirm is not a gate. If every acknowledgement is
    // retired, the shop opens rather than showing an empty dialog.
    enabled: Boolean(row?.gate_enabled) && items.length > 0,
    title: row?.gate_title ?? 'Before you order',
    intro: row?.gate_intro ?? '',
    confirmLabel: row?.gate_confirm_label ?? 'Confirm and enter the shop',
    declineLabel: row?.gate_decline_label ?? 'Leave',
    declineUrl: row?.gate_decline_url ?? 'https://www.google.com',
    optionalLabel: row?.gate_optional_label ?? 'Optional',
    remainingLabel: row?.gate_remaining_label ?? '{n} left to confirm',
    doneLabel: row?.gate_done_label ?? 'All set.',
    pendingLabel: row?.gate_pending_label ?? 'Confirming',
    linkLabel: row?.gate_link_label ?? 'Read more',
    items,
  };
}

// --- Branding, copy, and pages ----------------------------------------------

export async function getBranding(): Promise<Branding> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('settings')
    .select(
      'brand_light, brand_dark, brand_font_display, brand_font_body, brand_font_mono, brand_radius_px',
    )
    .single();

  if (!data) return DEFAULT_BRANDING;

  const row = data as Record<string, unknown>;
  const font = (value: unknown, fallback: string) =>
    typeof value === 'string' && isAllowedFont(value) ? value : fallback;

  return {
    light: normalizePalette(row.brand_light, DEFAULT_BRANDING.light),
    dark: normalizePalette(row.brand_dark, DEFAULT_BRANDING.dark),
    fontDisplay: font(row.brand_font_display, DEFAULT_BRANDING.fontDisplay),
    fontBody: font(row.brand_font_body, DEFAULT_BRANDING.fontBody),
    fontMono: font(row.brand_font_mono, DEFAULT_BRANDING.fontMono),
    radiusPx:
      typeof row.brand_radius_px === 'number' ? row.brand_radius_px : DEFAULT_BRANDING.radiusPx,
  };
}

/**
 * Every editable string, keyed. Call `text(map, key, fallback)` to read one —
 * a key that has been blanked out in the dashboard falls back to the wording
 * shipped with the app rather than rendering an empty heading.
 */
export async function getContent(): Promise<ContentMap> {
  const supabase = await createClient();
  const { data } = await supabase.from('site_content').select('key, value');

  const map: ContentMap = {};
  for (const row of (data ?? []) as { key: string; value: string }[]) {
    map[row.key] = row.value;
  }
  return map;
}

export interface NavPage {
  slug: string;
  title: string;
}

export async function getNavPages(): Promise<NavPage[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('site_pages')
    .select('slug, title')
    .eq('is_published', true)
    .eq('show_in_nav', true)
    .order('sort_order');

  return (data ?? []) as NavPage[];
}

export interface SitePage {
  slug: string;
  title: string;
  body_markdown: string;
  meta_description: string;
  is_published: boolean;
}

export async function getPage(slug: string): Promise<SitePage | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('site_pages')
    .select('slug, title, body_markdown, meta_description, is_published')
    .eq('slug', slug)
    .maybeSingle();

  return (data as SitePage | null) ?? null;
}
