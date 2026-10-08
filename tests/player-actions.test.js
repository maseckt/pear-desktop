import path from 'node:path';
import process from 'node:process';

import { test, expect, _electron as electron } from '@playwright/test';
import { build } from 'vite';

import { modulePath } from './helpers/module-path.js';

const root = path.resolve(import.meta.dirname, '..');
let bundle;

test.beforeAll(async ({}, testInfo) => {
  const output = testInfo.outputPath('fixture');
  await build({
    configFile: false,
    logLevel: 'error',
    resolve: { alias: { '@': path.join(root, 'src') } },
    plugins: [
      {
        name: 'player-actions-fixture',
        enforce: 'pre',
        resolveId(id) {
          id = modulePath(id);
          if (id === 'fixture' || id === modulePath(path.join(root, 'fixture')))
            return '\0fixture';
          if (id === '@/i18n' || id === modulePath(path.join(root, 'src/i18n')))
            return '\0translations';
          if (
            id === '@/utils' ||
            id === modulePath(path.join(root, 'src/utils'))
          )
            return '\0plugin';
        },
        load(id) {
          if (id === '\0translations')
            return `export const t=(key)=>key.split('.').at(-1);`;
          if (id === '\0plugin')
            return `export const createPlugin=(plugin)=>plugin;`;
          if (id !== '\0fixture') return;
          return `
          import plugin from ${JSON.stringify(modulePath(path.join(root, 'src/plugins/player-actions/index.ts')))};
          import compressor from ${JSON.stringify(modulePath(path.join(root, 'src/plugins/audio-compressor.ts')))};
          import {rememberAudioGraph} from ${JSON.stringify(modulePath(path.join(root, 'src/plugins/utils/renderer/audio-graph.ts')))};
          const video=document.querySelector('video');
          Object.defineProperties(video,{duration:{value:200,configurable:true},paused:{value:false,configurable:true},currentTime:{value:0,writable:true,configurable:true}});
          const audioContext=new AudioContext();
          const audioSource=audioContext.createMediaElementSource(video);
          audioSource.connect(audioContext.destination);
          rememberAudioGraph({audioContext,audioSource});
          let track='abcdefghijk';let loudness=-20;let saved=[];const seeks=[];const gains=[];
          const original=audioContext.createGain.bind(audioContext);
          audioContext.createGain=()=>{const node=original();const set=node.gain.setTargetAtTime.bind(node.gain);node.gain.setTargetAtTime=(value,...args)=>{gains.push(value);return set(value,...args)};return node};
          const api={getVideoData:()=>({video_id:track}),seekTo:(time)=>{seeks.push(time);video.currentTime=time},getPlayerState:()=>1,getPlayerResponse:()=>({playerConfig:{audioConfig:{loudnessDb:loudness}}}),loadVideoById:()=>{}};
          let config={enabled:true,slow:1,reverb:0,saved:[]};
          const context={getConfig:async()=>({...config}),setConfig:async(patch)=>{config={...config,...patch};saved=config.saved;plugin.renderer.onConfigChange(config)}};
          window.fixture={
            async start(){await plugin.renderer.start(context);plugin.renderer.onPlayerApiReady(api)},
            time(value){video.currentTime=value;video.dispatchEvent(new Event('timeupdate'))},
            track(value){track=value;video.currentTime=0;video.dispatchEvent(new Event('loadedmetadata'))},
            snapshot(){return {seeks:[...seeks],saved,rate:video.playbackRate,pitch:video.preservesPitch,panels:document.querySelectorAll('.pearum-player-actions').length,gains:[...gains]}},
            stop(){plugin.renderer.stop()},
            async compressor(){await compressor.renderer.start({getConfig:async()=>({enabled:true,autoTrackGain:true,maxTrackGainDb:12})});compressor.renderer.onPlayerApiReady(api)},
            badGain(){loudness=Infinity;compressor.renderer.onConfigChange({enabled:true,autoTrackGain:true,maxTrackGainDb:10000})},
            stopCompressor(){compressor.renderer.stop()},
            async lateStart(){let resolve;const wait=new Promise(r=>resolve=r);const pending=plugin.renderer.start({...context,getConfig:()=>wait});plugin.renderer.stop();resolve(config);await pending;plugin.renderer.onPlayerApiReady(api)},
          };
        `;
        },
      },
    ],
    build: {
      outDir: output,
      emptyOutDir: true,
      lib: {
        entry: 'fixture',
        formats: ['iife'],
        name: 'fixture',
        fileName: () => 'fixture.js',
      },
    },
  });
  bundle = path.join(output, 'fixture.js');
});

test('A–B lifecycle, saved ranges, rate/reverb and gain in real Electron Web Audio', async ({}, testInfo) => {
  const app = await electron.launch({
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      XDG_CONFIG_HOME: testInfo.outputPath('config'),
      XDG_CACHE_HOME: testInfo.outputPath('cache'),
    },
    args: [
      root,
      '--no-sandbox',
      '--disable-gpu',
      `--user-data-dir=${testInfo.outputPath('profile')}`,
    ],
  });
  try {
    const page = await app.firstWindow();
    await page.goto('about:blank');
    await page.setContent('<video></video>');
    await page.addScriptTag({ path: bundle });
    await page.evaluate(() => window.fixture.start());
    expect(await page.evaluate(() => window.fixture.snapshot().panels)).toBe(1);
    await page.evaluate(() => window.fixture.time(10));
    await page.getByRole('button', { name: 'A', exact: true }).click();
    await page.evaluate(() => window.fixture.time(20));
    await page.getByRole('button', { name: 'B', exact: true }).click();
    await page.getByRole('button', { name: 'save', exact: true }).click();
    await page.getByRole('button', { name: 'repeat', exact: true }).click();
    await page.evaluate(() => window.fixture.time(21));
    expect(await page.evaluate(() => window.fixture.snapshot().seeks)).toEqual([
      10, 10,
    ]);
    expect(await page.evaluate(() => window.fixture.snapshot().saved)).toEqual([
      { videoId: 'abcdefghijk', start: 10, end: 20 },
    ]);
    await page.locator('input[type=range]').first().fill('0.8');
    expect(
      await page.evaluate(() => window.fixture.snapshot().rate),
    ).toBeCloseTo(0.8);
    expect(await page.evaluate(() => window.fixture.snapshot().pitch)).toBe(
      false,
    );
    await page.locator('input[type=range]').last().fill('0.5');
    await page.evaluate(() => window.fixture.compressor());
    expect(
      await page.evaluate(() => window.fixture.snapshot().gains.at(-1)),
    ).toBeCloseTo(10 ** (12 / 20));
    await page.evaluate(() => window.fixture.badGain());
    expect(
      await page.evaluate(() => window.fixture.snapshot().gains.at(-1)),
    ).toBe(1);
    await page.evaluate(() => window.fixture.track('lmnopqrstuv'));
    await page.evaluate(() => window.fixture.time(100));
    expect(
      await page.evaluate(() => window.fixture.snapshot().seeks),
    ).toHaveLength(2);
    await page.evaluate(() => {
      window.fixture.stopCompressor();
      window.fixture.stop();
    });
    expect(await page.evaluate(() => window.fixture.snapshot().rate)).toBe(1);
    expect(await page.evaluate(() => window.fixture.snapshot().pitch)).toBe(
      true,
    );
    expect(await page.evaluate(() => window.fixture.snapshot().panels)).toBe(0);
    await page.evaluate(() => window.fixture.lateStart());
    expect(await page.evaluate(() => window.fixture.snapshot().panels)).toBe(0);
  } finally {
    await app.close();
  }
});
