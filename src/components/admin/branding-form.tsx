'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  BRAND_COLOR_KEYS,
  BRAND_COLOR_LABELS,
  FONT_CHOICES,
  brandingCss,
  fontHref,
  isHexColor,
  luminance,
  type BrandColorKey,
  type Branding,
} from '@/lib/branding';
import { saveBranding } from '@/lib/actions/site';
import { cn } from '@/lib/utils';

const PRESETS: { name: string; branding: Branding }[] = [
  {
    name: 'Evergreen',
    branding: {
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
    },
  },
  {
    name: 'Butcher',
    branding: {
      light: {
        background: '#FBF7F2',
        card: '#FFFFFF',
        foreground: '#241C17',
        primary: '#8C2F22',
        warning: '#B4791C',
        border: '#E8DED2',
      },
      dark: {
        background: '#1A1411',
        card: '#241C17',
        foreground: '#F0E7DD',
        primary: '#D4674F',
        warning: '#E0A106',
        border: '#3A2E26',
      },
      fontDisplay: 'Fraunces',
      fontBody: 'Karla',
      fontMono: 'IBM Plex Mono',
      radiusPx: 4,
    },
  },
  {
    name: 'Clinical',
    branding: {
      light: {
        background: '#F4F7FB',
        card: '#FFFFFF',
        foreground: '#0F172A',
        primary: '#1D4ED8',
        warning: '#B45309',
        border: '#DDE5F0',
      },
      dark: {
        background: '#0A1020',
        card: '#141C2E',
        foreground: '#E6EDF8',
        primary: '#6699FF',
        warning: '#F0B429',
        border: '#22304A',
      },
      fontDisplay: 'IBM Plex Sans',
      fontBody: 'IBM Plex Sans',
      fontMono: 'IBM Plex Mono',
      radiusPx: 6,
    },
  },
  {
    name: 'Florist',
    branding: {
      light: {
        background: '#FDF6F8',
        card: '#FFFFFF',
        foreground: '#2B1620',
        primary: '#A3346C',
        warning: '#C2760B',
        border: '#F0DCE4',
      },
      dark: {
        background: '#1C1017',
        card: '#2B1620',
        foreground: '#F6E8EE',
        primary: '#E27BAE',
        warning: '#F0B429',
        border: '#3E2431',
      },
      fontDisplay: 'Playfair Display',
      fontBody: 'Manrope',
      fontMono: 'JetBrains Mono',
      radiusPx: 18,
    },
  },
];

