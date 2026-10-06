import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { backend } from './backend';
import { renderer } from './renderer';

export default createPlugin({
  name: () => t('plugins.lyrics-pip.name'),
  description: () => t('plugins.lyrics-pip.description'),
  config: { enabled: false },
  restartNeeded: false,
  backend,
  renderer,
});
