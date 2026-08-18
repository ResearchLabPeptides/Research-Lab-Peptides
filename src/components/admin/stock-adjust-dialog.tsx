'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/field';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { adjustStock } from '@/lib/actions/inventory';
import { cn } from '@/lib/utils';

/**
 * Direction is chosen explicitly rather than inferred from the reason.
 *
 * It used to be implied by the reason code, with "Correction" and "Cycle count"
 * expecting a negative number typed into a box whose hint said so in small
 * grey text. That is a quiet way to remove stock you meant to add. Now you say
 * Add or Remove first, and only the reasons that make sense for that direction
 * are offered.
 */
const TYPES = [
  { value: 'receiving', label: 'Received from supplier', sign: 1 },
  { value: 'return', label: 'Customer return', sign: 1 },
  { value: 'found', label: 'Found / recount', sign: 1 },
  { value: 'adjustment', label: 'Correction', sign: 0 },
  { value: 'cycle_count', label: 'Cycle count', sign: 0 },
  { value: 'damaged', label: 'Damaged', sign: -1 },
  { value: 'expired', label: 'Expired', sign: -1 },
  { value: 'lost', label: 'Lost / shrinkage', sign: -1 },
  { value: 'transfer', label: 'Transferred out', sign: -1 },
] as const;

/**
 * Every stock change goes through here and lands in the ledger with a reason.
 * The reason is required — an unexplained adjustment is the thing that makes an
 * audit history useless six months later.
 */
export function StockAdjustDialog({
  productId,
  productName,
  currentQuantity,
}: {
  productId: string;
  productName: string;
  currentQuantity: number;
}) {
  const [open, setOpen] = React.useState(false);
  const [direction, setDirection] = React.useState<'add' | 'remove'>('add');
  const [type, setType] = React.useState<string>('receiving');
  const [quantity, setQuantity] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  // Reasons that fit the chosen direction, plus the neutral ones that fit both.
  const availableTypes = TYPES.filter((t) =>
    direction === 'add' ? t.sign >= 0 : t.sign <= 0,
  );

  // The typed number is always a positive count of units. The direction decides
  // the sign, so a typo cannot flip an addition into a removal.
  const magnitude = Math.abs(Number(quantity));
  const change = direction === 'add' ? magnitude : -magnitude;
  const preview = Number.isFinite(change) ? currentQuantity + change : currentQuantity;
  const wouldGoNegative = Number.isFinite(change) && preview < 0;

  // Keep the reason valid when the direction changes.
  React.useEffect(() => {
    if (!availableTypes.some((t) => t.value === type)) {
      setType(direction === 'add' ? 'receiving' : 'damaged');
    }
  }, [direction, type, availableTypes]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!Number.isFinite(magnitude) || magnitude <= 0) {
      setError('Enter how many units, as a number above zero.');
      return;
    }

    // Caught here as well as on the server. Stock going negative usually means
    // a miscount, and saying so before the write is more useful than an error
    // afterwards.
    if (wouldGoNegative) {
      setError(
        `Removing ${magnitude} would take stock below zero. There are ${currentQuantity} on hand.`,
      );
      return;
    }

    startTransition(async () => {
      const result = await adjustStock({
        productId,
        type,
        quantityChange: Math.round(change),
        reason,
        notes,
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }
      setOpen(false);
      setQuantity('');
      setReason('');
      setNotes('');
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Adjust
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="font-display text-lg font-semibold">Adjust stock</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          {productName} — {currentQuantity} on hand
        </DialogDescription>

        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <span className="text-sm font-medium">Adding or removing?</span>
            <div className="grid grid-cols-2 gap-2">
              {(['add', 'remove'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDirection(d)}
                  aria-pressed={direction === d}
                  className={cn(
                    'min-h-11 rounded-lg border px-3 text-sm font-medium transition-colors',
                    direction === d
                      ? 'border-primary bg-accent text-accent-foreground'
                      : 'border-border hover:bg-muted',
                  )}
                >
                  {d === 'add' ? 'Add stock' : 'Remove stock'}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="adjust-type" className="text-sm font-medium">
              What happened
            </label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="adjust-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableTypes.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Field
            id="adjust-qty"
            label="Quantity"
            hint={direction === 'add' ? 'How many units to add' : 'How many units to remove'}
            required
          >
            <Input
              type="number"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="tabular"
            />
          </Field>

          {quantity !== '' && Number.isFinite(change) ? (
            <p
              className={cn(
                'tabular rounded-md px-3 py-2 text-sm',
                wouldGoNegative
                  ? 'bg-[var(--destructive)]/10 font-medium text-[var(--destructive)]'
                  : 'bg-muted',
              )}
            >
              {wouldGoNegative
                ? `That would take stock below zero — there are only ${currentQuantity} on hand.`
                : `${currentQuantity} → ${preview}`}
            </p>
          ) : null}

          <Field id="adjust-reason" label="Reason" required>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Shipping from Pacific Dry Goods"
            />
          </Field>

          <Field id="adjust-notes" label="Notes">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>

          {error ? (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {error}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {pending ? 'Recording' : 'Record movement'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
