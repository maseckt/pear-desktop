import { test, expect } from '@playwright/test';

import { DownloadTasks } from '../src/plugins/downloader/tasks';
import { invokePlayerApiReady } from '../src/utils/player-api-ready';
import type { MusicPlayer } from '../src/types/music-player';
import { prepareLrcExport } from '../src/plugins/synced-lyrics/lrc-export';
import { seekSeconds } from '../src/plugins/shortcuts/seek';
import { trackGainDb } from '../src/plugins/utils/renderer/track-gain';
import { validRange, savedRanges } from '../src/plugins/player-actions/state';
import {
  claimPlaybackRate,
  releasePlaybackRate,
  isPlaybackRateControlledByOther,
} from '../src/plugins/utils/renderer/playback-rate-owner';

const timed = () => ({
  title: 'Song',
  artist: 'Artist',
  lyrics: {
    syncLevel: 'line',
    lines: [
      { startMs: 1234, text: '  original text  ' },
      { startMs: 60123, text: 'second' },
    ],
  },
});

test('throwing/rejected plugin hooks are isolated; receiver/context preserved', async () => {
  const errors: unknown[] = [];
  const api = {} as MusicPlayer;
  const context = {
    getConfig: () => ({ enabled: true }),
    setConfig: () => {},
    ipc: {},
  } as Parameters<typeof invokePlayerApiReady>[2];
  let called = false;
  const renderer = {
    onPlayerApiReady(player: MusicPlayer, ctx: typeof context) {
      expect(this).toBe(renderer);
      expect(player).toBe(api);
      expect(ctx).toBe(context);
      called = true;
    },
  };
  for (const hook of [
    {
      onPlayerApiReady() {
        throw new Error('synchronous');
      },
    },
    {
      async onPlayerApiReady() {
        throw new Error('asynchronous');
      },
    },
    renderer,
  ])
    await invokePlayerApiReady(hook, api, context, (error) =>
      errors.push(error),
    );
  expect(errors).toHaveLength(2);
  expect(called).toBe(true);
  await invokePlayerApiReady(undefined, api, context, (error) =>
    errors.push(error),
  );
  expect(errors).toHaveLength(2);
});

test('LRC exports canonical milliseconds and exact text, not display timing', () => {
  const value = timed();
  const before = JSON.stringify(value);
  expect(prepareLrcExport(value).content).toContain(
    '[00:01.23]  original text  \n[01:00.12]second',
  );
  expect(JSON.stringify(value)).toBe(before);
});

test('plain export never invents timestamps; header injection and path separators removed', () => {
  const exported = prepareLrcExport({
    title: '../a\\b\n[ar:evil]',
    artist: 'x\r\ny',
    lyrics: { syncLevel: 'plain', lyrics: 'exact\ntext' },
  });
  expect(exported.content.endsWith('exact\ntext')).toBe(true);
  expect(exported.content).not.toContain('\n[ar:evil]');
  expect(exported.filename).not.toMatch(/[\\/\r\n]/);
  expect(exported.filename.endsWith('.lrc')).toBe(true);
});

for (const [index, invalid] of [
  null,
  {},
  {
    title: 'x',
    artist: 'y',
    lyrics: { syncLevel: 'plain', lyrics: 'x'.repeat(1_000_001) },
  },
  ...[NaN, Infinity, -1, 604800001].map((startMs) => ({
    ...timed(),
    lyrics: { syncLevel: 'line', lines: [{ startMs, text: 'x' }] },
  })),
  {
    ...timed(),
    lyrics: {
      syncLevel: 'line',
      lines: [
        { startMs: 100, text: 'a' },
        { startMs: 99, text: 'b' },
      ],
    },
  },
  {
    ...timed(),
    lyrics: {
      syncLevel: 'line',
      lines: Array(10001).fill({ startMs: 0, text: 'x' }),
    },
  },
].entries()) {
  test(`LRC rejects malformed/bounded payload ${index}`, () => {
    expect(() => prepareLrcExport(invalid)).toThrow();
  });
}

test('multiline timed text retains each text line at same canonical timestamp', () => {
  const value = timed();
  value.lyrics.lines[0].text = 'one\ntwo';
  expect(prepareLrcExport(value).content).toContain(
    '[00:01.23]one\n[00:01.23]two',
  );
});

test('seek and gain settings reject non-finite/oversized values', () => {
  for (const value of [null, NaN, Infinity, -1, 0, 601, '10'])
    expect(seekSeconds(value, 5)).toBe(5);
  expect(seekSeconds(300, 5)).toBe(300);
  expect(trackGainDb(-20, 12)).toBe(12);
  expect(trackGainDb(-200, 1000)).toBe(24);
  expect(trackGainDb(10, 12)).toBe(0);
  for (const value of [NaN, Infinity, '12', null])
    expect(trackGainDb(value, 12)).toBe(0);
});

