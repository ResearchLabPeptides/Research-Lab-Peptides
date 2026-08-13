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

const TYPES = [
  { value: 'receiving', label: 'Received from supplier', sign: 1 },
  { value: 'return', label: 'Customer return', sign: 1 },
  { value: 'adjustment', label: 'Correction', sign: 0 },
  { value: 'cycle_count', label: 'Cycle count', sign: 0 },
  { value: 'damaged', label: 'Damaged', sign: -1 },
  { value: 'expired', label: 'Expired', sign: -1 },
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
  const [type, setType] = React.useState<string>('receiving');
  const [quantity, setQuantity] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const sign = TYPES.find((t) => t.value === type)?.sign ?? 0;
  const magnitude = Number(quantity);
  const change = sign === 0 ? magnitude : Math.abs(magnitude) * sign;
  const preview = Number.isFinite(change) ? currentQuantity + change : currentQuantity;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

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
            <label htmlFor="adjust-type" className="text-sm font-medium">
              What happened
            </label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="adjust-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
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
            hint={
              sign === 0
                ? 'Use a negative number to remove stock'
                : sign > 0
                  ? 'Units being added'
                  : 'Units being removed'
            }
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
            <p className="tabular rounded-md bg-muted px-3 py-2 text-sm">
              {currentQuantity} → <strong>{preview}</strong>
            </p>
          ) : null}

          <Field id="adjust-reason" label="Reason" required>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Delivery from Pacific Dry Goods"
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
