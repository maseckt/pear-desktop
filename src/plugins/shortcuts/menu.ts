import prompt, { type KeybindOptions } from 'custom-electron-prompt';

import { t } from '@/i18n';
import promptOptions from '@/providers/prompt-options';

import { seekSeconds } from './seek';

import type { ShortcutsPluginConfig } from './index';
import type { MenuTemplate } from '@/menu';
import type { MenuContext } from '@/types/contexts';
import type { BrowserWindow } from 'electron';

export const onMenu = async ({
  window,
  getConfig,
  setConfig,
}: MenuContext<ShortcutsPluginConfig>): Promise<MenuTemplate> => {
  const config = await getConfig();

  /**
   * Helper function for keybind prompt
   */
  const kb = (
    label_: string,
    value_: string,
    default_?: string,
  ): KeybindOptions => ({ value: value_, label: label_, default: default_ });

  async function promptKeybind(
    config: ShortcutsPluginConfig,
    win: BrowserWindow,
  ) {
    const output = await prompt(
      {
        title: t('plugins.shortcuts.prompt.keybind.title'),
        label: t('plugins.shortcuts.prompt.keybind.label'),
        type: 'keybind',
        keybindOptions: [
          // If default=undefined then no default is used
          kb(
            t('plugins.shortcuts.prompt.keybind.keybind-options.previous'),
            'previous',
            config.global?.previous,
          ),
          kb(
            t('plugins.shortcuts.prompt.keybind.keybind-options.play-pause'),
            'playPause',
            config.global?.playPause,
          ),
          kb(
            t('plugins.shortcuts.prompt.keybind.keybind-options.next'),
            'next',
            config.global?.next,
          ),
          kb(
            t('plugins.shortcuts.prompt.keybind.keybind-options.seek-forward'),
            'seekForward',
            config.global?.seekForward,
          ),
          kb(
            t('plugins.shortcuts.prompt.keybind.keybind-options.seek-backward'),
            'seekBackward',
            config.global?.seekBackward,
          ),
        ],
        height: 370,
        ...promptOptions(),
      },
      win,
    );

    if (output) {
      const global = { ...config.global };

      for (const { value, accelerator } of output) {
        if (
          Object.hasOwn(global, value) &&
          typeof accelerator === 'string' &&
          accelerator.length <= 100
        ) {
          global[value as keyof typeof global] = accelerator;
        }
      }

      await setConfig({ global });
    }
    // Else -> pressed cancel
  }

  return [
    ...(
      [
        'seekForwardSeconds',
        'seekBackwardSeconds',
        'podcastSeekForwardSeconds',
        'podcastSeekBackwardSeconds',
      ] as const
    ).map((key) => ({
      label: t(`plugins.shortcuts.seek.${key}`, { seconds: config[key] }),
      async click() {
        const value = await prompt(
          {
            title: t(`plugins.shortcuts.seek.${key}`, { seconds: config[key] }),
            value: config[key],
            type: 'counter',
            counterOptions: { minimum: 1, maximum: 600 },
            ...promptOptions(),
          },
          window,
        );
        if (value === null || value === undefined) return;
        await setConfig({ [key]: seekSeconds(Number(value), config[key]) });
      },
    })),
    {
      label: t('plugins.shortcuts.menu.set-keybinds'),
      click: () => promptKeybind(config, window),
    },
    {
      label: t('plugins.shortcuts.menu.override-media-keys'),
      type: 'checkbox',
      checked: config.overrideMediaKeys,
      click: (item) => setConfig({ overrideMediaKeys: item.checked }),
    },
  ];
};
