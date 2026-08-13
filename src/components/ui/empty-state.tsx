import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** An empty screen is an invitation to act, so every one of these takes an action. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 py-14 text-center',
        className,
      )}
    >
      <Icon className="size-7 text-muted-foreground" aria-hidden />
      <div className="space-y-1">
        <p className="font-display text-base font-semibold">{title}</p>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}
