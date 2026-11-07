export interface FetchJsonOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export class HttpError extends Error {
  override name = 'HttpError';

  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
    readonly headers?: Headers,
  ) {
    super(message);
  }
}

const DEFAULT_TIMEOUT_MS = 2000;

/**
 * Выполняет HTTP-запрос и разбирает JSON-ответ.
 * Таймаут через AbortSignal.timeout; ошибка — типизированный HttpError.
 */
export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<T> {
  const { method = 'GET', headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new HttpError(`Таймаут запроса (${timeoutMs} мс)`);
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new HttpError(`Запрос прерван по таймауту (${timeoutMs} мс)`);
    }
    throw new HttpError(error instanceof Error ? error.message : 'Сетевая ошибка');
  }

  const text = await response.text();

  if (!response.ok) {
    throw new HttpError(
      `HTTP ${response.status} ${response.statusText}`.trim(),
      response.status,
      text.slice(0, 500),
      response.headers,
    );
  }

  if (text.length === 0) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError('Ответ не является валидным JSON', response.status, text.slice(0, 500));
  }
}
