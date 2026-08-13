import 'server-only';
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

/**
 * Entry-gate cookie.
 *
 * The cookie records which acknowledgements a visitor confirmed and a version
 * derived from the wording they were shown. It is httpOnly, so page scripts
 * cannot read or forge it, and it is HMAC-signed, so a hand-edited cookie is
 * rejected rather than believed.
 *
 * None of that is the real enforcement — `place_order()` re-checks the required
 * set on every checkout regardless. The signature is here so the record stored
 * on the order is one the server vouches for.
 */

export const GATE_COOKIE = 'ack_gate';
export const GATE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90; // 90 days

export interface AcknowledgementItem {
  key: string;
  label: string;
  body: string;
  link_url: string | null;
  link_label: string;
  is_required: boolean;
}

export interface GatePayload {
  version: string;
  keys: string[];
  at: string;
}

function secret(): string {
  const value = process.env.GATE_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) {
    throw new Error(
      'Set GATE_SECRET (or SUPABASE_SERVICE_ROLE_KEY) so gate cookies can be signed.',
    );
  }
  return value;
}

/**
 * Version is a hash of the wording itself, not a number someone has to remember
 * to increment. Change an acknowledgement and every visitor is re-prompted
 * automatically; change nothing and nobody is bothered.
 */
export function gateVersion(items: AcknowledgementItem[]): string {
  const canonical = items
    .filter((i) => i.is_required)
    .map((i) => `${i.key}\u0000${i.label}`)
    .sort()
    .join('\u0001');

  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

export function signGate(payload: GatePayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifyGate(cookieValue: string | undefined): GatePayload | null {
  if (!cookieValue) return null;

  const [body, mac] = cookieValue.split('.');
  if (!body || !mac) return null;

  const expected = createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;

    const p = parsed as Record<string, unknown>;
    if (typeof p.version !== 'string' || typeof p.at !== 'string' || !Array.isArray(p.keys)) {
      return null;
    }
    return {
      version: p.version,
      keys: p.keys.filter((k): k is string => typeof k === 'string'),
      at: p.at,
    };
  } catch {
    return null;
  }
}

/** True when the visitor has confirmed the current required set. */
export function gateSatisfied(payload: GatePayload | null, items: AcknowledgementItem[]): boolean {
  if (!payload) return false;
  if (payload.version !== gateVersion(items)) return false;

  return items.filter((i) => i.is_required).every((i) => payload.keys.includes(i.key));
}
