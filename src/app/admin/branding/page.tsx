import { BrandingForm } from '@/components/admin/branding-form';
import { requireStaff } from '@/lib/auth';
import { getBranding } from '@/lib/queries/storefront';

export const metadata = { title: 'Branding' };
export const dynamic = 'force-dynamic';

export default async function BrandingPage() {
  await requireStaff('administrator');
  const branding = await getBranding();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Branding</h1>
        <p className="text-sm text-muted-foreground">
          Colours and type for the whole site — storefront and back office together. Changes go live
          the moment you save.
        </p>
      </div>

      <BrandingForm initial={branding} />
    </div>
  );
}
