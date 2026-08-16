'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMoneyCompact } from '@/lib/format';
import type { DailySalesRow } from '@/lib/queries/admin';

export function SalesChart({ data }: { data: DailySalesRow[] }) {
  const points = data.map((row) => ({
    // Pinned to the shop's zone like every other date, so a bucket does not
    // shift a day depending on where the page is rendered.
    day: new Intl.DateTimeFormat('en-CA', {
      month: 'short',
      day: 'numeric',
      timeZone: process.env.NEXT_PUBLIC_SHOP_TIMEZONE || 'America/Vancouver',
    }).format(new Date(row.day)),
    revenue: row.revenue_cents / 100,
    orders: row.order_count,
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <defs>
            <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis
            dataKey="day"
            tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={(v: number) => formatMoneyCompact(v * 100)}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--color-card)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value: number, name: string) =>
              name === 'revenue' ? [formatMoneyCompact(value * 100), 'Revenue'] : [value, 'Orders']
            }
          />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke="var(--color-chart-1)"
            strokeWidth={2}
            fill="url(#revenueFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
