'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { signIn, type ActionState } from '@/lib/actions/auth';

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState<ActionState, FormData>(signIn, {});

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />

      <Field id="login-email" label="Email" required>
        <Input name="email" type="email" autoComplete="email" required />
      </Field>

      <Field id="login-password" label="Password" required>
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>

      {state.error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" size="lg" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {pending ? 'Signing in' : 'Sign in'}
    </Button>
  );
}
