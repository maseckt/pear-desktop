import { once } from 'node:events';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { test, expect } from '@playwright/test';

const require = createRequire(import.meta.url);
const dependency = (parent) => createRequire(require.resolve(parent));

test('patched Seroval retains Solid serialization and rejects oversized typed-array nodes', async () => {
  const { toJSON, toJSONAsync, fromJSON } = dependency('solid-js')('seroval');
  const value = {
    text: 'lyrics',
    time: 1234,
    bytes: new Uint8Array([1, 2, 3]),
    map: new Map([['enabled', true]]),
  };
  expect(fromJSON(toJSON(value))).toEqual(value);
  expect(await fromJSON(await toJSONAsync(Promise.resolve('fixture')))).toBe(
    'fixture',
  );
  const oversized = toJSON(new Uint8Array([1, 2, 3]));
  oversized.t.l = 2 ** 32;
  expect(() => fromJSON(oversized)).toThrow();
  const wrongBuffer = toJSON(new Uint8Array([1]));
  wrongBuffer.t.f = { t: 0, s: 2 ** 32 };
  expect(() => fromJSON(wrongBuffer)).toThrow();
});

test('Seroval rejects Promise assimilation of plugin-produced thenables without executing them', async () => {
  const { fromJSON } = dependency('solid-js')('seroval');
  let calls = 0;
  let deserializations = 0;
  const plugin = {
    tag: 'fixture-thenable',
    deserialize: () => {
      deserializations++;
      return {
        then: () => {
          calls++;
        },
      };
    },
  };
  const payload = {
    t: { t: 12, i: 0, s: 1, f: { t: 25, i: 1, c: 'fixture-thenable', s: {} } },
    f: 127,
    m: [],
  };
  expect(() => fromJSON(payload, { plugins: [plugin] })).toThrow();
  await new Promise((resolve) => setImmediate(resolve));
  expect(calls).toBe(0);
  expect(deserializations).toBe(1);
});

test('patched formatter worker pool executes jobs and disposes workers', async () => {
  const { default: Tinypool } = await import(
    pathToFileURL(dependency('oxfmt').resolve('tinypool')).href
  );
  const pool = new Tinypool({
    filename: new URL('./helpers/dependency-worker.mjs', import.meta.url).href,
    minThreads: 1,
    maxThreads: 1,
  });
  try {
    expect(await pool.run({ a: 4, b: 6 })).toBe(10);
    expect(await pool.run({ a: 1, b: 2 })).toBe(3);
  } finally {
    await pool.destroy();
  }
});

test('patched serve compression preserves HTTP content and gzip negotiation', async () => {
  const serveRequire = createRequire(
    path.join(
      path.dirname(require.resolve('serve/package.json')),
      'build/main.js',
    ),
  );
  const compression = serveRequire('compression');
  const middleware = compression();
  const body = 'fixture compression content\n'.repeat(1024);
  const server = createServer((request, response) =>
    middleware(request, response, () => {
      response.setHeader('Content-Type', 'text/plain');
      response.end(body);
    }),
  );
  server.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}/`;
    const compressed = await fetch(url, {
      headers: { 'Accept-Encoding': 'gzip' },
    });
    expect(compressed.headers.get('content-encoding')).toBe('gzip');
    expect(await compressed.text()).toBe(body);
    const plain = await fetch(url, {
      headers: { 'Accept-Encoding': 'identity' },
    });
    expect(plain.headers.get('content-encoding')).toBeNull();
    expect(await plain.text()).toBe(body);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
