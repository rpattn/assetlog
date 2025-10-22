import type { AssetFilterKey, AssetSortDirection, AssetSortKey } from '../../types/assets';

export interface AssetLogTableOptions {
  /** Maximum number of rows to display. Leave empty to show all rows. */
  maxItems?: number;
  /** Column to request from the AssetLog API for sorting. */
  sortKey?: AssetSortKey | '';
  /** Direction for the server-side sort. Defaults to descending if unset. */
  sortDirection?: AssetSortDirection;
  /** Optional predefined filters entered as comma or newline separated strings. */
  filters?: Partial<Record<AssetFilterKey, string>>;
}
