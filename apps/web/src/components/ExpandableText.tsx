import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';

/**
 * Описание тайтла: 4 строки, пока пользователь не попросил раскрыть.
 *
 * Обрезка не должна быть тупиковой, поэтому кнопка «Ещё» появляется только
 * если текст действительно не влез: сравниваем `scrollHeight` и `clientHeight`
 * у сжатого параграфа. `useLayoutEffect` — чтобы кнопка не мигала после
 * первой отрисовки.
 */
export function ExpandableText({ text, className }: { text: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const paragraphRef = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    if (expanded) return;

    const measure = () => {
      const element = paragraphRef.current;
      if (element === null) return;
      setCanExpand(element.scrollHeight > element.clientHeight + 1);
    };

    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [text, expanded]);

  return (
    <div className={className}>
      <p
        ref={paragraphRef}
        className={cn(
          'text-sm leading-relaxed text-muted',
          expanded ? undefined : 'line-clamp-4',
        )}
      >
        {text}
      </p>

      {(canExpand || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 inline-flex h-11 items-center text-sm font-medium text-accent"
        >
          {expanded ? 'Свернуть' : 'Ещё'}
        </button>
      )}
    </div>
  );
}
