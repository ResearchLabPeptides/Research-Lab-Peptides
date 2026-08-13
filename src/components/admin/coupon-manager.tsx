'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Tag, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { CheckboxField } from '@/components/ui/checkbox-field';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatDate, formatMoney, inputToCents } from '@/lib/format';
import { createCoupon, deleteCoupon, setCouponActive } from '@/lib/actions/coupons';
import type { CouponRow } from '@/lib/queries/admin';
import type { CouponKind } from '@/lib/types';

const KIND_LABELS: Record<CouponKind, string> = {
  percent_off: 'Percentage off the items',
  amount_off: 'Fixed amount off the items',
  free_delivery: 'Free shipping',
};

const STATE_TONE: Record<string, 'green' | 'amber' | 'slate' | 'red'> = {
  Live: 'green',
  Scheduled: 'amber',
  Paused: 'slate',
  Expired: 'slate',
  'Fully redeemed': 'red',
};

/** Plain-English summary, so the rules never have to be decoded from the fields. */
function describe(c: {
  kind: CouponKind;
  value: number;
  max_discount_cents: number | null;
  minimum_order_cents: number;
}): string {
  const effect =
    c.kind === 'free_delivery'
      ? 'Waives the shipping charge'
      : c.kind === 'percent_off'
        ? `Takes ${String(c.value / 100).replace(/\.0+$/, '')}% off the items` +
          (c.max_discount_cents ? `, up to ${formatMoney(c.max_discount_cents)}` : '')
        : `Takes ${formatMoney(c.value)} off the items`;

  return c.minimum_order_cents > 0
    ? `${effect}, on orders of ${formatMoney(c.minimum_order_cents)} or more.`
    : `${effect}.`;
}

