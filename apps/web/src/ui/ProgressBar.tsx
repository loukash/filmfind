import { cn } from '../lib/cn';

export type ProgressTone = 'accent' | 'success';

export interface ProgressBarProps {
  /** Значение от 0 до 1. */
  value: number;
  tone?: ProgressTone;
  label?: string;
  className?: string;
}

export function ProgressBar({ value, tone = 'accent', label, className }: ProgressBarProps) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const percent = Math.round(clamped * 100);

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={label}
      className={cn('h-1 w-full overflow-hidden rounded-pill bg-surface2', className)}
    >
      <div
        className={cn(
          'h-full rounded-pill transition-[width] duration-300',
          tone === 'success' ? 'bg-success' : 'bg-accent',
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
