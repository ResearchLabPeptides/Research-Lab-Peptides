import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      tone: {
        slate: 'border-border bg-muted text-muted-foreground',
        green: 'border-transparent bg-accent text-accent-foreground',
        amber: 'border-transparent bg-[var(--warning)]/15 text-[var(--warning)]',
        blue: 'border-transparent bg-chart-2/15 text-chart-2',
        red: 'border-transparent bg-destructive/12 text-destructive',
        outline: 'border-border text-foreground',
      },
    },
    defaultVariants: { tone: 'slate' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export { Badge, badgeVariants };
