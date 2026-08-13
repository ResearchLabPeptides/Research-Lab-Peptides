'use client';

import { Button } from '@/components/ui/button';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="font-display text-2xl font-bold tracking-tight">Something broke on our end</h1>
      <p className="text-sm text-muted-foreground">
        Your order was not affected. Try again, and if it keeps happening, give us a call.
      </p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
