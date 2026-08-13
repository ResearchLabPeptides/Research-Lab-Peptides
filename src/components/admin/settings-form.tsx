'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { saveSettings } from '@/lib/actions/settings';

export interface SettingsValues {
  companyName: string;
  currency: string;
  taxRateBps: number;
  paymentEmail: string;
  deliveryEmail: string;
  supportPhone: string;
  orderPrefix: string;
  lowStockThresholdDefault: number;
  expiryWarningDays: number;
}

export function SettingsForm({ initial }: { initial: SettingsValues }) {
  const [values, setValues] = React.useState(initial);
  const [feedback, setFeedback] = React.useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = React.useTransition();

  function set<K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => setFeedback(await saveSettings(values)));
      }}
      className="max-w-xl space-y-4"
    >
      <Field id="s-company" label="Business name" required>
        <Input value={values.companyName} onChange={(e) => set('companyName', e.target.value)} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="s-currency" label="Currency" hint="Three-letter code" required>
          <Input
            value={values.currency}
            maxLength={3}
            onChange={(e) => set('currency', e.target.value.toUpperCase())}
          />
        </Field>
        <Field id="s-tax" label="Tax rate (%)" hint="Applied to items and delivery" required>
          <Input
            type="number"
            step="0.01"
            className="tabular"
            value={values.taxRateBps / 100}
            onChange={(e) => set('taxRateBps', Math.round(Number(e.target.value) * 100))}
          />
        </Field>
      </div>

      <Field
        id="s-payment-email"
        label="Interac e-Transfer email"
        hint="Customers send payment here — check it before saving"
        required
      >
        <Input
          type="email"
          value={values.paymentEmail}
          onChange={(e) => set('paymentEmail', e.target.value)}
        />
      </Field>

      <Field id="s-delivery-email" label="Shipping team email" required>
        <Input
          type="email"
          value={values.deliveryEmail}
          onChange={(e) => set('deliveryEmail', e.target.value)}
        />
      </Field>

      <Field id="s-phone" label="Support phone">
        <Input value={values.supportPhone} onChange={(e) => set('supportPhone', e.target.value)} />
      </Field>

      <Field
        id="s-prefix"
        label="Order number prefix"
        hint="Changing this only affects new orders. Existing numbers stay as they are."
        required
      >
        <Input
          value={values.orderPrefix}
          className="font-mono uppercase"
          onChange={(e) => set('orderPrefix', e.target.value.toUpperCase())}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="s-low-stock"
          label="Default low-stock threshold"
          hint="Used when a product has no minimum of its own"
          required
        >
          <Input
            type="number"
            className="tabular"
            value={values.lowStockThresholdDefault}
            onChange={(e) => set('lowStockThresholdDefault', Number(e.target.value))}
          />
        </Field>
        <Field id="s-expiry" label="Warn this many days before expiry" required>
          <Input
            type="number"
            className="tabular"
            value={values.expiryWarningDays}
            onChange={(e) => set('expiryWarningDays', Number(e.target.value))}
          />
        </Field>
      </div>

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
        {pending ? 'Saving' : 'Save settings'}
      </Button>
    </form>
  );
}
