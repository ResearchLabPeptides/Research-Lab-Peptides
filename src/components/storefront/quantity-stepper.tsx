'use client';

import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Minus / count / plus. This is the only way to change a quantity anywhere in
 * the storefront — product grid and order ticket share the control, so the
 * gesture is identical wherever the shopper happens to be looking.
 */
export function QuantityStepper({
  value,
  max,
  onChange,
  label,
  size = 'default',
}: {
  value: number;
  max: number;
  onChange: (next: number) => void;
  label: string;
  size?: 'default' | 'sm';
}) {
  const atMax = value >= max;
  const height = size === 'sm' ? 'h-8' : 'h-10';
  const button = size === 'sm' ? 'size-8' : 'size-10';

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-lg border border-border bg-background',
        height,
      )}
    >
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={value <= 0}
        aria-label={`Remove one ${label}`}
        className={cn(
          button,
          'grid place-items-center rounded-l-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent',
        )}
      >
        <Minus className="size-4" aria-hidden />
      </button>

      <span
        className="tabular w-9 text-center text-sm font-semibold"
        aria-live="polite"
        aria-label={`${value} ${label} in your order`}
      >
        {value}
      </span>

      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={atMax}
        aria-label={atMax ? `No more ${label} available` : `Add one ${label}`}
        className={cn(
          button,
          'grid place-items-center rounded-r-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent',
        )}
      >
        <Plus className="size-4" aria-hidden />
      </button>
    </div>
  );
}
