import { z } from 'zod';
import { isAllowedFont } from './branding';

/**
 * These schemas run in the browser for instant feedback and again on the server
 * before anything reaches the database. The database then re-derives prices,
 * fees, and taxes itself — client numbers are never trusted, only client intent.
 */

const CANADIAN_POSTAL = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d$/i;

export const postalCodeSchema = z
  .string()
  .trim()
  .min(1, 'Enter your postal code')
  .regex(CANADIAN_POSTAL, 'That does not look like a Canadian postal code');

/** Every province and territory, in the order Canada Post lists them. */
export const PROVINCES = [
  { code: 'AB', name: 'Alberta' },
  { code: 'BC', name: 'British Columbia' },
  { code: 'MB', name: 'Manitoba' },
  { code: 'NB', name: 'New Brunswick' },
  { code: 'NL', name: 'Newfoundland and Labrador' },
  { code: 'NT', name: 'Northwest Territories' },
  { code: 'NS', name: 'Nova Scotia' },
  { code: 'NU', name: 'Nunavut' },
  { code: 'ON', name: 'Ontario' },
  { code: 'PE', name: 'Prince Edward Island' },
  { code: 'QC', name: 'Quebec' },
  { code: 'SK', name: 'Saskatchewan' },
  { code: 'YT', name: 'Yukon' },
] as const;

const PROVINCE_CODES = PROVINCES.map((p) => p.code) as unknown as [string, ...string[]];

export const checkoutSchema = z.object({
  name: z.string().trim().min(2, 'Enter your full name').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  phone: z
    .string()
    .trim()
    .min(10, 'Enter a phone number we can reach you on')
    .max(30)
    .regex(/^[\d\s()+.-]+$/, 'Use digits only'),
  addressLine1: z.string().trim().min(4, 'Enter your street address').max(200),
  addressLine2: z.string().trim().max(120).optional().default(''),
  city: z.string().trim().min(2, 'Enter your city').max(80),
  province: z.enum(PROVINCE_CODES, { errorMap: () => ({ message: 'Choose your province' }) }),
  postalCode: postalCodeSchema,
  deliveryNotes: z.string().trim().max(500).optional().default(''),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const cartLineSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1, 'Quantity must be at least 1').max(999),
});

/** Codes are typed off a card or a text, so spacing and case are forgiven. */
export const couponCodeSchema = z
  .string()
  .trim()
  .max(40)
  .transform((v) => v.replace(/[^A-Za-z0-9]/g, '').toUpperCase());

export const placeOrderSchema = z.object({
  customer: checkoutSchema,
  items: z.array(cartLineSchema).min(1, 'Add at least one item before checking out'),
  couponCode: couponCodeSchema.optional().default(''),
  // Defaulted rather than required, so an older cached checkout page that knows
  // nothing about USDC still places a valid Interac order.
  paymentMethod: z.enum(['interac', 'usdc_solana']).default('interac'),
});

// --- Futurelite: USDC on Solana -------------------------------------------

export const refreshQuoteSchema = z.object({
  orderNumber: z.string().trim().min(3).max(40),
  email: z.string().trim().email('Enter the email used on the order').max(200),
});

export const confirmUsdcSchema = z.object({
  orderId: z.string().uuid(),
  // Kept as a string all the way to the parser. Reading money off a number
  // input invites floating point in exactly the place it must never appear.
  amount: z.string().trim().min(1, 'Enter the USDC amount that arrived'),
  note: z.string().trim().max(500).optional().default(''),
});

export const usdcSettingsSchema = z.object({
  enabled: z.boolean(),
  markupBps: z
    .number()
    .int()
    .min(0, 'A markup cannot be negative')
    .max(5000, 'A markup above 50% is almost certainly a mistake'),
  lowPoolThreshold: z.number().int().min(0).max(10000),
  quoteMinutes: z.number().int().min(1, 'Give customers at least a minute').max(1440),
  rateMaxAgeHours: z.number().int().min(1).max(720),
});

