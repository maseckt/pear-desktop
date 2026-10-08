import { t } from '@/i18n';
import { latestAudioGraph } from '@/plugins/utils/renderer/audio-graph';
import {
  claimPlaybackRate,
  releasePlaybackRate,
  isPlaybackRateControlledByOther,
} from '@/plugins/utils/renderer/playback-rate-owner';
import { createPlugin } from '@/utils';

import { savedRanges, validRange, type SavedRange } from './state';
import style from './style.css?inline';

import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';

type Config = {
  enabled: boolean;
  slow: number;
  reverb: number;
  saved: SavedRange[];
};
type Graph = {
  audioContext: AudioContext;
  audioSource: MediaElementAudioSourceNode;
};
let context: RendererContext<Config> | undefined;
let config: Config;
let player: MusicPlayer | undefined;
let panel: HTMLDivElement | undefined;
let media: HTMLVideoElement | null = null;
let graph: Graph | null = null;
let convolver: ConvolverNode | null = null;
let wet: GainNode | null = null;
let previousRate = 1;
let previousPitch = true;
let start: number | null = null;
let end: number | null = null;
let looping = false;
let track = '';
let active = false;
let generation = 0;
const ID = 'player-actions';

function disconnectReverb() {
  try {
    if (convolver) graph?.audioSource.disconnect(convolver);
  } catch {}
  convolver?.disconnect();
  wet?.disconnect();
  convolver = null;
  wet = null;
}

function applyEffects() {
  if (!active || !config) return;
  const rate = Number.isFinite(config.slow)
    ? Math.min(1.3, Math.max(0.7, config.slow))
    : 1;
  if (media && !isPlaybackRateControlledByOther(ID)) {
    media.preservesPitch = rate === 1 ? previousPitch : false;
    media.playbackRate = rate;
  }
  const amount = Number.isFinite(config.reverb)
    ? Math.min(1, Math.max(0, config.reverb))
    : 0;
  if (!amount) {
    disconnectReverb();
    return;
  }
  if (!graph || graph.audioContext.state === 'closed') return;
  if (!convolver) {
    const audio = graph.audioContext;
    if (audio.sampleRate > 192_000) return;
    convolver = audio.createConvolver();
    wet = audio.createGain();
    // Auxiliary wet branch; never disconnect another plugin's dry/equalized route.
    const impulse = audio.createBuffer(
      2,
      Math.floor(audio.sampleRate * 1.5),
      audio.sampleRate,
    );
    for (let channel = 0; channel < 2; channel++) {
      const samples = impulse.getChannelData(channel);
      for (let i = 0; i < samples.length; i++)
        samples[i] = (Math.random() * 2 - 1) * (1 - i / samples.length) ** 3;
    }
    convolver.buffer = impulse;
    graph.audioSource.connect(convolver);
    convolver.connect(wet);
    wet.connect(audio.destination);
  }
  wet!.gain.setTargetAtTime(amount * 0.35, graph.audioContext.currentTime, 0.1);
}

function onAudio(event: Event) {
  const detail = (event as CustomEvent<Graph>).detail;
  if (
    !detail ||
    !(detail.audioContext instanceof AudioContext) ||
    !(detail.audioSource instanceof MediaElementAudioSourceNode)
  )
    return;
  if (graph?.audioSource !== detail.audioSource) disconnectReverb();
  graph = detail;
  applyEffects();
}

function update(event?: Event) {
  if (!active || !player) return;
  const video = document.querySelector<HTMLVideoElement>('video');
  if (media !== video) {
    media = video;
    previousRate = media?.playbackRate ?? 1;
    previousPitch = media?.preservesPitch ?? true;
    applyEffects();
  }
  const id = player.getVideoData()?.video_id;
  if (typeof id !== 'string') return;
  if (id !== track) {
    track = id;
    const saved = savedRanges(config.saved).find(
      (entry) => entry.videoId === track,
    );
    start = saved?.start ?? null;
    end = saved?.end ?? null;
    looping = false;
    const status = panel?.querySelector('output');
    if (status)
      status.textContent =
        start === null ? 'A–B' : `${start.toFixed(1)} – ${end!.toFixed(1)}`;
  }
  if (
    media &&
    looping &&
    (!media.paused || event?.type === 'ended') &&
    !media.seeking &&
    validRange(start, end, media.duration) &&
    media.currentTime >= end!
  ) {
    player.seekTo(start!);
    if (event?.type === 'ended') player.playVideo();
  }
}

