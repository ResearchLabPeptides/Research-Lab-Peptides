import type { Metadata, Viewport } from 'next';
import { ThemeProvider } from '@/components/theme-provider';
import { BrandingStyle } from '@/components/branding-style';
import { getBranding, getPublicSettings } from '@/lib/queries/storefront';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getPublicSettings();
  return {
    title: {
      default: `${settings.company_name} — Groceries delivered`,
      template: `%s · ${settings.company_name}`,
    },
    description:
      'Order pantry staples, fresh produce, and bakery for delivery. No account, no app — pay by Interac e-Transfer.',
    metadataBase: process.env.NEXT_PUBLIC_SITE_URL
      ? new URL(process.env.NEXT_PUBLIC_SITE_URL)
      : undefined,
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f8fa' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1220' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Fonts and colours come from the database, not from the build, so one
  // deployment can serve businesses that look nothing alike.
  const branding = await getBranding();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <BrandingStyle branding={branding} />
      </head>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
          >
            Skip to content
          </a>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
