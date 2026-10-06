import type { LyricsView } from '@/providers/lyrics-view';

export interface PipSnapshot {
  videoId: string;
  title: string;
  artist: string;
  paused: boolean;
  volume: number;
  timeMs: number;
  lyrics: LyricsView | null;
  theme?: Record<string, string>;
}
export const themeKeys = [
  '--ytmusic-text-primary',
  '--ytmusic-text-secondary',
  '--ytmusic-color-white1',
  '--ytmusic-color-grey5',
  '--ytmusic-player-bar-background',
  '--ytmusic-general-background-a',
  '--ytmusic-body-line-height',
  '--lyrics-font-family',
  '--lyrics-font-size',
  '--lyrics-line-height',
  '--lyrics-width',
  '--lyrics-padding',
  '--global-margin',
  '--lyrics-inactive-font-weight',
  '--lyrics-inactive-opacity',
  '--lyrics-inactive-scale',
  '--lyrics-inactive-offset',
  '--lyrics-active-font-weight',
  '--lyrics-active-opacity',
  '--lyrics-active-scale',
  '--lyrics-active-offset',
  '--lyrics-animations',
  '--lyrics-scale-duration',
  '--lyrics-opacity-transition',
  '--lyrics-glow-duration',
  '--lyrics-wobble-duration',
  '--glow-color',
  '--floating-root-font-size',
  '--floating-font-family',
  '--floating-plain-font-size',
] as const;
export type PipCommand = 'previous' | 'playPause' | 'next' | 'volume' | 'close';
export const channels = {
  toggle: 'lyrics-pip:toggle',
  update: 'lyrics-pip:update',
  state: 'lyrics-pip:state',
  command: 'lyrics-pip:command',
  opened: 'lyrics-pip:opened',
} as const;

export const validSnapshot = (value: unknown): value is PipSnapshot => {
  if (!value || typeof value !== 'object') return false;
  const data = value as PipSnapshot;
  if (
    data.theme !== undefined &&
    (!data.theme ||
      typeof data.theme !== 'object' ||
      Array.isArray(data.theme) ||
      Object.entries(data.theme).some(
        ([key, value]) =>
          !themeKeys.some((allowed) => allowed === key) ||
          typeof value !== 'string' ||
          value.length > 400,
      ))
  )
    return false;
  const shortText = (text: unknown, max: number) =>
    typeof text === 'string' && text.length <= max;
  if (
    !shortText(data.videoId, 256) ||
    !shortText(data.title, 2000) ||
    !shortText(data.artist, 2000) ||
    typeof data.paused !== 'boolean' ||
    !Number.isFinite(data.volume) ||
    data.volume < 0 ||
    data.volume > 100 ||
    !Number.isFinite(data.timeMs) ||
    data.timeMs < 0
  )
    return false;
  if (data.lyrics === null) return true;
  const lyrics = data.lyrics;
  if (lyrics?.stylesheet !== undefined && !shortText(lyrics.stylesheet, 64000))
    return false;
  if (
    !lyrics ||
    lyrics.videoId !== data.videoId ||
    !['loading', 'ready', 'empty'].includes(lyrics.state) ||
    !shortText(lyrics.text, 200000) ||
    !Array.isArray(lyrics.lines) ||
    lyrics.lines.length > 5000
  )
    return false;
  let last = -1;
  return lyrics.lines.every((line) => {
    if (
      !line ||
      !shortText(line.text, 4000) ||
      !Number.isFinite(line.startMs) ||
      line.startMs < last ||
      line.startMs < 0 ||
      (line.endMs !== undefined &&
        (!Number.isFinite(line.endMs) || line.endMs < line.startMs))
    )
      return false;
    last = line.startMs;
    return true;
  });
};
