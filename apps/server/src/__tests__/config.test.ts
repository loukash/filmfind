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

  it('падает с понятным сообщением при невалидном PORT', () => {
    expect(() => loadConfig({ PORT: 'не-число' })).toThrow(ConfigError);
    expect(() => loadConfig({ PORT: 'не-число' })).toThrow(/PORT/);
  });

  it('падает при невалидном URL', () => {
    expect(() => loadConfig({ PROWLARR_URL: 'not a url' })).toThrow(/PROWLARR_URL/);
  });
});
