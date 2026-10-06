import { test, expect } from '@playwright/test';

import { loadNativeLyrics, nativeLyricsText } from './native-lyrics';
import { validSnapshot } from './types';

import type { MusicPlayerAppElement } from '@/types/music-player-app-element';

const next = {
  contents: {
    singleColumnMusicWatchNextResultsRenderer: {
      tabbedRenderer: {
        watchNextTabbedResultsRenderer: {
          tabs: [
            {
              tabRenderer: {
                endpoint: {
                  browseEndpoint: {
                    browseId: 'native-lyrics',
                    browseEndpointContextSupportedConfigs: {
                      browseEndpointContextMusicConfig: {
                        pageType: 'MUSIC_PAGE_TYPE_TRACK_LYRICS',
                      },
                    },
                  },
                },
              },
            },
          ],
        },
      },
    },
  },
};
const browse = {
  contents: {
    sectionListRenderer: {
      contents: [
        {
          musicDescriptionShelfRenderer: {
            description: { runs: [{ text: '  Hello 世界!\nSecond line  ' }] },
          },
        },
      ],
    },
  },
};

test('native fallback preserves YouTube text and never requires Synced Lyrics', async () => {
  const calls: { url: string; data: unknown }[] = [];
  const app = {
    networkManager: {
      fetch: (url: string, data: unknown) => {
        calls.push({ url, data });
        return Promise.resolve(url.startsWith('/next') ? next : browse);
      },
    },
  } as unknown as MusicPlayerAppElement;
  const result = await loadNativeLyrics(
    app,
    'song',
    new AbortController().signal,
  );
  expect(result).toEqual({
    videoId: 'song',
    state: 'ready',
    text: '  Hello 世界!\nSecond line  ',
    lines: [],
  });
  expect(calls).toEqual([
    { url: '/next?prettyPrint=false', data: { videoId: 'song' } },
    { url: '/browse?prettyPrint=false', data: { browseId: 'native-lyrics' } },
  ]);
});

test('native timed YouTube format remains readable without installing sync providers', () => {
  expect(
    nativeLyricsText({
      contents: {
        elementRenderer: {
          newElement: {
            type: {
              componentType: {
                model: {
                  timedLyricsModel: {
                    lyricsData: {
                      timedLyricsData: [
                        { lyricLine: 'One' },
                        { lyricLine: 'Two' },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
  ).toBe('One\nTwo');
  for (const response of [
    null,
    42,
    {},
    { contents: { sectionListRenderer: { contents: [null, {}] } } },
  ])
    expect(nativeLyricsText(response)).toBe('');
});

test('missing native lyrics endpoint yields empty state without another request', async () => {
  let calls = 0;
  const app = {
    networkManager: {
      fetch: () => {
        calls++;
        return Promise.resolve({});
      },
    },
  } as unknown as MusicPlayerAppElement;
  expect(
    (await loadNativeLyrics(app, 'song', new AbortController().signal)).state,
  ).toBe('empty');
  expect(calls).toBe(1);
});

test('cancelled native wait cannot start browse after stale next result arrives', async () => {
  let complete!: (value: unknown) => void;
  let calls = 0;
  const pending = new Promise((resolve) => {
    complete = resolve;
  });
  const app = {
    networkManager: {
      fetch: () => {
        calls++;
        return pending;
      },
    },
  } as unknown as MusicPlayerAppElement;
  const controller = new AbortController();
  const request = loadNativeLyrics(app, 'old-song', controller.signal);
  await Promise.resolve();
  controller.abort();
  await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  complete(next);
  await Promise.resolve();
  expect(calls).toBe(1);
});

test('already cancelled native requests perform no native work', async () => {
  let calls = 0;
  const app = {
    networkManager: {
      fetch: () => {
        calls++;
        return Promise.resolve(next);
      },
    },
  } as unknown as MusicPlayerAppElement;
  const controller = new AbortController();
  controller.abort();
  await expect(
    loadNativeLyrics(app, 'song', controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(calls).toBe(0);
});

test('window snapshots reject stale tracks, malformed timing and out-of-range controls', () => {
  const snapshot = {
    videoId: 'song',
    title: '<script>text only</script>',
    artist: 'Artist',
    paused: false,
    volume: 50,
    timeMs: 1234,
    lyrics: {
      videoId: 'song',
      state: 'ready',
      text: '',
      lines: [{ text: 'Line', startMs: 1000, endMs: 2000 }],
    },
  };
  expect(validSnapshot(snapshot)).toBe(true);
  for (const volume of [NaN, Infinity, -1, 101, '50'])
    expect(validSnapshot({ ...snapshot, volume })).toBe(false);
  expect(
    validSnapshot({
      ...snapshot,
      lyrics: { ...snapshot.lyrics, videoId: 'old' },
    }),
  ).toBe(false);
  expect(
    validSnapshot({
      ...snapshot,
      lyrics: {
        ...snapshot.lyrics,
        lines: [{ text: 'Line', startMs: 2000, endMs: 1000 }],
      },
    }),
  ).toBe(false);
  expect(validSnapshot({ ...snapshot, title: 'x'.repeat(2001) })).toBe(false);
});
