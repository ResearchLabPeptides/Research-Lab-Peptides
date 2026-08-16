'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { refreshRateNow, saveUsdcSettings, setRateManually } from '@/lib/actions/usdc';
import { formatDateTime } from '@/lib/format';

/**
 * The exchange rate and the switches around it.
 *
 * The rate's age is stated in plain terms rather than as a timestamp, because
 * the thing that matters is whether it is old enough to stop trusting.
 */
export function UsdcRatePanel({
  rate,
  settings,
  available,
  budget,
}: {
  rate: {
    cad_per_usdc: number;
    source: string;
    fetched_at: string | null;
    last_error: string;
    last_attempt_at?: string | null;
  } | null;
  settings: {
    usdc_enabled: boolean;
    usdc_markup_bps: number;
    usdc_low_pool_threshold: number;
    usdc_quote_minutes: number;
    usdc_rate_max_age_hours: number;
  } | null;
  available: number;
  budget: { used: number; budget: number; remaining: number } | null;
}) {
  const [pending, startTransition] = useTransition();
  const [manual, setManual] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [form, setForm] = useState({
    enabled: settings?.usdc_enabled ?? false,
    markupBps: settings?.usdc_markup_bps ?? 0,
    lowPoolThreshold: settings?.usdc_low_pool_threshold ?? 20,
    quoteMinutes: settings?.usdc_quote_minutes ?? 15,
    rateMaxAgeHours: settings?.usdc_rate_max_age_hours ?? 36,
  });

  const fetchedAt = rate?.fetched_at ? new Date(rate.fetched_at) : null;
  const ageHours = fetchedAt ? (Date.now() - fetchedAt.getTime()) / 3_600_000 : null;
  const stale = ageHours !== null && ageHours > form.rateMaxAgeHours;

  function save() {
    startTransition(async () => {
      const result = await saveUsdcSettings(form);
      result.ok ? toast.success(result.message) : toast.error(result.message);
    });
  }

  function refresh() {
    startTransition(async () => {
      const result = await refreshRateNow();
      result.ok ? toast.success(result.message) : toast.error(result.message);
    });
  }

  return (
    <Card className="space-y-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold">Exchange rate</h2>
          {rate?.fetched_at && Number(rate.cad_per_usdc) > 0 ? (
            <>
              <p className="mt-1 tabular text-2xl font-bold">
                1 USDC = {Number(rate.cad_per_usdc).toFixed(4)} CAD
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {ageHours !== null && ageHours < 1
                  ? 'Updated in the last hour'
                  : `Updated about ${Math.round(ageHours ?? 0)} hours ago`}
                {rate.source ? ` from ${rate.source}` : ''}.
                {stale && ' Too old to quote from — USDC is hidden at checkout until it refreshes.'}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              No rate yet. Refresh before turning USDC on.
            </p>
          )}
          {rate?.last_error ? (
            <p className="mt-2 text-sm text-[var(--destructive)]">
              Last refresh failed: {rate.last_error}
            </p>
          ) : null}

          {/* Says when it last tried, not just when it last succeeded. Without
              this, a rate that stops updating looks identical to one that is
              updating fine and simply has not moved. */}
          <p className="mt-1 text-xs text-muted-foreground">
            {rate?.last_attempt_at
              ? `Last checked ${formatDateTime(rate.last_attempt_at)}.`
              : 'Not checked automatically yet.'}{' '}
            The rate refreshes itself when the shop is visited and the figure has aged.
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <Button variant="outline" onClick={refresh} disabled={pending}>
            <RefreshCw className={pending ? 'size-4 animate-spin' : 'size-4'} aria-hidden />
            Refresh now
          </Button>
          <button
            type="button"
            className="text-xs text-muted-foreground underline underline-offset-2"
            onClick={() => setShowManual((v) => !v)}
          >
            {showManual ? 'Hide' : 'Set the rate by hand'}
          </button>
        </div>
      </div>

      {/* A way through when no rate service answers. Better than a shop being
          unable to take payment because a third party is down or is blocking
          the datacentre this runs in. */}
      {showManual ? (
        <div className="rounded-lg border border-border bg-muted/40 p-4">
          <Label htmlFor="manual-rate">CAD per 1 USDC</Label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Input
              id="manual-rate"
              value={manual}
              placeholder="1.37"
              inputMode="decimal"
              className="max-w-[10rem]"
              onChange={(event) => setManual(event.target.value)}
            />
            <Button
              variant="secondary"
              disabled={pending || manual.trim() === ''}
              onClick={() =>
                startTransition(async () => {
                  const result = await setRateManually(manual);
                  if (result.ok) {
                    toast.success(result.message);
                    setManual('');
                    setShowManual(false);
                  } else {
                    toast.error(result.message);
                  }
                })
              }
            >
              Use this rate
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Look up &ldquo;USDC to CAD&rdquo; and enter what you find. It ages out on the same
            schedule as a fetched rate, so set it again if the automatic refresh stays down.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 border-t pt-5 sm:grid-cols-2">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
            className="mt-1 size-4 accent-[var(--primary)]"
          />
          <span>
            <span className="text-sm font-medium">Offer USDC at checkout</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {available === 0
                ? 'You need at least one unused address before this can be switched on.'
                : `${available} unused ${available === 1 ? 'address' : 'addresses'} ready.`}
            </span>
          </span>
        </label>

        <div>
          <Label htmlFor="markup">Markup on the rate (%)</Label>
          <Input
            id="markup"
            type="number"
            step="0.01"
            min="0"
            max="50"
            value={(form.markupBps / 100).toString()}
            onChange={(event) =>
              setForm({ ...form, markupBps: Math.round(Number(event.target.value) * 100) })
            }
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Leave at 0 for the straight converted amount.
          </p>
        </div>

        <div>
          <Label htmlFor="quote-minutes">Quote holds for (minutes)</Label>
          <Input
            id="quote-minutes"
            type="number"
            min="1"
            max="1440"
            value={form.quoteMinutes}
            onChange={(event) => setForm({ ...form, quoteMinutes: Number(event.target.value) })}
          />
        </div>

        <div>
          <Label htmlFor="low-pool">Warn when addresses drop below</Label>
          <Input
            id="low-pool"
            type="number"
            min="0"
            value={form.lowPoolThreshold}
            onChange={(event) =>
              setForm({ ...form, lowPoolThreshold: Number(event.target.value) })
            }
          />
        </div>
      </div>

      <Button onClick={save} disabled={pending}>
        {pending ? 'Saving…' : 'Save payment settings'}
      </Button>
    </Card>
  );
}
