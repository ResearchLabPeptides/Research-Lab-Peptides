'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/field';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ORDER_STATUS_META } from '@/lib/constants';
import { formatMoney } from '@/lib/format';
import { changeOrderStatus, recordPayment, saveTrackingNote } from '@/lib/actions/orders';
import type { OrderStatus } from '@/lib/types';

type Feedback = { ok: boolean; message: string } | null;

function FeedbackNote({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  return (
    <p
      role="status"
      className={
        feedback.ok
          ? 'rounded-md bg-accent px-3 py-2 text-xs font-medium text-accent-foreground'
          : 'rounded-md bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive'
      }
    >
      {feedback.message}
    </p>
  );
}

/**
 * Confirming an e-Transfer is the moment stock leaves the shelf for good, so
 * the balance owing is stated in full and the amount is pre-filled rather than
 * typed from memory.
 */
export function RecordPaymentPanel({
  orderId,
  balanceCents,
  canEdit,
}: {
  orderId: string;
  balanceCents: number;
  canEdit: boolean;
}) {
  const [amount, setAmount] = React.useState((balanceCents / 100).toFixed(2));
  const [reference, setReference] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [pending, startTransition] = React.useTransition();
  const [feedback, setFeedback] = React.useState<Feedback>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const cents = Math.round(Number(amount) * 100);

    if (!Number.isFinite(cents) || cents === 0) {
      setFeedback({ ok: false, message: 'Enter the amount that arrived.' });
      return;
    }

    startTransition(async () => {
      setFeedback(await recordPayment({ orderId, amountCents: cents, reference, notes }));
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Record an e-Transfer</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <Field
            id="pay-amount"
            label="Amount received"
            hint={`Balance owing: ${formatMoney(balanceCents)}`}
            required
          >
            <Input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={!canEdit}
              className="tabular"
            />
          </Field>

          <Field id="pay-ref" label="Reference" hint="The e-Transfer confirmation number">
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              disabled={!canEdit}
            />
          </Field>

          <Field id="pay-notes" label="Notes">
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={!canEdit}
            />
          </Field>

          <FeedbackNote feedback={feedback} />

          <Button type="submit" className="w-full" disabled={!canEdit || pending}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {pending ? 'Confirming' : 'Confirm payment'}
          </Button>

          {canEdit ? (
            <p className="text-xs text-muted-foreground">
              Paying in full deducts stock permanently and moves the order to Preparing.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Your role can view orders but not record payments.
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

export function ChangeStatusPanel({
  orderId,
  currentStatus,
  canEdit,
}: {
  orderId: string;
  currentStatus: OrderStatus;
  canEdit: boolean;
}) {
  const [status, setStatus] = React.useState<OrderStatus>(currentStatus);
  const [note, setNote] = React.useState('');
  const [pending, startTransition] = React.useTransition();
  const [feedback, setFeedback] = React.useState<Feedback>(null);

  const destructive = status === 'cancelled' || status === 'refunded';

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (status === currentStatus) {
      setFeedback({ ok: false, message: 'Pick a different status first.' });
      return;
    }
    startTransition(async () => {
      const result = await changeOrderStatus({ orderId, status, note });
      setFeedback(result);
      if (result.ok) setNote('');
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Update status</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="status-select" className="text-sm font-medium">
              Status
            </label>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as OrderStatus)}
              disabled={!canEdit}
            >
              <SelectTrigger id="status-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ORDER_STATUS_META) as OrderStatus[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {ORDER_STATUS_META[key].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Field id="status-note" label="Note to the customer" hint="Included in their email">
            <Textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={!canEdit}
            />
          </Field>

          {destructive ? (
            <p className="rounded-md bg-[var(--warning)]/12 px-3 py-2 text-xs font-medium text-[var(--warning)]">
              Cancelling or refunding returns every item on this order to stock.
            </p>
          ) : null}

          <FeedbackNote feedback={feedback} />

          <Button
            type="submit"
            variant={destructive ? 'destructive' : 'default'}
            className="w-full"
            disabled={!canEdit || pending}
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {pending ? 'Updating' : 'Update status and email the customer'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function TrackingNotePanel({
  orderId,
  initialNote,
  canEdit,
}: {
  orderId: string;
  initialNote: string;
  canEdit: boolean;
}) {
  const [note, setNote] = React.useState(initialNote);
  const [pending, startTransition] = React.useTransition();
  const [feedback, setFeedback] = React.useState<Feedback>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Customer-facing note</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(async () => setFeedback(await saveTrackingNote(orderId, note)));
          }}
          className="space-y-3"
        >
          <Field
            id="tracking-note"
            label="Shown on their tracking page"
            hint="For example: driver is running 20 minutes late"
          >
            <Textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={!canEdit}
            />
          </Field>

          <FeedbackNote feedback={feedback} />

          <Button type="submit" variant="outline" className="w-full" disabled={!canEdit || pending}>
            {pending ? 'Saving' : 'Save note'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
