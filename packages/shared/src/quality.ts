import type { ParsedRelease } from './types.js';

/**
 * Парсер качества раздач по названию торрента.
 *
 * Правила:
 * - Нечувствителен к регистру и разделителям (. _ - пробел, скобки).
 * - Неизвестное значение не попадает в результат (ключ просто отсутствует).
 * - Никогда не бросает исключений: на пустых и мусорных входах возвращает {}.
 * - Чистая функция: без внешнего состояния, без зависимостей.
 * - Регулярки без вложенных квантификаторов — катастрофический бэктрекинг невозможен.
 */

type Resolution = NonNullable<ParsedRelease['resolution']>;
type Source = NonNullable<ParsedRelease['source']>;
type Codec = NonNullable<ParsedRelease['codec']>;
type Hdr = NonNullable<ParsedRelease['hdr']>;

interface MatchCand {
  index: number;
  value: string;
}

// Разделители внутри составных токенов: точка, пробел, подчёркивание, дефис.
const SEP = String.raw`[\s._-]*`;
// Границы токена: слева/справа не буква и не цифра.
// Подчёркивание сюда НЕ входит — в названиях раздач оно работает как разделитель
// (`Dune_2024_2160p`, `DDP5_1`), поэтому не должно блокировать совпадение.
const L = String.raw`(?<![0-9a-zа-яё])`;
const R = String.raw`(?![0-9a-zа-яё])`;
// Правая граница, разрешающая цифры после токена (DDP5.1, AAC2.0).
const R_DIGIT = String.raw`(?![a-zа-яё])`;