function mount() {
  if (panel || !context) return;
  panel = document.createElement('div');
  panel.className = 'pearum-player-actions';
  const output = document.createElement('output');
  output.textContent = 'A–B';
  panel.append(output);
  const button = (label: string, click: () => void) => {
    const element = document.createElement('button');
    element.textContent = label;
    element.onclick = click;
    panel!.append(element);
    return element;
  };
  const display = () => {
    output.textContent = `${start?.toFixed(1) ?? '—'} – ${end?.toFixed(1) ?? '—'}`;
  };
  button('A', () => {
    update();
    start = media?.currentTime ?? null;
    looping = false;
    display();
  });
  button('B', () => {
    update();
    end = media?.currentTime ?? null;
    looping = false;
    display();
  });
  const repeat = button(t('plugins.player-actions.repeat'), () => {
    if (!media || !validRange(start, end, media.duration)) return;
    looping = !looping;
    repeat.setAttribute('aria-pressed', String(looping));
    if (looping) player?.seekTo(start!);
  });
  button(t('plugins.player-actions.save'), () => {
    if (
      !media ||
      !/^[\w-]{11}$/.test(track) ||
      !validRange(start, end, media.duration)
    )
      return;
    const saved = savedRanges(config.saved).filter(
      (entry) => entry.videoId !== track,
    );
    saved.push({ videoId: track, start: start!, end: end! });
    config.saved = saved.slice(-500);
    Promise.resolve(context!.setConfig({ saved: config.saved })).catch(
      console.error,
    );
  });
  button(t('plugins.player-actions.clear'), () => {
    looping = false;
    start = end = null;
    repeat.setAttribute('aria-pressed', 'false');
    config.saved = savedRanges(config.saved).filter(
      (entry) => entry.videoId !== track,
    );
    Promise.resolve(context!.setConfig({ saved: config.saved })).catch(
      console.error,
    );
    display();
  });
  const slider = (
    label: string,
    key: 'slow' | 'reverb',
    min: number,
    max: number,
  ) => {
    const row = document.createElement('label');
    row.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = '0.01';
    input.value = String(config[key]);
    input.oninput = () => {
      config[key] = Number(input.value);
      if (key === 'slow') claimPlaybackRate(ID);
      applyEffects();
    };
    input.onchange = () => {
      Promise.resolve(context!.setConfig({ [key]: config[key] })).catch(
        console.error,
      );
    };
    row.append(input);
    panel!.append(row);
  };
  slider(t('plugins.player-actions.slow'), 'slow', 0.7, 1.3);
  slider(t('plugins.player-actions.reverb'), 'reverb', 0, 1);
  document.body.append(panel);
}

export default createPlugin({
  name: () => t('plugins.player-actions.name'),
  description: () => t('plugins.player-actions.description'),
  config: { enabled: false, slow: 1, reverb: 0, saved: [] } as Config,
  restartNeeded: false,
  stylesheets: [style],
  renderer: {
    async start(ctx) {
      const session = ++generation;
      const loaded = await ctx.getConfig();
      if (session !== generation) return;
      context = ctx;
      config = loaded;
      active = true;
      graph = latestAudioGraph();
      if (config.slow !== 1) claimPlaybackRate(ID);
      document.addEventListener('peard:audio-can-play', onAudio);
      document.addEventListener('timeupdate', update, true);
      document.addEventListener('loadedmetadata', update, true);
      document.addEventListener('ended', update, true);
    },
    onPlayerApiReady(api) {
      player = api;
      graph = latestAudioGraph();
      update();
      mount();
      applyEffects();
    },
    onConfigChange(value: Config) {
      config = value;
      applyEffects();
    },
    stop() {
      ++generation;
      active = false;
      document.removeEventListener('peard:audio-can-play', onAudio);
      document.removeEventListener('timeupdate', update, true);
      document.removeEventListener('loadedmetadata', update, true);
      document.removeEventListener('ended', update, true);
      disconnectReverb();
      if (media) {
        if (!isPlaybackRateControlledByOther(ID))
          media.playbackRate = previousRate;
        media.preservesPitch = previousPitch;
      }
      releasePlaybackRate(ID);
      panel?.remove();
      panel = undefined;
      player = undefined;
      context = undefined;
      media = null;
      graph = null;
      track = '';
      looping = false;
      start = end = null;
    },
  },
});
