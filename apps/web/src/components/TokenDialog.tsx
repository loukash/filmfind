import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { dismissUnauthorized, saveToken, useUnauthorized } from '../lib/token';
import { Button } from '../ui';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Диалог ввода токена доступа.
 *
 * Появляется только после настоящего 401 от `/api/*`, поэтому приложение без
 * `APP_ACCESS_TOKEN` работает как обычно. Закрыть его нельзя: пока сервер
 * требует токен, остальные экраны всё равно получат отказ. Escape намеренно
 * не обрабатывается, Tab зациклен внутри диалога.
 */
export function TokenDialog() {
  const required = useUnauthorized();
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const inputId = useId();
  const errorId = useId();

  useEffect(() => {
    if (!required) return;

    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    inputRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || panel === null) return;

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (first === undefined || last === undefined) {
        event.preventDefault();
        panel.focus();
        return;
      }

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
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [required]);

  if (!required) return null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const token = value.trim();
    if (token.length === 0) {
      setError('Введите токен доступа');
      return;
    }

    saveToken(token);
    setValue('');
    setError(null);
    dismissUnauthorized();

    // Инвалидация перезапустит активные запросы уже с новым заголовком.
    void queryClient.invalidateQueries();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div aria-hidden="true" className="absolute inset-0 bg-bg/85" />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="relative w-full max-w-sm rounded-card border border-line bg-surface p-5 focus:outline-none"
      >
        <h2 id={titleId} className="text-lg font-semibold text-fg">
          Требуется токен доступа
        </h2>
        <p id={descriptionId} className="mt-1.5 text-sm leading-relaxed text-muted">
          Сервер закрыт токеном доступа. Без него запросы к API отвечают отказом.
        </p>

        <form onSubmit={submit} className="mt-4 space-y-2">
          <label
            htmlFor={inputId}
            className="block text-xs font-semibold uppercase tracking-wider text-muted"
          >
            Токен
          </label>
          <input
            id={inputId}
            ref={inputRef}
            type="password"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              if (error !== null) setError(null);
            }}
            autoComplete="off"
            spellCheck={false}
            placeholder="Вставьте токен"
            aria-invalid={error !== null}
            aria-describedby={error === null ? undefined : errorId}
            className="h-12 w-full rounded-chip border border-line bg-bg px-3 text-[15px] text-fg placeholder:text-muted"
          />

          <p className="text-xs text-muted">
            Токен задан в <code className="text-fg">APP_ACCESS_TOKEN</code> на сервере.
          </p>

          {error !== null && (
            <p id={errorId} role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" className="mt-2 w-full">
            Войти
          </Button>
        </form>
      </div>
    </div>
  );
}