export function BrandingForm({ initial }: { initial: Branding }) {
  const [brand, setBrand] = React.useState<Branding>(initial);
  const [scheme, setScheme] = React.useState<'light' | 'dark'>('light');
  const [feedback, setFeedback] = React.useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = React.useTransition();

  const palette = brand[scheme];

  function setColor(key: BrandColorKey, value: string) {
    setBrand((prev) => ({ ...prev, [scheme]: { ...prev[scheme], [key]: value } }));
  }

  // Two colours that are nearly the same brightness will not be readable
  // against each other. Flagged rather than blocked — a designer may know
  // something the check does not.
  const contrastWarning =
    Math.abs(luminance(palette.background) - luminance(palette.foreground)) < 90;

  const invalid = BRAND_COLOR_KEYS.filter((k) => !isHexColor(palette[k]));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Start from a preset</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                onClick={() => setBrand(preset.branding)}
                className="rounded-lg border border-border p-2.5 text-left transition-colors hover:border-primary"
              >
                <span className="mb-1.5 flex gap-1">
                  {(['background', 'primary', 'foreground'] as BrandColorKey[]).map((k) => (
                    <span
                      key={k}
                      className="size-3.5 rounded-full border border-black/10"
                      style={{ background: preset.branding.light[k] }}
                    />
                  ))}
                </span>
                <span className="text-xs font-semibold">{preset.name}</span>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Colours</CardTitle>
            <div className="mt-2 inline-flex rounded-lg bg-muted p-0.5">
              {(['light', 'dark'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScheme(s)}
                  aria-pressed={scheme === s}
                  className={cn(
                    'rounded-md px-3 py-1 text-xs font-semibold capitalize transition-colors',
                    scheme === s ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
                  )}
                >
                  {s} mode
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {BRAND_COLOR_KEYS.map((key) => {
              const value = palette[key];
              const valid = isHexColor(value);
              return (
                <div key={key} className="space-y-1">
                  <label htmlFor={`brand-${key}`} className="text-sm font-medium">
                    {BRAND_COLOR_LABELS[key].label}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="color"
                      aria-label={`${BRAND_COLOR_LABELS[key].label} colour picker`}
                      value={valid ? value : '#000000'}
                      onChange={(e) => setColor(key, e.target.value.toUpperCase())}
                      className="h-10 w-11 shrink-0 cursor-pointer rounded-md border border-input bg-background p-1"
                    />
                    <Input
                      id={`brand-${key}`}
                      value={value}
                      onChange={(e) => setColor(key, e.target.value.toUpperCase())}
                      aria-invalid={!valid}
                      className="font-mono uppercase"
                      maxLength={7}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">{BRAND_COLOR_LABELS[key].help}</p>
                </div>
              );
            })}

            {contrastWarning ? (
              <p className="rounded-md bg-[var(--warning)]/12 px-3 py-2 text-xs font-medium text-[var(--warning)]">
                Your text and background are close in brightness. Customers may struggle to read
                this — check the preview before saving.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Type &amp; shape</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <FontPicker
              id="font-display"
              label="Headings"
              value={brand.fontDisplay}
              options={FONT_CHOICES.display}
              onChange={(v) => setBrand((p) => ({ ...p, fontDisplay: v }))}
            />
            <FontPicker
              id="font-body"
              label="Body text"
              value={brand.fontBody}
              options={FONT_CHOICES.body}
              onChange={(v) => setBrand((p) => ({ ...p, fontBody: v }))}
            />
            <FontPicker
              id="font-mono"
              label="Numbers, SKUs, order numbers"
              value={brand.fontMono}
              options={FONT_CHOICES.mono}
              onChange={(v) => setBrand((p) => ({ ...p, fontMono: v }))}
            />

            <div className="space-y-1">
              <label htmlFor="radius" className="text-sm font-medium">
                Corner roundness{' '}
                <span className="tabular font-mono text-xs text-muted-foreground">
                  {brand.radiusPx}px
                </span>
              </label>
              <input
                id="radius"
                type="range"
                min={0}
                max={32}
                value={brand.radiusPx}
                onChange={(e) => setBrand((p) => ({ ...p, radiusPx: Number(e.target.value) }))}
                className="w-full accent-[var(--primary)]"
              />
            </div>
          </CardContent>
        </Card>

        {feedback ? (
          <p
            role="status"
            className={
              feedback.ok
                ? 'rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground'
                : 'rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive'
            }
          >
            {feedback.message}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button
            disabled={pending || invalid.length > 0}
            onClick={() => startTransition(async () => setFeedback(await saveBranding(brand)))}
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {pending ? 'Saving' : 'Save branding'}
          </Button>
          <Button variant="outline" onClick={() => setBrand(initial)} disabled={pending}>
            Discard changes
          </Button>
        </div>

        {invalid.length > 0 ? (
          <p className="text-xs font-medium text-destructive">
            Fix the {invalid.length === 1 ? 'colour' : 'colours'} marked in red first — each one
            needs six hex digits, like #0F7B5A.
          </p>
        ) : null}
      </div>

      <BrandPreview brand={brand} scheme={scheme} />
    </div>
  );
}

function FontPicker({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((font) => (
            <SelectItem key={font} value={font}>
              {font}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * A real product block and order ticket, rendered inside an isolated scope with
 * the unsaved palette applied. Showing the actual components rather than
 * swatches is the point — it is the only way to catch a colour that technically
 * validates but looks wrong on the thing customers see.
 */
function BrandPreview({ brand, scheme }: { brand: Branding; scheme: 'light' | 'dark' }) {
  const css = React.useMemo(() => {
    // Reuse the production CSS generator, then re-scope it to the preview box so
    // it cannot repaint the dashboard around it.
    return brandingCss(brand)
      .replace('html:root{', '#brand-preview{')
      .replace('html.dark{', '#brand-preview[data-scheme="dark"]{');
  }, [brand]);

  const palette = brand[scheme];

  return (
    <div className="lg:sticky lg:top-6">
      <link rel="stylesheet" href={fontHref(brand)} />
      <style dangerouslySetInnerHTML={{ __html: css }} />

      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Live preview — {scheme} mode
      </p>

      <div
        id="brand-preview"
        data-scheme={scheme}
        className="overflow-hidden rounded-xl border"
        style={{
          background: palette.background,
          borderColor: palette.border,
          color: palette.foreground,
          fontFamily: `'${brand.fontBody}', sans-serif`,
        }}
      >
        <div
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: palette.border, background: palette.card }}
        >
          <span
            className="text-base font-bold"
            style={{ fontFamily: `'${brand.fontDisplay}', sans-serif` }}
          >
            Your Business
          </span>
          <span className="text-xs opacity-60">Delivery only</span>
        </div>

        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <div
            className="overflow-hidden border"
            style={{
              background: palette.card,
              borderColor: palette.border,
              borderRadius: brand.radiusPx,
            }}
          >
            <div className="aspect-[4/3]" style={{ background: `${palette.primary}22` }} />
            <div className="p-3">
              <p className="text-[10px] uppercase tracking-[0.14em] opacity-60">Pantry</p>
              <p className="mt-0.5 text-sm font-semibold">Cold Pressed Olive Oil</p>
              <p className="mt-1 text-xs opacity-70">Single estate, harvested last November.</p>
              <div className="mt-3 flex items-center justify-between">
                <span
                  className="text-base font-bold"
                  style={{
                    fontFamily: `'${brand.fontDisplay}', sans-serif`,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  $22.99
                </span>
                <span
                  className="px-3 py-1.5 text-xs font-semibold"
                  style={{
                    background: palette.primary,
                    color: luminance(palette.primary) > 150 ? '#0B1220' : '#FFFFFF',
                    borderRadius: Math.max(4, brand.radiusPx - 3),
                  }}
                >
                  + Add
                </span>
              </div>
            </div>
          </div>

          <div
            className="border p-3"
            style={{
              background: palette.card,
              borderColor: palette.border,
              borderRadius: brand.radiusPx,
            }}
          >
            <p className="text-[11px] font-bold uppercase tracking-[0.16em]">Your order</p>
            <div className="mt-3 space-y-1.5 text-xs">
              <Line label="Subtotal" value="$45.98" font={brand.fontBody} />
              <Line label="Shipping" value="Free" font={brand.fontBody} />
              <Line label="Tax" value="$2.30" font={brand.fontBody} />
            </div>
            <div
              className="mt-2 flex items-center justify-between border-t pt-2"
              style={{ borderColor: palette.border }}
            >
              <span className="text-xs font-semibold">Total</span>
              <span
                className="text-lg font-bold"
                style={{
                  fontFamily: `'${brand.fontDisplay}', sans-serif`,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                $48.28
              </span>
            </div>
            <div
              className="mt-3 px-3 py-2 text-[11px] font-semibold"
              style={{
                background: `${palette.warning}22`,
                color: palette.warning,
                borderRadius: Math.max(4, brand.radiusPx - 4),
              }}
            >
              Awaiting e-Transfer
            </div>
            <p
              className="mt-2 text-[11px] opacity-60"
              style={{ fontFamily: `'${brand.fontMono}', monospace` }}
            >
              ORD-2026-000001
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Line({ label, value, font }: { label: string; value: string; font: string }) {
  return (
    <div className="flex justify-between">
      <span className="opacity-60">{label}</span>
      <span style={{ fontFamily: `'${font}', sans-serif`, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>
    </div>
  );
}
