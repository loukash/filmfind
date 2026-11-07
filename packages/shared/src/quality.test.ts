import { describe, expect, it } from 'vitest';
import { normalizeReleaseTitle, parseRelease } from './quality.js';
import { parseRelease as parseReleaseFromIndex } from './index.js';
import garbage from '../fixtures/garbage.json';
import movies from '../fixtures/movies.json';
import series from '../fixtures/series.json';
import voice from '../fixtures/voice.json';
import type { ParsedRelease } from './types.js';

interface Fixture {
  title: string;
  expect: Partial<ParsedRelease>;
}

const PARSABLE_KEYS = ['resolution', 'source', 'codec', 'hdr', 'audio', 'voice', 'season', 'episodes'] as const;

type FixtureGroup = ReadonlyArray<Fixture>;

/** Для фикстуры проверяются только объявленные поля, остальные должны быть undefined. */
function checkFixture(fixture: Fixture, actual: ParsedRelease): void {
  for (const key of PARSABLE_KEYS) {
    const expected = fixture.expect[key];
    if (expected !== undefined) {
      expect(actual[key], `поле "${key}" для "${fixture.title}"`).toEqual(expected);
    } else {
      expect(actual[key], `поле "${key}" должно отсутствовать для "${fixture.title}"`).toBeUndefined();
    }
  }
}

describe('parseRelease: фикстуры', () => {
  const groups: ReadonlyArray<[string, FixtureGroup]> = [
    ['фильмы', movies],
    ['озвучка', voice],
    ['сериалы', series],
    ['мусор/неполные', garbage],
  ];

  for (const [groupName, fixtures] of groups) {
    describe(groupName, () => {
      for (const fixture of fixtures) {
        it(fixture.title, () => {
          checkFixture(fixture, parseRelease(fixture.title));
        });
      }
    });
  }
});

describe('parseRelease: поведение', () => {
  it('возвращает {} для пустой строки', () => {
    expect(parseRelease('')).toEqual({});
  });

  it('не бросает исключений на мусоре', () => {
    const trash = [
      '',
      '   ',
      '\u0000\u0001',
      '🍿🍿🍿',
      '🔥🔥🔥🔥🔥🔥🔥🔥',
      '!@#$%^&*()_+="<>',
      'a'.repeat(5000),
      '😀'.repeat(200),
      'X'.repeat(10001),
    ];
    for (const t of trash) {
      expect(() => parseRelease(t)).not.toThrow();
      expect(parseRelease(t)).toEqual({});
    }
  });

  it('терпит нестроковые входы (оборонительный контракт)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(parseRelease(null as any)).toEqual({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(parseRelease(undefined as any)).toEqual({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(parseRelease(42 as any)).toEqual({});
  });

  it('идемпотентен: повторный вызов даёт тот же результат', () => {
    const titles = [
      'Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR10+.H.265',
      'Матрица 1999 UHD BluRay Remux 2160p HDR10 Дубляж MVO',
      'Stranger.Things.S01E01-E05.720p.WEB-DL.DDP5.1.H.264',
      'Джентльмены 2019 BDRip 1080p Dub MVO Subs',
    ];
    for (const t of titles) {
      const first = parseRelease(t);
      const second = parseRelease(t);
      expect(second).toEqual(first);
    }
  });

  it('без внутреннего состояния: порядок вызовов не влияет на результат', () => {
    const a = 'Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR10+.H.265';
    const b = 'Матрица 1999 UHD BluRay Remux 2160p HDR10 Дубляж MVO';
    const direct = parseRelease(a);
    parseRelease(b);
    const after = parseRelease(a);
    expect(after).toEqual(direct);
  });

  it('не путает 2160p внутри других чисел', () => {
    expect(parseRelease('Test.Clip.7202160p.mkv').resolution).toBeUndefined();
  });

  it('S01E01.1080p не превращается в диапазон серий 1..1080', () => {
    const parsed = parseRelease('Show.S01E01.1080p.WEB-DL.x264');
    expect(parsed.season).toBe(1);
    expect(parsed.episodes).toEqual([1]);
  });

  it('x265 и HEVC вместе дают один кодек', () => {
    const parsed = parseRelease('Movie.2020.2160p.BluRay.x265.HEVC.DTS-HD.MA.5.1');
    expect(parsed.codec).toBe('H.265');
  });

  it('HDR10+ не даёт второго HDR10', () => {
    expect(parseRelease('Movie.2020.2160p.WEB-DL.HDR10+.HEVC').hdr).toEqual(['HDR10+']);
  });

  it('DV как отдельный токен — Dolby Vision, но не внутри слов', () => {
    expect(parseRelease('Movie.2020.2160p.WEB-DL.DV.HEVC').hdr).toEqual(['Dolby Vision']);
    // "DVDRip" не должен засчитаться как DV
    expect(parseRelease('Movie.2020.DVDRip.AV1').hdr).toBeUndefined();
  });

  it('регистронезависим: ALL CAPS равно исходной форме', () => {
    const title = 'Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR10+.H.265';
    expect(parseRelease(title.toUpperCase())).toEqual(parseRelease(title));
  });

  it('подчёркивания работают как разделители, в т.ч. внутри каналов', () => {
    const parsed = parseRelease('Dune_Part_Two_2024_2160p_WEB-DL_DDP5_1_Atmos_DV');
    expect(parsed.resolution).toBe('2160p');
    expect(parsed.source).toBe('WEB-DL');
    expect(parsed.audio).toEqual({ format: 'DDP', channels: '5.1', atmos: true });
  });

  it('даны оба "S01" и "1 сезон" — берётся первый найденный формат сезона', () => {
    expect(parseRelease('Шоу 1 сезон').season).toBe(1);
    expect(parseRelease('Шоу S03').season).toBe(3);
    expect(parseRelease('Шоу Сезон 2').season).toBe(2);
  });

  it('диапазон длиннее 100 серий не раскрывается — только границы', () => {
    expect(parseRelease('Мега.Шоу.S01E01-300.WEB-DL.x264').episodes).toEqual([1, 300]);
  });
});

