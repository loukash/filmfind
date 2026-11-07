export type TitleType = 'movie' | 'tv';

export interface TitleSummaryDTO {
  id: number;
  type: TitleType;
  title: string; // локализованное название
  originalTitle: string;
  year?: number;
  posterPath?: string; // путь TMDB, без базового URL
  rating?: number;
  isAnimation: boolean; // жанр Animation (id 16)
}

export interface TitleDetailsDTO extends TitleSummaryDTO {
  overview?: string;
  backdropPath?: string;
  genres: { id: number; name: string }[];
  runtime?: number; // минуты, для фильмов
  seasons?: { seasonNumber: number; name: string; episodeCount: number; airDate?: string }[];
  imdbId?: string;
  status?: string;
}

export interface SearchResultDTO {
  page: number;
  totalPages: number;
  totalResults: number;
  items: TitleSummaryDTO[];
}

export interface ParsedRelease {
  resolution?: '480p' | '576p' | '720p' | '1080p' | '2160p';
  source?:
    | 'WEB-DL'
    | 'WEBRip'
    | 'BluRay'
    | 'BDRip'
    | 'BDRemux'
    | 'Remux'
    | 'HDTV'
    | 'DVDRip'
    | 'CAM'
    | 'TS'
    | 'TC';
  codec?: 'H.264' | 'H.265' | 'AV1' | 'XviD';
  hdr?: ('HDR10' | 'HDR10+' | 'Dolby Vision' | 'HLG')[];
  audio?: { format?: string; channels?: string; atmos?: boolean };
  voice?: string[]; // Дубляж, MVO, DVO, AVO, Оригинал, Субтитры, iTunes, Лицензия
  season?: number;
  episodes?: number[];
}

export interface ReleaseDTO {
  id: string; // стабильный идентификатор (hash)
  title: string;
  size: number; // байты
  seeders?: number;
  leechers?: number;
  indexer?: string;
  indexerId?: number;
  publishDate?: string;
  infoHash?: string;
  categories: number[];
  quality: ParsedRelease;
  guid?: string;
}

export interface ReleasesResponseDTO {
  items: ReleaseDTO[];
  warnings: string[];
}

export interface TorrentDTO {
  id: number;
  name: string;
  percentDone: number; // 0..1
  status: number; // код Transmission
  rateDownload: number; // байт/с
  rateUpload: number;
  eta: number; // секунды, -1 = неизвестно
  totalSize: number;
  downloadDir?: string;
}

export interface ServiceStatus {
  ok: boolean;
  configured: boolean;
  message?: string;
  latencyMs?: number;
}

export interface HealthDTO {
  status: 'ok' | 'degraded';
  services: { tmdb: ServiceStatus; prowlarr: ServiceStatus; transmission: ServiceStatus };
}

export interface ApiErrorDTO {
  code: string;
  message: string;
  details?: unknown;
}
