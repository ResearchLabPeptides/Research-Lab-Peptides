'use client';

import { Button } from '@/components/ui/button';

/**
 * What a customer sees when a page throws.
 *
 * The customer-facing wording stays reassuring and vague — they cannot act on a
 * stack trace and should not be shown one. But the error itself is no longer
 * thrown away: it is printed to the browser console every time, and shown on
 * screen when the address carries `?debug=1`.
 *
 * That combination matters. An earlier version accepted the error and rendered
 * nothing from it, so a real fault produced a friendly message, nothing in any
 * log anyone could find, and no way to tell one cause from another. Whoever
 * runs the shop needs to answer "what actually broke" without deploying new
 * code to find out.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Always in the browser console, whether or not the flag is set, so a support
  // call can be "press F12 and read me the red line".
  if (typeof window !== 'undefined') {
    console.error('[futurelite] page error:', error.message, error.digest ?? '', error.stack ?? '');
  }

  const showDetail =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="font-display text-2xl font-bold tracking-tight">Something broke on our end</h1>
      <p className="text-sm text-muted-foreground">
        Your order was not affected. Try again, and if it keeps happening, give us a call.
      </p>
      <Button onClick={reset}>Try again</Button>

      {showDetail ? (
        <div className="mt-4 w-full rounded-lg border border-border bg-card p-4 text-left">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Diagnostic
          </p>
          <p className="mt-2 break-words font-mono text-xs">{error.message || '(no message)'}</p>
          {error.digest ? (
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              digest: {error.digest} — search this in the Vercel runtime log for the full trace
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Staff: add <code className="font-mono">?debug=1</code> to the address, or open the browser
          console, to see what went wrong.
        </p>
      )}
    </main>
  );
}
