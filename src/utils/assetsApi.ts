import { getBackendSrv, isFetchError } from '@grafana/runtime';
import type { AssetPayload, AssetRecord } from '../types/assets';

const PLUGIN_ID = 'rpatt-assetlog-app';
const BASE_URL = `/api/plugins/${PLUGIN_ID}/resources/assets`;

interface ListResponse {
  data: AssetRecord[];
}

interface ItemResponse {
  data: AssetRecord;
}

export async function fetchAssets(): Promise<AssetRecord[]> {
  const backend = tryGetBackendSrv();
  if (!backend) {
    return [];
  }
  const response = await backend.get<ListResponse>(BASE_URL, undefined, undefined, { showErrorAlert: false });
  return response?.data ?? [];
}

export async function createAsset(payload: AssetPayload): Promise<AssetRecord> {
  const backend = getBackendOrThrow();
  const response = await backend.post<ItemResponse>(BASE_URL, payload, { showErrorAlert: false });
  return response.data;
}

export async function updateAsset(assetId: number, payload: AssetPayload): Promise<AssetRecord> {
  const backend = getBackendOrThrow();
  const response = await backend.put<ItemResponse>(`${BASE_URL}/${assetId}`, payload, { showErrorAlert: false });
  return response.data;
}

export async function deleteAsset(assetId: number): Promise<void> {
  const backend = getBackendOrThrow();
  await backend.delete(`${BASE_URL}/${assetId}`, undefined, { showErrorAlert: false });
}

export function toErrorMessage(error: unknown): string {
  if (isFetchError(error)) {
    const data = error.data as { message?: string; error?: string } | string | undefined;
    if (typeof data === 'string' && data.trim() !== '') {
      return data.trim();
    }
    if (data && typeof data === 'object') {
      if (typeof data.message === 'string' && data.message.trim() !== '') {
        return data.message.trim();
      }
      if (typeof data.error === 'string' && data.error.trim() !== '') {
        return data.error.trim();
      }
    }
    if (typeof error.statusText === 'string' && error.statusText.trim() !== '') {
      return `${error.status}: ${error.statusText}`;
    }
    if (typeof error.message === 'string' && error.message.trim() !== '') {
      return error.message;
    }
    return `request failed with status ${error.status}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unexpected error';
}

function tryGetBackendSrv() {
  try {
    return getBackendSrv();
  } catch (error) {
    return undefined;
  }
}

function getBackendOrThrow() {
  const backend = tryGetBackendSrv();
  if (!backend) {
    throw new Error('backend service unavailable');
  }
  return backend;
}
