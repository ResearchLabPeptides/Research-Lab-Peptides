'use client';

import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Check, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { addUsdcAddresses, retireUsdcAddress } from '@/lib/actions/usdc';
import { describeAddressProblem, shortenAddress } from '@/lib/solana';
import type { UsdcPoolStats, UsdcAddress } from '@/lib/types';

/**
 * The address pool.
 *
 * These are receiving addresses, not wallets. The shop has one wallet, on a
 * phone; every address here belongs to it, so there is nothing per-order to
 * fund, sweep, or keep track of.
 *
 * Addresses are generated on that phone and pasted in here as plain text. No
 * key material ever reaches this screen or the server behind it.
 *
 * Every line is checked as it is typed, before anything is saved, because a
 * mistyped address is the one mistake in this whole system that cannot be
 * undone — the customer's money goes to an address nobody controls and there is
 * no way to get it back.
 */
export function UsdcAddressManager({
  addresses,
  stats,
}: {
  addresses: UsdcAddress[];
  stats: UsdcPoolStats;
}) {
  const [text, setText] = useState('');
  const [pending, startTransition] = useTransition();

  // Live validation. Splitting on any whitespace or comma means a pasted
  // column, a comma-separated list, or one-per-line all behave the same.
  const lines = useMemo(
    () =>
      text
        .split(/[\s,;]+/)
        .map((line) => line.trim())
        .filter(Boolean),
    [text],
  );

  const problems = useMemo(
    () =>
      lines
        .map((line, index) => ({ index, line, problem: describeAddressProblem(line) }))
        .filter((entry) => entry.problem !== null),
    [lines],
  );

  const duplicates = useMemo(() => {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    lines.forEach((line) => {
      if (seen.has(line)) dupes.add(line);
      seen.add(line);
    });
    return dupes;
  }, [lines]);

  const ready = lines.length > 0 && problems.length === 0 && duplicates.size === 0;

  function submit() {
    startTransition(async () => {
      const result = await addUsdcAddresses(text);
      if (result.ok) {
        toast.success(result.message);
        setText('');
      } else {
        toast.error(result.message);
      }
    });
  }

  function retire(id: string, address: string) {
    if (!confirm(`Retire ${shortenAddress(address)}? It will never be handed out again.`)) return;

    startTransition(async () => {
      const result = await retireUsdcAddress(id, 'Retired from the admin panel');
      result.ok ? toast.success(result.message) : toast.error(result.message);
    });
  }

  return (
    <div className="space-y-6">
      {stats.low && stats.available > 0 && (
        <Card className="border-[var(--warning)]/50 bg-[var(--warning)]/8 p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="size-4" aria-hidden />
            Only {stats.available} unused {stats.available === 1 ? 'address' : 'addresses'} left.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add more below. If the pool empties, USDC stops being offered at checkout and customers
            see Interac e-Transfer only.
          </p>
        </Card>
      )}

      {stats.available === 0 && stats.enabled && (
        <Card className="border-[var(--destructive)]/50 bg-[var(--destructive)]/8 p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="size-4" aria-hidden />
            The pool is empty — USDC is not being offered.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Existing orders are unaffected. New customers see Interac e-Transfer only until you add
            addresses.
          </p>
        </Card>
      )}

      <Card className="p-5">
        <h3 className="font-display text-base font-semibold">Add payment addresses</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Generate these in your wallet app on your phone and paste the public addresses here. One
          per line. Never paste a seed phrase or a private key — nothing on this page needs one.
        </p>

        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={8}
          spellCheck={false}
          placeholder={'9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM\n7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'}
          className="mt-4 font-mono text-xs"
          aria-describedby="paste-status"
        />

        <div id="paste-status" aria-live="polite" className="mt-3 space-y-2 text-sm">
          {lines.length === 0 && (
            <p className="text-muted-foreground">Nothing pasted yet.</p>
          )}

          {lines.length > 0 && problems.length === 0 && duplicates.size === 0 && (
            <p className="flex items-center gap-2 text-[var(--success,green)]">
              <Check className="size-4" aria-hidden />
              {lines.length} {lines.length === 1 ? 'address looks' : 'addresses look'} valid.
            </p>
          )}

          {duplicates.size > 0 && (
            <p className="text-[var(--destructive)]">
              The same address appears more than once: {shortenAddress([...duplicates][0])}
            </p>
          )}

          {problems.length > 0 && (
            <ul className="space-y-1 text-[var(--destructive)]">
              {problems.slice(0, 6).map((entry) => (
                <li key={entry.index}>
                  Line {entry.index + 1}: {entry.problem}
                </li>
              ))}
              {problems.length > 6 && <li>…and {problems.length - 6} more.</li>}
            </ul>
          )}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Button onClick={submit} disabled={!ready || pending}>
            <Plus className="size-4" aria-hidden />
            {pending ? 'Adding…' : `Add ${lines.length || ''} to the pool`}
          </Button>
          {lines.length > 0 && (
            <Button variant="ghost" onClick={() => setText('')} disabled={pending}>
              Clear
            </Button>
          )}
        </div>

        <p className="mt-4 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
          Worth knowing: a Solana address has no built-in checksum, so these checks catch a bad
          character set, a wrong length, and about half of single-character slips — but not every
          one. Send a small test payment to the first address before you rely on a new batch.
        </p>
      </Card>

      <Card className="p-5">
        <h3 className="font-display text-base font-semibold">
          Addresses <span className="text-muted-foreground">({stats.total})</span>
        </h3>

        {addresses.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No addresses yet. Add some above to start taking USDC.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">#</th>
                  <th className="py-2 pr-3 font-medium">Address</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Assigned</th>
                  <th className="py-2 font-medium sr-only">Actions</th>
                </tr>
              </thead>
              <tbody>
                {addresses.map((address) => (
                  <tr key={address.id} className="border-b border-border/50 last:border-0">
                    <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">
                      {address.position}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs" title={address.address}>
                      {shortenAddress(address.address)}
                    </td>
                    <td className="py-2 pr-3">
                      {address.is_retired ? (
                        <Badge variant="outline">Retired</Badge>
                      ) : address.order_id ? (
                        <Badge variant="secondary">In use</Badge>
                      ) : (
                        <Badge>Available</Badge>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">
                      {address.assigned_at
                        ? new Date(address.assigned_at).toLocaleDateString('en-CA')
                        : '—'}
                    </td>
                    <td className="py-2 text-right">
                      {!address.is_retired && !address.order_id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => retire(address.id, address.address)}
                          disabled={pending}
                        >
                          <X className="size-4" aria-hidden />
                          Retire
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
