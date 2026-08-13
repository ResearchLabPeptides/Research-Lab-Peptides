/**
 * The parts of the email layer a Client Component may import.
 *
 * `lib/email.ts` is server-only because it reaches for the service key, so the
 * template editor cannot import from it. Keeping the pure pieces here means the
 * preview in the browser renders placeholders exactly the way the sender does.
 */

export interface TemplateVars {
  company_name: string;
  customer_name: string;
  order_number: string;
  subtotal: string;
  shipping: string;
  discount: string;
  tax: string;
  total: string;
  items: string;
  address: string;
  payment_email: string;
  track_url: string;
  note: string;
  discount_lines: string;
  payment_method: string;
  payment_instructions: string;
  usdc_address: string;
  usdc_amount: string;
}

export const TEMPLATE_PLACEHOLDERS: { token: keyof TemplateVars; description: string }[] = [
  { token: 'customer_name', description: 'Who the order is for' },
  { token: 'order_number', description: 'e.g. ORD-2026-000001' },
  { token: 'company_name', description: 'Your business name' },
  { token: 'total', description: 'What they owe, formatted' },
  { token: 'subtotal', description: 'Items before shipping and tax' },
  { token: 'shipping', description: 'Shipping charge, or "Free"' },
  { token: 'discount', description: 'All discounts combined, or a dash' },
  { token: 'discount_lines', description: 'Each discount on its own line' },
  { token: 'tax', description: 'Tax charged' },
  { token: 'items', description: 'The order lines, one per row' },
  { token: 'address', description: 'Where it is going' },
  { token: 'payment_email', description: 'Your e-Transfer address' },
  { token: 'payment_method', description: 'Interac e-Transfer, or USDC on Solana' },
  { token: 'payment_instructions', description: 'How to pay — matches the method they chose' },
  { token: 'usdc_address', description: 'The address for this order, if paying in USDC' },
  { token: 'usdc_amount', description: 'How much USDC to send, if paying that way' },
  { token: 'track_url', description: 'Link to their tracking page' },
  { token: 'note', description: 'The note staff typed, if any' },
];

/** Unknown tokens are left alone, so a typo is visible rather than silently blank. */
export function renderTemplate(text: string, vars: Partial<TemplateVars>): string {
  return text.replace(/\{(\w+)\}/g, (match, token: string) => {
    const value = vars[token as keyof TemplateVars];
    return value === undefined ? match : value;
  });
}
