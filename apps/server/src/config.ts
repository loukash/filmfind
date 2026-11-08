import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export interface AppConfig {
  port: number;
  isProduction: boolean;
  webDistPath: string;
  accessToken?: string;
  tmdb: {
    apiKey?: string;
    /** true, если ключ — v4 bearer-токен (начинается с «eyJ»). */
    bearer: boolean;
    language: string;
  };
  prowlarr: {
    url?: string;
    apiKey?: string;
  };
  transmission: {
    url?: string;
    user?: string;
    password?: string;
    downloadDir?: string;
  };
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

const emptyToUndefined = (value: unknown): unknown => {
  if (typeof value === 'string' && value.trim() === '') return undefined;
  if (typeof value === 'string') return value.trim();
  return value;
};

/**
 * Снимает обрамляющие кавычки у секретов.
 *
 * В `.env` dotenv снимает кавычки сам, а в `docker-compose.yml` запись
 * `- VAR="value"` передаёт их внутрь значения — сервис получает ключ вместе с
 * кавычками и отвечает 401. Ошибка неочевидная, поэтому терпим оба варианта.
 */
const stripWrappingQuotes = (value: unknown): unknown => {
  const trimmed = emptyToUndefined(value);
  if (typeof trimmed !== 'string' || trimmed.length < 2) return trimmed;

  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' || first === "'") && first === last) {
    const inner = trimmed.slice(1, -1).trim();
    return inner === '' ? undefined : inner;
  }

  return trimmed;
};

const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

/**
 * Секрет или путь: как `optionalString`, но терпит кавычки из docker-compose.
 * Применимо и к ключам, и к `TRANSMISSION_DOWNLOAD_DIR`: кавычки в значении
 * ломают и авторизацию, и путь загрузки.
 */
const optionalQuoted = z.preprocess(stripWrappingQuotes, z.string().optional());

const optionalUrl = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .optional()
    .refine((value) => {
      if (value === undefined) return true;
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    }, 'должен быть корректным http(s) URL'),
);

const envSchema = z.object({
  PORT: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .optional()
      .transform((value) => (value === undefined ? 8080 : Number(value)))
      .pipe(
        z
          .number({ error: 'PORT должен быть числом' })
          .int('PORT должен быть целым числом')
          .min(1, 'PORT должен быть от 1 до 65535')
          .max(65535, 'PORT должен быть от 1 до 65535'),
      ),
  ),
  NODE_ENV: optionalString,
  TMDB_API_KEY: optionalQuoted,
  TMDB_LANGUAGE: optionalString,
  PROWLARR_URL: optionalUrl,
  PROWLARR_API_KEY: optionalQuoted,
  TRANSMISSION_URL: optionalUrl,
  TRANSMISSION_USER: optionalString,
  TRANSMISSION_PASSWORD: optionalQuoted,
  TRANSMISSION_DOWNLOAD_DIR: optionalQuoted,
  APP_ACCESS_TOKEN: optionalQuoted,
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => {
        const field = issue.path.join('.') || 'env';
        return `  • ${field}: ${issue.message}`;
      })
      .join('\n');
    throw new ConfigError(`Некорректная конфигурация окружения:\n${details}`);
  }

  const data = parsed.data;
  const apiKey = data.TMDB_API_KEY;

  return {
    port: data.PORT,
    isProduction: data.NODE_ENV === 'production',
    // apps/server/dist/index.js → ../../web/dist
    webDistPath: fileURLToPath(new URL('../../web/dist', import.meta.url)),
    accessToken: data.APP_ACCESS_TOKEN,
    tmdb: {
      apiKey,
      bearer: apiKey !== undefined && apiKey.startsWith('eyJ'),
      language: data.TMDB_LANGUAGE ?? 'ru-RU',
    },
    prowlarr: {
      url: data.PROWLARR_URL,
      apiKey: data.PROWLARR_API_KEY,
    },
    transmission: {
      url: data.TRANSMISSION_URL,
      user: data.TRANSMISSION_USER,
      password: data.TRANSMISSION_PASSWORD,
      downloadDir: data.TRANSMISSION_DOWNLOAD_DIR,
    },
  };
}
