import Link from 'next/link';
import { FileText, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ContentEditor } from '@/components/admin/content-editor';
import { requireStaff } from '@/lib/auth';
import { getAdminPages, getContentEntries } from '@/lib/queries/admin';
import { formatRelative } from '@/lib/format';

export const metadata = { title: 'Content' };
export const dynamic = 'force-dynamic';

export default async function ContentPage() {
  await requireStaff('administrator');
  const [entries, pages] = await Promise.all([getContentEntries(), getAdminPages()]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Content</h1>
        <p className="text-sm text-muted-foreground">
          The words on your storefront. Short labels and headings are below; longer pages like About
          or FAQ get their own editor.
        </p>
      </div>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
          <div>
            <CardTitle>Pages</CardTitle>
            <p className="text-sm text-muted-foreground">
              Full pages with headings, lists, and links.
            </p>
          </div>
          <Button size="sm" asChild>
            <Link href="/admin/content/pages/new">
              <Plus className="size-4" aria-hidden />
              New page
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {pages.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No pages yet"
              description="Add an About, FAQ, or delivery information page and link it in the footer."
              action={
                <Button size="sm" asChild>
                  <Link href="/admin/content/pages/new">Write your first page</Link>
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {pages.map((page) => (
                <li key={page.id}>
                  <Link
                    href={`/admin/content/pages/${page.id}`}
                    className="flex items-center justify-between gap-3 py-3 transition-colors hover:text-primary"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{page.title}</p>
                        {page.is_published ? (
                          <Badge tone="green">Published</Badge>
                        ) : (
                          <Badge tone="amber">Draft</Badge>
                        )}
                        {page.show_in_nav ? <Badge tone="slate">In footer</Badge> : null}
                      </div>
                      <p className="font-mono text-xs text-muted-foreground">
                        /p/{page.slug} · edited {formatRelative(page.updated_at)}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-1 font-display text-lg font-semibold tracking-tight">Wording</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Headings and labels used across the storefront. Clear a field and the built-in wording
          comes back.
        </p>
        <ContentEditor entries={entries} />
      </div>
    </div>
  );
}
