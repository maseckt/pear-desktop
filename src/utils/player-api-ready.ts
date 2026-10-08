import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';
import type { PluginConfig, PluginDef } from '@/types/plugins';

export async function invokePlayerApiReady(
  renderer: PluginDef<unknown, unknown, unknown>['renderer'],
  playerApi: MusicPlayer,
  context: RendererContext<PluginConfig>,
  onError: (error: unknown) => void,
) {
  if (typeof renderer === 'function') return;
  try {
    await renderer?.onPlayerApiReady?.call(renderer, playerApi, context);
  } catch (error) {
    onError(error);
  }
}
