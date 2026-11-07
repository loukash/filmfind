import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../lib/cn';
import { SpinnerIcon } from './icons';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export const buttonVariantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover active:bg-accent',
  secondary:
    'bg-surface2 text-fg border border-line hover:border-muted hover:bg-surface active:bg-surface2',
  ghost: 'bg-transparent text-fg hover:bg-surface2 active:bg-surface',
  danger: 'bg-danger text-white hover:bg-danger/90 active:bg-danger',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5',
  md: 'h-11 px-4 text-[15px] gap-2',
  lg: 'h-[52px] px-6 text-base gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex select-none items-center justify-center rounded-chip font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        buttonVariantClasses[variant],
        sizeClasses[size],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <SpinnerIcon />}
      {children}
    </button>
  );
}