export function CouponManager({ coupons }: { coupons: CouponRow[] }) {
  const [adding, setAdding] = React.useState(false);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
          <div>
            <CardTitle>Coupon codes</CardTitle>
            <p className="text-sm text-muted-foreground">
              Customers type these at checkout. Limit them by date, by total uses, or by how many
              times one person can use them.
            </p>
          </div>
          {!adding ? (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="size-4" aria-hidden />
              New coupon
            </Button>
          ) : null}
        </CardHeader>

        <CardContent className="space-y-4">
          {adding ? <CouponForm onDone={() => setAdding(false)} /> : null}

          {coupons.length === 0 && !adding ? (
            <EmptyState
              icon={Tag}
              title="No coupons yet"
              description="Create a code and customers can enter it on the order ticket before they check out."
              action={
                <Button size="sm" onClick={() => setAdding(true)}>
                  Create a coupon
                </Button>
              }
            />
          ) : null}

          {coupons.length > 0 ? (
            <ul className="divide-y divide-border">
              {coupons.map((c) => (
                <CouponItem key={c.id} coupon={c} />
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function CouponItem({ coupon }: { coupon: CouponRow }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const remaining =
    coupon.usage_limit === null ? null : Math.max(0, coupon.usage_limit - coupon.times_redeemed);

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold">{coupon.code}</span>
          <Badge tone={STATE_TONE[coupon.state] ?? 'slate'}>{coupon.state}</Badge>
        </div>

        <p className="mt-0.5 text-xs text-muted-foreground">{describe(coupon)}</p>

        <p className="mt-0.5 text-xs text-muted-foreground">
          <span className="tabular">{coupon.times_redeemed}</span> used
          {remaining !== null ? (
            <>
              {' '}
              of <span className="tabular">{coupon.usage_limit}</span> ({remaining} left)
            </>
          ) : (
            ' · no limit'
          )}
          {coupon.per_customer_limit ? ` · max ${coupon.per_customer_limit} per customer` : ''}
          {coupon.expires_at ? ` · ends ${formatDate(coupon.expires_at)}` : ''}
          {coupon.discount_given_cents > 0
            ? ` · ${formatMoney(coupon.discount_given_cents)} given away`
            : ''}
        </p>

        {coupon.description ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{coupon.description}</p>
        ) : null}

        {error ? (
          <p role="alert" className="mt-1 text-xs font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await setCouponActive(coupon.id, !coupon.is_active);
              if (!r.ok) setError(r.message);
              else router.refresh();
            })
          }
        >
          {coupon.is_active ? 'Pause' : 'Resume'}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Delete coupon ${coupon.code}`}
          disabled={pending}
          onClick={() => {
            if (!window.confirm(`Delete ${coupon.code}?`)) return;
            startTransition(async () => {
              const r = await deleteCoupon(coupon.id);
              if (!r.ok) setError(r.message);
              else router.refresh();
            });
          }}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </li>
  );
}

function CouponForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [code, setCode] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [kind, setKind] = React.useState<CouponKind>('percent_off');
  const [percent, setPercent] = React.useState('10');
  const [amount, setAmount] = React.useState('');
  const [maxDiscount, setMaxDiscount] = React.useState('');
  const [minimum, setMinimum] = React.useState('');
  const [usageLimit, setUsageLimit] = React.useState('');
  const [perCustomer, setPerCustomer] = React.useState('');
  const [expires, setExpires] = React.useState('');
  const [active, setActive] = React.useState(true);
  const [feedback, setFeedback] = React.useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = React.useTransition();

  const value =
    kind === 'percent_off'
      ? Math.round((Number(percent) || 0) * 100) // basis points
      : kind === 'amount_off'
        ? (inputToCents(amount) ?? 0)
        : 0;

  const preview = describe({
    kind,
    value,
    max_discount_cents: kind === 'percent_off' ? inputToCents(maxDiscount) : null,
    minimum_order_cents: inputToCents(minimum) ?? 0,
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setFeedback(null);

    startTransition(async () => {
      const result = await createCoupon({
        code,
        description,
        kind,
        value,
        maxDiscountCents: kind === 'percent_off' ? inputToCents(maxDiscount) : null,
        minimumOrderCents: inputToCents(minimum) ?? 0,
        usageLimit: usageLimit.trim() === '' ? null : Number(usageLimit),
        perCustomerLimit: perCustomer.trim() === '' ? null : Number(perCustomer),
        startsAt: null,
        // A date input gives a day; treat it as the end of that day so a coupon
        // ending "31 Dec" still works on the 31st.
        expiresAt: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
        isActive: active,
      });

      setFeedback(result);
      if (result.ok) {
        router.refresh();
        onDone();
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-border p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="cp-code"
          label="Code"
          hint="What the customer types. Case and spaces don't matter."
          required
        >
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="WELCOME10"
            className="font-mono uppercase"
            autoComplete="off"
          />
        </Field>

        <div className="space-y-1.5">
          <label htmlFor="cp-kind" className="text-sm font-medium">
            What it does
          </label>
          <Select value={kind} onValueChange={(v) => setKind(v as CouponKind)}>
            <SelectTrigger id="cp-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(KIND_LABELS) as CouponKind[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {KIND_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {kind === 'percent_off' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="cp-percent" label="Percentage off" required>
            <Input
              inputMode="decimal"
              className="tabular"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              placeholder="10"
            />
          </Field>
          <Field
            id="cp-max"
            label="Most it can take off"
            hint="Optional. Stops a big order costing you more than you planned."
          >
            <Input
              inputMode="decimal"
              className="tabular"
              value={maxDiscount}
              onChange={(e) => setMaxDiscount(e.target.value)}
              placeholder="15.00"
            />
          </Field>
        </div>
      ) : null}

      {kind === 'amount_off' ? (
        <Field id="cp-amount" label="Amount off" required>
          <Input
            inputMode="decimal"
            className="tabular"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="5.00"
          />
        </Field>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="cp-min" label="Minimum order" hint="Blank for none">
          <Input
            inputMode="decimal"
            className="tabular"
            value={minimum}
            onChange={(e) => setMinimum(e.target.value)}
            placeholder="30.00"
          />
        </Field>
        <Field id="cp-uses" label="Total uses" hint="Blank for unlimited">
          <Input
            type="number"
            min="1"
            className="tabular"
            value={usageLimit}
            onChange={(e) => setUsageLimit(e.target.value)}
            placeholder="100"
          />
        </Field>
        <Field id="cp-per" label="Uses per customer" hint="Matched on email">
          <Input
            type="number"
            min="1"
            className="tabular"
            value={perCustomer}
            onChange={(e) => setPerCustomer(e.target.value)}
            placeholder="1"
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="cp-expires" label="Last day it works" hint="Blank for no expiry">
          <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </Field>
        <Field id="cp-desc" label="Internal note" hint="Staff only — customers never see this">
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Spring flyer"
          />
        </Field>
      </div>

      <CheckboxField
        id="cp-active"
        label="Start accepting it right away"
        description="Leave off to set it up now and switch it on later"
        checked={active}
        onChange={setActive}
      />

      <p className="rounded-md bg-muted px-3 py-2 text-sm">
        <span className="font-medium">In plain English: </span>
        {preview}
      </p>

      {feedback && !feedback.ok ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {feedback.message}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {pending ? 'Creating' : 'Create coupon'}
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
