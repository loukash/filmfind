import { useHealth } from '../api/queries';
import { StatusDot } from '../ui';

/**
 * Сводка здоровья трёх внешних сервисов в шапке.
 *
 * Зелёный — все `ok`, жёлтый — часть не настроена или недоступна, красный —
 * сам `/api/health` не ответил. На узких экранах остаётся только точка,
 * подпись `N/3` появляется с `sm`.
 */
export function HealthIndicator() {
  const health = useHealth();

  if (health.isError) {
    return <StatusDot tone="danger" label="—/3" ariaLabel="Сервер недоступен" />;
  }

  const services = health.data?.services;
  if (services === undefined) {
    return <StatusDot tone="warn" label="…" ariaLabel="Проверяем состояние сервисов" />;
  }

  const list = [
    { name: 'TMDB', status: services.tmdb },
    { name: 'Prowlarr', status: services.prowlarr },
    { name: 'Transmission', status: services.transmission },
  ];
  const okCount = list.filter((entry) => entry.status.ok).length;
  const broken = list.filter((entry) => !entry.status.ok).map((entry) => entry.name);
  const tone = okCount === list.length ? 'success' : 'warn';

  return (
    <StatusDot
      tone={tone}
      label={`${okCount}/3`}
      ariaLabel={
        broken.length === 0
          ? 'Все сервисы доступны'
          : `Доступно сервисов: ${okCount} из 3. Недоступны: ${broken.join(', ')}`
      }
      className="[&>span:last-child]:hidden sm:[&>span:last-child]:inline"
    />
  );
}
