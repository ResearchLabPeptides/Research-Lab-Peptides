import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">404</p>
      <h1 className="font-display text-2xl font-bold tracking-tight">This page does not exist</h1>
      <p className="text-sm text-muted-foreground">
        The link may be out of date. Everything we sell is on the shop page.
      </p>
      <Button asChild>
        <Link href="/">Go to the shop</Link>
      </Button>
    </main>
  );
}
