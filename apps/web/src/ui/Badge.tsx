import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';

export type BadgeVariant = 'resolution' | 'source' | 'codec' | 'hdr' | 'audio' | 'voice' | 'plain';
export type BadgeTone = 'neutral' | 'accent' | 'warn' | 'success' | 'danger';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  tone?: BadgeTone;
  children: ReactNode;
}

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'border border-line bg-surface2 text-fg',
  accent: 'border border-transparent bg-accent text-white',
  warn: 'border border-warn/30 bg-warn/15 text-warn',
  success: 'border border-success/30 bg-success/15 text-success',
  danger: 'border border-danger/30 bg-danger/15 text-danger',
};

const variantTone: Record<BadgeVariant, BadgeTone> = {
  resolution: 'neutral',
  source: 'neutral',
  codec: 'neutral',
  hdr: 'warn',
  audio: 'neutral',
  voice: 'neutral',
  plain: 'neutral',
};

export function Badge({ variant = 'plain', tone, className, children, ...rest }: BadgeProps) {
  const is2160p = variant === 'resolution' && String(children).includes('2160p');
  const resolutionFillClasses = 'border border-transparent bg-line text-white';
  const resolvedTone: BadgeTone = is2160p ? 'accent' : (tone ?? variantTone[variant]);
  const isOutline = variant === 'voice';
  const resolutionDefault = variant === 'resolution' && tone === undefined;

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center whitespace-nowrap rounded-chip px-2 py-1 text-[11px] font-semibold leading-none',
        isOutline
          ? 'border border-line bg-transparent text-muted'
          : resolutionDefault && !is2160p
            ? resolutionFillClasses
            : toneClasses[resolvedTone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
