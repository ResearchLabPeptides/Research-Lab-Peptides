'use client';

import * as React from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { saveContent } from '@/lib/actions/site';
import type { ContentEntry } from '@/lib/queries/admin';

const GROUP_LABELS: Record<string, { title: string; help: string }> = {
  home: { title: 'Home page', help: 'The first thing anyone sees.' },
  shop: { title: 'Shop and search', help: 'Filters, empty states, and the product grid.' },
  order: { title: 'Order ticket', help: 'The panel customers check out from.' },
  confirmation: { title: 'After checkout', help: 'The payment instructions screen.' },
  tracking: { title: 'Order tracking', help: 'What customers see when they look up an order.' },
  footer: { title: 'Footer', help: 'Shown at the bottom of every page.' },
};

/**
 * Edits the fixed strings scattered through the storefront — the ones that are
 * a heading or a button label rather than a page of prose.
 *
 * Everything is edited on one screen and saved in one action. Copy tends to be
 * revised in passes ("make the whole thing warmer"), not one field at a time.
 */
export function ContentEditor({ entries }: { entries: ContentEntry[] }) {
  const [values, setValues] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(entries.map((e) => [e.key, e.value])),
  );
  const [feedback, setFeedback] = React.useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = React.useTransition();

  const original = React.useMemo(
    () => Object.fromEntries(entries.map((e) => [e.key, e.value])),
    [entries],
  );

  const changed = entries.filter((e) => values[e.key] !== original[e.key]);

  const groups = React.useMemo(() => {
    const map = new Map<string, ContentEntry[]>();
    for (const entry of entries) {
      const list = map.get(entry.content_group) ?? [];
      list.push(entry);
      map.set(entry.content_group, list);
    }
    return [...map.entries()];
  }, [entries]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (changed.length === 0) {
      setFeedback({ ok: false, message: 'Nothing has changed yet.' });
      return;
    }

    startTransition(async () => {
      // Only the edited rows go over the wire.
      const result = await saveContent({
        entries: changed.map((e) => ({ key: e.key, value: values[e.key] ?? '' })),
      });
      setFeedback(result);
    });
  }

  const draft = (key: string) => values[key] ?? original[key] ?? '';

  return (
    <form onSubmit={submit} className="space-y-4">
      {/* Nothing here has reached the site yet. Everything below is local state
          until Save, so shoppers never see a half-rewritten headline. */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <p className="text-xs font-semibold uppercase tracking-widest">Preview</p>
          {changed.length > 0 ? (
            <Badge tone="amber">Not saved yet — customers still see the old wording</Badge>
          ) : (
            <Badge tone="green">Matches the live site</Badge>
          )}
        </div>

        <div className="space-y-4 p-4">
          <div className="rounded-lg border border-border bg-background p-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
              {draft('home.eyebrow')}
            </p>
            <p className="mt-2 font-display text-2xl font-bold leading-tight tracking-tight">
              {draft('home.heading')}
            </p>
            <p className="mt-2 max-w-prose text-sm text-muted-foreground">{draft('home.sub')}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-background p-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest">
                {draft('order.title')}
              </p>
              <p className="mt-2 text-sm font-medium">{draft('order.emptyTitle')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{draft('order.emptyBody')}</p>
              <div className="mt-3 rounded-md bg-primary px-3 py-2 text-center text-xs font-medium text-primary-foreground">
                {draft('order.cta')}
              </div>
              <p className="mt-2 text-center text-[11px] text-muted-foreground">
                {draft('order.microcopy')}
              </p>
            </div>

            <div className="rounded-lg border border-border bg-background p-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest">
                {draft('confirm.title')}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{draft('confirm.body')}</p>
              <p className="mt-3 text-[11px] uppercase tracking-wider text-muted-foreground">
                No results
              </p>
              <p className="mt-1 text-sm font-medium">{draft('shop.emptyTitle')}</p>
              <p className="text-xs text-muted-foreground">{draft('shop.emptyBody')}</p>
            </div>
          </div>
        </div>
      </div>

      {groups.map(([group, items]) => {
        const meta = GROUP_LABELS[group] ?? { title: group, help: '' };
        return (
          <Card key={group}>
            <CardHeader>
              <CardTitle>{meta.title}</CardTitle>
              {meta.help ? <p className="text-sm text-muted-foreground">{meta.help}</p> : null}
            </CardHeader>
            <CardContent className="space-y-4">
              {items.map((entry) => {
                const isChanged = values[entry.key] !== original[entry.key];
                return (
                  <div key={entry.key} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor={`c-${entry.key}`} className="text-sm font-medium">
                        {entry.label}
                      </label>
                      {isChanged ? (
                        <button
                          type="button"
                          onClick={() =>
                            setValues((p) => ({ ...p, [entry.key]: original[entry.key] ?? '' }))
                          }
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          <RotateCcw className="size-3" aria-hidden />
                          Undo
                        </button>
                      ) : null}
                    </div>

                    {entry.is_multiline ? (
                      <Textarea
                        id={`c-${entry.key}`}
                        rows={3}
                        value={values[entry.key] ?? ''}
                        onChange={(e) => setValues((p) => ({ ...p, [entry.key]: e.target.value }))}
                      />
                    ) : (
                      <Input
                        id={`c-${entry.key}`}
                        value={values[entry.key] ?? ''}
                        onChange={(e) => setValues((p) => ({ ...p, [entry.key]: e.target.value }))}
                      />
                    )}

                    {entry.help ? (
                      <p className="text-xs text-muted-foreground">{entry.help}</p>
                    ) : null}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}

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

      <div className="sticky bottom-0 -mx-4 flex items-center gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
        <Button type="submit" disabled={pending || changed.length === 0}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {pending ? 'Saving' : 'Save wording'}
        </Button>
        <p className="text-sm text-muted-foreground">
          {changed.length === 0
            ? 'No changes'
            : `${changed.length} ${changed.length === 1 ? 'change' : 'changes'} — not live until you save`}
        </p>
      </div>
    </form>
  );
}