export const couponPreviewSchema = z.object({
  code: couponCodeSchema,
  subtotalCents: z.number().int().min(0),
  deliveryFeeCents: z.number().int().min(0).default(0),
  email: z.string().trim().max(200).optional().default(''),
});

const couponBase = z.object({
  code: z
    .string()
    .trim()
    .min(3, 'Codes need at least three characters')
    .max(40)
    .regex(/^[A-Za-z0-9 -]+$/, 'Letters and numbers only'),
  description: z.string().trim().max(300).optional().default(''),
  kind: z.enum(['percent_off', 'amount_off', 'free_delivery']),
  // Basis points for percent_off, cents for amount_off, ignored for free shipping.
  value: z.number().int().min(0),
  maxDiscountCents: z.number().int().positive().nullable().optional(),
  minimumOrderCents: z.number().int().min(0).default(0),
  usageLimit: z.number().int().positive().nullable().optional(),
  perCustomerLimit: z.number().int().positive().nullable().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  isActive: z.boolean().default(true),
});

export const couponSchema = couponBase
  .refine((c) => c.kind !== 'percent_off' || (c.value >= 1 && c.value <= 10000), {
    message: 'Enter a percentage between 0.01 and 100',
    path: ['value'],
  })
  .refine((c) => c.kind !== 'amount_off' || c.value > 0, {
    message: 'Enter an amount greater than zero',
    path: ['value'],
  })
  .refine((c) => !c.startsAt || !c.expiresAt || new Date(c.expiresAt) > new Date(c.startsAt), {
    message: 'The end date has to be after the start date',
    path: ['expiresAt'],
  });

export const deliveryQuoteSchema = z.object({
  postalCode: z.string().trim().min(3),
  city: z.string().trim().optional().default(''),
  subtotalCents: z.number().int().min(0),
  // Drives "buy 5, ship free" style rules.
  itemCount: z.number().int().min(0).max(100000).default(0),
});

export const orderLookupSchema = z.object({
  orderNumber: z
    .string()
    .trim()
    .min(4, 'Enter your order number')
    .max(40)
    .regex(/^[A-Za-z0-9-]+$/, 'Order numbers look like ORD-2026-000001'),
  email: z.string().trim().toLowerCase().email('Enter the email you ordered with'),
});

export const recordPaymentSchema = z.object({
  orderId: z.string().uuid(),
  amountCents: z
    .number()
    .int()
    .refine((v) => v !== 0, 'Enter an amount'),
  receivedAt: z.string().datetime().optional(),
  reference: z.string().trim().max(120).optional().default(''),
  notes: z.string().trim().max(500).optional().default(''),
});

export const orderStatusSchema = z.object({
  orderId: z.string().uuid(),
  status: z.enum([
    'pending_payment',
    'payment_received',
    'preparing',
    'out_for_delivery',
    'delivered',
    'cancelled',
    'refunded',
  ]),
  note: z.string().trim().max(500).optional().default(''),
});

