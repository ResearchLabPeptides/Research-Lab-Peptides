import 'server-only';
import { createServiceClient } from './supabase/admin';
import { formatMoney } from './format';

/**
 * Transactional email.
 *
 * Wording comes from the `email_templates` table so staff can rewrite it
 * without touching code. Templates are plain text with {placeholders}; the HTML
 * version is generated from the same text, so there is one thing to edit rather
 * than two that can disagree.
 *
 * With no RESEND_API_KEY set, messages are logged instead of sent. That is the
 * intended development behaviour — you can walk the whole order lifecycle and
 * read every email in your terminal.
 */

export type TemplateKey =
  'order_placed' | 'payment_received' | 'out_for_delivery' | 'delivered' | 'cancelled';

export { TEMPLATE_PLACEHOLDERS, renderTemplate } from './email-shared';
export type { TemplateVars } from './email-shared';
import { renderTemplate, type TemplateVars } from './email-shared';

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Plain text to HTML. Blank lines become paragraphs, ALL-CAPS lines become
 * small headings, and the tracking link becomes a button. The text is escaped
 * first, so nothing typed into a template can emit a tag.
 */
function toHtml(text: string, companyName: string, trackUrl?: string): string {
  const blocks = escapeHtml(text.trim())
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();

      if (trackUrl && trimmed === escapeHtml(trackUrl)) {
        return `<p style="margin:0 0 16px"><a href="${escapeHtml(trackUrl)}" style="display:inline-block;background:#0f7b5a;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Track your order</a></p>`;
      }

      if (/^[A-Z0-9 ,'&-]{4,}$/.test(trimmed)) {
        return `<p style="margin:24px 0 8px;font-size:12px;letter-spacing:.12em;color:#5b6472;font-weight:700">${trimmed}</p>`;
      }

      return `<p style="margin:0 0 14px;font-size:15px;line-height:1.6">${trimmed.replace(/\n/g, '<br>')}</p>`;
    })
    .join('');

  return `<!doctype html><html><body style="margin:0;background:#f7f8fa;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0b1220">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px">
    <p style="font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:#5b6472;margin:0 0 20px">${escapeHtml(companyName)}</p>
    ${blocks}
    <p style="font-size:12px;color:#5b6472;margin-top:32px;border-top:1px solid #e3e7ec;padding-top:16px">
      Questions? Reply to this email and a person will read it.
    </p>
  </div></body></html>`;
}

async function deliver(to: string, subject: string, text: string, html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? 'orders@example.com';

  if (!apiKey) {
    console.info(`[email] would send to ${to}: ${subject}\n${text}\n`);
    return;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html, text }),
    });
    if (!res.ok) console.error('[email] send failed', res.status, await res.text());
  } catch (error) {
    // A failed email must never fail the operation that triggered it. Staff have
    // already confirmed the payment; losing the receipt is the lesser problem.
    console.error('[email] send threw', error);
  }
}

export async function sendTemplatedEmail(
  key: TemplateKey,
  to: string,
  vars: TemplateVars,
): Promise<void> {
  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from('email_templates')
      .select('subject, body, is_active')
      .eq('key', key)
      .maybeSingle();

    if (!data) {
      console.warn(`[email] no template for "${key}" — nothing sent`);
      return;
    }
    if (!data.is_active) return; // switched off on purpose

    const subject = renderTemplate(data.subject as string, vars);
    const text = renderTemplate(data.body as string, vars);
    await deliver(to, subject, text, toHtml(text, vars.company_name, vars.track_url));
  } catch (error) {
    console.error('[email] could not build message', key, error);
  }
}

/** Order lines the way the templates expect them: one per row. */
export function formatItemLines(
  items: { name: string; quantity: number; line_total_cents: number }[],
): string {
  return items
    .map((i) => `  ${i.quantity} × ${i.name} — ${formatMoney(i.line_total_cents)}`)
    .join('\n');
}

/** Which template a status change should send, if any. */
export function templateForStatus(status: string): TemplateKey | null {
  if (status === 'preparing' || status === 'payment_received') return 'payment_received';
  if (status === 'out_for_delivery') return 'out_for_delivery';
  if (status === 'delivered') return 'delivered';
  if (status === 'cancelled' || status === 'refunded') return 'cancelled';
  return null;
}
