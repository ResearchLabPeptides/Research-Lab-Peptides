import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { OrderLookupForm } from '@/components/storefront/order-lookup-form';
import { OrderStatus } from '@/components/storefront/order-status';
import { getPublicSettings } from '@/lib/queries/storefront';

interface PageProps {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ email?: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { orderNumber } = await params;
  // An order number is not a secret, but it should not be indexed either.
  return { title: `Order ${orderNumber}`, robots: { index: false, follow: false } };
}

export default async function OrderPage({ params, searchParams }: PageProps) {
  const [{ orderNumber }, { email }, settings] = await Promise.all([
    params,
    searchParams,
    getPublicSettings(),
  ]);

  return (
    <main id="main" className="mx-auto w-full max-w-2xl px-4 py-10">
      {email ? (
        <>
          <OrderStatus
            orderNumber={orderNumber}
            email={email}
            paymentEmail={settings.payment_email}
          />
          <div className="mt-8 print:hidden">
            <Button variant="outline" asChild>
              <Link href="/">Back to the shop</Link>
            </Button>
          </div>
        </>
      ) : (
        <div className="mx-auto max-w-md">
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Confirm it&rsquo;s your order
          </h1>
          <p className="mb-6 mt-1 text-sm text-muted-foreground">
            Enter the email you used for {orderNumber} and we&rsquo;ll pull it up.
          </p>
          <OrderLookupForm />
        </div>
      )}
    </main>
  );
}
