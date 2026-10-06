import type { LyricsView } from '@/providers/lyrics-view';
import type { MusicPlayerAppElement } from '@/types/music-player-app-element';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const at = (value: unknown, ...keys: string[]): unknown =>
  keys.reduce((item, key) => record(item)[key], value);
const runsText = (value: unknown): string =>
  Array.isArray(value)
    ? value
        .map((run) => record(run).text)
        .filter((text): text is string => typeof text === 'string')
        .join('\n')
    : '';

export const nativeLyricsText = (response: unknown): string => {
  const contents = at(response, 'contents');
  const timed = at(
    contents,
    'elementRenderer',
    'newElement',
    'type',
    'componentType',
    'model',
    'timedLyricsModel',
    'lyricsData',
    'timedLyricsData',
  );
  if (Array.isArray(timed))
    return timed
      .map((line) => record(line).lyricLine)
      .filter((text): text is string => typeof text === 'string')
      .join('\n');
  const sections = at(contents, 'sectionListRenderer', 'contents');
  if (!Array.isArray(sections)) return '';
  return sections
    .map((section) =>
      runsText(
        at(section, 'musicDescriptionShelfRenderer', 'description', 'runs'),
      ),
    )
    .filter(Boolean)
    .join('\n');
};

// The site's networkManager has no abort handle. Bound our wait and ignore late
// native results; never use an external lyrics service for this fallback.
const waitNative = <T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      action();
    };
    const abort = () =>
      finish(() =>
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new DOMException('Native lyrics request cancelled', 'AbortError'),
        ),
      );
    const timer = setTimeout(
      () => finish(() => reject(new Error('Native lyrics request timed out'))),
      10000,
    );
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return operation();
      })
      .then(
        (result) => finish(() => resolve(result)),
        (error: unknown) =>
          finish(() =>
            reject(
              error instanceof Error
                ? error
                : new Error('Native lyrics request failed'),
            ),
          ),
      );
  });

export const loadNativeLyrics = async (
  app: MusicPlayerAppElement,
  videoId: string,
  signal: AbortSignal,
): Promise<LyricsView> => {
  const next = await waitNative(
    () =>
      app.networkManager.fetch<unknown, { videoId: string }>(
        '/next?prettyPrint=false',
        { videoId },
      ),
    signal,
  );
  signal.throwIfAborted();
  const tabs = at(
    next,
    'contents',
    'singleColumnMusicWatchNextResultsRenderer',
    'tabbedRenderer',
    'watchNextTabbedResultsRenderer',
    'tabs',
  );
  const tab = Array.isArray(tabs)
    ? tabs.find(
        (item) =>
          at(
            item,
            'tabRenderer',
            'endpoint',
            'browseEndpoint',
            'browseEndpointContextSupportedConfigs',
            'browseEndpointContextMusicConfig',
            'pageType',
          ) === 'MUSIC_PAGE_TYPE_TRACK_LYRICS',
      )
    : undefined;
  const browseId = at(
    tab,
    'tabRenderer',
    'endpoint',
    'browseEndpoint',
    'browseId',
  );
  let text = '';
  if (typeof browseId === 'string' && browseId) {
    const response = await waitNative(
      () =>
        app.networkManager.fetch<unknown, { browseId: string }>(
          '/browse?prettyPrint=false',
          { browseId },
        ),
      signal,
    );
    signal.throwIfAborted();
    text = nativeLyricsText(response);
  }
  return { videoId, state: text.trim() ? 'ready' : 'empty', text, lines: [] };
};
