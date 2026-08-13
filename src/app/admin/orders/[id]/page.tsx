import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { OrderStatusBadge, PaymentStatusBadge } from '@/components/admin/status-badge';
import {
  ChangeStatusPanel,
  RecordPaymentPanel,
  TrackingNotePanel,
} from '@/components/admin/order-actions';
import { hasMinRole, requireStaff } from '@/lib/auth';
import { getOrderDetail } from '@/lib/queries/admin';
import { ORDER_STATUS_META } from '@/lib/constants';
import { formatDateTime, formatMoney, formatPostalCode } from '@/lib/format';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const detail = await getOrderDetail((await params).id);
  return { title: detail ? `Order ${detail.order.order_number}` : 'Order' };
}

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireStaff();
  const detail = await getOrderDetail((await params).id);
  if (!detail) notFound();

  const { order, items, history, payments } = detail;
  const canEdit = hasMinRole(profile.role, 'employee');
  const balanceCents = Math.max(0, order.total_cents - order.amount_paid_cents);

  return (
    <div className="space-y-5">
      <Link
        href="/admin/orders"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All orders
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-2xl font-bold tracking-tight">{order.order_number}</h1>
        <OrderStatusBadge status={order.status} />
        <PaymentStatusBadge status={order.payment_status} />
        {order.inventory_reserved ? (
          <span className="text-xs text-muted-foreground">Stock held, not yet deducted</span>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Items</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border">
                {items.map((item) => (
                  <li key={item.id} className="flex items-baseline justify-between gap-4 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        <span className="tabular">{item.quantity}&times;</span> {item.name}
                      </p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {item.sku} · {formatMoney(item.unit_price_cents)} / {item.unit}
                      </p>
                    </div>
                    <p className="tabular text-sm font-semibold">
                      {formatMoney(item.line_total_cents)}
                    </p>
                  </li>
                ))}
              </ul>

              <Separator className="my-3" />

              <dl className="space-y-1 text-sm">
                <Row label="Subtotal" value={formatMoney(order.subtotal_cents)} />
                <Row
                  label={`Delivery — ${order.delivery_zone_name}`}
                  value={formatMoney(order.delivery_fee_cents)}
                />
                <Row label="Tax" value={formatMoney(order.tax_cents)} />
                <Row label="Total" value={formatMoney(order.total_cents)} emphasis />
                <Row label="Paid" value={formatMoney(order.amount_paid_cents)} />
                {balanceCents > 0 ? (
                  <Row label="Balance owing" value={formatMoney(balanceCents)} warning />
                ) : null}
              </dl>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Customer</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p className="font-medium">{order.customer_name}</p>
                <p>
                  <a
                    href={`mailto:${order.customer_email}`}
                    className="text-primary hover:underline"
                  >
                    {order.customer_email}
                  </a>
                </p>
                <p>
                  <a href={`tel:${order.customer_phone}`} className="text-primary hover:underline">
                    {order.customer_phone}
                  </a>
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Shipping to</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <address className="not-italic text-muted-foreground">
                  {order.address_line1}
                  {order.address_line2 ? `, ${order.address_line2}` : ''}
                  <br />
                  {order.city}, {order.province} {formatPostalCode(order.postal_code)}
                </address>
                {order.delivery_notes ? (
                  <p className="rounded-md bg-muted px-3 py-2 text-xs">
                    <span className="font-medium">Instructions: </span>
                    {order.delivery_notes}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {history.map((entry) => (
                  <li key={entry.id} className="flex gap-3 text-sm">
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-hidden />
                    <div>
                      <p className="font-medium">{ORDER_STATUS_META[entry.to_status].label}</p>
                      {entry.note ? <p className="text-muted-foreground">{entry.note}</p> : null}
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(entry.created_at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>

              {payments.length > 0 ? (
                <>
                  <Separator className="my-4" />
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Payments
                  </h3>
                  <ul className="space-y-1.5 text-sm">
                    {payments.map((payment) => (
                      <li key={payment.id} className="flex justify-between gap-3">
                        <span className="text-muted-foreground">
                          {formatDateTime(payment.received_at)}
                          {payment.reference ? ` · ${payment.reference}` : ''}
                        </span>
                        <span className="tabular font-medium">
                          {formatMoney(payment.amount_cents)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {balanceCents > 0 ? (
            <RecordPaymentPanel orderId={order.id} balanceCents={balanceCents} canEdit={canEdit} />
          ) : null}
          <ChangeStatusPanel orderId={order.id} currentStatus={order.status} canEdit={canEdit} />
          <TrackingNotePanel
            orderId={order.id}
            initialNote={order.tracking_notes}
            canEdit={canEdit}
          />
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  emphasis,
  warning,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  warning?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={emphasis ? 'font-medium' : 'text-muted-foreground'}>{label}</dt>
      <dd
        className={[
          'tabular font-medium',
          emphasis ? 'font-display text-lg font-semibold' : '',
          warning ? 'text-[var(--warning)]' : '',
        ].join(' ')}
      >
        {value}
      </dd>
    </div>
  );
}
