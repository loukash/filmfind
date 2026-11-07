import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { SearchIcon } from './icons';

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn('flex flex-col items-center gap-3 px-6 py-10 text-center', className)}
    >
      <div className="flex size-12 items-center justify-center rounded-pill border border-line bg-surface2 text-muted">
        {icon ?? <SearchIcon className="size-6" />}
      </div>
      <div className="space-y-1">
        <p className="text-base font-semibold text-fg">{title}</p>
        {description !== undefined && <p className="text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
