import type { HTMLAttributes } from 'react';
import { cn } from '../lib/cn';

export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn('ff-skeleton rounded-chip', className)} {...rest} />;
}
