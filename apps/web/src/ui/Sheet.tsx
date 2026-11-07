import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { CloseIcon } from './icons';
import { IconButton } from './IconButton';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Встроенный режим — для макетов внутри рамки (не блокирует фон страницы). */
  embedded?: boolean;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Sheet({ open, onClose, title, children, embedded = false }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;

    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    let previousOverflow = '';

    if (!embedded) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      panel?.focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      if (embedded || event.key !== 'Tab' || !panel) return;

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (!embedded) {
        document.body.style.overflow = previousOverflow;
        previouslyFocused?.focus();
      }
    };
  }, [open, onClose, embedded]);

  if (!open) return null;

  return (
    <div
      className={cn(
        'flex items-end justify-center',
        embedded ? 'absolute inset-0 z-30' : 'fixed inset-0 z-50',
      )}
    >
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-bg/80"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal={embedded ? undefined : true}
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'relative flex w-full max-w-[640px] flex-col overflow-hidden rounded-t-card border-t border-line bg-surface focus:outline-none',
          embedded ? 'h-[85%]' : 'max-h-[85vh]',
        )}
      >
        <div className="shrink-0 px-4 pb-3 pt-2">
          <div aria-hidden="true" className="mx-auto h-1 w-12 rounded-pill bg-line" />
          <div className="mt-3 flex items-center justify-between gap-3">
            <h2 id={titleId} className="text-lg font-semibold text-fg">
              {title}
            </h2>
            <IconButton label="Закрыть" onClick={onClose} className="-mr-2">
              <CloseIcon className="size-5" />
            </IconButton>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>
  );
}
