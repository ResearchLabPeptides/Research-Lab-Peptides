import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  tone?: 'default' | 'warning' | 'danger';
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        {Icon ? (
          <Icon
            className={cn(
              'size-4 shrink-0',
              tone === 'warning' && 'text-[var(--warning)]',
              tone === 'danger' && 'text-destructive',
              tone === 'default' && 'text-muted-foreground',
            )}
            aria-hidden
          />
        ) : null}
      </div>
      <p
        className={cn(
          'tabular mt-2 font-display text-2xl font-bold',
          tone === 'warning' && 'text-[var(--warning)]',
          tone === 'danger' && 'text-destructive',
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
