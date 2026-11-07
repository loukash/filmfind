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

const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

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
  TMDB_API_KEY: optionalString,
  TMDB_LANGUAGE: optionalString,
  PROWLARR_URL: optionalUrl,
  PROWLARR_API_KEY: optionalString,
  TRANSMISSION_URL: optionalUrl,
  TRANSMISSION_USER: optionalString,
  TRANSMISSION_PASSWORD: optionalString,
  TRANSMISSION_DOWNLOAD_DIR: optionalString,
  APP_ACCESS_TOKEN: optionalString,
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
