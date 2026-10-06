import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { BrowserWindow, ipcMain } from 'electron';

import { t } from '@/i18n';
import { getSongControls } from '@/providers/song-controls';
import { createBackend } from '@/utils';

import { channels, validSnapshot, type PipSnapshot } from './types';
import windowFile from './window.html?asset';

import type { BackendContext } from '@/types/contexts';
import type { PluginConfig } from '@/types/plugins';

export const backend = createBackend({
  cleanup: undefined as (() => void) | undefined,
  start(ctx: BackendContext<PluginConfig>) {
    this.cleanup?.();
    const parent = ctx.window;
    let child: BrowserWindow | undefined;
    let latest: PipSnapshot | undefined;
    let stopped = false;
    let originalThrottling: boolean | undefined;
    const url = pathToFileURL(windowFile).href;
    const labels = () =>
      Object.fromEntries(
        [
          'name',
          'previous',
          'next',
          'play',
          'pause',
          'volume',
          'follow',
          'loading',
          'empty',
          'noTrack',
        ].map((key) => [key, t(`plugins.lyrics-pip.${key}`)]),
      );
    const notify = (open: boolean) => {
      if (!parent.webContents.isDestroyed())
        parent.webContents.send(channels.opened, open);
    };
    const restoreThrottling = () => {
      if (originalThrottling !== undefined && !parent.webContents.isDestroyed())
        parent.webContents.setBackgroundThrottling(originalThrottling);
      originalThrottling = undefined;
    };
    const sendState = () => {
      if (latest && child && !child.isDestroyed())
        child.webContents.send(channels.state, {
          snapshot: latest,
          labels: labels(),
        });
    };
    const isParent = (event: Electron.IpcMainInvokeEvent) =>
      !stopped &&
      event.sender === parent.webContents &&
      event.senderFrame === parent.webContents.mainFrame;
    ipcMain.handle(channels.toggle, async (event, snapshot: unknown) => {
      if (!isParent(event) || !validSnapshot(snapshot)) return false;
      latest = snapshot;
      if (child && !child.isDestroyed()) {
        child.close();
        return false;
      }
      const popup = new BrowserWindow({
        width: 420,
        height: 560,
        minWidth: 280,
        minHeight: 260,
        title: t('plugins.lyrics-pip.name'),
        show: false,
        alwaysOnTop: true,
        resizable: true,
        minimizable: true,
        backgroundColor: '#181818',
        autoHideMenuBar: true,
        webPreferences: {
          preload: path.join(
            import.meta.dirname,
            '..',
            'preload',
            'lyrics-pip.cjs',
          ),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          partition: 'lyrics-pip',
          backgroundThrottling: false,
        },
      });
      child = popup;
      popup.setMenu(null);
      popup.webContents.session.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      );
      popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      popup.webContents.on('will-navigate', (navigation) =>
        navigation.preventDefault(),
      );
      popup.on('closed', () => {
        if (child === popup) {
          child = undefined;
          restoreThrottling();
          notify(false);
        }
      });
      try {
        await popup.loadFile(windowFile);
        if (stopped || child !== popup || popup.isDestroyed()) return false;
        originalThrottling = parent.webContents.getBackgroundThrottling();
        parent.webContents.setBackgroundThrottling(false);
        popup.show();
        sendState();
        notify(true);
        return true;
      } catch (error) {
        if (!popup.isDestroyed()) popup.destroy();
        console.error('Floating lyrics window failed to open', error);
        return false;
      }
    });
    ipcMain.handle(channels.update, (event, snapshot: unknown) => {
      if (
        !isParent(event) ||
        !validSnapshot(snapshot) ||
        !child ||
        child.isDestroyed()
      )
        return false;
      latest = snapshot;
      sendState();
      return true;
    });
    const controls = getSongControls(parent);
    const command = (
      event: Electron.IpcMainEvent,
      action: unknown,
      value: unknown,
    ) => {
      if (
        stopped ||
        !child ||
        event.sender !== child.webContents ||
        event.senderFrame !== child.webContents.mainFrame ||
        event.senderFrame.url !== url
      )
        return;
      switch (action) {
        case 'ready':
          sendState();
          break;
        case 'previous':
          controls.previous();
          break;
        case 'next':
          controls.next();
          break;
        case 'playPause':
          controls.playPause();
          break;
        case 'volume':
          if (
            typeof value === 'number' &&
            Number.isFinite(value) &&
            value >= 0 &&
            value <= 100
          )
            controls.setVolume(value);
          break;
        case 'close':
          child.close();
          break;
      }
    };
    ipcMain.on(channels.command, command);
    const close = () => {
      child?.destroy();
    };
    const navigating = (
      _event: Electron.Event,
      _url: string,
      _inPlace: boolean,
      mainFrame: boolean,
    ) => {
      if (mainFrame) close();
    };
    parent.on('closed', close);
    parent.webContents.on('did-start-navigation', navigating);
    this.cleanup = () => {
      stopped = true;
      close();
      restoreThrottling();
      latest = undefined;
      ipcMain.removeHandler(channels.toggle);
      ipcMain.removeHandler(channels.update);
      ipcMain.removeListener(channels.command, command);
      parent.removeListener('closed', close);
      if (!parent.webContents.isDestroyed())
        parent.webContents.removeListener('did-start-navigation', navigating);
    };
  },
  stop() {
    this.cleanup?.();
    this.cleanup = undefined;
  },
});
