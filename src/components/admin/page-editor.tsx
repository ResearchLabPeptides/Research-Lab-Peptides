'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Bold,
  Eye,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Pencil,
  Quote,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { CheckboxField } from '@/components/ui/checkbox-field';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { renderMarkdown } from '@/lib/markdown';
import { slugify } from '@/lib/format';
import { createPage, deletePage, updatePage } from '@/lib/actions/site';
import type { AdminPage } from '@/lib/queries/admin';
import { cn } from '@/lib/utils';

/**
 * Pages are written in Markdown rather than as raw HTML.
 *
 * That is a safety decision as much as a simplicity one: the renderer escapes
 * every angle bracket before it looks for Markdown, so nothing an author types
 * can become a tag. Only the renderer emits HTML. A pasted `<script>` shows up
 * as literal text on the page instead of running.
 *
 * The toolbar wraps the selection, so nobody has to know the syntax.
 */
export function PageEditor({ page }: { page?: AdminPage }) {
  const router = useRouter();
  const isEdit = Boolean(page);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);

  const [title, setTitle] = React.useState(page?.title ?? '');
  const [slug, setSlug] = React.useState(page?.slug ?? '');
  const [slugTouched, setSlugTouched] = React.useState(isEdit);
  const [body, setBody] = React.useState(page?.body_markdown ?? '');
  const [meta, setMeta] = React.useState(page?.meta_description ?? '');
  const [published, setPublished] = React.useState(page?.is_published ?? false);
  const [inNav, setInNav] = React.useState(page?.show_in_nav ?? true);
  const [sortOrder, setSortOrder] = React.useState(String(page?.sort_order ?? 0));
  const [tab, setTab] = React.useState<'write' | 'preview'>('write');
  const [feedback, setFeedback] = React.useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = React.useTransition();

  function setTitleAndSlug(value: string) {
    setTitle(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  /** Wraps or prefixes the current selection, then restores the cursor. */
  function apply(kind: 'bold' | 'italic' | 'h2' | 'ul' | 'ol' | 'quote' | 'link') {
    const el = bodyRef.current;
    if (!el) return;

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = body.slice(start, end);
    const before = body.slice(0, start);
    const after = body.slice(end);

    const wrap = (mark: string, placeholder: string) => {
      const inner = selected || placeholder;
      const next = `${before}${mark}${inner}${mark}${after}`;
      setBody(next);
      queueMicrotask(() => {
        el.focus();
        el.setSelectionRange(start + mark.length, start + mark.length + inner.length);
      });
    };

    const prefixLines = (prefix: string | ((i: number) => string), placeholder: string) => {
      const inner = selected || placeholder;
      const lines = inner.split('\n').map((line, i) => {
        const p = typeof prefix === 'function' ? prefix(i) : prefix;
        return p + line;
      });
      // Block elements need a blank line before them to start a new block.
      const pad = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
      const next = `${before}${pad}${lines.join('\n')}${after}`;
      setBody(next);
      queueMicrotask(() => el.focus());
    };

    switch (kind) {
      case 'bold':
        return wrap('**', 'bold text');
      case 'italic':
        return wrap('*', 'italic text');
      case 'h2':
        return prefixLines('## ', 'Section heading');
      case 'ul':
        return prefixLines('- ', 'List item');
      case 'ol':
        return prefixLines((i) => `${i + 1}. `, 'List item');
      case 'quote':
        return prefixLines('> ', 'Quoted text');
      case 'link': {
        const label = selected || 'link text';
        const next = `${before}[${label}](https://example.com)${after}`;
        setBody(next);
        queueMicrotask(() => {
          el.focus();
          const urlStart = start + label.length + 3;
          el.setSelectionRange(urlStart, urlStart + 19);
        });
      }
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setFeedback(null);

    const payload = {
      slug,
      title,
      bodyMarkdown: body,
      metaDescription: meta,
      isPublished: published,
      showInNav: inNav,
      sortOrder: Number(sortOrder) || 0,
    };

    startTransition(async () => {
      const result = page ? await updatePage(page.id, payload) : await createPage(payload);
      setFeedback(result);
      if (result.ok && !page && result.pageId) {
        router.push(`/admin/content/pages/${result.pageId}`);
      } else if (result.ok) {
        router.refresh();
      }
    });
  }

  const previewHtml = React.useMemo(() => renderMarkdown(body), [body]);

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Page</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field id="pg-title" label="Title" required>
                <Input value={title} onChange={(e) => setTitleAndSlug(e.target.value)} />
              </Field>

              <Field
                id="pg-slug"
                label="Web address"
                hint={slug ? `Visitors will find it at /p/${slug}` : 'Filled in from the title'}
                required
              >
                <Input
                  value={slug}
                  className="font-mono"
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(e.target.value);
                  }}
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle>Content</CardTitle>
              <div className="flex gap-1 rounded-md bg-muted p-0.5">
                <button
                  type="button"
                  onClick={() => setTab('write')}
                  aria-pressed={tab === 'write'}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium',
                    tab === 'write' ? 'bg-card shadow-sm' : 'text-muted-foreground',
                  )}
                >
                  <Pencil className="size-3.5" aria-hidden />
                  Write
                </button>
                <button
                  type="button"
                  onClick={() => setTab('preview')}
                  aria-pressed={tab === 'preview'}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium',
                    tab === 'preview' ? 'bg-card shadow-sm' : 'text-muted-foreground',
                  )}
                >
                  <Eye className="size-3.5" aria-hidden />
                  Preview
                </button>
              </div>
            </CardHeader>
            <CardContent>
              {tab === 'write' ? (
                <>
                  <div
                    className="mb-2 flex flex-wrap gap-0.5 rounded-md border border-border p-1"
                    role="toolbar"
                    aria-label="Formatting"
                  >
                    <ToolButton label="Bold" onClick={() => apply('bold')} icon={Bold} />
                    <ToolButton label="Italic" onClick={() => apply('italic')} icon={Italic} />
                    <ToolButton label="Heading" onClick={() => apply('h2')} icon={Heading2} />
                    <ToolButton label="Bulleted list" onClick={() => apply('ul')} icon={List} />
                    <ToolButton
                      label="Numbered list"
                      onClick={() => apply('ol')}
                      icon={ListOrdered}
                    />
                    <ToolButton label="Quote" onClick={() => apply('quote')} icon={Quote} />
                    <ToolButton label="Link" onClick={() => apply('link')} icon={Link2} />
                  </div>

                  <textarea
                    ref={bodyRef}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={20}
                    aria-label="Page content"
                    placeholder="Write the page here. Select some text and use the buttons above, or type Markdown directly."
                    className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm leading-relaxed shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    Blank line between paragraphs. Typed HTML is shown as plain text, never run.
                  </p>
                </>
              ) : (
                <div className="min-h-[28rem] rounded-md border border-border p-5">
                  {body.trim() ? (
                    <div
                      className="space-y-3 text-sm leading-relaxed [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:font-display [&_h3]:text-lg [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_ul]:list-disc"
                      // Safe: renderMarkdown escapes all HTML in the source before
                      // emitting its own tags. See lib/markdown.ts.
                      dangerouslySetInnerHTML={{ __html: previewHtml }}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Nothing to preview yet. Switch to Write and start typing.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Visibility</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <CheckboxField
                id="pg-published"
                label="Published"
                description="Unpublished pages are only visible to you"
                checked={published}
                onChange={setPublished}
              />
              <CheckboxField
                id="pg-nav"
                label="Show in the menu"
                description="Adds a link at the top of the shop, beside Track an order"
                checked={inNav}
                onChange={setInNav}
              />
              <Field id="pg-sort" label="Menu order" hint="Lower numbers come first">
                <Input
                  type="number"
                  min="0"
                  className="tabular"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Search listing</CardTitle>
            </CardHeader>
            <CardContent>
              <Field
                id="pg-meta"
                label="Description"
                hint="The grey text under the title in Google results. Around 150 characters."
              >
                <Input value={meta} onChange={(e) => setMeta(e.target.value)} />
              </Field>
            </CardContent>
          </Card>
        </div>
      </div>

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

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {pending ? 'Saving' : isEdit ? 'Save page' : 'Create page'}
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link href="/admin/content">Cancel</Link>
        </Button>

        {page ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Delete this page"
            className="ml-auto"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(`Delete "${page.title}" permanently?`)) return;
              startTransition(async () => {
                const result = await deletePage(page.id);
                if (result.ok) router.push('/admin/content');
                else setFeedback(result);
              });
            }}
          >
            <Trash2 className="size-4" />
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function ToolButton({
  label,
  onClick,
  icon: Icon,
}: {
  label: string;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="grid size-8 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Icon className="size-4" />
    </button>
  );
}
