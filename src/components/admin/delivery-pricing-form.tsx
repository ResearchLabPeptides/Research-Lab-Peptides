'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { CheckboxField } from '@/components/ui/checkbox-field';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { centsToInput, formatMoney, inputToCents } from '@/lib/format';
import {
  deleteDeliveryModifier,
  saveDeliveryModifier,
  saveDeliveryPricing,
} from '@/lib/actions/site';
import type { DeliveryModifierRow, DeliveryPricing } from '@/lib/queries/admin';

type Condition = DeliveryModifierRow['condition'];
type Effect = DeliveryModifierRow['effect'];

const CONDITION_LABELS: Record<Condition, string> = {
  always: 'Every order',
  item_count_at_least: 'Order has at least this many items',
  subtotal_at_least: 'Order subtotal is at least',
};

const EFFECT_LABELS: Record<Effect, string> = {
  free: 'Delivery is free',
  set_fee: 'Charge this flat amount instead',
  amount_off: 'Take this much off the fee',
  percent_off: 'Take this percentage off the fee',
};

/** Plain-English summary of a rule, so nobody has to decode the fields. */
function describe(m: {
  condition: Condition;
  threshold: number;
  effect: Effect;
  amount: number;
}): string {
  const when =
    m.condition === 'always'
      ? 'On every order'
      : m.condition === 'item_count_at_least'
        ? `When someone buys ${m.threshold} or more items`
        : `When the subtotal reaches ${formatMoney(m.threshold)}`;

  const then =
    m.effect === 'free'
      ? 'delivery is free'
      : m.effect === 'set_fee'
        ? `delivery costs ${formatMoney(m.amount)}`
        : m.effect === 'amount_off'
          ? `take ${formatMoney(m.amount)} off delivery`
          : `take ${(m.amount / 100).toFixed(0)}% off delivery`;

  return `${when}, ${then}.`;
}

export function DeliveryPricingForm({
  pricing,
  modifiers,
}: {
  pricing: DeliveryPricing;
  modifiers: DeliveryModifierRow[];
}) {
  const [fee, setFee] = React.useState(centsToInput(pricing.delivery_flat_fee_cents));
  const [minimum, setMinimum] = React.useState(centsToInput(pricing.delivery_minimum_order_cents));
  const [etaMin, setEtaMin] = React.useState(String(pricing.delivery_eta_min_minutes));
  const [etaMax, setEtaMax] = React.useState(String(pricing.delivery_eta_max_minutes));
  const [restrict, setRestrict] = React.useState(pricing.delivery_restrict_area);
  const [feedback, setFeedback] = React.useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = React.useTransition();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Base shipping charge</CardTitle>
          <p className="text-sm text-muted-foreground">
            What delivery costs before any rule below is applied.
          </p>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              startTransition(async () => {
                setFeedback(
                  await saveDeliveryPricing({
                    mode: pricing.delivery_mode,
                    flatFeeCents: inputToCents(fee) ?? 0,
                    minimumOrderCents: inputToCents(minimum) ?? 0,
                    etaMinMinutes: Number(etaMin) || 0,
                    etaMaxMinutes: Number(etaMax) || 0,
                    restrictArea: restrict,
                  }),
                );
              });
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="d-fee" label="Shipping fee" required>
                <Input
                  className="tabular"
                  inputMode="decimal"
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                />
              </Field>
              <Field
                id="d-min"
                label="Minimum order"
                hint="Below this, checkout is blocked. Use 0.00 for no minimum."
                required
              >
                <Input
                  className="tabular"
                  inputMode="decimal"
                  value={minimum}
                  onChange={(e) => setMinimum(e.target.value)}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="d-eta-min" label="Fastest estimate (minutes)" required>
                <Input
                  type="number"
                  min="0"
                  className="tabular"
                  value={etaMin}
                  onChange={(e) => setEtaMin(e.target.value)}
                />
              </Field>
              <Field id="d-eta-max" label="Slowest estimate (minutes)" required>
                <Input
                  type="number"
                  min="0"
                  className="tabular"
                  value={etaMax}
                  onChange={(e) => setEtaMax(e.target.value)}
                />
              </Field>
            </div>

            <CheckboxField
              id="d-restrict"
              label="Only deliver to the postal codes listed below"
              description="Leave off to accept every address at the same flat rate. Turn it on and anything unlisted is refused at checkout."
              checked={restrict}
              onChange={setRestrict}
            />

            {feedback ? (
              <p
                role="status"
                className={
                  feedback.ok
                    ? 'rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground'
                    : 'rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive'
                }
              >
                {feedback.message}
              </p>
            ) : null}

            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {pending ? 'Saving' : 'Save shipping charge'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <ModifierManager modifiers={modifiers} baseFeeCents={inputToCents(fee) ?? 0} />
    </div>
  );
}

/**
 * Free and discounted shipping rules.
 *
 * When more than one rule matches an order the customer gets the cheapest
 * result, not the first one written. That is deliberate: a shop owner adding a
 * generous promotion should never accidentally make delivery *dearer* for
 * someone who also qualifies for an older rule.
 */
