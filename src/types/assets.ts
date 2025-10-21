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
