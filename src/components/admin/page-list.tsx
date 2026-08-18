'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { movePage } from '@/lib/actions/site';
import { formatRelative } from '@/lib/format';

export interface PageRow {
  id: string;
  slug: string;
  title: string;
  is_published: boolean;
  show_in_nav: boolean;
  sort_order: number;
  updated_at: string;
}

/**
 * The list of pages, with controls to change the order they appear in the shop
 * menu.
 *
 * Up and down buttons rather than drag and drop. Dragging is fiddly on a phone
 * — it competes with scrolling and there is no obvious drop target — and a shop
 * with four or five pages reorders them once and never again. Two buttons work
 * the same on every device and need no explaining.
 *
 * Only pages that are in the menu get the controls: ordering a page nobody can
 * see has no visible effect, and offering the buttons anyway would look broken.
 */
export function PageList({ pages }: { pages: PageRow[] }) {
  const [pending, startTransition] = useTransition();

  // Same ordering the storefront menu uses, so the arrows move things the way
  // the list here shows them.
  const inNav = pages
    .filter((page) => page.show_in_nav)
    .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title));

  const navPosition = new Map(inNav.map((page, index) => [page.id, index]));

  function move(id: string, direction: 'up' | 'down') {
    startTransition(async () => {
      const result = await movePage(id, direction);
      if (result.ok) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <ul className="divide-y divide-border">
      {pages.map((page) => {
        const position = navPosition.get(page.id);
        const inMenu = position !== undefined;

        return (
          <li key={page.id} className="flex items-center gap-2 py-3">
            <Link
              href={`/admin/content/pages/${page.id}`}
              className="min-w-0 flex-1 transition-colors hover:text-primary"
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{page.title}</p>
                {page.is_published ? (
                  <Badge tone="green">Published</Badge>
                ) : (
                  <Badge tone="amber">Draft</Badge>
                )}
                {inMenu ? <Badge tone="slate">In menu</Badge> : null}
              </div>
              <p className="font-mono text-xs text-muted-foreground">
                /p/{page.slug} · edited {formatRelative(page.updated_at)}
              </p>
            </Link>

            {inMenu ? (
              <div className="flex shrink-0 items-center gap-1">
                {/* 40px targets: these sit next to a link that navigates away,
                    so a near miss on a phone is worse than usual. */}
                <button
                  type="button"
                  onClick={() => move(page.id, 'up')}
                  disabled={pending || position === 0}
                  aria-label={`Move ${page.title} up in the menu`}
                  className="grid size-10 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
                >
                  <ArrowUp className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => move(page.id, 'down')}
                  disabled={pending || position === inNav.length - 1}
                  aria-label={`Move ${page.title} down in the menu`}
                  className="grid size-10 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
                >
                  <ArrowDown className="size-4" aria-hidden />
                </button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
