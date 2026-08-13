'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Download, Mail, Search, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { setUnsubscribed } from '@/lib/actions/customers';
import { formatMoney, formatRelative } from '@/lib/format';
import type { CustomerRow } from '@/lib/queries/admin';
import { cn } from '@/lib/utils';

export function CustomerList({
  customers,
  mailable,
  search,
  mailableOnly,
}: {
  customers: CustomerRow[];
  mailable: number;
  search: string;
  mailableOnly: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState(search);
  const [pending, startTransition] = React.useTransition();
  const [feedback, setFeedback] = React.useState<{ ok: boolean; message: string } | null>(null);

  React.useEffect(() => {
    if (query === search) return;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (mailableOnly) params.set('mailable', '1');
      router.push(`/admin/customers?${params.toString()}`);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, search, mailableOnly, router]);

  function toggleFilter() {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (!mailableOnly) params.set('mailable', '1');
    router.push(`/admin/customers?${params.toString()}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or email"
            aria-label="Search customers"
            className="pl-9"
          />
        </div>

        <button
          type="button"
          onClick={toggleFilter}
          aria-pressed={mailableOnly}
          className={cn(
            'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
            mailableOnly
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border text-muted-foreground hover:text-foreground',
          )}
        >
          Mailing list only
        </button>

        <Button variant="outline" size="sm" asChild className="ml-auto">
          <a href="/api/admin/export?report=mailing-list" download>
            <Download className="size-4" aria-hidden />
            Download mailing list
          </a>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href="/api/admin/export?report=customers" download>
            <Download className="size-4" aria-hidden />
            Download everyone
          </a>
        </Button>
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

      {customers.length === 0 ? (
        <EmptyState
          icon={Users}
          title={search ? 'Nobody matches that' : 'No customers yet'}
          description={
            search
              ? 'Try a different search.'
              : 'Anyone who places an order appears here, once, however many times they order.'
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Customer
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  Orders
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  Spent
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  Average
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Last order
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Marketing
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {customers.map((c) => (
                <tr key={c.email} className="transition-colors hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <p className="font-medium">{c.name || '—'}</p>
                    <a
                      href={`mailto:${c.email}`}
                      className="text-xs text-primary underline-offset-2 hover:underline"
                    >
                      {c.email}
                    </a>
                  </td>
                  <td className="tabular px-4 py-3 text-right">{c.order_count}</td>
                  <td className="tabular px-4 py-3 text-right font-medium">
                    {formatMoney(c.total_spent_cents)}
                  </td>
                  <td className="tabular px-4 py-3 text-right text-muted-foreground">
                    {formatMoney(c.average_order_cents)}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {c.last_order_at ? formatRelative(c.last_order_at) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {c.unsubscribed ? (
                      <Badge tone="slate">Unsubscribed</Badge>
                    ) : c.marketing_opt_in ? (
                      <Badge tone="green">Opted in</Badge>
                    ) : (
                      <Badge tone="amber">Not opted in</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {c.marketing_opt_in ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          startTransition(async () => {
                            const r = await setUnsubscribed({
                              email: c.email,
                              unsubscribed: !c.unsubscribed,
                            });
                            setFeedback(r);
                            if (r.ok) router.refresh();
                          })
                        }
                      >
                        {c.unsubscribed ? 'Re-subscribe' : 'Unsubscribe'}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-4 text-sm">
        <p className="flex items-start gap-2">
          <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>
            <strong className="font-medium">
              {mailable} of {customers.length} can be sent marketing email.
            </strong>{' '}
            <span className="text-muted-foreground">
              Placing an order is not consent to receive advertising — only the people who ticked
              the optional box on the entry gate are on the mailing list. The download reflects
              that, so it is safe to hand straight to a newsletter tool.
            </span>
          </span>
        </p>
      </div>
    </div>
  );
}