export const productSchema = z
  .object({
    // Blank is fine — the database fills one in from the name.
    sku: z.string().trim().max(60).optional().default(''),
    barcode: z.string().trim().max(60).optional().default(''),
    name: z.string().trim().min(2, 'Name is required').max(200),
    slug: z
      .string()
      .trim()
      .min(2, 'Web address is required')
      .max(200)
      .regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers, and dashes'),
    description: z.string().trim().max(4000).optional().default(''),

    categoryId: z.string().uuid().nullable().optional(),
    supplierId: z.string().uuid().nullable().optional(),
    // Staff can name a category or supplier that does not exist yet; the server
    // creates it rather than sending them off to another screen mid-task.
    newCategoryName: z.string().trim().max(80).optional().default(''),
    newSupplierName: z.string().trim().max(120).optional().default(''),

    manufacturer: z.string().trim().max(120).optional().default(''),
    costCents: z.number().int().min(0, 'Cost cannot be negative'),
    priceCents: z.number().int().min(0, 'Price cannot be negative'),
    compareAtCents: z.number().int().min(0).nullable().optional(),

    // Only read when creating. Existing stock changes go through the ledger.
    openingQuantity: z.number().int().min(0).max(1_000_000).optional().default(0),
    minQuantity: z.number().int().min(0).default(0),
    maxQuantity: z.number().int().min(0).nullable().optional(),
    unit: z.string().trim().min(1, 'Unit is required').max(30).default('each'),

    storageLocation: z.string().trim().max(80).optional().default(''),
    shelf: z.string().trim().max(40).optional().default(''),
    bin: z.string().trim().max(40).optional().default(''),
    batchNumber: z.string().trim().max(60).optional().default(''),
    lotNumber: z.string().trim().max(60).optional().default(''),
    expiryDate: z.string().date('Use YYYY-MM-DD').nullable().optional(),

    status: z.enum(['active', 'inactive', 'discontinued', 'archived']).default('active'),
    isFeatured: z.boolean().default(false),
    isNew: z.boolean().default(false),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    notes: z.string().trim().max(2000).optional().default(''),
  })
  .refine(
    (v) =>
      v.compareAtCents === null ||
      v.compareAtCents === undefined ||
      v.compareAtCents > v.priceCents,
    {
      message: 'The "was" price has to be higher than the selling price',
      path: ['compareAtCents'],
    },
  )
  .refine(
    (v) => v.maxQuantity === null || v.maxQuantity === undefined || v.maxQuantity >= v.minQuantity,
    {
      message: 'Maximum cannot be below the minimum',
      path: ['maxQuantity'],
    },
  );

export type ProductInput = z.infer<typeof productSchema>;

export const productImageSchema = z.object({
  productId: z.string().uuid(),
  storagePath: z.string().trim().min(1).max(400),
  altText: z.string().trim().max(200).optional().default(''),
});

export const stockAdjustmentSchema = z.object({
  productId: z.string().uuid(),
  type: z.enum([
    'receiving',
    'adjustment',
    'return',
    'damaged',
    'expired',
    'transfer',
    'cycle_count',
  ]),
  quantityChange: z
    .number()
    .int()
    .refine((v) => v !== 0, 'Enter a quantity'),
  reason: z.string().trim().min(2, 'Say why the stock moved').max(200),
  notes: z.string().trim().max(500).optional().default(''),
});

export const deliveryZoneSchema = z.object({
  name: z.string().trim().min(2, 'Name the zone').max(80),
  code: z.string().trim().min(1).max(10),
  description: z.string().trim().max(300).optional().default(''),
  feeCents: z.number().int().min(0),
  freeDeliveryThresholdCents: z.number().int().min(0).nullable().optional(),
  minimumOrderCents: z.number().int().min(0).default(0),
  maxDistanceKm: z.number().positive().nullable().optional(),
  estimatedMinutesMin: z.number().int().min(0).default(60),
  estimatedMinutesMax: z.number().int().min(0).default(120),
  priority: z.number().int().default(100),
  isActive: z.boolean().default(true),
});

export const deliveryRuleSchema = z.object({
  zoneId: z.string().uuid(),
  matchType: z.enum(['postal_prefix', 'postal_exact', 'city']),
  matchValue: z.string().trim().min(1, 'Enter a postal code or city').max(60),
  isActive: z.boolean().default(true),
});

export const settingsSchema = z.object({
  companyName: z.string().trim().min(1).max(120),
  currency: z.string().trim().length(3),
  taxRateBps: z.number().int().min(0).max(10000),
  paymentEmail: z.string().trim().email(),
  deliveryEmail: z.string().trim().email(),
  supportPhone: z.string().trim().max(40).optional().default(''),
  orderPrefix: z
    .string()
    .trim()
    .min(1)
    .max(10)
    .regex(/^[A-Z0-9]+$/, 'Use capital letters and numbers'),
  lowStockThresholdDefault: z.number().int().min(0),
  expiryWarningDays: z.number().int().min(0),
});

