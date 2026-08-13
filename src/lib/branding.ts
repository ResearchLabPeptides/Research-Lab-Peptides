/**
 * Branding.
 *
 * Six colours, three fonts, and a corner radius are enough to make one
 * deployment look like a completely different business. Everything else in the
 * palette is derived from those six, so an administrator cannot produce an
 * unreadable combination by editing one value in isolation — muted text, for
 * instance, is always mixed from the background and foreground they chose.
 */

export const BRAND_COLOR_KEYS = [
  'background',
  'card',
  'foreground',
  'primary',
  'warning',
  'border',
] as const;

export type BrandColorKey = (typeof BRAND_COLOR_KEYS)[number];
export type BrandPalette = Record<BrandColorKey, string>;

export interface Branding {
  light: BrandPalette;
  dark: BrandPalette;
  fontDisplay: string;
  fontBody: string;
  fontMono: string;
  radiusPx: number;
}

export const BRAND_COLOR_LABELS: Record<BrandColorKey, { label: string; help: string }> = {
  background: { label: 'Page background', help: 'Behind everything.' },
  card: { label: 'Cards and panels', help: 'Product blocks, the order ticket, dashboard tiles.' },
  foreground: { label: 'Text', help: 'Headings and body copy.' },
  primary: { label: 'Primary', help: 'Buttons, links, and anything affirmative.' },
  warning: { label: 'Awaiting payment', help: 'Reserved for money that has not arrived yet.' },
  border: { label: 'Borders', help: 'Hairlines between things.' },
};

export const DEFAULT_BRANDING: Branding = {
  light: {
    background: '#F7F8FA',
    card: '#FFFFFF',
    foreground: '#0B1220',
    primary: '#0F7B5A',
    warning: '#E0A106',
    border: '#E3E7EC',
  },
  dark: {
    background: '#0B1220',
    card: '#131C2B',
    foreground: '#E8ECF2',
    primary: '#3ECF97',
    warning: '#F0B429',
    border: '#222E42',
  },
  fontDisplay: 'Bricolage Grotesque',
  fontBody: 'Inter',
  fontMono: 'JetBrains Mono',
  radiusPx: 12,
};

/**
 * Fonts are an allow-list, not free text. The names go straight into a Google
 * Fonts URL, so accepting arbitrary input would hand an administrator a way to
 * point every visitor's browser at a URL of their choosing.
 */
export const FONT_CHOICES = {
  display: [
    'Bricolage Grotesque',
    'Playfair Display',
    'Fraunces',
    'Space Grotesk',
    'Outfit',
    'Archivo',
    'Libre Baskerville',
    'DM Serif Display',
    'Inter',
    'IBM Plex Sans',
  ],
  body: [
    'Inter',
    'DM Sans',
    'Manrope',
    'Karla',
    'IBM Plex Sans',
    'Source Sans 3',
    'Lora',
    'Source Serif 4',
    'Nunito Sans',
    'Work Sans',
  ],
  mono: ['JetBrains Mono', 'IBM Plex Mono', 'Roboto Mono', 'Space Mono', 'Source Code Pro'],
} as const;

const ALL_FONTS = new Set<string>([
  ...FONT_CHOICES.display,
  ...FONT_CHOICES.body,
  ...FONT_CHOICES.mono,
]);

export function isAllowedFont(name: string): boolean {
  return ALL_FONTS.has(name);
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

/** Falls back to the default for anything missing or malformed. */
export function normalizePalette(input: unknown, fallback: BrandPalette): BrandPalette {
  const source = (typeof input === 'object' && input !== null ? input : {}) as Record<
    string,
    unknown
  >;
  const out = {} as BrandPalette;
  for (const key of BRAND_COLOR_KEYS) {
    out[key] = isHexColor(source[key]) ? (source[key] as string).toUpperCase() : fallback[key];
  }
  return out;
}

// --- Colour maths ------------------------------------------------------------

function toRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function toHex(rgb: number[]): string {
  return (
    '#' +
    rgb
      .map((v) =>
        Math.round(Math.max(0, Math.min(255, v)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
      .toUpperCase()
  );
}

/** Blends `to` into `from` by `amount` (0–1). */
export function mix(from: string, to: string, amount: number): string {
  const a = toRgb(from);
  const b = toRgb(to);
  return toHex(a.map((v, i) => v + (b[i]! - v) * amount));
}

/** Perceived brightness, 0–255. */
export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Black or white, whichever stays readable on the given colour. */
export function readableOn(hex: string): string {
  return luminance(hex) > 150 ? '#0B1220' : '#FFFFFF';
}

/**
 * Everything the stylesheet needs, derived from the six chosen colours.
 * Kept in one place so light and dark cannot drift apart.
 */
function paletteToVars(p: BrandPalette): Record<string, string> {
  return {
    '--background': p.background,
    '--card': p.card,
    '--card-foreground': p.foreground,
    '--popover': p.card,
    '--popover-foreground': p.foreground,
    '--foreground': p.foreground,
    '--primary': p.primary,
    '--primary-foreground': readableOn(p.primary),
    '--secondary': mix(p.background, p.foreground, 0.06),
    '--secondary-foreground': p.foreground,
    '--muted': mix(p.background, p.foreground, 0.06),
    '--muted-foreground': mix(p.background, p.foreground, 0.6),
    '--accent': mix(p.card, p.primary, 0.14),
    '--accent-foreground': mix(p.primary, p.foreground, 0.25),
    '--warning': p.warning,
    '--warning-foreground': readableOn(p.warning),
    '--border': p.border,
    '--input': mix(p.border, p.foreground, 0.08),
    '--ring': p.primary,
    '--chart-1': p.primary,
    '--chart-2': mix(p.primary, '#2F6F9E', 0.75),
    '--chart-3': p.warning,
    '--chart-4': mix(p.primary, '#8B5CF6', 0.7),
    '--chart-5': '#B42318',
  };
}

function block(selector: string, vars: Record<string, string>): string {
  const body = Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
  return `${selector}{${body}}`;
}

/**
 * The stylesheet injected into every page. It overrides the defaults declared
 * in globals.css, so an unconfigured install still renders correctly and a
 * configured one wins.
 */
/**
 * Second line of defence. The schema rejects unknown fonts on the way in, but
 * this string is interpolated into a <style> tag, so a row that predates the
 * check — or arrives some other way — must not be able to break out of the
 * quotes and inject CSS.
 */
function safeFont(name: string, fallback: string): string {
  return isAllowedFont(name) ? name : fallback;
}

export function brandingCss(branding: Branding): string {
  const body = safeFont(branding.fontBody, 'Inter');
  const display = safeFont(branding.fontDisplay, 'Inter');
  const mono = safeFont(branding.fontMono, 'JetBrains Mono');

  return [
    block('html:root', {
      ...paletteToVars(branding.light),
      '--radius': `${branding.radiusPx}px`,
      '--app-font-sans': `'${body}', ui-sans-serif, system-ui, sans-serif`,
      '--app-font-display': `'${display}', '${body}', sans-serif`,
      '--app-font-mono': `'${mono}', ui-monospace, monospace`,
    }),
    block('html.dark', paletteToVars(branding.dark)),
  ].join('');
}

/** The Google Fonts URL for the three chosen families. */
export function fontHref(branding: Branding): string {
  const families = [...new Set([branding.fontDisplay, branding.fontBody, branding.fontMono])]
    .filter(isAllowedFont)
    .map((f) => `family=${f.replace(/ /g, '+')}:wght@400;500;600;700;800`);

  return `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`;
}
