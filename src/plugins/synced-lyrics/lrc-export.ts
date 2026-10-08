import filenamify from 'filenamify';

const MAX_TEXT = 1_000_000;
const MAX_LINES = 10_000;
const MAX_TIME = 7 * 24 * 60 * 60 * 1000;

function text(value: unknown, limit: number): string {
  if (
    typeof value !== 'string' ||
    value.length > limit ||
    value.includes('\0')
  ) {
    throw new Error('Invalid lyrics export text');
  }
  return value;
}

function metadata(value: unknown): string {
  return text(value, 300).replace(/[\r\n[\]]/g, ' ');
}

export function prepareLrcExport(payload: unknown): {
  content: string;
  filename: string;
} {
  if (!payload || typeof payload !== 'object')
    throw new Error('Invalid lyrics export');
  const { lyrics, title, artist } = payload as Record<string, unknown>;
  if (!lyrics || typeof lyrics !== 'object') throw new Error('Missing lyrics');
  const result = lyrics as Record<string, unknown>;
  const safeTitle = metadata(title);
  const safeArtist = metadata(artist);
  let content = `[ti:${safeTitle}]\n[ar:${safeArtist}]\n[by:Pearum Desktop]\n\n`;
  if (result.syncLevel === 'plain') {
    content += text(result.lyrics, MAX_TEXT);
  } else {
    if (
      !['line', 'word', 'syllable'].includes(String(result.syncLevel)) ||
      !Array.isArray(result.lines) ||
      !result.lines.length ||
      result.lines.length > MAX_LINES
    ) {
      throw new Error('Invalid timed lyrics');
    }
    let previous = -1;
    for (const raw of result.lines) {
      if (!raw || typeof raw !== 'object')
        throw new Error('Invalid lyric line');
      const line = raw as Record<string, unknown>;
      const ms = line.startMs;
      if (
        typeof ms !== 'number' ||
        !Number.isFinite(ms) ||
        ms < previous ||
        ms < 0 ||
        ms > MAX_TIME
      ) {
        throw new Error('Invalid lyric timestamp');
      }
      previous = ms;
      const centiseconds = Math.floor(ms / 10);
      const minutes = Math.floor(centiseconds / 6000);
      const seconds = Math.floor(centiseconds / 100) % 60;
      const stamp = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds % 100).padStart(2, '0')}`;
      for (const part of text(line.text, MAX_TEXT).split(/\r\n|\r|\n/)) {
        content += `[${stamp}]${part}\n`;
        if (content.length > MAX_TEXT)
          throw new Error('Lyrics export too large');
      }
    }
  }
  if (content.length > MAX_TEXT) throw new Error('Lyrics export too large');
  return {
    content,
    filename: `${filenamify(`${safeTitle || 'Lyrics'} - ${safeArtist || 'Unknown'}`, { replacement: '_', maxLength: 150 }) || 'Lyrics'}.lrc`,
  };
}
