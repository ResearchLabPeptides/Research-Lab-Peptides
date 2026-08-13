import { cn } from '@/lib/utils';

/**
 * A checkbox with its label and explanation. Native input, so keyboard and
 * screen-reader behaviour comes for free.
 */
export function CheckboxField({
  id,
  label,
  description,
  checked,
  onChange,
  disabled,
  className,
}: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
        aria-describedby={description ? `${id}-desc` : undefined}
      />
      <div className="space-y-0.5">
        <label htmlFor={id} className="text-sm font-medium leading-none">
          {label}
        </label>
        {description ? (
          <p id={`${id}-desc`} className="text-xs text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
