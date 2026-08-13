'use client';

import * as React from 'react';
import { Check, Copy } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';

export function CopyButton({
  value,
  label,
  copiedLabel = 'Copied',
  ...props
}: { value: string; label: string; copiedLabel?: string } & Omit<ButtonProps, 'onClick'>) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard blocked (insecure context or denied permission). Select the
      // text instead so the person can copy it by hand.
      window.prompt('Copy this:', value);
    }
  }

  return (
    <Button variant="outline" onClick={copy} {...props}>
      {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {copied ? copiedLabel : label}
    </Button>
  );
}
