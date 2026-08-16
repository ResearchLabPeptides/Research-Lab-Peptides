import Link from 'next/link';
import { Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { OrderStatusBadge, PaymentStatusBadge } from '@/components/admin/status-badge';
import { OrderFilterBar } from '@/components/admin/order-filter-bar';
import { requireStaff } from '@/lib/auth';
import { getOrders } from '@/lib/queries/admin';
import { formatDateTime, formatMoney } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import type { OrderStatus, PaymentMethod } from '@/lib/types';

export const metadata = { title: 'Orders' };
export const dynamic = 'force-dynamic';

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  await requireStaff();
  const params = await searchParams;

  const { orders, total, page, pageCount } = await getOrders({
    search: params.q,
    status: (params.status as OrderStatus | 'all' | undefined) ?? 'all',
    page: Number(params.page) || 1,
  });

  const buildHref = (nextPage: number) => {
    const search = new URLSearchParams();
    if (params.q) search.set('q', params.q);
    if (params.status) search.set('status', params.status);
    search.set('page', String(nextPage));
    return `/admin/orders?${search.toString()}`;
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Orders</h1>
        <p className="tabular text-sm text-muted-foreground">
          {total} {total === 1 ? 'order' : 'orders'}
        </p>
      </div>

      <OrderFilterBar defaultQuery={params.q ?? ''} defaultStatus={params.status ?? 'all'} />

      {orders.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No orders match"
          description="Try a different search, or clear the status filter to see everything."
        />
      ) : (
        <>
          {/* Table on desktop, stacked cards on mobile — the same data, laid out
              for the device rather than horizontally scrolled. */}
          <div className="hidden overflow-hidden rounded-xl border border-border md:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Order
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Customer
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Zone
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Placed
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Payment
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {orders.map((order) => (
                  <tr key={order.id} className="transition-colors hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/orders/${order.id}`}
                        className="font-mono font-medium text-primary underline-offset-2 hover:underline"
                      >
                        {order.order_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{order.customer_name}</p>
                      <p className="text-xs text-muted-foreground">{order.customer_email}</p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{order.delivery_zone_name}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDateTime(order.placed_at)}
                    </td>
                    <td className="px-4 py-3">
                      <OrderStatusBadge status={order.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <PaymentStatusBadge status={order.payment_status} />
                        <PaymentMethodBadge
                          method={order.payment_method}
                          cryptoDiscountCents={order.crypto_discount_cents}
                        />
                      </div>
                    </td>
                    <td className="tabular px-4 py-3 text-right font-semibold">
                      {formatMoney(order.total_cents)}
                      {order.crypto_discount_cents > 0 ? (
                        <span className="block text-xs font-normal text-muted-foreground">
                          after -{formatMoney(order.crypto_discount_cents)} crypto
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-2 md:hidden">
            {orders.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/admin/orders/${order.id}`}
                  className="block rounded-xl border border-border bg-card p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-semibold">{order.order_number}</p>
                      <p className="truncate text-sm">{order.customer_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(order.placed_at)}
                      </p>
                    </div>
                    <p className="tabular font-semibold">
                      {formatMoney(order.total_cents)}
                      {order.crypto_discount_cents > 0 ? (
                        <span className="block text-xs font-normal text-muted-foreground">
                          after -{formatMoney(order.crypto_discount_cents)} crypto
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <OrderStatusBadge status={order.status} />
                    <PaymentStatusBadge status={order.payment_status} />
                    <PaymentMethodBadge
                      method={order.payment_method}
                      cryptoDiscountCents={order.crypto_discount_cents}
                    />
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {pageCount > 1 ? (
            <nav className="flex items-center justify-between" aria-label="Pagination">
              <Button variant="outline" size="sm" disabled={page <= 1} asChild={page > 1}>
                {page > 1 ? (
                  <Link href={buildHref(page - 1)}>Previous</Link>
                ) : (
                  <span>Previous</span>
                )}
              </Button>
              <p className="tabular text-sm text-muted-foreground">
                Page {page} of {pageCount}
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pageCount}
                asChild={page < pageCount}
              >
                {page < pageCount ? (
                  <Link href={buildHref(page + 1)}>Next</Link>
                ) : (
                  <span>Next</span>
                )}
              </Button>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * Which way an order is being paid, and whether its price already reflects the
 * crypto discount.
 *
 * Both matter at a glance in the list: a USDC order needs checking against a
 * wallet rather than an inbox, and a discounted one is deliberately worth less
 * than the same basket paid by e-Transfer — without saying so, the total looks
 * like an error.
 */
function PaymentMethodBadge({
  method,
  cryptoDiscountCents,
}: {
  method: PaymentMethod;
  cryptoDiscountCents: number;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge variant={method === 'usdc_solana' ? 'secondary' : 'outline'}>
        {method === 'usdc_solana' ? 'USDC' : 'e-Transfer'}
      </Badge>
      {cryptoDiscountCents > 0 ? <Badge variant="outline">Crypto discount</Badge> : null}
    </span>
  );
}