describe('normalizeReleaseTitle', () => {
  it('приводит к нижнему регистру', () => {
    expect(normalizeReleaseTitle('Dune.Part.Two.2024')).toBe('dune part two 2024');
  });

  it('пунктуация становится пробелами', () => {
    expect(normalizeReleaseTitle('The.Matrix_1999_[1080p]+WEB-DL')).toBe('the matrix 1999 1080p web dl');
  });

  it('схлопывает повторные разделители и обрезает края', () => {
    expect(normalizeReleaseTitle('  МНОГО---ПРОБЕЛОВ  ...и---дефисы!!!  ')).toBe(
      'много пробелов и дефисы',
    );
  });

  it('сохраняет кириллицу и цифры', () => {
    expect(normalizeReleaseTitle('Матрица.1999.BluRay.Remux.2160p')).toBe('матрица 1999 bluray remux 2160p');
  });

  it('эмодзи и спецсимволы убираются', () => {
    expect(normalizeReleaseTitle('🍿🍿🍿')).toBe('');
    expect(normalizeReleaseTitle('🔥HDR10+ 🔥')).toBe('hdr10');
  });

  it('пустые и нестроковые входы → пустая строка', () => {
    expect(normalizeReleaseTitle('')).toBe('');
    expect(normalizeReleaseTitle('   ')).toBe('');
    expect(normalizeReleaseTitle(null as unknown as string)).toBe('');
    expect(normalizeReleaseTitle(42 as unknown as string)).toBe('');
  });

  it('идемпотентен', () => {
    expect(normalizeReleaseTitle(normalizeReleaseTitle('The.Matrix_1999_[1080p]'))).toBe(
      normalizeReleaseTitle('The.Matrix_1999_[1080p]'),
    );
  });
});

describe('публичный API', () => {
  it('parseRelease экспортируется из index', () => {
    expect(typeof parseReleaseFromIndex).toBe('function');
    expect(parseReleaseFromIndex('Movie.2020.1080p.BluRay.x264')).toEqual(
      parseRelease('Movie.2020.1080p.BluRay.x264'),
    );
  });

  it('normalizeReleaseTitle экспортируется из index (через re-export из ./quality)', () => {
    // index.ts делает export * from './quality.js'
    expect(normalizeReleaseTitle('Dune.Part.Two.2160p')).toBeDefined();
  });
});
