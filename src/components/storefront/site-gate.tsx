'use client';

import * as React from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { acceptAcknowledgements } from '@/lib/actions/gate';
import type { AcknowledgementItem } from '@/lib/gate';
import type { GateConfig } from '@/lib/queries/storefront';
import { cn } from '@/lib/utils';

/**
 * The entry gate.
 *
 * The shop behind it is still server-rendered and present in the document, so
 * search engines and link previews see the catalog. It is made genuinely
 * unreachable rather than merely covered: the page behind is marked `inert`
 * (no pointer, no keyboard, no screen reader), scrolling is locked, and focus
 * is held inside the dialog.
 */
export function SiteGate({ config }: { config: GateConfig }) {
  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const dialogRef = React.useRef<HTMLDivElement>(null);

  const required = config.items.filter((i) => i.is_required);
  const remaining = required.filter((i) => !checked.has(i.key)).length;

  React.useEffect(() => {
    const main = document.getElementById('shop-content');
    main?.setAttribute('inert', '');
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    dialogRef.current?.querySelector<HTMLElement>('input, button')?.focus();

    return () => {
      main?.removeAttribute('inert');
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // Focus stays in the dialog. There is nothing behind it to tab to.
  function trapFocus(event: React.KeyboardEvent) {
    if (event.key !== 'Tab' || !dialogRef.current) return;

    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
      'input, button, a[href], [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function toggle(key: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setError(null);
  }

  function confirm() {
    startTransition(async () => {
      const result = await acceptAcknowledgements([...checked]);
      if (!result.ok) setError(result.message);
      // On success the server action revalidates and the gate stops rendering.
    });
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center overflow-hidden bg-background/80 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onKeyDown={trapFocus}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gate-title"
        aria-describedby="gate-intro"
        className="flex max-h-[100dvh] w-full max-w-lg flex-col rounded-t-2xl border border-border bg-card shadow-2xl sm:max-h-[90dvh] sm:rounded-2xl"
      >
        {/* Pinned. On a short screen the whole card used to scroll as one
            block, which pushed the heading off the top and left people looking
            at a list of tick boxes with no idea what they were agreeing to. */}
        <div className="shrink-0 px-6 pb-3 pt-6">
          <h2 id="gate-title" className="font-display text-xl font-bold tracking-tight">
            {config.title}
          </h2>
          {config.intro ? (
            <p id="gate-intro" className="mt-1.5 text-sm text-muted-foreground">
              {config.intro}
            </p>
          ) : null}
        </div>

        {/* The only part that scrolls. */}
        <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-1">
          {config.items.map((item) => (
            <li key={item.key}>
              <Acknowledgement
                item={item}
                checked={checked.has(item.key)}
                onToggle={() => toggle(item.key)}
                disabled={pending}
                optionalLabel={config.optionalLabel}
                linkLabel={config.linkLabel}
              />
            </li>
          ))}
        </ul>

        {/* Pinned too, so the button is always reachable without scrolling to
            the end of a long list of acknowledgements. */}
        <div className="shrink-0 border-t border-border px-6 pb-6 pt-4">
        {error ? (
          <p
            role="alert"
            className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
          >
            {error}
          </p>
        ) : null}

        <div className="space-y-2">
          <Button
            type="button"
            size="lg"
            className="w-full"
            onClick={confirm}
            disabled={pending || remaining > 0}
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {pending ? config.pendingLabel : config.confirmLabel}
          </Button>

          <p className="text-center text-xs text-muted-foreground" aria-live="polite">
            {remaining === 0
              ? config.doneLabel
              : config.remainingLabel.replace('{n}', String(remaining))}
          </p>

          <a
            href={config.declineUrl}
            className="block w-full rounded-md py-2 text-center text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            {config.declineLabel}
          </a>
        </div>
        </div>
      </div>
    </div>
  );
}

function Acknowledgement({
  item,
  checked,
  onToggle,
  disabled,
  optionalLabel,
  linkLabel,
}: {
  item: AcknowledgementItem;
  checked: boolean;
  onToggle: () => void;
  disabled: boolean;
  optionalLabel: string;
  linkLabel: string;
}) {
  const id = `ack-${item.key}`;

  // A label, not a div, so the whole row toggles. On a phone the checkbox alone
  // is a 20px target — making the row the target is the difference between
  // tapping comfortably and aiming. min-h-11 is the 44px accessibility minimum.
  return (
    <label
      className={cn(
        'block min-h-11 cursor-pointer rounded-lg border p-3 transition-colors',
        checked ? 'border-primary bg-accent/40' : 'border-border',
      )}
    >
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          disabled={disabled}
          aria-describedby={item.body ? `${id}-body` : undefined}
          className="mt-0.5 size-5 shrink-0 cursor-pointer accent-[var(--primary)]"
        />
        <div className="min-w-0 flex-1">
          <span className="block text-sm font-medium leading-snug">
            {item.label}
            {item.is_required ? (
              <span className="ml-1 text-destructive" aria-label="required">
                *
              </span>
            ) : (
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                {optionalLabel}
              </span>
            )}
          </span>

          {item.body ? (
            <p id={`${id}-body`} className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {item.body}
            </p>
          ) : null}

          {item.link_url ? (
            <a
              href={item.link_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {item.link_label || linkLabel}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          ) : null}
        </div>
      </div>
    </label>
  );
}
