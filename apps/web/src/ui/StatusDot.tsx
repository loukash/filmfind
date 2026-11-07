import { cn } from '../lib/cn';

export type StatusTone = 'success' | 'warn' | 'danger';

const dotClasses: Record<StatusTone, string> = {
  success: 'bg-success',
  warn: 'bg-warn',
  danger: 'bg-danger',
};

export interface StatusDotProps {
  tone: StatusTone;
  label?: string;
  ariaLabel?: string;
  className?: string;
}

export function StatusDot({ tone, label, ariaLabel, className }: StatusDotProps) {
  return (
    <span
      role="status"
      aria-label={ariaLabel ?? label}
      className={cn('inline-flex items-center gap-2 text-xs text-muted', className)}
    >
      <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-pill', dotClasses[tone])} />
      {label !== undefined && <span>{label}</span>}
    </span>
  );
}
