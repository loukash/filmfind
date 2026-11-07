import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  icon?: ReactNode;
}

export function Chip({ active = false, icon, className, children, type = 'button', ...rest }: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={active}
      className={cn(
        'inline-flex h-11 shrink-0 select-none items-center justify-center gap-1.5 rounded-chip px-4',
        'text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        active
          ? 'border border-transparent bg-accent text-white'
          : 'border border-line bg-transparent text-muted hover:border-muted hover:text-fg',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
