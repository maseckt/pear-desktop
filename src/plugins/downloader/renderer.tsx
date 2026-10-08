import { createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';

import { defaultConfig } from '@/config/defaults';
import { t } from '@/i18n';
import {
  isAlbumOrPlaylist,
  isMusicOrVideoTrack,
} from '@/plugins/utils/renderer/check';
import { getSongMenu } from '@/providers/dom-elements';
import { getSongInfo } from '@/providers/song-info-front';

import { DownloadButton } from './templates/download';

import type { DownloaderPluginConfig } from './index';
import type { DownloadTask } from './tasks';
import type { RendererContext } from '@/types/contexts';

let download: () => void;

const [downloadButtonText, setDownloadButtonText] = createSignal<string>('');

let buttonContainer: HTMLDivElement | null = null;
let panelContainer: HTMLDivElement | null = null;
let disposePanel: (() => void) | undefined;
let unsubscribeTasks: (() => void) | undefined;
const [tasks, setTasks] = createSignal<DownloadTask[]>([]);

const menuObserver = new MutationObserver(() => {
  const menu = getSongMenu();

  if (
    !menu ||
    menu.contains(buttonContainer) ||
    !(isMusicOrVideoTrack() || isAlbumOrPlaylist()) ||
    !buttonContainer
  ) {
    return;
  }

  menu.prepend(buttonContainer);
});

export const onRendererLoad = ({
  ipc,
}: RendererContext<DownloaderPluginConfig>) => {
  unsubscribeTasks?.();
  unsubscribeTasks = ipc.on('downloader:tasks', (value: DownloadTask[]) => {
    if (Array.isArray(value) && value.length <= 100) setTasks(value);
  });
  if (!panelContainer) {
    panelContainer = document.createElement('div');
    panelContainer.className = 'pearum-download-tasks';
    document.body.append(panelContainer);
    disposePanel = render(
      () => (
        <Show when={tasks().length}>
          <details open>
            <summary>{t('plugins.downloader.tasks.title')}</summary>
            <For each={tasks()}>
              {(task) => (
                <div class="pearum-download-task">
                  <span>
                    {task.title} —{' '}
                    {t(`plugins.downloader.tasks.${task.status}`)}
                  </span>
                  <Show when={task.error}>
                    <span>{task.error}</span>
                  </Show>
                  <progress
                    max="1"
                    value={task.progress >= 0 ? task.progress : undefined}
                  />
                  <Show
                    fallback={
                      <>
                        <Show when={task.status === 'error'}>
                          <button
                            onClick={() =>
                              ipc.send('downloader:retry', task.id)
                            }
                          >
                            {t('plugins.downloader.tasks.retry')}
                          </button>
                        </Show>
                        <button
                          onClick={() =>
                            ipc.send('downloader:dismiss', task.id)
                          }
                        >
                          ×
                        </button>
                      </>
                    }
                    when={task.status === 'running' || task.status === 'queued'}
                  >
                    <button
                      onClick={() => ipc.send('downloader:cancel', task.id)}
                    >
                      {t('plugins.downloader.tasks.cancel')}
                    </button>
                  </Show>
                </div>
              )}
            </For>
          </details>
        </Show>
      ),
      panelContainer,
    );
  }
  ipc.send('downloader:tasks-ready');
  download = () => {
    const songMenu = getSongMenu();

    let videoUrl = songMenu
      ?.querySelector(
        'ytmusic-menu-navigation-item-renderer[tabindex="0"] #navigation-endpoint',
      )
      ?.getAttribute('href');

    if (!videoUrl && songMenu) {
      for (const it of songMenu.querySelectorAll(
        'ytmusic-menu-navigation-item-renderer[tabindex="-1"] #navigation-endpoint',
      )) {
        if (it.getAttribute('href')?.includes('podcast/')) {
          videoUrl = it.getAttribute('href');
          break;
        }
      }
    }

    if (videoUrl) {
      if (videoUrl.startsWith('watch?')) {
        videoUrl = defaultConfig.url + '/' + videoUrl;
      }

      if (videoUrl.startsWith('podcast/')) {
        videoUrl =
          defaultConfig.url + '/watch?' + videoUrl.replace('podcast/', 'v=');
      }

      if (videoUrl.includes('?playlist=')) {
        ipc.invoke('download-playlist-request', videoUrl);
        return;
      }
    } else {
      videoUrl = getSongInfo().url || window.location.href;
    }

    ipc.invoke('download-song', videoUrl);
  };

  ipc.on('downloader-feedback', (feedback: string) => {
    const targetHtml = feedback || t('plugins.downloader.templates.button');
    setDownloadButtonText(targetHtml);
  });
};

export const onPlayerApiReady = () => {
  setDownloadButtonText(t('plugins.downloader.templates.button'));

  buttonContainer = document.createElement('div');
  buttonContainer.classList.add(
    'style-scope',
    'menu-item',
    'ytmusic-menu-popup-renderer',
  );
  buttonContainer.setAttribute('aria-disabled', 'false');
  buttonContainer.setAttribute('aria-selected', 'false');
  buttonContainer.setAttribute('role', 'option');
  buttonContainer.setAttribute('tabindex', '-1');

  render(
    () => <DownloadButton onClick={download} text={downloadButtonText()} />,
    buttonContainer,
  );

  menuObserver.observe(document.querySelector('ytmusic-popup-container')!, {
    childList: true,
    subtree: true,
  });
};

export function onRendererStop() {
  unsubscribeTasks?.();
  unsubscribeTasks = undefined;
  menuObserver.disconnect();
  disposePanel?.();
  disposePanel = undefined;
  panelContainer?.remove();
  panelContainer = null;
  buttonContainer?.remove();
  buttonContainer = null;
  setTasks([]);
}
