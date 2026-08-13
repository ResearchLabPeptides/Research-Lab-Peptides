'use client';

import { useRouter } from 'next/navigation';
import { RANGES, type RangeKey } from '@/lib/reports';
import { cn } from '@/lib/utils';

/**
 * One date range for the whole screen. Reports that cannot be filtered by date
 * say so on their own card rather than being hidden, so nobody hunts for a
 * report that is right there but looks unavailable.
 */
export function ReportRange({ value }: { value: RangeKey }) {
  const router = useRouter();

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Date range">
      {RANGES.map((range) => (
        <button
          key={range.key}
          type="button"
          aria-pressed={value === range.key}
          onClick={() => router.push(`/admin/reports?range=${range.key}`)}
          className={cn(
            'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
            value === range.key
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground',
          )}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}
