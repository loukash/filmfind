import type { ServiceStatus } from '@filmfind/shared';
import type { AppConfig } from '../config.js';
import { fetchJson } from '../lib/http.js';

/** Лёгкая проверка доступности TMDB. Полноценный клиент — волна 1. */
export async function checkHealth(cfg: AppConfig['tmdb']): Promise<ServiceStatus> {
  if (!cfg.apiKey) {
    return { ok: false, configured: false, message: 'TMDB_API_KEY не задан' };
  }

  const startedAt = Date.now();
  const language = encodeURIComponent(cfg.language);
  const url = cfg.bearer
    ? `https://api.themoviedb.org/3/configuration?language=${language}`
    : `https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(cfg.apiKey)}&language=${language}`;

  try {
    await fetchJson(url, {
      headers: cfg.bearer ? { authorization: `Bearer ${cfg.apiKey}` } : {},
    });
    return { ok: true, configured: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      message: error instanceof Error ? error.message : 'Неизвестная ошибка TMDB',
      latencyMs: Date.now() - startedAt,
    };
  }
}
