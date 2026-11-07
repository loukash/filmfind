import type { ServiceStatus } from '@filmfind/shared';
import type { AppConfig } from '../config.js';
import { fetchJson, HttpError } from '../lib/http.js';

/**
 * Приводит базовый URL к RPC-эндпоинту Transmission.
 * Поддерживает как `http://host:9091`, так и полный `.../transmission/rpc`.
 */
function toRpcUrl(base: string): string {
  const trimmed = base.replace(/\/+$/, '');
  return trimmed.endsWith('/rpc') ? trimmed : `${trimmed}/transmission/rpc`;
}

/** Лёгкая проверка доступности Transmission (session-get). Полноценный клиент — волна 2. */
export async function checkHealth(cfg: AppConfig['transmission']): Promise<ServiceStatus> {
  if (!cfg.url) {
    return { ok: false, configured: false, message: 'TRANSMISSION_URL не задан' };
  }

  const startedAt = Date.now();
  const url = toRpcUrl(cfg.url);
  const payload = { method: 'session-get' };

  const headers: Record<string, string> = {};
  if (cfg.user) {
    const credentials = `${cfg.user}:${cfg.password ?? ''}`;
    headers.authorization = `Basic ${Buffer.from(credentials).toString('base64')}`;
  }

  try {
    try {
      await fetchJson(url, { method: 'POST', headers, body: payload });
    } catch (error) {
      // Transmission отвечает 409 и выдаёт session-id, с которым нужно повторить запрос.
      if (error instanceof HttpError && error.status === 409) {
        const sessionId = error.headers?.get('x-transmission-session-id');
        if (!sessionId) throw error;
        await fetchJson(url, {
          method: 'POST',
          headers: { ...headers, 'x-transmission-session-id': sessionId },
          body: payload,
        });
      } else {
        throw error;
      }
    }
    return { ok: true, configured: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      message: error instanceof Error ? error.message : 'Неизвестная ошибка Transmission',
      latencyMs: Date.now() - startedAt,
    };
  }
}
