import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageEditor } from '@/components/admin/page-editor';
import { requireStaff } from '@/lib/auth';

export const metadata = { title: 'New page' };
export const dynamic = 'force-dynamic';

export default async function NewSitePage() {
  await requireStaff('administrator');

  return (
    <div className="space-y-5">
      <Link
        href="/admin/content"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Content
      </Link>
      <h1 className="font-display text-2xl font-bold tracking-tight">New page</h1>
      <PageEditor />
    </div>
  );
}
