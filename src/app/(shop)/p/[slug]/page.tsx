import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPage } from '@/lib/queries/storefront';
import { markdownExcerpt, renderMarkdown } from '@/lib/markdown';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const page = await getPage((await params).slug);
  if (!page) return { title: 'Not found' };

  return {
    title: page.title,
    description: page.meta_description || markdownExcerpt(page.body_markdown),
    // A draft is visible to signed-in staff for review, but should never be
    // indexed while it is still unpublished.
    robots: page.is_published ? undefined : { index: false, follow: false },
  };
}

export default async function ContentPage({ params }: PageProps) {
  const page = await getPage((await params).slug);

  // RLS already hides unpublished pages from anonymous visitors, so a staff
  // member is the only one who can reach this with is_published false.
  if (!page) notFound();

  return (
    <main id="main" className="mx-auto w-full max-w-2xl px-4 py-12">
      {!page.is_published ? (
        <p className="mb-6 rounded-md bg-[var(--warning)]/12 px-3 py-2 text-sm font-medium text-[var(--warning)]">
          Draft — customers cannot see this page yet.
        </p>
      ) : null}

      <h1 className="font-display text-3xl font-bold tracking-tight">{page.title}</h1>

      {/* The Markdown renderer escapes author input before it does anything
          else, so nothing typed into the dashboard can become markup here. */}
      <div
        className="prose-page mt-6"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(page.body_markdown) }}
      />
    </main>
  );
}
