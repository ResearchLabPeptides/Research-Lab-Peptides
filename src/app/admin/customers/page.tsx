import { CustomerList } from '@/components/admin/customer-list';
import { requireStaff } from '@/lib/auth';
import { getCustomers } from '@/lib/queries/admin';

export const metadata = { title: 'Customers' };
export const dynamic = 'force-dynamic';

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; mailable?: string }>;
}) {
  await requireStaff();
  const params = await searchParams;
  const mailableOnly = params.mailable === '1';
  const { customers, mailable } = await getCustomers(params.q, mailableOnly);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Customers</h1>
        <p className="tabular text-sm text-muted-foreground">
          {customers.length} {customers.length === 1 ? 'person' : 'people'} · one row each, however
          many times they have ordered
        </p>
      </div>

      <CustomerList
        customers={customers}
        mailable={mailable}
        search={params.q ?? ''}
        mailableOnly={mailableOnly}
      />
    </div>
  );
}
