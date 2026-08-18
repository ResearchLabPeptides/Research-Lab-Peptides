import Link from 'next/link';
import {
  AlertTriangle,
  BookOpen,
  Download,
  FileSpreadsheet,
  Boxes,
  CircleDollarSign,
  PackageX,
  Receipt,
  Truck,
  Wallet,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatCard } from '@/components/admin/stat-card';
import { SalesChart } from '@/components/admin/sales-chart';
import { OrderStatusBadge } from '@/components/admin/status-badge';
import { requireStaff } from '@/lib/auth';
import { getDashboard } from '@/lib/queries/admin';
import { formatMoney, formatRelative } from '@/lib/format';

export const metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  await requireStaff();
  const { metrics, dailySales, topProducts, alerts, recentOrders } = await getDashboard();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Today</h1>
          <p className="text-sm text-muted-foreground">
            Everything waiting on someone, in the order it needs attention.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {/* The two people ask for most, straight off the dashboard. Everything
              else is one click further, on the Reports screen. */}
          <Button variant="outline" size="sm" asChild>
            <a href="/api/admin/export?report=orders&range=30d" download>
              <Download className="size-4" aria-hidden />
              Orders, last 30 days
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href="/api/admin/export?report=inventory" download>
              <Download className="size-4" aria-hidden />
              Stock on hand
            </a>
          </Button>
          <Button size="sm" asChild>
            <Link href="/admin/reports">
              <FileSpreadsheet className="size-4" aria-hidden />
              All reports
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Sales today"
          value={formatMoney(metrics?.sales_today_cents ?? 0)}
          hint={`${metrics?.orders_today ?? 0} orders`}
          icon={CircleDollarSign}
        />
        <StatCard
          label="Awaiting payment"
          value={String(metrics?.pending_payments ?? 0)}
          hint={formatMoney(metrics?.pending_payment_cents ?? 0)}
          icon={Wallet}
          tone={metrics?.pending_payments ? 'warning' : 'default'}
        />
        <StatCard
          label="To ship"
          value={String(metrics?.pending_deliveries ?? 0)}
          hint="Preparing or on the road"
          icon={Truck}
        />
        <StatCard
          label="Revenue this month"
          value={formatMoney(metrics?.revenue_month_cents ?? 0)}
          hint={`${formatMoney(metrics?.delivery_fees_month_cents ?? 0)} in shipping fees`}
          icon={Receipt}
        />
        <StatCard
          label="Inventory value"
          value={formatMoney(metrics?.inventory_value_cents ?? 0)}
          hint="At cost"
          icon={Boxes}
        />
        <StatCard
          label="Low stock"
          value={String(metrics?.low_stock_count ?? 0)}
          icon={AlertTriangle}
          tone={metrics?.low_stock_count ? 'warning' : 'default'}
        />
        <StatCard
          label="Out of stock"
          value={String(metrics?.out_of_stock_count ?? 0)}
          icon={PackageX}
          tone={metrics?.out_of_stock_count ? 'danger' : 'default'}
        />
        <StatCard
          label="Open alerts"
          value={String(metrics?.open_alerts ?? 0)}
          icon={AlertTriangle}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Revenue, last 30 days</CardTitle>
          </CardHeader>
          <CardContent>
            <SalesChart data={dailySales} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Needs attention</CardTitle>
          </CardHeader>
          <CardContent>
            {alerts.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nothing is low, out, or expiring.
              </p>
            ) : (
              <ul className="space-y-2">
                {alerts.map((alert) => (
                  <li key={alert.id} className="flex items-start gap-2 text-sm">
                    <Badge
                      tone={
                        alert.type === 'out_of_stock' || alert.type === 'expired' ? 'red' : 'amber'
                      }
                    >
                      {alert.type.replace(/_/g, ' ')}
                    </Badge>
                    <span className="min-w-0 flex-1 text-muted-foreground">{alert.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent orders</CardTitle>
          </CardHeader>
          <CardContent>
            {recentOrders.length === 0 ? (
              <EmptyState
                icon={Receipt}
                title="No orders yet"
                description="When someone checks out, their order lands here."
              />
            ) : (
              <ul className="divide-y divide-border">
                {recentOrders.map((order) => (
                  <li key={order.id}>
                    <Link
                      href={`/admin/orders/${order.id}`}
                      className="flex items-center justify-between gap-3 py-2.5 transition-colors hover:text-primary"
                    >
                      <div className="min-w-0">
                        <p className="font-mono text-sm font-medium">{order.order_number}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {order.customer_name} · {formatRelative(order.placed_at)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <OrderStatusBadge status={order.status} />
                        <span className="tabular text-sm font-semibold">
                          {formatMoney(order.total_cents)}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top sellers, last 90 days</CardTitle>
          </CardHeader>
          <CardContent>
            {topProducts.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Not enough sales to rank yet.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {topProducts.map((product) => (
                  <li key={product.sku} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{product.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{product.sku}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="tabular text-sm font-semibold">{product.units_sold} sold</p>
                      <p className="tabular text-xs text-muted-foreground">
                        {formatMoney(product.revenue_cents)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Last thing on the dashboard on purpose: useful to have within reach,
          not something to step over on the way to the day's orders. */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Staff manual</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              How to run the shop day to day — taking payment, stock, coupons, answering customer
              questions. Written for staff, no technical knowledge assumed.
            </p>
          </div>
          <Button variant="outline" asChild>
            <a href="/admin/manual" target="_blank" rel="noopener noreferrer">
              <BookOpen className="size-4" aria-hidden />
              Open the manual
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
