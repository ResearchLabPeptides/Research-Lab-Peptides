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

export function formatDate(value: string | Date): string {
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    dateStyle: 'medium',
  }).format(new Date(value));
}

export function formatDateTime(value: string | Date): string {
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    dateStyle: 'medium',
    timeStyle: 'short',
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
