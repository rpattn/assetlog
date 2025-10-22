import { PanelPlugin } from '@grafana/data';

import type { AssetFilterKey, AssetSortKey } from '../../types/assets';
import { AssetLogTablePanel } from './AssetLogTablePanel';
import type { AssetLogTableOptions } from './types';

const SORT_OPTIONS: Array<{ label: string; value: AssetSortKey }> = [
  { label: 'Entry date', value: 'entry_date' },
  { label: 'Commissioning date', value: 'commissioning_date' },
  { label: 'Title', value: 'title' },
  { label: 'Station', value: 'station_name' },
  { label: 'Technician', value: 'technician' },
  { label: 'Service', value: 'service' },
  { label: 'Start date', value: 'start_date' },
  { label: 'End date', value: 'end_date' },
];

const FILTER_FIELDS: Array<{ key: AssetFilterKey; name: string }> = [
  { key: 'title', name: 'Title filter' },
  { key: 'entry_date', name: 'Entry date filter' },
  { key: 'commissioning_date', name: 'Commissioning filter' },
  { key: 'station_name', name: 'Station filter' },
  { key: 'technician', name: 'Technician filter' },
  { key: 'service', name: 'Service filter' },
];

const FILTER_DESCRIPTION =
  'Provide a comma-separated list of values to include. Use "(empty)" to match records without a value.';

export const plugin = new PanelPlugin<AssetLogTableOptions>(AssetLogTablePanel).setPanelOptions((builder) => {
  builder.addNumberInput({
    path: 'maxItems',
    name: 'Max rows',
    description: 'Limit the number of assets displayed in the table.',
    settings: {
      min: 1,
      step: 1,
    },
  });

  builder.addSelect({
    path: 'sortKey',
    name: 'Sort column',
    description: 'Choose which column to use when sorting assets.',
    settings: {
      options: SORT_OPTIONS,
    },
    defaultValue: 'entry_date',
  });

  builder.addSelect({
    path: 'sortDirection',
    name: 'Sort direction',
    description: 'Descending shows the most recent records first.',
    settings: {
      options: [
        { label: 'Descending', value: 'desc' },
        { label: 'Ascending', value: 'asc' },
      ],
    },
    defaultValue: 'desc',
  });

  FILTER_FIELDS.forEach(({ key, name }) => {
    builder.addTextInput({
      path: `filters.${key}`,
      name,
      description: FILTER_DESCRIPTION,
    });
  });

  return builder;
});