function ModifierManager({
  modifiers,
  baseFeeCents,
}: {
  modifiers: DeliveryModifierRow[];
  baseFeeCents: number;
}) {
  const router = useRouter();
  const [adding, setAdding] = React.useState(false);
  const [label, setLabel] = React.useState('');
  const [condition, setCondition] = React.useState<Condition>('item_count_at_least');
  const [threshold, setThreshold] = React.useState('5');
  const [effect, setEffect] = React.useState<Effect>('free');
  const [amount, setAmount] = React.useState('');
  const [feedback, setFeedback] = React.useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = React.useTransition();

  const thresholdIsMoney = condition === 'subtotal_at_least';
  const amountIsMoney = effect === 'set_fee' || effect === 'amount_off';
  const needsAmount = effect !== 'free';

  function thresholdValue(): number {
    if (condition === 'always') return 0;
    return thresholdIsMoney ? (inputToCents(threshold) ?? 0) : Number(threshold) || 0;
  }

  function amountValue(): number {
    if (!needsAmount) return 0;
    // Percentages are stored as basis points, the same unit the database uses.
    return amountIsMoney ? (inputToCents(amount) ?? 0) : Math.round((Number(amount) || 0) * 100);
  }

  const preview = describe({
    condition,
    threshold: thresholdValue(),
    effect,
    amount: amountValue(),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setFeedback(null);

    startTransition(async () => {
      const result = await saveDeliveryModifier({
        label,
        condition,
        threshold: thresholdValue(),
        effect,
        amount: amountValue(),
        priority: 100,
        isActive: true,
      });
      setFeedback(result);
      if (result.ok) {
        setAdding(false);
        setLabel('');
        setAmount('');
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle>Free and discounted delivery</CardTitle>
          <p className="text-sm text-muted-foreground">
            Reward bigger orders. If several rules match, the customer gets the cheapest.
          </p>
        </div>
        {!adding ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden />
            Add rule
          </Button>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4">
        {modifiers.length === 0 && !adding ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No rules yet. Everyone pays the base shipping charge.
          </p>
        ) : null}

        {modifiers.length > 0 ? (
          <ul className="divide-y divide-border">
            {modifiers.map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{m.label}</p>
                    {!m.is_active ? <Badge tone="slate">Paused</Badge> : null}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{describe(m)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Customers see this wording on the order ticket when it applies.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete rule: ${m.label}`}
                  disabled={pending}
                  onClick={() => {
                    if (!window.confirm(`Delete "${m.label}"?`)) return;
                    startTransition(async () => {
                      const r = await deleteDeliveryModifier(m.id);
                      if (!r.ok) setFeedback(r);
                      else router.refresh();
                    });
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        {adding ? (
          <form onSubmit={submit} className="space-y-4 rounded-lg border border-border p-4">
            <div className="space-y-1.5">
              <label htmlFor="m-cond" className="text-sm font-medium">
                When does this apply?
              </label>
              <Select value={condition} onValueChange={(v) => setCondition(v as Condition)}>
                <SelectTrigger id="m-cond">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CONDITION_LABELS) as Condition[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {CONDITION_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {condition !== 'always' ? (
              <Field
                id="m-threshold"
                label={thresholdIsMoney ? 'Subtotal' : 'Number of items'}
                hint={
                  thresholdIsMoney
                    ? 'Before delivery and tax'
                    : 'Total units in the basket, not distinct products'
                }
                required
              >
                <Input
                  className="tabular"
                  inputMode="decimal"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                />
              </Field>
            ) : null}

            <div className="space-y-1.5">
              <label htmlFor="m-effect" className="text-sm font-medium">
                What happens?
              </label>
              <Select value={effect} onValueChange={(v) => setEffect(v as Effect)}>
                <SelectTrigger id="m-effect">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(EFFECT_LABELS) as Effect[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {EFFECT_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {needsAmount ? (
              <Field
                id="m-amount"
                label={amountIsMoney ? 'Amount' : 'Percentage'}
                hint={amountIsMoney ? undefined : 'For example, 50 for half price'}
                required
              >
                <Input
                  className="tabular"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={amountIsMoney ? '0.00' : '50'}
                />
              </Field>
            ) : null}

            <Field
              id="m-label"
              label="What the customer sees"
              hint="Shown on the order ticket when the rule applies"
              required
            >
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Free shipping on 5 items or more"
              />
            </Field>

            <p className="rounded-md bg-muted px-3 py-2 text-sm">
              <span className="font-medium">In plain English: </span>
              {preview}
              {effect !== 'free' && baseFeeCents > 0 ? (
                <> Base fee is {formatMoney(baseFeeCents)}.</>
              ) : null}
            </p>

            {feedback && !feedback.ok ? (
              <p
                role="alert"
                className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {feedback.message}
              </p>
            ) : null}

            <div className="flex gap-2">
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {pending ? 'Saving' : 'Add rule'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