// Символы, которые всегда считаются разделителями: скобки, кавычки, палки и т.п.
const RE_STRIP = /[[\]{}()|«»"'`,;:!?*#=@~^<>/\\]+/g;

/** Приводит название к канонической форме для сопоставления с шаблонами. */
function canonize(title: string): string {
  return title.toLowerCase().replace(RE_STRIP, ' ').replace(/\u00a0/g, ' ');
}

// ---------------------------------------------------------------------------
// Разрешение
// ---------------------------------------------------------------------------

const RE_RESOLUTION = new RegExp(`${L}(480|576|720|1080|2160)p${R}`, 'i');
const RE_4K = new RegExp(`${L}4k${R}`, 'i');
const RE_UHD = new RegExp(`${L}uhd${R}`, 'i');

// ---------------------------------------------------------------------------
// Источник. Порядок = приоритет: более специфичный источник проверяется первым.
// ---------------------------------------------------------------------------

const SOURCE_PATTERNS: ReadonlyArray<{ re: RegExp; value: Source }> = [
  { re: new RegExp(`${L}(?:bd|blu${SEP}ray)${SEP}remux${R}`, 'i'), value: 'BDRemux' },
  { re: new RegExp(`${L}remux${R}`, 'i'), value: 'Remux' },
  { re: new RegExp(`${L}blu${SEP}ray${SEP}(?:b|rar)?rip${R}`, 'i'), value: 'BDRip' },
  { re: new RegExp(`${L}bd${SEP}rip${R}`, 'i'), value: 'BDRip' },
  { re: new RegExp(`${L}blu${SEP}ray${R}`, 'i'), value: 'BluRay' },
  { re: new RegExp(`${L}web${SEP}dl${R}`, 'i'), value: 'WEB-DL' },
  { re: new RegExp(`${L}web${SEP}rip${R}`, 'i'), value: 'WEBRip' },
  { re: new RegExp(`${L}hd${SEP}tv${SEP}rip${R}`, 'i'), value: 'HDTV' },
  { re: new RegExp(`${L}hd${SEP}tv${R}`, 'i'), value: 'HDTV' },
  { re: new RegExp(`${L}dvd${SEP}rip${R}`, 'i'), value: 'DVDRip' },
  { re: new RegExp(`${L}cam(?:${SEP}rip)?${R}`, 'i'), value: 'CAM' },
  { re: new RegExp(`${L}(?:tele${SEP}sync|hdts|ts)${R}`, 'i'), value: 'TS' },
  { re: new RegExp(`${L}(?:tele${SEP}cine|hdtc|tc)${R}`, 'i'), value: 'TC' },
];

// ---------------------------------------------------------------------------
// Кодек: побеждает самый левый алиас в названии (связка "x265 HEVC" даст один H.265).
// ---------------------------------------------------------------------------

const CODEC_PATTERNS: ReadonlyArray<{ re: RegExp; value: Codec }> = [
  { re: new RegExp(`${L}(?:x${SEP}265|h${SEP}265|hevc)${R}`, 'i'), value: 'H.265' },
  { re: new RegExp(`${L}(?:x${SEP}264|h${SEP}264|avc)${R}`, 'i'), value: 'H.264' },
  { re: new RegExp(`${L}av1${R}`, 'i'), value: 'AV1' },
  { re: new RegExp(`${L}xvid${R}`, 'i'), value: 'XviD' },
];

// ---------------------------------------------------------------------------
// HDR: HDR10+ проверяется раньше HDR10, голый "HDR" тоже значит HDR10.
// ---------------------------------------------------------------------------

const HDR_PATTERNS: ReadonlyArray<{ re: RegExp; value: Hdr[number] }> = [
  { re: new RegExp(`${L}hdr10\\+${R}`, 'ig'), value: 'HDR10+' },
  { re: new RegExp(`${L}hdr10(?!\\+)${R}`, 'ig'), value: 'HDR10' },
  { re: new RegExp(`${L}hdr(?!\\+|\\d)${R}`, 'ig'), value: 'HDR10' },
  { re: new RegExp(`${L}dolby${SEP}vision`, 'ig'), value: 'Dolby Vision' },
  { re: new RegExp(`${L}dovi${R}`, 'ig'), value: 'Dolby Vision' },
  { re: new RegExp(`${L}dv${R}`, 'ig'), value: 'Dolby Vision' },
  { re: new RegExp(`${L}hlg${R}`, 'ig'), value: 'HLG' },
];

// ---------------------------------------------------------------------------
// Аудио. Побеждает формат с наибольшим приоритетом (rank), при равном —
// самый левый в названии. Atmos — отдельный флаг, не формат.
// ---------------------------------------------------------------------------

const AUDIO_PATTERNS: ReadonlyArray<{ re: RegExp; value: string; rank: number }> = [
  { re: new RegExp(`${L}true${SEP}hd${R}`, 'i'), value: 'TrueHD', rank: 90 },
  { re: new RegExp(`${L}dts${SEP}x${R}`, 'i'), value: 'DTS-X', rank: 80 },
  { re: new RegExp(`${L}dts${SEP}hd(?:${SEP}ma)?(?![a-zа-яё])|${L}dtshd${R}`, 'i'), value: 'DTS-HD', rank: 70 },
  { re: new RegExp(`${L}ddp${R_DIGIT}|${L}dd\\+`, 'i'), value: 'DDP', rank: 60 },
  { re: new RegExp(`${L}e${SEP}ac${SEP}3${R_DIGIT}`, 'i'), value: 'DDP', rank: 60 },
  { re: new RegExp(`${L}flac${R}`, 'i'), value: 'FLAC', rank: 50 },
  { re: new RegExp(`${L}dts${R}`, 'i'), value: 'DTS', rank: 40 },
  { re: new RegExp(`${L}dd${R_DIGIT}`, 'i'), value: 'DD', rank: 30 },
  { re: new RegExp(`${L}ac${SEP}3${R_DIGIT}`, 'i'), value: 'DD', rank: 30 },
  { re: new RegExp(`${L}aac${R_DIGIT}`, 'i'), value: 'AAC', rank: 20 },
  { re: new RegExp(`${L}opus${R}`, 'i'), value: 'Opus', rank: 10 },
];

const RE_ATMOS = new RegExp(`${L}atmos${R}`, 'i');
// Каналы: только валидные пары 2.0 / 5.1 / 7.1 (с разделителем или без).
const RE_CHANNELS = /(?<!\d)(?:2[\s._-]?0|5[\s._-]?1|7[\s._-]?1)(?!\d)/i;

// ---------------------------------------------------------------------------
// Озвучка/язык (рунет). Порядок в массиве — порядок появления в названии.
// ---------------------------------------------------------------------------

const VOICE_PATTERNS: ReadonlyArray<{ re: RegExp; value: string }> = [
  { re: new RegExp(`${L}дубл[а-яё]*`, 'ig'), value: 'Дубляж' },
  { re: new RegExp(`${L}dub${R}`, 'ig'), value: 'Дубляж' },
  { re: new RegExp(`${L}mvo${R}`, 'ig'), value: 'MVO' },
  { re: new RegExp(`${L}двухголос[а-яё]*`, 'ig'), value: 'DVO' },
  { re: new RegExp(`${L}dvo${R}`, 'ig'), value: 'DVO' },
  { re: new RegExp(`${L}одноголос[а-яё]*`, 'ig'), value: 'AVO' },
  { re: new RegExp(`${L}avo${R}`, 'ig'), value: 'AVO' },
  { re: new RegExp(`${L}оригинал[а-яё]*`, 'ig'), value: 'Оригинал' },
  { re: new RegExp(`${L}original(?![a-zа-яё])`, 'ig'), value: 'Оригинал' },
  { re: new RegExp(`${L}eng(?:lish)?(?![\\wа-яё])`, 'ig'), value: 'Оригинал' },
  { re: new RegExp(`${L}субтитр[а-яё]*`, 'ig'), value: 'Субтитры' },
  { re: new RegExp(`${L}sub(?:titl\\w*|s)?(?![a-zа-яё])`, 'ig'), value: 'Субтитры' },
  { re: new RegExp(`${L}itunes${R}`, 'ig'), value: 'iTunes' },
  { re: new RegExp(`${L}(?:лицензи[а-яё]*|лиц\\.)`, 'ig'), value: 'Лицензия' },
  { re: new RegExp(`${L}лиц${R}`, 'ig'), value: 'Лицензия' },
];

// Легитимные границы номеров серий; больше — мусор (год, размер и т.п.).
const MAX_EPISODE_NUMBER = 400;
// Диапазон длиннее 100 серий не раскрываем — оставляем только границы.
const MAX_EPISODES_EXPAND = 100;

// ---------------------------------------------------------------------------
// Сезон и серии
// ---------------------------------------------------------------------------

// S01E01, s1e1, S01E01-E05; диапазон серии требует явного "-" (иначе "S01E01.1080p" даст 1..1080)
const RE_SE = new RegExp(
  `${L}s(\\d{1,3})[\\s._-]*e(\\d{1,4})(?:-[\\s._-]*(?:e[\\s._-]*)?(\\d{1,4}))?`,
  'gi',
);
// S01 без серии (SE-формат с сериями обрабатывается отдельно)
const RE_SEASON_S = new RegExp(`${L}s(\\d{1,3})${R}`, 'gi');
// "1 сезон", "Сезон 2"
const RE_SEASON_RU = new RegExp(`(?<!\\d)(\\d{1,3})[\\s._-]*сезон|сезон[\\s._-]*(\\d{1,3})`, 'gi');
// "1-8 серия"
const RE_EP_RU_RANGE = new RegExp(
  `(?<!\\d)(\\d{1,4})[\\s._-]*-[\\s._-]*(\\d{1,4})[\\s._-]*сери(?:[яийю]|ей)`,
  'gi',
);
// "8 серия" (одна серия)
const RE_EP_RU_SINGLE = new RegExp(
  `${L}(\\d{1,4})[\\s._-]*сери(?:[яийю]|ей)(?![а-яё]*\\d)`,
  'gi',
);

interface Position {
  index: number;
}

/** Первое вхождение неглобальной регулярки или null. */
function firstMatch(text: string, re: RegExp): Position | null {
  const m = re.exec(text);
  return m ? { index: m.index } : null;
}

/** Все вхождения набора глобальных регулярок, без дублей значений, по порядку появления. */
function collectAll(text: string, patterns: ReadonlyArray<{ re: RegExp; value: string }>): string[] {
  const found: MatchCand[] = [];
  for (const { re, value } of patterns) {
    for (const m of text.matchAll(re)) {
      found.push({ index: m.index, value });
    }
  }
  found.sort((a, b) => a.index - b.index);
  const out: string[] = [];
  for (const c of found) {
    if (!out.includes(c.value)) out.push(c.value);
  }
  return out;
}

function parseResolution(canon: string): Resolution | undefined {
  const m = RE_RESOLUTION.exec(canon);
  if (m?.[1]) return `${m[1]}p` as Resolution;
  if (RE_4K.test(canon) || RE_UHD.test(canon)) return '2160p';
  return undefined;
}

function parseEpisodes(canon: string): number[] {
  const groups: number[][] = [];

  // S01E01 / S01E01-E05 / s2e10 / S01E02-05
  for (const m of canon.matchAll(RE_SE)) {
    const g = m[1];
    const start = Number(m[2]);
    if (!g || !Number.isFinite(start) || start < 1) continue;
    const endRaw = m[3];
    const end = endRaw !== undefined ? Number(endRaw) : start;
    groups.push(expandRange(start, end));
  }
  // "1-8 серия"
  for (const m of canon.matchAll(RE_EP_RU_RANGE)) {
    const s = Number(m[1]);
    const e = Number(m[2]);
    if (!Number.isFinite(s) || !Number.isFinite(e) || s < 1 || e < s || e > MAX_EPISODE_NUMBER) continue;
    groups.push(expandRange(s, e));
  }
  // "8 серия"
  for (const m of canon.matchAll(RE_EP_RU_SINGLE)) {
    const s = Number(m[1]);
    if (!Number.isFinite(s) || s < 1 || s > MAX_EPISODE_NUMBER) continue;
    groups.push([s]);
  }

  return [...new Set(groups.flat())].sort((a, b) => a - b);
}

/** Раскрывает диапазон серий; если он длиннее лимита — оставляет только границы. */
function expandRange(start: number, end: number): number[] {
  if (!Number.isFinite(end) || end <= start) return [start];
  if (end - start + 1 > MAX_EPISODES_EXPAND) return [start, end];
  const list: number[] = [];
  for (let i = start; i <= end; i++) list.push(i);
  return list;
}

interface SeasonCandidate {
  index: number;
  season: number;
  /** При равной позиции побеждает более специфичный формат: SE → S01 → "1 сезон". */
  priority: number;
}

/**
 * Номер сезона из первого по позиции формата: `S01E01`, `S01`, «1 сезон» / «Сезон 2».
 * Раньше здесь сравнивалось с null, из-за чего результат `undefined`
 * принимался за найденный сезон и остальные форматы не проверялись.
 */
function parseSeason(canon: string): number | undefined {
  const candidates: SeasonCandidate[] = [];

  for (const m of canon.matchAll(RE_SE)) {
    pushSeason(candidates, m.index, m[1], 0);
  }
  for (const m of canon.matchAll(RE_SEASON_S)) {
    pushSeason(candidates, m.index, m[1], 1);
  }
  for (const m of canon.matchAll(RE_SEASON_RU)) {
    pushSeason(candidates, m.index, m[1] ?? m[2], 2);
  }

  candidates.sort((a, b) => a.index - b.index || a.priority - b.priority);
  return candidates[0]?.season;
}

function pushSeason(
  target: SeasonCandidate[],
  index: number,
  raw: string | undefined,
  priority: number,
): void {
  const season = Number(raw);
  if (Number.isFinite(season) && season >= 1) {
    target.push({ index, season, priority });
  }
}

function parseQualityInner(title: string): ParsedRelease {
  const canon = canonize(title);
  const result: ParsedRelease = {};

  const resolution = parseResolution(canon);
  if (resolution) result.resolution = resolution;

  // Источник: первый подошедший паттерн проверяет «специфичность».
  for (const { re, value } of SOURCE_PATTERNS) {
    if (firstMatch(canon, re)) {
      result.source = value;
      break;
    }
  }

  // Кодек: самый левый алиас, при равной позиции — более приоритетная группа.
  let codec: Codec | undefined;
  let codecIndex = Infinity;
  for (const pattern of CODEC_PATTERNS) {
    const m = firstMatch(canon, pattern.re);
    if (m && m.index < codecIndex) {
      codec = pattern.value;
      codecIndex = m.index;
    }
  }
  if (codec) result.codec = codec;

  // HDR — по порядку появления в названии, без дублей.
  const hdr = collectAll(
    canon,
    HDR_PATTERNS.map((p) => ({ re: p.re, value: p.value })),
  );
  if (hdr.length > 0) result.hdr = hdr as Hdr;

  // Аудио.
  const audio: { format?: string; channels?: string; atmos?: boolean } = {};
  const formats: Array<{ index: number; value: string; rank: number }> = [];
  for (const { re, value, rank } of AUDIO_PATTERNS) {
    const m = firstMatch(canon, re);
    if (!m) continue;
    formats.push({ index: m.index, value, rank });
  }
  let best: { value: string; rank: number; index: number } | undefined;
  for (const f of formats) {
    if (!best || f.rank > best.rank || (f.rank === best.rank && f.index < best.index)) best = f;
  }
  if (best) audio.format = best.value;
  if (RE_ATMOS.test(canon)) audio.atmos = true;
  const ch = RE_CHANNELS.exec(canon);
  if (ch?.[0]) {
    const digits = ch[0].replace(/[^\d]/g, '');
    if (digits.length === 2) audio.channels = `${digits[0]}.${digits[1]}`;
  }
  if (audio.format || audio.channels || audio.atmos) result.audio = audio;

  // Озвучка — по порядку появления в названии, без дублей.
  const voice = collectAll(
    canon,
    VOICE_PATTERNS.map((p) => ({ re: p.re, value: p.value })),
  );
  if (voice.length > 0) result.voice = voice;

  // Сезон/серии.
  const season = parseSeason(canon);
  if (season !== undefined) result.season = season;
  const episodes = parseEpisodes(canon);
  if (episodes.length > 0) result.episodes = episodes;

  return result;
}

/**
 * Разбирает название раздачи и извлекает признаки качества.
 * Никогда не бросает исключений; на пустых и мусорных входах возвращает {}.
 */
export function parseRelease(title: string): ParsedRelease {
  if (typeof title !== 'string' || title.length === 0 || title.length > 10000) {
    return {};
  }
  try {
    return parseQualityInner(title);
  } catch {
    return {};
  }
}

/**
 * Нормализует название для дедупликации: lowercase, пунктуация → пробелы,
 * пробелы схлопнуты. Совместимо с кириллицей.
 */
export function normalizeReleaseTitle(title: string): string {
  if (typeof title !== 'string') return '';
  try {
    return title
      .toLowerCase()
      .replace(/\p{C}+/gu, ' ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  } catch {
    return '';
  }
}
