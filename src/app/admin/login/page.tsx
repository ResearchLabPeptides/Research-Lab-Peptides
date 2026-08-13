import type { Metadata } from 'next';
import { LoginForm } from '@/components/admin/login-form';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false } };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <h1 className="font-display text-2xl font-bold tracking-tight">Back office</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">
        Staff accounts only. Customers never need to sign in.
      </p>
      <LoginForm next={next ?? '/admin'} />
    </div>
  );
}
