import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { UsdcAddressManager } from '@/components/admin/usdc-address-manager';
import { UsdcRatePanel } from '@/components/admin/usdc-rate-panel';
import { formatUsdc } from '@/lib/solana';
import type { UsdcAddress, UsdcPoolStats } from '@/lib/types';

export const metadata = { title: 'Payments' };

/**
 * Everything to do with taking USDC in one place: whether it is switched on,
 * what rate is being quoted, how many addresses are left, and which orders are
 * waiting to be confirmed.
 */
export default async function PaymentsPage() {
  await requireStaff('manager');

  const supabase = await createClient();

  const [{ data: stats }, { data: addresses }, { data: settings }, { data: rate }, { data: waiting }] =
    await Promise.all([
      supabase.rpc('usdc_pool_stats'),
      supabase.from('usdc_addresses').select('*').order('position', { ascending: false }).limit(200),
      supabase.from('settings').select('*').eq('id', true).single(),
      supabase.from('fx_rate_cache').select('*').eq('id', true).single(),
      supabase
        .from('orders')
        .select(
          'id, order_number, customer_name, total_cents, usdc_address, usdc_amount_micros, placed_at, payment_status',
        )
        .eq('payment_method', 'usdc_solana')
        .neq('payment_status', 'paid')
        .order('placed_at', { ascending: true })
        .limit(100),
    ]);

  const pool = (stats ?? {
    total: 0,
    available: 0,
    assigned: 0,
    retired: 0,
    low: false,
    threshold: 20,
    enabled: false,
    rate_ok: false,
  }) as UsdcPoolStats;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-2xl font-bold">Payments</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Interac e-Transfer is always on. This page controls the USDC option that sits beside it,
          and the receiving addresses it hands out.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Addresses left" value={String(pool.available)} tone={pool.low ? 'warn' : 'ok'} />
        <Stat label="In use" value={String(pool.assigned)} />
        <Stat label="Awaiting payment" value={String(waiting?.length ?? 0)} />
        <Stat
          label="USDC at checkout"
          value={pool.enabled && pool.rate_ok && pool.available > 0 ? 'On' : 'Off'}
          tone={pool.enabled && pool.rate_ok && pool.available > 0 ? 'ok' : 'warn'}
        />
      </div>

      <UsdcRatePanel
        rate={rate ?? null}
        settings={settings ?? null}
        available={pool.available}
      />

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">Waiting on payment</h2>
        {!waiting || waiting.length === 0 ? (
          <Card className="p-5 text-sm text-muted-foreground">
            No USDC orders are waiting. When one comes in, check your wallet for the amount and
            confirm it from the order page.
          </Card>
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Order</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Expecting</th>
                  <th className="px-4 py-3 font-medium">Address</th>
                  <th className="px-4 py-3 font-medium">Placed</th>
                </tr>
              </thead>
              <tbody>
                {waiting.map((order) => (
                  <tr key={order.id} className="border-b border-border/50 last:border-0">
                    <td className="px-4 py-3">
                      <a
                        href={`/admin/orders/${order.id}`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {order.order_number}
                      </a>
                    </td>
                    <td className="px-4 py-3">{order.customer_name}</td>
                    <td className="px-4 py-3 tabular font-medium">
                      {formatUsdc(order.usdc_amount_micros)} USDC
                    </td>
                    <td className="px-4 py-3 font-mono text-xs break-all">{order.usdc_address}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(order.placed_at).toLocaleString('en-CA')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
        <p className="text-xs text-muted-foreground">
          Full addresses are shown so you can search for them in your wallet app.
        </p>
      </section>

      <UsdcAddressManager addresses={(addresses ?? []) as UsdcAddress[]} stats={pool} />
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'plain',
}: {
  label: string;
  value: string;
  tone?: 'plain' | 'ok' | 'warn';
}) {
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p
        className={
          tone === 'warn'
            ? 'mt-1 font-display text-2xl font-bold text-[var(--warning)]'
            : 'mt-1 font-display text-2xl font-bold'
        }
      >
        {value}
      </p>
    </Card>
  );
}