export const gateSettingsSchema = z.object({
  gateEnabled: z.boolean(),
  gateTitle: z.string().trim().min(2, 'Give the gate a heading').max(120),
  gateIntro: z.string().trim().max(600).default(''),
  gateConfirmLabel: z.string().trim().min(2, 'Label the confirm button').max(60),
  gateDeclineLabel: z.string().trim().min(2, 'Label the leave link').max(60),
  gateDeclineUrl: z.string().trim().url('Enter a full URL, including https://'),
  gateOptionalLabel: z.string().trim().max(40).default('Optional'),
  gateRemainingLabel: z.string().trim().min(1, 'Say what is still outstanding').max(120),
  gateDoneLabel: z.string().trim().max(80).default(''),
  gatePendingLabel: z.string().trim().min(1, 'Label the button while it saves').max(60),
  gateLinkLabel: z.string().trim().max(60).default('Read more'),
});

export const acknowledgementSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers, and underscores'),
  label: z.string().trim().min(4, 'Write the sentence the customer ticks').max(300),
  body: z.string().trim().max(1000).default(''),
  linkUrl: z.string().trim().url('Enter a full URL').or(z.literal('')).default(''),
  linkLabel: z.string().trim().max(60).default(''),
  isRequired: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

// --- Branding, content, pages, delivery pricing ------------------------------

const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex colour like #0F7B5A');

const palette = z.object({
  background: hexColor,
  card: hexColor,
  foreground: hexColor,
  primary: hexColor,
  warning: hexColor,
  border: hexColor,
});

export const brandingSchema = z.object({
  light: palette,
  dark: palette,
  // Font names are interpolated into a <style> block, so they must come from
  // the known list rather than being any string an administrator can type.
  // isAllowedFont() existed for this and was not being called.
  fontDisplay: z.string().trim().refine(isAllowedFont, 'Choose a font from the list'),
  fontBody: z.string().trim().refine(isAllowedFont, 'Choose a font from the list'),
  fontMono: z.string().trim().refine(isAllowedFont, 'Choose a font from the list'),
  radiusPx: z.number().int().min(0).max(32),
});

export const contentUpdateSchema = z.object({
  entries: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(64),
        value: z.string().max(2000),
      }),
    )
    .max(200),
});

export const pageSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, 'A web address is required')
    .max(80)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Use lowercase letters, numbers, and dashes'),
  title: z.string().trim().min(1, 'Give the page a title').max(120),
  bodyMarkdown: z.string().max(60000),
  metaDescription: z.string().trim().max(300).optional().default(''),
  isPublished: z.boolean().default(false),
  showInNav: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

export const deliveryPricingSchema = z
  .object({
    mode: z.enum(['flat', 'zones']).default('flat'),
    flatFeeCents: z.number().int().min(0, 'A fee cannot be negative'),
    minimumOrderCents: z.number().int().min(0),
    etaMinMinutes: z.number().int().min(0).max(20160),
    etaMaxMinutes: z.number().int().min(0).max(20160),
    restrictArea: z.boolean().default(false),
  })
  .refine((v) => v.etaMaxMinutes >= v.etaMinMinutes, {
    message: 'The longest estimate has to be at least the shortest',
    path: ['etaMaxMinutes'],
  });

export const deliveryModifierSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(3, 'Write what the customer should see, e.g. "Free shipping on 5 items or more"')
      .max(120),
    condition: z.enum(['always', 'item_count_at_least', 'subtotal_at_least']),
    threshold: z.number().int().min(0).default(0),
    effect: z.enum(['free', 'set_fee', 'amount_off', 'percent_off']),
    amount: z.number().int().min(0).default(0),
    priority: z.number().int().min(0).max(999).default(100),
    isActive: z.boolean().default(true),
  })
  .refine((v) => v.condition === 'always' || v.threshold > 0, {
    message: 'Set the number this rule kicks in at',
    path: ['threshold'],
  })
  .refine((v) => v.effect !== 'percent_off' || (v.amount > 0 && v.amount <= 10000), {
    message: 'A percentage has to be between 0 and 100',
    path: ['amount'],
  })
  .refine((v) => v.effect === 'free' || v.effect === 'percent_off' || v.amount > 0, {
    message: 'Enter an amount',
    path: ['amount'],
  });
