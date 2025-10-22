export interface AssetFile {
  id: number;
  asset_id: number;
  file_name: string;
  content_type?: string;
  url?: string;
  created_at: string;
  updated_at: string;
}

export interface AssetRecord {
  id: number;
  title: string;
  entry_date: string;
  commissioning_date: string;
  station_name: string;
  technician: string;
  start_date: string;
  end_date: string;
  service?: string;
  staff: string[];
  latitude: number;
  longitude: number;
  pitch: number;
  roll: number;
  attachments: AssetFile[];
  image_urls?: string[];
  created_at: string;
  updated_at: string;
}

export interface AssetPayload {
  title: string;
  entry_date: string;
  commissioning_date: string;
  station_name: string;
  technician: string;
  start_date: string;
  end_date: string;
  service?: string;
  staff: string[];
  latitude: number;
  longitude: number;
  pitch: number;
  roll: number;
}

export type AssetFilterKey =
  | 'title'
  | 'entry_date'
  | 'commissioning_date'
  | 'station_name'
  | 'technician'
  | 'service';

export type AssetFilterValue = string[];

export type AssetListFilters = Partial<Record<AssetFilterKey, AssetFilterValue>>;

export const EMPTY_FILTER_VALUE = '__EMPTY__';

export type AssetSortKey =
  | 'title'
  | 'entry_date'
  | 'commissioning_date'
  | 'station_name'
  | 'technician'
  | 'service'
  | 'start_date'
  | 'end_date';

export type AssetSortDirection = 'asc' | 'desc';

export interface AssetListSort {
  key: AssetSortKey;
  direction: AssetSortDirection;
}

export interface AssetListMeta {
  storageConfigured: boolean;
  maxUploadSizeBytes: number;
  maxUploadSizeMb: number;
  page: number;
  pageSize: number;
  pageCount: number;
  totalCount: number;
  filters: AssetListFilters;
  storageError?: string;
  sort?: AssetListSort | null;
}
