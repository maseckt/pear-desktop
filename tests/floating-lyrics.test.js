import {
  readFile,
  readdir,
  mkdir,
  writeFile,
  copyFile,
} from 'node:fs/promises';
import path from 'node:path';

import { test, expect, _electron as electron } from '@playwright/test';
import { build } from 'vite';

import { modulePath } from './helpers/module-path.js';

const root = path.resolve(import.meta.dirname, '..');

test('floating lyrics window supports native/synced text, controls, resize, security and cleanup in Electron', async ({}, testInfo) => {
  const directory = testInfo.outputPath('fixture');
  const mocks = {
    name: 'floating-lyrics-mocks',
    enforce: 'pre',
    resolveId(id) {
      if (id === './window.html?asset') return '\0floating-window-file';
      if (['@/i18n', '@/utils', '@/providers/song-info-front'].includes(id))
        return `\0${id}`;
      if (modulePath(id).endsWith('/floating-fixture'))
        return '\0floating-fixture';
    },
    load(id) {
      if (id === '\0floating-window-file')
        return `export default ${JSON.stringify(path.join(directory, 'main/window.html'))};`;
      if (id === '\0@/utils')
        return 'export const createBackend = value => value; export const createRenderer = value => value;';
      if (id === '\0@/i18n')
        return `export const t = key => ({name:'Floating Lyrics',loading:'Loading lyrics…',empty:'No lyrics',noTrack:'No track',volume:'Volume',play:'Play',pause:'Pause',previous:'Previous',next:'Next',follow:'Follow'})[key.split('.').at(-1)] || key;`;
      if (id === '\0@/providers/song-info-front')
        return 'export const getSongInfo = () => window.fixtureSongInfo;';
      if (id === '\0floating-fixture')
        return `
        export {renderer} from ${JSON.stringify(modulePath(path.join(root, 'src/plugins/lyrics-pip/renderer.ts')))};
        export {publishLyricsView} from ${JSON.stringify(modulePath(path.join(root, 'src/providers/lyrics-view.ts')))};
        export {default as stylesheet} from ${JSON.stringify(modulePath(path.join(root, 'src/plugins/synced-lyrics/style.css')) + '?inline')};
      `;
    },
  };
  const common = {
    configFile: false,
    logLevel: 'error',
    resolve: {
      alias: [
        ...['@/i18n', '@/utils', '@/providers/song-info-front'].map((find) => ({
          find,
          replacement: `\0${find}`,
        })),
        { find: '@', replacement: path.join(root, 'src') },
      ],
    },
    plugins: [mocks],
  };
  await build({
    ...common,
    build: {
      outDir: path.join(directory, 'main'),
      lib: {
        entry: path.join(root, 'src/plugins/lyrics-pip/backend.ts'),
        formats: ['es'],
        fileName: () => 'backend.mjs',
      },
      rollupOptions: { external: ['electron', 'node:path', 'node:url'] },
    },
  });
  const assetDirectory = path.join(root, 'dist/main/chunks');
  const windowAssets = (await readdir(assetDirectory)).filter((name) =>
    /^window-.*\.html$/.test(name),
  );
  expect(windowAssets).toHaveLength(1);
  const productionWindow = path.join(assetDirectory, windowAssets[0]);
  expect(await readFile(productionWindow, 'utf8')).toBe(
    await readFile(
      path.join(root, 'src/plugins/lyrics-pip/window.html'),
      'utf8',
    ),
  );
  await copyFile(productionWindow, path.join(directory, 'main/window.html'));
  const productionPreload = path.join(root, 'dist/preload/lyrics-pip.cjs');
  const preload = await readFile(productionPreload, 'utf8');
  expect(preload).not.toMatch(/require\(["']\.\.?\//);
  expect(preload).toContain('floatingLyrics');
  await mkdir(path.join(directory, 'preload'), { recursive: true });
  await copyFile(
    productionPreload,
    path.join(directory, 'preload/lyrics-pip.cjs'),
  );
  await build({
    ...common,
    build: {
      outDir: path.join(directory, 'renderer'),
      lib: {
        entry: path.join(root, 'floating-fixture'),
        name: 'floatingFixture',
        formats: ['iife'],
        fileName: () => 'fixture.js',
      },
    },
  });
  await mkdir(directory, { recursive: true });
  const mainPath = path.join(directory, 'main.cjs');
  await writeFile(
    mainPath,
    `
    const {app,BrowserWindow,protocol}=require('electron');
    protocol.registerSchemesAsPrivileged(['http','https'].map(scheme=>({scheme,privileges:{standard:true,bypassCSP:true,allowServiceWorkers:true,supportFetchAPI:true,corsEnabled:true,stream:true,codeCache:true}})));
    app.whenReady().then(async()=>{
      const {backend}=await import('./main/backend.mjs');
      const parent=new BrowserWindow({show:true,webPreferences:{nodeIntegration:true,contextIsolation:false}});
      global.fixtureBackend=backend;global.fixtureParent=parent;
      global.startBackend=()=>backend.start({window:parent});
      global.startBackend();
      await parent.loadURL('data:text/html,'+encodeURIComponent('<style>.right-controls{display:flex;justify-content:flex-end;width:500px}.right-controls-buttons{display:flex;transform:translateX(0)}.right-controls-buttons:has(#volume-button:hover){transform:translateX(-80px)}#volume-button{width:40px;height:40px;margin:0;padding:8px}</style><ytmusic-app></ytmusic-app><ytmusic-player-bar><div class="right-controls"><div id="reserved-slider" style="width:80px"></div><div class="right-controls-buttons"><button id="volume-button">Volume</button></div></div></ytmusic-player-bar><div id="native-source">Main page unchanged</div>'));
    });
    app.on('window-all-closed',()=>app.quit());
  `,
  );
  const app = await electron.launch({
    args: [
      mainPath,
      '--no-sandbox',
      '--disable-gpu',
      `--user-data-dir=${testInfo.outputPath('profile')}`,
    ],
  });
  try {
    const page = await app.firstWindow();
    await page.evaluate(
      await readFile(path.join(directory, 'renderer/fixture.js'), 'utf8'),
    );
    await page.evaluate(() => {
      const { ipcRenderer } = window.require('electron');
      window.fixtureSongInfo = {
        videoId: 'song',
        title: 'Track',
        artist: 'Artist',
      };
      document.documentElement.style.fontSize = '10px';
      document.documentElement.style.fontFamily = 'Roboto, Arial, sans-serif';
      document.documentElement.style.setProperty('--lyrics-font-size', '3rem');
      document.documentElement.style.setProperty(
        '--ytmusic-text-primary',
        '#ffffff',
      );
      document.documentElement.style.setProperty(
        '--ytmusic-text-secondary',
        '#aaaaaa',
      );
      window.playerData = { id: 'song', time: 1.5, volume: 50, state: 1 };
      window.commands = [];
      const listeners = new Set();
      window.fixturePlayer = {
        getVideoData: () => ({
          video_id: window.playerData.id,
          title: 'Track',
          author: 'Artist',
        }),
        getCurrentTime: () => window.playerData.time,
        getVolume: () => window.playerData.volume,
        isMuted: () => false,
        getPlayerState: () => window.playerData.state,
        addEventListener: (_event, listener) => listeners.add(listener),
        removeEventListener: (_event, listener) => listeners.delete(listener),
      };
      window.changeTrack = (id) => {
        window.playerData.id = id;
        for (const listener of listeners) listener();
      };
      window.listenerCount = () => listeners.size;
      window.fixtureIpc = {
        invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
        on: (channel, callback) => {
          const listener = (_event, value) => callback(value);
          ipcRenderer.on(channel, listener);
          return () => ipcRenderer.removeListener(channel, listener);
        },
      };
      for (const channel of [
        'peard:previous-video',
        'peard:next-video',
        'peard:toggle-play',
        'peard:update-volume',
      ])
        ipcRenderer.on(channel, (_event, value) => {
          window.commands.push([channel, value]);
          if (channel === 'peard:toggle-play')
            window.playerData.state = window.playerData.state === 1 ? 2 : 1;
          if (channel === 'peard:update-volume')
            window.playerData.volume = value;
        });
      window.nativeCalls = [];
      document.querySelector('ytmusic-app').networkManager = {
        fetch: async (url, data) => {
          window.nativeCalls.push({ url, data });
          if (url.startsWith('/next'))
            return {
              contents: {
                singleColumnMusicWatchNextResultsRenderer: {
                  tabbedRenderer: {
                    watchNextTabbedResultsRenderer: {
                      tabs: [
                        {
                          tabRenderer: {
                            endpoint: {
                              browseEndpoint: {
                                browseId: data.videoId,
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
          return {
            contents: {
              sectionListRenderer: {
                contents: [
                  {
                    musicDescriptionShelfRenderer: {
                      description: {
                        runs: [
                          {
                            text: 'Native YouTube lyrics for ' + data.browseId,
                          },
                        ],
                      },
                    },
                  },
                ],
              },
            },
          };
        },
      };
      floatingFixture.renderer.start({ ipc: window.fixtureIpc });
      floatingFixture.renderer.onPlayerApiReady(window.fixturePlayer);
    });
    await expect(
      page.locator('.right-controls-buttons > #floating-lyrics-button'),
    ).toHaveCount(1);
    const geometry = () =>
      page.evaluate(() => {
        const lyrics = document
          .querySelector('#floating-lyrics-button')
          .getBoundingClientRect();
        const volume = document
          .querySelector('#volume-button')
          .getBoundingClientRect();
        return {
          lyrics: lyrics.x,
          volume: volume.x,
          gap: volume.x - lyrics.right,
        };
      });
    const collapsed = await geometry();
    expect(collapsed.gap).toBe(0);
    await page.locator('#volume-button').hover();
    await expect
      .poll(async () => (await geometry()).lyrics)
      .toBe(collapsed.lyrics - 80);
    const expanded = await geometry();
    expect(expanded.volume).toBe(collapsed.volume - 80);
    expect(expanded.gap).toBe(collapsed.gap);
    const opening = app.waitForEvent('window');
    await page.locator('#floating-lyrics-button').click();
    const popup = await opening;
    await expect(popup.locator('#plain')).toHaveText(
      'Native YouTube lyrics for song',
    );
    await expect(popup.locator('#title')).toHaveText('Track');
    await expect(popup.locator('#artist')).toHaveText('Artist');
    expect(
      await popup.evaluate(() => [
        typeof window.require,
        Object.keys(window.floatingLyrics).sort(),
      ]),
    ).toEqual(['undefined', ['command', 'onState']]);
    const initialBounds = await app.evaluate(({ BrowserWindow }) => {
      const child = BrowserWindow.getAllWindows().find(
        (win) => win.getTitle() === 'Floating Lyrics',
      );
      const top = child.isAlwaysOnTop();
      child.setSize(600, 400);
      return { top, size: child.getSize() };
    });
    expect(initialBounds).toEqual({ top: true, size: [600, 400] });
    await popup.locator('#next').click();
    await popup.locator('#previous').click();
    await popup.locator('#play').click();
    await expect(popup.locator('#play')).toHaveAttribute('aria-label', 'Play');
    await popup.locator('#volume').fill('75');
    await expect
      .poll(() => page.evaluate(() => window.playerData.volume))
      .toBe(75);
    expect(
      await page.evaluate(() => window.commands.map((item) => item[0])),
    ).toEqual([
      'peard:next-video',
      'peard:previous-video',
      'peard:toggle-play',
      'peard:update-volume',
    ]);

    // Optional producer replaces the fallback without provider imports or moving
    // main-page nodes. Malicious-looking lyrics remain plain text, never HTML.
    await page.evaluate(() =>
      floatingFixture.publishLyricsView({
        videoId: 'song',
        state: 'ready',
        text: '',
        stylesheet: floatingFixture.stylesheet,
        lines: [
          {
            text: '<img src=x onerror="window.injected=1">',
            startMs: 1000,
            endMs: 2000,
          },
          { text: 'Second synced line', startMs: 2000, endMs: 4000 },
        ],
      }),
    );
    await expect(popup.locator('.line.active')).toHaveText(
      '<img src=x onerror="window.injected=1">',
    );
    expect(await popup.locator('#source-style').textContent()).toBe(
      await page.evaluate(() => floatingFixture.stylesheet),
    );
    expect(
      await popup
        .locator('.line.active .text-lyrics')
        .evaluate((element) => getComputedStyle(element).fontSize),
    ).toBe('30px');
    expect(
      await popup
        .locator('footer button#next')
        .evaluate((element) => getComputedStyle(element).borderWidth),
    ).toBe('0px');
    await popup.screenshot({
      path: testInfo.outputPath('floating-lyrics-design.png'),
    });
    expect(await popup.locator('img').count()).toBe(0);
    await page.evaluate(() => {
      window.playerData.time = 2.5;
    });
    await expect(popup.locator('.line.active')).toHaveText(
      'Second synced line',
    );
    await expect(page.locator('#native-source')).toHaveText(
      'Main page unchanged',
    );
    await page.evaluate(() =>
      floatingFixture.publishLyricsView({
        videoId: 'song',
        state: 'ready',
        text: 'New selected source',
        lines: [],
      }),
    );
    await expect(popup.locator('#plain')).toHaveText('New selected source');
    await popup.locator('#follow').click();
    await expect(popup.locator('#follow')).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    // Parent cannot impersonate the child command channel; invalid child values
    // and generic bridge calls cannot drive arbitrary IPC.
    const count = await page.evaluate(() => window.commands.length);
    await page.evaluate(() =>
      window.require('electron').ipcRenderer.send('lyrics-pip:command', 'next'),
    );
    await popup.evaluate(() => {
      window.floatingLyrics.command('volume', 999);
      window.floatingLyrics.command('untrusted-channel');
    });
    await expect
      .poll(() => page.evaluate(() => window.commands.length))
      .toBe(count);
    const attempts = await popup.evaluate(() => {
      window.open('https://fixture.invalid/');
      return typeof window.injected;
    });
    expect(attempts).toBe('undefined');
    expect(app.windows()).toHaveLength(2);

    // Track identity prevents old selected lyrics remaining visible; disabling
    // the optional producer switches back to the current track's native text.
    await page.evaluate(() => window.changeTrack('new-song'));
    await expect(popup.locator('#plain')).toBeEmpty();
    await expect(popup.locator('#status')).toHaveText('Loading lyrics…');
    await page.evaluate(() => floatingFixture.publishLyricsView(null));
    await expect(popup.locator('#plain')).toHaveText(
      'Native YouTube lyrics for new-song',
    );
    await page.locator('#floating-lyrics-button').click();
    await expect.poll(() => app.windows().length).toBe(1);
    expect(
      await app.evaluate(() =>
        global.fixtureParent.webContents.getBackgroundThrottling(),
      ),
    ).toBe(true);
    await page.evaluate(() => floatingFixture.renderer.stop());
    await expect(page.locator('#floating-lyrics-button')).toHaveCount(0);
    expect(await page.evaluate(() => window.listenerCount())).toBe(0);
    await app.evaluate(() => {
      global.fixtureBackend.stop();
      global.startBackend();
    });
    await page.evaluate(() => {
      floatingFixture.renderer.start({ ipc: window.fixtureIpc });
      floatingFixture.renderer.onPlayerApiReady(window.fixturePlayer);
    });
    await expect(page.locator('#floating-lyrics-button')).toHaveCount(1);
    const reopen = app.waitForEvent('window');
    await page.locator('#floating-lyrics-button').click();
    const reopened = await reopen;
    await expect(reopened.locator('#plain')).toHaveText(
      'Native YouTube lyrics for new-song',
    );
    await app.evaluate(() => global.fixtureBackend.stop());
    await expect.poll(() => app.windows().length).toBe(1);
    await page.evaluate(() => floatingFixture.renderer.stop());
    expect(
      await app.evaluate(({ ipcMain }) =>
        ipcMain.listenerCount('lyrics-pip:command'),
      ),
    ).toBe(0);
  } finally {
    await app.close();
  }
});
