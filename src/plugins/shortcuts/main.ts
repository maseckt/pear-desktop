import { type BrowserWindow, globalShortcut } from 'electron';
import is from 'electron-is';
import { register, unregister } from 'electron-localshortcut';

import { getSongControls } from '@/providers/song-controls';
import { MediaType, registerCallback } from '@/providers/song-info';

import { registerMPRIS } from './mpris';
import { seekSeconds } from './seek';

import type { ShortcutMappingType, ShortcutsPluginConfig } from './index';
import type { BackendContext } from '@/types/contexts';

let window: BrowserWindow | undefined;
let current: ShortcutsPluginConfig;
let isPodcast = false;
let observing = false;
const globals = new Set<string>();
const locals = new Set<string>();

export function unregisterShortcuts() {
  for (const key of globals) globalShortcut.unregister(key);
  if (window && !window.isDestroyed()) {
    for (const key of locals) unregister(window, key);
  }
  globals.clear();
  locals.clear();
}

export function onConfigChange(config: ShortcutsPluginConfig) {
  unregisterShortcuts();
  current = config;
  if (!window || window.isDestroyed() || !config.enabled) return;
  const controls = getSongControls(window);
  const actions: Record<keyof ShortcutMappingType, () => void> = {
    previous: controls.previous,
    playPause: controls.playPause,
    next: controls.next,
    seekForward: () =>
      controls.goForward(
        seekSeconds(
          isPodcast
            ? current.podcastSeekForwardSeconds
            : current.seekForwardSeconds,
          isPodcast ? 10 : 5,
        ),
      ),
    seekBackward: () =>
      controls.goBack(
        seekSeconds(
          isPodcast
            ? current.podcastSeekBackwardSeconds
            : current.seekBackwardSeconds,
          isPodcast ? 30 : 5,
        ),
      ),
  };
  const bind = (
    type: 'global' | 'local',
    key: unknown,
    callback: () => void,
  ) => {
    if (typeof key !== 'string' || !key || key.length > 100) return;
    const owned = type === 'global' ? globals : locals;
    if (owned.has(key)) return;
    try {
      if (type === 'global') {
        if (globalShortcut.register(key, callback)) owned.add(key);
      } else {
        register(window!, key, callback);
        owned.add(key);
      }
    } catch (error) {
      console.warn('Invalid shortcut', key, error);
    }
  };
  if (config.overrideMediaKeys) {
    bind('global', 'MediaPlayPause', controls.playPause);
    bind('global', 'MediaNextTrack', controls.next);
    bind('global', 'MediaPreviousTrack', controls.previous);
  }
  for (const type of ['global', 'local'] as const) {
    for (const action of Object.keys(
      actions,
    ) as (keyof ShortcutMappingType)[]) {
      bind(type, config[type]?.[action], actions[action]);
    }
  }
}

export const onMainLoad = async (
  ctx: BackendContext<ShortcutsPluginConfig>,
) => {
  window = ctx.window;
  if (!observing) {
    registerCallback((song) => {
      isPodcast = song.mediaType === MediaType.PodcastEpisode;
    });
    observing = true;
  }
  if (is.linux()) registerMPRIS(window);
  onConfigChange(await ctx.getConfig());
};
