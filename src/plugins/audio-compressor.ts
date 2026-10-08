import { t } from '@/i18n';
import { latestAudioGraph } from '@/plugins/utils/renderer/audio-graph';
import { trackGainDb } from '@/plugins/utils/renderer/track-gain';
import { type MusicPlayer } from '@/types/music-player';
import { createPlugin } from '@/utils';

type AudioCompressorConfig = {
  enabled: boolean;
  autoTrackGain: boolean;
  maxTrackGainDb: number;
};
let currentConfig: AudioCompressorConfig = {
  enabled: false,
  autoTrackGain: false,
  maxTrackGainDb: 12,
};
let player: MusicPlayer | null = null;
let enabled = false;
let generation = 0;

const lazySafeTry = (...fns: (() => void)[]) => {
  for (const fn of fns) {
    try {
      fn();
    } catch {}
  }
};

const createCompressorNode = (
  audioContext: AudioContext,
): DynamicsCompressorNode => {
  const compressor = audioContext.createDynamicsCompressor();

  compressor.threshold.value = -50;
  compressor.ratio.value = 12;
  compressor.knee.value = 40;
  compressor.attack.value = 0;
  compressor.release.value = 0.25;

  return compressor;
};

class Storage {
  lastSource: MediaElementAudioSourceNode | null = null;
  lastContext: AudioContext | null = null;
  lastCompressor: DynamicsCompressorNode | null = null;
  lastGain: GainNode | null = null;

  connected: WeakMap<MediaElementAudioSourceNode, DynamicsCompressorNode> =
    new WeakMap();

  connectToCompressor = (
    source: MediaElementAudioSourceNode | null = null,
    audioContext: AudioContext | null = null,
    compressor: DynamicsCompressorNode | null = null,
  ): boolean => {
    if (!(source && audioContext && compressor)) return false;

    const current = this.connected.get(source);
    if (current === compressor) return false;

    this.lastSource = source;
    this.lastContext = audioContext;
    this.lastCompressor = compressor;

    if (current) {
      lazySafeTry(
        () => source.disconnect(current),
        () => current.disconnect(),
        () => this.lastGain?.disconnect(),
      );
    } else {
      lazySafeTry(() => source.disconnect(audioContext.destination));
    }

    try {
      source.connect(compressor);
      const gain = audioContext.createGain();
      gain.gain.value = 1;
      compressor.connect(gain);
      gain.connect(audioContext.destination);
      this.lastGain = gain;
      this.connected.set(source, compressor);
      return true;
    } catch (error) {
      console.error('connectToCompressor failed', error);
      return false;
    }
  };

  disconnectCompressor = (): boolean => {
    const source = this.lastSource;
    const audioContext = this.lastContext;
    if (!(source && audioContext)) return false;
    const current = this.connected.get(source);
    if (!current) return false;

    lazySafeTry(
      () => source.connect(audioContext.destination),
      () => source.disconnect(current),
      () => current.disconnect(),
      () => this.lastGain?.disconnect(),
    );
    this.connected.delete(source);
    return true;
  };
}

const storage = new Storage();

const resetTrackGain = () => {
  const gain = storage.lastGain?.gain;
  const context = storage.lastContext;
  if (!gain || !context) return;
  gain.cancelScheduledValues(context.currentTime);
  gain.setValueAtTime(1, context.currentTime);
};

const updateTrackGain = () => {
  if (!enabled || !storage.lastGain || !storage.lastContext) return;
  let loudness: unknown;
  try {
    const response = player?.getPlayerResponse() as unknown as {
      playerConfig?: {
        audioConfig?: { loudnessDb?: number; perceptualLoudnessDb?: number };
      };
    };
    loudness =
      response?.playerConfig?.audioConfig?.loudnessDb ??
      response?.playerConfig?.audioConfig?.perceptualLoudnessDb;
  } catch {
    loudness = undefined;
  }
  const db = currentConfig.autoTrackGain
    ? trackGainDb(loudness, currentConfig.maxTrackGainDb)
    : 0;
  const parameter = storage.lastGain.gain;
  const now = storage.lastContext.currentTime;
  parameter.cancelScheduledValues(now);
  parameter.setTargetAtTime(10 ** (db / 20), now, 0.1);
};

const audioCanPlayHandler = ({
  detail: { audioSource, audioContext },
}: CustomEvent<Compressor>) => {
  storage.connectToCompressor(
    audioSource,
    audioContext,
    createCompressorNode(audioContext),
  );
  updateTrackGain();
};

const ensureAudioContextLoad = (playerApi: MusicPlayer) => {
  if (playerApi.getPlayerState() !== 1 || storage.lastContext) return;

  playerApi.loadVideoById(
    playerApi.getPlayerResponse().videoDetails.videoId,
    playerApi.getCurrentTime(),
    playerApi.getUserPlaybackQualityPreference(),
  );
};

export default createPlugin({
  name: () => t('plugins.audio-compressor.name'),
  description: () => t('plugins.audio-compressor.description'),
  restartNeeded: false,
  config: {
    enabled: false,
    autoTrackGain: false,
    maxTrackGainDb: 12,
  } as AudioCompressorConfig,
  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();
    return [
      {
        label: t('plugins.audio-compressor.menu.auto-track-gain'),
        type: 'checkbox',
        checked: config.autoTrackGain,
        click: (item) => setConfig({ autoTrackGain: item.checked }),
      },
      {
        label: t('plugins.audio-compressor.menu.maximum-gain'),
        submenu: [6, 9, 12, 15, 18, 24].map((db) => ({
          label: `${db} dB`,
          type: 'radio' as const,
          checked: config.maxTrackGainDb === db,
          click: () => setConfig({ maxTrackGainDb: db }),
        })),
      },
    ];
  },

  renderer: {
    onPlayerApiReady(playerApi) {
      player = playerApi;
      ensureAudioContextLoad(playerApi);
      updateTrackGain();
    },

    async start({ getConfig }) {
      const session = ++generation;
      const loaded = await getConfig();
      if (session !== generation) return;
      currentConfig = loaded;
      enabled = true;
      const shared = latestAudioGraph();
      if (shared && shared.audioContext.state !== 'closed') {
        storage.connectToCompressor(
          shared.audioSource,
          shared.audioContext,
          createCompressorNode(shared.audioContext),
        );
      }
      document.addEventListener('peard:audio-can-play', audioCanPlayHandler, {
        passive: true,
      });
      storage.connectToCompressor(
        storage.lastSource,
        storage.lastContext,
        storage.lastCompressor,
      );
      document.addEventListener('loadstart', resetTrackGain, true);
      document.addEventListener('loadeddata', updateTrackGain, true);
      updateTrackGain();
    },

    onConfigChange(config: AudioCompressorConfig) {
      currentConfig = config;
      updateTrackGain();
    },

    stop() {
      ++generation;
      enabled = false;
      document.removeEventListener('loadstart', resetTrackGain, true);
      document.removeEventListener('loadeddata', updateTrackGain, true);
      document.removeEventListener('peard:audio-can-play', audioCanPlayHandler);
      storage.disconnectCompressor();
    },
  },
});
