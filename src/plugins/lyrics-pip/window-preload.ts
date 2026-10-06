import { contextBridge, ipcRenderer } from 'electron';

// This preload must stay standalone: sandboxed preloads cannot require local
// chunks. Expose only this window's state subscription and fixed player commands.
contextBridge.exposeInMainWorld('floatingLyrics', {
  onState: (callback: (value: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) =>
      callback(value);
    ipcRenderer.on('lyrics-pip:state', listener);
    ipcRenderer.send('lyrics-pip:command', 'ready');
    return () => ipcRenderer.removeListener('lyrics-pip:state', listener);
  },
  command: (action: string, value?: number) => {
    if (['previous', 'playPause', 'next', 'close'].includes(action)) {
      ipcRenderer.send('lyrics-pip:command', action);
    } else if (
      action === 'volume' &&
      Number.isFinite(value) &&
      value! >= 0 &&
      value! <= 100
    ) {
      ipcRenderer.send('lyrics-pip:command', action, value);
    }
  },
});
