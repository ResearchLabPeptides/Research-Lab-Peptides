/**
 * Money is integer cents everywhere in this codebase — in the database, over
 * the wire, and in React state. It only becomes a decimal string at the moment
 * it is rendered. Nothing multiplies or divides prices in floating point.
 */

const DEFAULT_CURRENCY = 'CAD';
const DEFAULT_LOCALE = 'en-CA';

export function formatMoney(cents: number, currency = DEFAULT_CURRENCY): string {
  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

/** "$12" when whole, "$12.50" otherwise. For dense product grids. */
export function formatMoneyCompact(cents: number, currency = DEFAULT_CURRENCY): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    style: 'currency',
    currency,
    minimumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);
}

/**
 * The shop's timezone.
 *
 * Timestamps are stored in UTC, and without naming a zone here the formatter
 * uses whatever the machine rendering the page thinks is local. In the browser
 * that is the visitor's own clock; on the server it is UTC, because that is how
 * Vercel's runtime is configured. The result is an order placed at 7:30pm
 * showing as 2:30am the following day on any page rendered server-side, and
 * correctly in the same shop elsewhere.
 *
 * Fixed to the business's own zone rather than the visitor's, deliberately. An
 * order placed at 7:30pm Pacific should read 7:30pm to the staff packing it and
 * to the customer who placed it, whichever province either happens to be in.
 * The alternative — everyone sees their own local time — sounds friendlier and
 * makes it impossible for two people to talk about the same order.
 */
const SHOP_TIME_ZONE = process.env.NEXT_PUBLIC_SHOP_TIMEZONE || 'America/Vancouver';

export function formatDate(value: string | Date): string {
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    dateStyle: 'medium',
    timeZone: SHOP_TIME_ZONE,
  }).format(new Date(value));
}

export function formatDateTime(value: string | Date): string {
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: SHOP_TIME_ZONE,
  }).format(new Date(value));
}

/** "in about 2 hours" / "3 days ago" */
export function formatRelative(value: string | Date): string {
  const target = new Date(value).getTime();
  const diffMinutes = Math.round((target - Date.now()) / 60000);
  const rtf = new Intl.RelativeTimeFormat(DEFAULT_LOCALE, { numeric: 'auto' });

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['minute', 1],
    ['hour', 60],
    ['day', 60 * 24],
    ['week', 60 * 24 * 7],
    ['month', 60 * 24 * 30],
  ];

  let chosen: [Intl.RelativeTimeFormatUnit, number] = ['minute', 1];
  for (const unit of units) {
    if (Math.abs(diffMinutes) >= unit[1]) chosen = unit;
  }
  return rtf.format(Math.round(diffMinutes / chosen[1]), chosen[0]);
}

/** "V3S 1A4" for display; the database stores "V3S1A4". */
export function formatPostalCode(raw: string): string {
  const clean = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return clean.length > 3 ? `${clean.slice(0, 3)} ${clean.slice(3, 6)}` : clean;
}

export function normalizePostalCode(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/**
 * Turns a product name into a URL segment. Staff never have to think about
 * this — the form fills it in and only shows it if they want to change it.
 */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
}

/** "12.50" from 1250. For pre-filling a money input. */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2);
}

/** 1250 from "12.50" or "12,50". Returns null for blank input. */
export function inputToCents(value: string): number | null {
  const clean = value.replace(/[^0-9.,-]/g, '').replace(',', '.');
  if (clean.trim() === '') return null;
  const amount = Number(clean);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}
