import { t } from '@/i18n';
import {
  getLyricsView,
  subscribeLyricsView,
  type LyricsView,
} from '@/providers/lyrics-view';
import { getSongInfo } from '@/providers/song-info-front';
import { createRenderer } from '@/utils';

import { loadNativeLyrics } from './native-lyrics';
import { channels, themeKeys, type PipSnapshot } from './types';

import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';
import type { MusicPlayerAppElement } from '@/types/music-player-app-element';
import type { PluginConfig } from '@/types/plugins';

export const renderer = createRenderer({
  cleanup: undefined as (() => void) | undefined,
  attachPlayer: undefined as ((api: MusicPlayer) => void) | undefined,
  start(ctx: RendererContext<PluginConfig>) {
    this.cleanup?.();
    let player: MusicPlayer | undefined;
    let detachPlayer: (() => void) | undefined;
    let open = false;
    let stopped = false;
    let pendingToggle = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let native: LyricsView | undefined;
    let request: AbortController | undefined;
    let trackId = '';
    const button = document.createElement('button');
    button.id = 'floating-lyrics-button';
    button.type = 'button';
    button.title = t('plugins.lyrics-pip.open');
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', 'false');
    button.className = 'style-scope ytmusic-player-bar';
    button.style.cssText =
      'background:transparent;border:0;color:inherit;width:40px;height:40px;margin:0;padding:8px;cursor:pointer;flex-shrink:0;border-radius:50%';
    // Static icon only; track/provider data is never inserted as HTML.
    button.innerHTML =
      '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M6 8h9M6 11h6"/><rect x="12" y="12" width="7" height="6" rx="1"/></svg>';
    button.disabled = true;
    const mount = () => {
      const controls = document.querySelector(
        'ytmusic-player-bar .right-controls-buttons',
      );
      if (controls && button.parentElement !== controls)
        controls.prepend(button);
    };
    const observer = new MutationObserver(mount);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    mount();
    const emptyView = (state: 'loading' | 'empty'): LyricsView => ({
      videoId: trackId,
      state,
      text: '',
      lines: [],
    });
    const syncTrack = () => {
      const id = player?.getVideoData()?.video_id ?? '';
      if (trackId === id) return;
      trackId = id;
      request?.abort();
      request = undefined;
      native = undefined;
    };
    const snapshot = (): PipSnapshot => {
      syncTrack();
      const info = getSongInfo();
      const data = player?.getVideoData();
      const synced = getLyricsView();
      const rootStyle = getComputedStyle(document.documentElement);
      const bodyStyle = getComputedStyle(
        document.querySelector('ytmusic-player-bar') ??
          document.documentElement,
      );
      const nativeElement = document.querySelector(
        'ytmusic-description-shelf-renderer .description',
      );
      const nativeStyle = nativeElement
        ? getComputedStyle(nativeElement)
        : undefined;
      const theme = Object.fromEntries(
        themeKeys.flatMap((key) => {
          const value =
            key === '--floating-root-font-size'
              ? rootStyle.fontSize
              : key === '--floating-font-family'
                ? bodyStyle.fontFamily
                : key === '--floating-plain-font-size'
                  ? (nativeStyle?.fontSize ?? '16px')
                  : rootStyle.getPropertyValue(key).trim();
          return value ? [[key, value]] : [];
        }),
      );
      return {
        theme,
        videoId: trackId,
        title: info?.videoId === trackId ? info.title : (data?.title ?? ''),
        artist: info?.videoId === trackId ? info.artist : (data?.author ?? ''),
        paused: player?.getPlayerState() !== 1,
        volume: player?.isMuted()
          ? 0
          : Math.max(0, Math.min(100, player?.getVolume() ?? 0)),
        timeMs: Math.max(0, (player?.getCurrentTime() ?? 0) * 1000),
        lyrics: synced
          ? synced.videoId === trackId
            ? synced
            : emptyView('loading')
          : (native ?? emptyView(trackId ? 'loading' : 'empty')),
      };
    };
    const update = () => {
      if (!open || stopped || !player) return;
      const state = snapshot();
      ctx.ipc.invoke(channels.update, state).catch((error: unknown) => {
        if (!stopped) console.error('Floating lyrics update failed', error);
      });
      if (getLyricsView()) {
        request?.abort();
        request = undefined;
        return;
      }
      if (!trackId || native || request) return;
      const active = new AbortController();
      request = active;
      const id = trackId;
      const app = document.querySelector<MusicPlayerAppElement>('ytmusic-app');
      if (!app?.networkManager) {
        native = emptyView('empty');
        request = undefined;
        return;
      }
      loadNativeLyrics(app, id, active.signal)
        .then((view) => {
          if (
            stopped ||
            !open ||
            active.signal.aborted ||
            request !== active ||
            trackId !== id ||
            getLyricsView()
          )
            return;
          native = view;
          request = undefined;
          update();
        })
        .catch(() => {
          if (
            stopped ||
            !open ||
            active.signal.aborted ||
            request !== active ||
            trackId !== id
          )
            return;
          native = emptyView('empty');
          request = undefined;
          update();
        });
    };
    const clicked = async () => {
      if (stopped || !player || pendingToggle) return;
      pendingToggle = true;
      try {
        await ctx.ipc.invoke(channels.toggle, snapshot());
      } catch (error) {
        if (!stopped) console.error('Floating lyrics toggle failed', error);
      } finally {
        pendingToggle = false;
      }
    };
    button.addEventListener('click', clicked);
    const disposeOpen = ctx.ipc.on(channels.opened, (value: boolean) => {
      if (stopped) return;
      open = value;
      button.setAttribute('aria-pressed', String(open));
      clearInterval(timer);
      timer = undefined;
      if (open) {
        update();
        timer = setInterval(update, 250);
      } else {
        request?.abort();
        request = undefined;
        native = undefined;
      }
    });
    const disposeLyrics = subscribeLyricsView(() => update());
    this.attachPlayer = (api) => {
      detachPlayer?.();
      player = api;
      button.disabled = false;
      const changed = () => {
        syncTrack();
        update();
      };
      api.addEventListener('videodatachange', changed);
      detachPlayer = () => api.removeEventListener('videodatachange', changed);
      changed();
    };
    this.cleanup = () => {
      stopped = true;
      open = false;
      clearInterval(timer);
      request?.abort();
      observer.disconnect();
      button.removeEventListener('click', clicked);
      button.remove();
      disposeOpen();
      disposeLyrics();
      detachPlayer?.();
      player = undefined;
      this.attachPlayer = undefined;
    };
  },
  onPlayerApiReady(api: MusicPlayer) {
    this.attachPlayer?.(api);
  },
  stop() {
    this.cleanup?.();
    this.cleanup = undefined;
  },
});
