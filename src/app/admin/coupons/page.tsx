import { CouponManager } from '@/components/admin/coupon-manager';
import {
  CryptoDiscountPanel,
  type CryptoDiscountSettingsRow,
} from '@/components/admin/crypto-discount-panel';
import { requireStaff } from '@/lib/auth';
import { getCoupons } from '@/lib/queries/admin';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Coupons' };
export const dynamic = 'force-dynamic';

export default async function CouponsPage() {
  await requireStaff('manager');

  const supabase = await createClient();
  const [coupons, { data: settings }, { data: usdcOk }, { data: pool }] = await Promise.all([
    getCoupons(),
    supabase.from('settings').select('*').eq('id', true).single(),
    supabase.rpc('usdc_available'),
    supabase.rpc('usdc_pool_stats'),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Coupons</h1>
        <p className="text-sm text-muted-foreground">
          Discount codes customers enter on the order ticket before checking out.
        </p>
      </div>

      {settings ? (
        <CryptoDiscountPanel
          settings={settings as CryptoDiscountSettingsRow}
          usdcAvailable={usdcOk === true}
          addressesAvailable={(pool as { available?: number } | null)?.available ?? 0}
        />
      ) : null}

      <CouponManager coupons={coupons} />
    </div>
  );
}
