import { describe, expect, it } from 'vitest';
import { formatBytes, formatEta } from '@filmfind/shared';

describe('format из @filmfind/shared', () => {
  it('форматирует размеры', () => {
    expect(formatBytes(0)).toBe('0 Б');
    expect(formatBytes(19756849562)).toBe('18.4 ГБ');
  });

  it('форматирует ETA', () => {
    expect(formatEta(720)).toBe('12 мин');
    expect(formatEta(-1)).toBe('—');
  });
});
