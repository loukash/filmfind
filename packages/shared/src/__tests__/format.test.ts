import { describe, expect, it } from 'vitest';
import { formatBytes, formatEta } from '../format.js';
import { parseRelease } from '../quality.js';

describe('formatBytes', () => {
  it('форматирует байты и килобайты', () => {
    expect(formatBytes(0)).toBe('0 Б');
    expect(formatBytes(512)).toBe('512 Б');
    expect(formatBytes(1024)).toBe('1 КБ');
    expect(formatBytes(1536)).toBe('1.5 КБ');
  });

  it('форматирует гигабайты как в макетах', () => {
    expect(formatBytes(19756849562)).toBe('18.4 ГБ');
    expect(formatBytes(1024 ** 3 * 2)).toBe('2 ГБ');
    expect(formatBytes(1024 ** 4 * 3.25)).toBe('3.3 ТБ');
  });

  it('возвращает тире для некорректных значений', () => {
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
  });
});

describe('formatEta', () => {
  it('форматирует минуты и часы', () => {
    expect(formatEta(720)).toBe('12 мин');
    expect(formatEta(3900)).toBe('1 ч 5 мин');
    expect(formatEta(3600)).toBe('1 ч');
    expect(formatEta(30)).toBe('30 с');
  });

  it('форматирует дни', () => {
    expect(formatEta(90000)).toBe('1 д 1 ч');
  });

  it('возвращает тире для -1', () => {
    expect(formatEta(-1)).toBe('—');
  });
});

describe('parseRelease', () => {
  it('не бросает исключений и возвращает объект на простом названии', () => {
    expect(() => parseRelease('Dune.Part.Two.2024.2160p.WEB-DL')).not.toThrow();
    expect(parseRelease('Dune.Part.Two.2024.2160p.WEB-DL')).toBeInstanceOf(Object);
  });
});
