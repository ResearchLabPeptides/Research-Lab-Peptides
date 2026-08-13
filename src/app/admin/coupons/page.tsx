import { CouponManager } from '@/components/admin/coupon-manager';
import { requireStaff } from '@/lib/auth';
import { getCoupons } from '@/lib/queries/admin';

export const metadata = { title: 'Coupons' };
export const dynamic = 'force-dynamic';

export default async function CouponsPage() {
  await requireStaff('manager');
  const coupons = await getCoupons();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Coupons</h1>
        <p className="text-sm text-muted-foreground">
          Discount codes customers enter on the order ticket before checking out.
        </p>
      </div>

      <CouponManager coupons={coupons} />
    </div>
  );
}
