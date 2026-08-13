'use client';

import * as React from 'react';
import { Loader2, Tag, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CouponEvaluation } from '@/lib/types';

export interface AppliedCoupon {
  code: string;
  label: string;
  discountCents: number;
  appliesTo: 'subtotal' | 'delivery';
}

/**
 * Coupon entry, sitting just above the totals so the effect of the code appears
 * in the same glance as the number it changes.
 *
 * The discount shown here is advisory. place_order() re-checks the code under a
 * row lock at the moment of purchase, which is what stops a coupon on its last
 * use from being spent twice.
 */
export function CouponField({
  subtotalCents,
  deliveryFeeCents,
  email,
  applied,
  onApply,
  onRemove,
}: {
  subtotalCents: number;
  deliveryFeeCents: number;
  email: string;
  applied: AppliedCoupon | null;
  onApply: (coupon: AppliedCoupon) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [checking, setChecking] = React.useState(false);

  // The basket can change after a code is applied, which changes what a
  // percentage is worth and can drop the order under a minimum. Re-check
  // quietly whenever the numbers move.
  React.useEffect(() => {
    if (!applied) return;
    let live = true;

    (async () => {
      try {
        const res = await fetch('/api/coupons/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: applied.code, subtotalCents, deliveryFeeCents, email }),
        });
        if (!res.ok) return;
        const result = (await res.json()) as CouponEvaluation;
        if (!live) return;

        if (!result.valid) {
          onRemove();
          setError(result.message);
          setOpen(true);
        } else if (result.discount_cents !== applied.discountCents) {
          onApply({
            code: result.code,
            label: result.label,
            discountCents: result.discount_cents,
            appliesTo: result.applies_to,
          });
        }
      } catch {
        // Leave the applied coupon alone on a network blip; checkout re-checks.
      }
    })();

    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtotalCents, deliveryFeeCents, applied?.code]);

  async function check() {
    const trimmed = code.trim();
    if (!trimmed) {
      setError('Enter a code.');
      return;
    }

    setChecking(true);
    setError(null);
    try {
      const res = await fetch('/api/coupons/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmed, subtotalCents, deliveryFeeCents, email }),
      });

      if (!res.ok) {
        setError('Could not check that code right now.');
        return;
      }

      const result = (await res.json()) as CouponEvaluation;

      if (!result.valid) {
        setError(result.message);
        return;
      }

      onApply({
        code: result.code,
        label: result.label,
        discountCents: result.discount_cents,
        appliesTo: result.applies_to,
      });
      setCode('');
      setOpen(false);
    } catch {
      setError('The network dropped out. Try again.');
    } finally {
      setChecking(false);
    }
  }

  if (applied) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md bg-accent px-3 py-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-accent-foreground">
          <Tag className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate font-mono">{applied.code}</span>
          <span className="shrink-0">— {applied.label}</span>
        </span>
        <button
          type="button"
          onClick={() => {
            onRemove();
            setError(null);
          }}
          className="shrink-0 rounded p-0.5 text-accent-foreground/70 transition-colors hover:text-accent-foreground"
          aria-label={`Remove coupon ${applied.code}`}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 self-start text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        <Tag className="size-3.5" aria-hidden />
        Have a coupon code?
      </button>
    );
  }

  return (
    <div className="space-y-1.5">
      <label htmlFor="coupon-code" className="text-xs font-medium">
        Coupon code
      </label>
      <div className="flex gap-1.5">
        <Input
          id="coupon-code"
          value={code}
          onChange={(event) => {
            setCode(event.target.value.toUpperCase());
            setError(null);
          }}
          onKeyDown={(event) => {
            // Enter here must not submit the checkout form behind it.
            if (event.key === 'Enter') {
              event.preventDefault();
              void check();
            }
          }}
          placeholder="WELCOME10"
          autoComplete="off"
          spellCheck={false}
          className="h-9 font-mono uppercase"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'coupon-error' : undefined}
        />
        <Button type="button" size="sm" className="h-9" onClick={check} disabled={checking}>
          {checking ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Apply
        </Button>
      </div>
      {error ? (
        <p id="coupon-error" className="text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
