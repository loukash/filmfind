import { describe, expect, it } from 'vitest';
import { resolveDownloadDir, type DownloadDirConfig } from '../lib/download-dirs.js';

const dirs: DownloadDirConfig = {
  base: '/downloads/complete',
  movie: '/downloads/complete/film',
  tv: '/downloads/complete/tv',
  animation: '/downloads/complete/mult',
};

describe('resolveDownloadDir', () => {
  it('фильм без анимации → каталог фильмов', () => {
    expect(resolveDownloadDir(dirs, { type: 'movie', isAnimation: false })).toBe(
      '/downloads/complete/film',
    );
  });

  it('мультфильм → каталог мультфильмов', () => {
    expect(resolveDownloadDir(dirs, { type: 'movie', isAnimation: true })).toBe(
      '/downloads/complete/mult',
    );
  });

  it('сериал → каталог сериалов', () => {
    expect(resolveDownloadDir(dirs, { type: 'tv', isAnimation: false })).toBe(
      '/downloads/complete/tv',
    );
  });

  it('аниме-сериал → каталог сериалов: тип важнее жанра', () => {
    expect(resolveDownloadDir(dirs, { type: 'tv', isAnimation: true })).toBe('/downloads/complete/tv');
  });

  it('без контекста (прямой magnet) → общий каталог', () => {
    expect(resolveDownloadDir(dirs, undefined)).toBe('/downloads/complete');
  });

  it('незаданный специфичный каталог падает на общий', () => {
    const onlyBase: DownloadDirConfig = { base: '/downloads' };
    expect(resolveDownloadDir(onlyBase, { type: 'movie', isAnimation: false })).toBe('/downloads');
    expect(resolveDownloadDir(onlyBase, { type: 'movie', isAnimation: true })).toBe('/downloads');
    expect(resolveDownloadDir(onlyBase, { type: 'tv', isAnimation: true })).toBe('/downloads');
  });

  it('частично заданные каталоги: каждый проваливается независимо', () => {
    const partial: DownloadDirConfig = { base: '/base', tv: '/base/series' };
    expect(resolveDownloadDir(partial, { type: 'movie', isAnimation: false })).toBe('/base');
    expect(resolveDownloadDir(partial, { type: 'movie', isAnimation: true })).toBe('/base');
    expect(resolveDownloadDir(partial, { type: 'tv', isAnimation: false })).toBe('/base/series');
  });

  it('совсем без каталогов → undefined, Transmission возьмёт папку по умолчанию', () => {
    expect(resolveDownloadDir({}, { type: 'movie', isAnimation: false })).toBeUndefined();
    expect(resolveDownloadDir({}, undefined)).toBeUndefined();
  });
});
