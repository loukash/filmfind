import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '../lib/cn';
import { goBack, Link } from '../lib/router';
import { clearToken, useToken } from '../lib/token';
import { IconButton } from '../ui';
import { ChevronLeftIcon, LogoutIcon } from './icons';
import { HealthIndicator } from './HealthIndicator';

export type HeaderSection = 'search' | 'downloads' | 'title';

export interface AppHeaderProps {
  /** Текущий раздел: подсвечивает ссылку и даёт `aria-current`. */
  active: HeaderSection;
  /** Показать «Назад» вместо перехода на поиск (карточка тайтла). */
  back?: boolean;
  /** Прозрачная шапка поверх backdrop. */
  overlay?: boolean;
  className?: string;
}

function NavLink({
  to,
  active,
  children,
}: {
  to: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex h-11 items-center rounded-chip px-2 text-[13px] font-medium transition-colors sm:px-2.5 sm:text-sm',
        active ? 'text-fg' : 'text-muted hover:text-fg',
      )}
    >
      {children}
    </Link>
  );
}

/**
 * Единая шапка приложения. Одна на всех экранах, кроме стайлгайда:
 * марка, ссылки разделов, индикатор сервисов и выход из токена доступа.
 */
export function AppHeader({ active, back = false, overlay = false, className }: AppHeaderProps) {
  const token = useToken();
  const queryClient = useQueryClient();

  const logout = () => {
    clearToken();
    // Данные, полученные с токеном, больше не валидны. Если сервер открыт —
    // запросы просто пройдут заново; если закрыт — появится диалог ввода.
    void queryClient.invalidateQueries();
  };

  return (
    <header
      className={cn(
        'flex items-center justify-between gap-2',
        overlay && 'absolute inset-x-0 top-0 z-40 bg-gradient-to-b from-bg/85 to-transparent pb-6',
        className,
      )}
    >
      <div className="flex min-w-0 items-center">
        {back && (
          <button
            type="button"
            aria-label="Назад"
            onClick={() => goBack('/')}
            className="-ml-2 inline-flex size-11 shrink-0 items-center justify-center rounded-chip text-fg transition-colors hover:bg-surface2"
          >
            <ChevronLeftIcon className="size-5" />
          </button>
        )}

        <Link
          to="/"
          className="truncate px-1 text-lg font-bold tracking-tight text-fg sm:text-xl"
        >
          FilmFind
        </Link>
      </div>

      <nav aria-label="Основная навигация" className="flex shrink-0 items-center gap-0.5">
        <NavLink to="/" active={active === 'search'}>
          Поиск
        </NavLink>
        <NavLink to="/downloads" active={active === 'downloads'}>
          Загрузки
        </NavLink>

        <div className="ml-1 flex items-center">
          <HealthIndicator />
        </div>

        {token !== null && (
          <IconButton label="Сбросить токен доступа" onClick={logout} className="-mr-2">
            <LogoutIcon className="size-5" />
          </IconButton>
        )}
      </nav>
    </header>
  );
}
