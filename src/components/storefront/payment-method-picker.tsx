'use client';

import { Landmark, Coins } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatMoney } from '@/lib/format';
import { PAYMENT_METHOD_META } from '@/lib/constants';
import type { PaymentMethod } from '@/lib/types';

/**
 * Choice of payment method at checkout.
 *
 * USDC only appears when the shop can actually take it — switched on, a fresh
 * enough rate, and at least one unused address left. When any of those is
 * missing the option is not shown at all rather than shown and then failing at
 * the last step, which would lose the order.
 */
export function PaymentMethodPicker({
  value,
  onChange,
  usdcAvailable,
  savingCents = 0,
}: {
  value: PaymentMethod;
  onChange: (method: PaymentMethod) => void;
  usdcAvailable: boolean;
  /**
   * The discount amount, in cents — the same figure shown on the discount line
   * in the order summary.
   *
   * Not the amount the total drops by. That is slightly larger, because tax
   * falls with the discount, but the customer has no way to see it: they never
   * see the undiscounted total, so the larger figure reads as a contradiction
   * of the line item rather than as extra value.
   */
  savingCents?: number;
}) {
  if (!usdcAvailable) return null;

  const options: { id: PaymentMethod; icon: typeof Landmark; badge?: string }[] = [
    { id: 'interac', icon: Landmark },
    {
      id: 'usdc_solana',
      icon: Coins,
      badge: savingCents > 0 ? `Save ${formatMoney(savingCents)}` : undefined,
    },
  ];

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">How would you like to pay?</legend>

      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const meta = PAYMENT_METHOD_META[option.id];
          const selected = value === option.id;

          return (
            <label
              key={option.id}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors',
                selected
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border hover:bg-muted/50',
              )}
            >
              <input
                type="radio"
                name="payment-method"
                value={option.id}
                checked={selected}
                onChange={() => onChange(option.id)}
                className="mt-1 size-4 accent-[var(--primary)]"
              />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  <option.icon className="size-4 shrink-0" aria-hidden />
                  {meta.label}
                  {option.badge && (
                    <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">
                      {option.badge}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{meta.hint}</span>
              </span>
            </label>
          );
        })}
      </div>

      {value === 'usdc_solana' && (
        <p className="text-xs text-muted-foreground">
          You will get an address that belongs to your order alone, and the exact amount to send, as
          soon as you place the order.
        </p>
      )}
    </fieldset>
  );
}
