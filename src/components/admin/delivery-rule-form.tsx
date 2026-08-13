'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { saveDeliveryRule } from '@/lib/actions/settings';

export function DeliveryRuleForm({ zones }: { zones: { id: string; name: string }[] }) {
  const [zoneId, setZoneId] = React.useState(zones[0]?.id ?? '');
  const [matchType, setMatchType] = React.useState('postal_prefix');
  const [matchValue, setMatchValue] = React.useState('');
  const [feedback, setFeedback] = React.useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = React.useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveDeliveryRule({ zoneId, matchType, matchValue, isActive: true });
      setFeedback(result);
      if (result.ok) setMatchValue('');
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor="rule-zone" className="text-sm font-medium">
          Zone
        </label>
        <Select value={zoneId} onValueChange={setZoneId}>
          <SelectTrigger id="rule-zone">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {zones.map((zone) => (
              <SelectItem key={zone.id} value={zone.id}>
                {zone.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="rule-type" className="text-sm font-medium">
          Match on
        </label>
        <Select value={matchType} onValueChange={setMatchType}>
          <SelectTrigger id="rule-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="postal_prefix">Postal code starts with</SelectItem>
            <SelectItem value="postal_exact">Exact postal code</SelectItem>
            <SelectItem value="city">City name</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Field
        id="rule-value"
        label={matchType === 'city' ? 'City' : 'Postal code'}
        hint={
          matchType === 'postal_prefix'
            ? 'The first three characters, like V3S'
            : matchType === 'postal_exact'
              ? 'A full postal code, like V3S 1A4'
              : 'For example, Surrey'
        }
        required
      >
        <Input
          value={matchValue}
          onChange={(e) => setMatchValue(e.target.value)}
          className={matchType === 'city' ? '' : 'font-mono uppercase'}
        />
      </Field>

      {feedback ? (
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
      ) : null}

      <Button type="submit" disabled={pending || !matchValue}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {pending ? 'Adding' : 'Add rule'}
      </Button>
    </form>
  );
}
