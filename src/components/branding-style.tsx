import { brandingCss, fontHref, type Branding } from '@/lib/branding';

/**
 * Injects the business's palette, fonts, and corner radius.
 *
 * This overrides the defaults in globals.css, so an install with no branding
 * configured still renders correctly and a configured one wins. It sits in the
 * root layout above everything, which means the first paint is already branded
 * — no flash of the default green.
 *
 * The fonts load from Google's CDN rather than being self-hosted by `next/font`.
 * That costs one extra request, and it is the price of letting an administrator
 * change the typeface without a rebuild.
 */
export function BrandingStyle({ branding }: { branding: Branding }) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href={fontHref(branding)} />
      {/* Values are hex-validated and font names come from an allow-list before
          they are ever stored, so nothing here can carry injected CSS. */}
      <style dangerouslySetInnerHTML={{ __html: brandingCss(branding) }} />
    </>
  );
}
