import type { Metadata, Viewport } from 'next';
import { ThemeProvider } from '@/components/theme-provider';
import { BrandingStyle } from '@/components/branding-style';
import { getBranding, getPublicSettings } from '@/lib/queries/storefront';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getPublicSettings();
  return {
    // Deliberately says nothing about what is being sold.
    //
    // This wording is what appears when the link is pasted into a message, and
    // it followed the demo shop it was written for — pantry staples, produce,
    // bakery. That is wrong for this business and wrong for anyone else running
    // the same software. Describing how ordering works instead is accurate
    // whatever is on the shelves.
    title: {
      default: settings.company_name,
      template: `%s · ${settings.company_name}`,
    },
    description:
      'Order for delivery. No account, no app — pay by Interac e-Transfer or USDC on Solana.',

    metadataBase: process.env.NEXT_PUBLIC_SITE_URL
      ? new URL(process.env.NEXT_PUBLIC_SITE_URL)
      : undefined,

    // Without these, some apps fall back to scraping the page and show whatever
    // text they find first. Stating them explicitly is what makes the preview
    // predictable in Messenger, iMessage, WhatsApp and Slack alike.
    openGraph: {
      type: 'website',
      siteName: settings.company_name,
      title: settings.company_name,
      description:
        'Order for delivery. No account, no app — pay by Interac e-Transfer or USDC on Solana.',
      url: process.env.NEXT_PUBLIC_SITE_URL,
    },
    twitter: {
      card: 'summary',
      title: settings.company_name,
      description:
        'Order for delivery. No account, no app — pay by Interac e-Transfer or USDC on Solana.',
    },
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
