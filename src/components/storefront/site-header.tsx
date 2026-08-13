import Link from 'next/link';
import { PackageSearch } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import type { NavPage } from '@/lib/queries/storefront';

export function SiteHeader({
  companyName,
  tagline,
  pages = [],
}: {
  companyName: string;
  tagline?: string;
  pages?: NavPage[];
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="font-display text-lg font-bold tracking-tight">{companyName}</span>
          {tagline ? (
            <span className="hidden text-xs uppercase tracking-[0.18em] text-muted-foreground sm:inline">
              {tagline}
            </span>
          ) : null}
        </Link>

        <div className="flex items-center gap-1">
          {/* Pages an administrator has ticked "show in menu". Hidden on small
              screens so the header never wraps on a phone. */}
          <nav className="hidden items-center md:flex" aria-label="Pages">
            {pages.map((page) => (
              <Link
                key={page.slug}
                href={`/p/${page.slug}`}
                className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {page.title}
              </Link>
            ))}
          </nav>

          <Link
            href="/orders"
            className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <PackageSearch className="size-4" aria-hidden />
            <span className="hidden sm:inline">Track an order</span>
          </Link>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
