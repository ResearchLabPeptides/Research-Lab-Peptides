'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { orderLookupSchema } from '@/lib/validation';

export function OrderLookupForm() {
  const router = useRouter();
  const [orderNumber, setOrderNumber] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [errors, setErrors] = React.useState<{ orderNumber?: string; email?: string }>({});

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = orderLookupSchema.safeParse({ orderNumber, email });

    if (!parsed.success) {
      const next: { orderNumber?: string; email?: string } = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === 'orderNumber' && !next.orderNumber) next.orderNumber = issue.message;
        if (key === 'email' && !next.email) next.email = issue.message;
      }
      setErrors(next);
      return;
    }

    router.push(
      `/orders/${parsed.data.orderNumber.toUpperCase()}?email=${encodeURIComponent(parsed.data.email)}`,
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field
        id="lookup-number"
        label="Order number"
        error={errors.orderNumber}
        hint="On your confirmation page and in your email"
        required
      >
        <Input
          value={orderNumber}
          onChange={(e) => {
            setOrderNumber(e.target.value.toUpperCase());
            setErrors((p) => ({ ...p, orderNumber: undefined }));
          }}
          placeholder="ORD-2026-000001"
          className="font-mono"
        />
      </Field>

      <Field id="lookup-email" label="Email" error={errors.email} required>
        <Input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setErrors((p) => ({ ...p, email: undefined }));
          }}
          placeholder="you@example.com"
          autoComplete="email"
        />
      </Field>

      <Button type="submit" className="w-full" size="lg">
        Find my order
      </Button>
    </form>
  );
}
