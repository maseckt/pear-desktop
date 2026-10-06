import { test, expect } from '@playwright/test';

import {
  getLyricsView,
  publishLyricsView,
  subscribeLyricsView,
} from './lyrics-view';

test('optional lyrics feed replays current source, clears on stop and disposes consumers', () => {
  publishLyricsView(null);
  const view = {
    videoId: 'song',
    state: 'ready' as const,
    text: 'Lyrics',
    lines: [],
  };
  const seen: unknown[] = [];
  const dispose = subscribeLyricsView((value) => seen.push(value));
  publishLyricsView(view);
  expect(getLyricsView()).toEqual(view);
  publishLyricsView(null);
  dispose();
  publishLyricsView(view);
  expect(seen).toEqual([null, view, null]);
  publishLyricsView(null);
});

test('optional consumer failure cannot interrupt the lyrics producer or other consumers', () => {
  const error = console.error;
  const seen: unknown[] = [];
  let failures = 0;
  console.error = () => {
    failures++;
  };
  const disposeBad = subscribeLyricsView(() => {
    throw new Error('fixture');
  });
  const disposeGood = subscribeLyricsView((view) => seen.push(view));
  try {
    expect(() => publishLyricsView(null)).not.toThrow();
    expect(seen).toEqual([null, null]);
    expect(failures).toBe(2);
  } finally {
    disposeBad();
    disposeGood();
    console.error = error;
  }
});
