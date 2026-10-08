import { writeFile } from 'node:fs/promises';

import { dialog, net } from 'electron';

import { createBackend } from '@/utils';

import { prepareLrcExport } from './lrc-export';
import { ElectronLyricsRequests } from './search/electron-requests';

const requests = new ElectronLyricsRequests((url, init) =>
  net.fetch(url, init),
);

export const backend = createBackend({
  generation: 0,
  saving: false,
  start(ctx) {
    const generation = ++this.generation;
    ctx.ipc.handle('synced-lyrics:save', async (payload: unknown) => {
      if (this.saving) return false;
      const { content, filename } = prepareLrcExport(payload);
      this.saving = true;
      try {
        const result = await dialog.showSaveDialog(ctx.window, {
          defaultPath: filename,
          filters: [{ name: 'LRC', extensions: ['lrc'] }],
        });
        if (
          result.canceled ||
          !result.filePath ||
          generation !== this.generation ||
          ctx.window.isDestroyed()
        )
          return false;
        await writeFile(result.filePath, content, 'utf8');
        return true;
      } finally {
        this.saving = false;
      }
    });
    // Privileged transport retained only for providers requiring forbidden headers.
    ctx.ipc.handle(
      'synced-lyrics:fetch',
      (id: string, url: string, init: RequestInit) =>
        requests.fetch(id, url, init),
    );
    ctx.ipc.handle('synced-lyrics:cancel', (id: string) => {
      requests.cancel(id);
    });
  },
  stop(ctx) {
    ++this.generation;
    requests.dispose();
    ctx.ipc.removeHandler('synced-lyrics:fetch');
    ctx.ipc.removeHandler('synced-lyrics:cancel');
    ctx.ipc.removeHandler('synced-lyrics:save');
  },
});
