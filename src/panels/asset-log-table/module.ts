import { PanelPlugin } from '@grafana/data';

import { AssetLogTablePanel } from './AssetLogTablePanel';
import type { AssetLogTableOptions } from './types';

export const plugin = new PanelPlugin<AssetLogTableOptions>(AssetLogTablePanel).setPanelOptions((builder) => {
  return builder.addNumberInput({
    path: 'maxItems',
    name: 'Max rows',
    description: 'Limit the number of assets displayed in the table.',
    settings: {
      min: 1,
      step: 1,
    },
  });
});
