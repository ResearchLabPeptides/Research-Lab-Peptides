import type { Metadata } from 'next';
import { OrderLookupForm } from '@/components/storefront/order-lookup-form';

export const metadata: Metadata = { title: 'Track an order' };

export default function OrderLookupPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-md px-4 py-12">
      <h1 className="font-display text-2xl font-bold tracking-tight">Track an order</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">
        No password to remember. Your order number and the email you used are enough.
      </p>
      <OrderLookupForm />
    </main>
  );
}
