import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { PageEditor } from '@/components/admin/page-editor';
import { requireStaff } from '@/lib/auth';
import { getAdminPage } from '@/lib/queries/admin';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const page = await getAdminPage((await params).id);
  return { title: page ? page.title : 'Page' };
}

export default async function EditSitePage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff('administrator');
  const page = await getAdminPage((await params).id);
  if (!page) notFound();

  return (
    <div className="space-y-5">
      <Link
        href="/admin/content"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Content
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-bold tracking-tight">{page.title}</h1>
        {page.is_published ? (
          <Link
            href={`/p/${page.slug}`}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            View live
            <ExternalLink className="size-3" aria-hidden />
          </Link>
        ) : null}
      </div>

      <PageEditor page={page} />
    </div>
  );
}
