import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../lib/cn';
import { buttonVariantClasses, type ButtonVariant } from './Button';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Обязательная подпись: у кнопки без текста должен быть accessible name. */
  label: string;
  variant?: ButtonVariant;
}

export function IconButton({
  label,
  variant = 'ghost',
  className,
  children,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cn(
        'inline-flex size-11 shrink-0 items-center justify-center rounded-chip transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        buttonVariantClasses[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