test('saved sections bounded and malformed/range overflow rejected', () => {
  expect(validRange(0, 10, 10)).toBe(true);
  for (const [a, b, duration] of [
    [-1, 2, 10],
    [1, 1, 10],
    [0, Infinity, 10],
    [0, 11, 10],
  ])
    expect(validRange(a, b, duration)).toBe(false);
  expect(
    savedRanges([null, {}, { videoId: 'bad', start: 0, end: 10 }]),
  ).toEqual([]);
  expect(
    savedRanges(Array(700).fill({ videoId: 'abcdefghijk', start: 1, end: 10 })),
  ).toHaveLength(500);
});

test('playback-rate arbitration yields and releasing another owner does not steal rate', () => {
  claimPlaybackRate('speed');
  expect(isPlaybackRateControlledByOther('actions')).toBe(true);
  releasePlaybackRate('actions');
  expect(isPlaybackRateControlledByOther('actions')).toBe(true);
  claimPlaybackRate('actions');
  expect(isPlaybackRateControlledByOther('speed')).toBe(true);
  releasePlaybackRate('actions');
  expect(isPlaybackRateControlledByOther('speed')).toBe(false);
});

test('download jobs serialized, deduplicated, failing job cannot block next', async () => {
  const queue = new DownloadTasks();
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const order: string[] = [];
  const a = queue.enqueue('a', 'A', async () => {
    order.push('a');
    await wait;
  });
  expect(
    queue.enqueue('a', 'Duplicate', async () => {
      throw new Error('must not run');
    }),
  ).toBe(a);
  const b = queue.enqueue('b', 'B', async () => {
    order.push('b');
    throw new Error('network');
  });
  const c = queue.enqueue('c', 'C', async () => {
    order.push('c');
  });
  await Promise.resolve();
  expect(order).toEqual(['a']);
  release();
  await Promise.all([a, b, c]);
  expect(order).toEqual(['a', 'b', 'c']);
  expect(queue.snapshot().map((task) => task.status)).toEqual([
    'done',
    'error',
    'done',
  ]);
});

test('cancelled queued task never starts; running cancel checked before simulated save', async () => {
  const queue = new DownloadTasks();
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let saved = false;
  const a = queue.enqueue('a', 'A', async (id) => {
    await wait;
    queue.check(id);
    saved = true;
  });
  const b = queue.enqueue('b', 'B', async () => {
    throw new Error('must not run');
  });
  await Promise.resolve();
  queue.cancel('1');
  queue.cancel('2');
  release();
  await Promise.all([a, b]);
  expect(saved).toBe(false);
  expect(queue.snapshot().map((task) => task.status)).toEqual([
    'cancelled',
    'cancelled',
  ]);
});

test('queue snapshots detached; retry restricted to failed jobs; task history bounded', async () => {
  const queue = new DownloadTasks();
  let attempts = 0;
  await queue.enqueue('a', 'A', async () => {
    if (++attempts === 1) throw new Error('failure');
  });
  const snapshot = queue.snapshot();
  snapshot[0].title = 'spoof';
  expect(queue.snapshot()[0].title).toBe('A');
  queue.retry('1');
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(attempts).toBe(2);
  expect(queue.snapshot()[0].status).toBe('done');
  for (let i = 0; i < 150; i++)
    await queue.enqueue(String(i), 'x', async () => {});
  expect(queue.snapshot().length).toBeLessThanOrEqual(100);
});

test('cancel/dismiss cannot bypass pending queue cap behind a blocked job', async () => {
  const queue = new DownloadTasks();
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const jobs = [
    queue.enqueue('blocking', 'Blocking', async () => {
      await wait;
    }),
  ];
  await Promise.resolve();
  for (let i = 0; i < 99; i++) {
    jobs.push(queue.enqueue(`queued-${i}`, 'Queued', async () => {}));
    const id = String(i + 2);
    queue.cancel(id);
    queue.dismiss(id);
  }
  expect(queue.snapshot()).toHaveLength(1);
  await expect(
    queue.enqueue('overflow', 'Overflow', async () => {}),
  ).rejects.toThrow('queue full');
  release();
  await Promise.all(jobs);
  await queue.enqueue('allowed-after-drain', 'Allowed', async () => {});
  expect(queue.snapshot().at(-1)?.status).toBe('done');
});
