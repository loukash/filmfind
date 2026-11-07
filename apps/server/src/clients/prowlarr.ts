import type { ServiceStatus } from '@filmfind/shared';
import type { AppConfig } from '../config.js';
import { fetchJson } from '../lib/http.js';

/** Лёгкая проверка доступности Prowlarr. Полноценный клиент — волна 1. */
export async function checkHealth(cfg: AppConfig['prowlarr']): Promise<ServiceStatus> {
  if (!cfg.url || !cfg.apiKey) {
    const missing = !cfg.url ? 'PROWLARR_URL' : 'PROWLARR_API_KEY';
    return { ok: false, configured: false, message: `${missing} не задан` };
  }

  const startedAt = Date.now();
  const base = cfg.url.replace(/\/+$/, '');

  try {
    await fetchJson(`${base}/api/v1/system/status`, {
      headers: { 'x-api-key': cfg.apiKey },
    });
    return { ok: true, configured: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      message: error instanceof Error ? error.message : 'Неизвестная ошибка Prowlarr',
      latencyMs: Date.now() - startedAt,
    };
  }
}
