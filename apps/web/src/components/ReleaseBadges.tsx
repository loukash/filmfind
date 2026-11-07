import type { ParsedRelease } from '@filmfind/shared';
import { Badge } from '../ui';

/** Как в стайлгайде: парсер отдаёт стандартные имена, в интерфейсе — короткие. */
const CODEC_LABELS: Record<string, string> = {
  'H.264': 'x264',
  'H.265': 'x265',
  AV1: 'AV1',
  XviD: 'XviD',
};

/**
 * Строка качества раздачи: разрешение, источник, кодек, HDR, звук, озвучка.
 * Пустые поля парсера просто не показываются — бейджи не врут про «undefined».
 */
export function ReleaseBadges({ quality }: { quality: ParsedRelease }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {quality.resolution !== undefined && (
        <Badge variant="resolution">{quality.resolution}</Badge>
      )}
      {quality.source !== undefined && <Badge variant="source">{quality.source}</Badge>}
      {quality.codec !== undefined && (
        <Badge variant="codec">{CODEC_LABELS[quality.codec] ?? quality.codec}</Badge>
      )}
      {quality.hdr?.map((hdr) => (
        <Badge key={hdr} variant="hdr">
          {hdr}
        </Badge>
      ))}
      {quality.audio !== undefined && (
        <Badge variant="audio">
          {[quality.audio.format, quality.audio.channels].filter(Boolean).join(' ')}
          {quality.audio.atmos === true ? ' Atmos' : ''}
        </Badge>
      )}
      {quality.voice?.map((voice) => (
        <Badge key={voice} variant="voice">
          {voice}
        </Badge>
      ))}
    </div>
  );
}
