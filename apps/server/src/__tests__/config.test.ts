import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../config.js';

describe('loadConfig', () => {
  it('стартует без кредов с дефолтными значениями', () => {
    const config = loadConfig({});

    expect(config.port).toBe(8080);
    expect(config.isProduction).toBe(false);
    expect(config.tmdb.apiKey).toBeUndefined();
    expect(config.tmdb.language).toBe('ru-RU');
    expect(config.prowlarr.url).toBeUndefined();
    expect(config.transmission.url).toBeUndefined();
  });

  it('распознаёт v4 bearer-токен TMDB', () => {
    const config = loadConfig({ TMDB_API_KEY: 'eyJhbGciOiJIUzI1NiJ9.test' });
    expect(config.tmdb.bearer).toBe(true);
    expect(config.tmdb.apiKey).toBe('eyJhbGciOiJIUzI1NiJ9.test');
  });

  it('считает обычный ключ TMDB v3-ключом', () => {
    const config = loadConfig({ TMDB_API_KEY: 'abc123' });
    expect(config.tmdb.bearer).toBe(false);
  });

  it('снимает обрамляющие кавычки у секретов из docker-compose', () => {
    const double = loadConfig({ PROWLARR_API_KEY: '"abc123"', TMDB_API_KEY: '"def456"' });
    expect(double.prowlarr.apiKey).toBe('abc123');
    expect(double.tmdb.apiKey).toBe('def456');

    const single = loadConfig({ APP_ACCESS_TOKEN: "'token'", TRANSMISSION_PASSWORD: "'pass'" });
    expect(single.accessToken).toBe('token');
    expect(single.transmission.password).toBe('pass');
  });

  it('не трогает кавычки внутри значения и оставляет пустую строку пустой', () => {
    const config = loadConfig({ PROWLARR_API_KEY: 'ab"cd', APP_ACCESS_TOKEN: '""' });
    expect(config.prowlarr.apiKey).toBe('ab"cd');
    expect(config.accessToken).toBeUndefined();
  });

  it('падает с понятным сообщением при невалидном PORT', () => {
    expect(() => loadConfig({ PORT: 'не-число' })).toThrow(ConfigError);
    expect(() => loadConfig({ PORT: 'не-число' })).toThrow(/PORT/);
  });

  it('падает при невалидном URL', () => {
    expect(() => loadConfig({ PROWLARR_URL: 'not a url' })).toThrow(/PROWLARR_URL/);
  });
});
