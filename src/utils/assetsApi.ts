import { getBackendSrv, isFetchError } from '@grafana/runtime';
import type {
  AssetFile,
  AssetListFilters,
  AssetListMeta,
  AssetPayload,
  AssetRecord,
} from '../types/assets';

const PLUGIN_ID = 'rpatt-assetlog-app';
const BASE_URL = `/api/plugins/${PLUGIN_ID}/resources/assets`;

interface ListResponse {
  data: AssetRecord[];
  meta?: AssetListMeta;
}

interface ItemResponse<T> {
  data: T;
}

export interface AssetListResult {
  assets: AssetRecord[];
  meta: AssetListMeta;
}

export interface AssetListQuery {
  page?: number;
  pageSize?: number;
  filters?: AssetListFilters;
}

export async function fetchAssets(query?: AssetListQuery): Promise<AssetListResult> {
  const backend = tryGetBackendSrv();
  if (!backend) {
    return {
      assets: [],
      meta: getDefaultMeta(),
    };
  }
  const url = buildListURL(query);
  const response = await backend.get<ListResponse>(url, undefined, undefined, { showErrorAlert: false });
  const meta: AssetListMeta = response?.meta ?? getDefaultMeta();
  if (!meta.filters) {
    meta.filters = {};
  }
  return {
    assets: response?.data ?? [],
    meta,
  };
}

export async function createAsset(payload: AssetPayload): Promise<AssetRecord> {
  const backend = getBackendOrThrow();
  const response = await backend.post<ItemResponse<AssetRecord>>(BASE_URL, payload, { showErrorAlert: false });
  return response.data;
}

export async function updateAsset(assetId: number, payload: AssetPayload): Promise<AssetRecord> {
  const backend = getBackendOrThrow();
  const response = await backend.put<ItemResponse<AssetRecord>>(`${BASE_URL}/${assetId}`, payload, { showErrorAlert: false });
  return response.data;
}

export async function deleteAsset(assetId: number): Promise<void> {
  const backend = getBackendOrThrow();
  await backend.delete(`${BASE_URL}/${assetId}`, undefined, { showErrorAlert: false });
}

export async function uploadAttachment(assetId: number, file: File, signal?: AbortSignal): Promise<AssetFile> {
  const form = new FormData();
  form.append('file', file);

  const response = await fetch(`${BASE_URL}/${assetId}/files`, {
    method: 'POST',
    body: form,
    credentials: 'same-origin',
    signal,
  });

  if (!response.ok) {
    throw await buildResponseError(response);
  }

  const payload = (await response.json()) as ItemResponse<AssetFile>;
  return payload.data;
}

export async function deleteAttachment(assetId: number, fileId: number): Promise<void> {
  const response = await fetch(`${BASE_URL}/${assetId}/files/${fileId}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });

  if (!response.ok) {
    throw await buildResponseError(response);
  }
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

async function buildResponseError(response: Response): Promise<Error> {
  let bodyText: string | undefined;
  try {
    const data = await response.clone().json();
    if (typeof data === 'string' && data.trim() !== '') {
      bodyText = data.trim();
    } else if (data && typeof data === 'object') {
      if (typeof (data as { message?: string }).message === 'string' && (data as { message?: string }).message!.trim() !== '') {
        bodyText = (data as { message: string }).message.trim();
      } else if (
        typeof (data as { error?: string }).error === 'string' &&
        (data as { error?: string }).error!.trim() !== ''
      ) {
        bodyText = (data as { error: string }).error.trim();
      }
    }
  } catch (err) {
    try {
      bodyText = (await response.clone().text()).trim();
    } catch (ignored) {
      // ignore
    }
  }

  const message =
    bodyText && bodyText.length > 0
      ? bodyText
      : response.statusText || `request failed with status ${response.status}`;
  return new Error(message);
}

function buildListURL(query?: AssetListQuery): string {
  if (!query) {
    return BASE_URL;
  }
  const params = new URLSearchParams();
  if (query.page && query.page > 0) {
    params.set('page', String(query.page));
  }
  if (query.pageSize && query.pageSize > 0) {
    params.set('pageSize', String(query.pageSize));
  }
  if (query.filters) {
    Object.entries(query.filters).forEach(([key, value]) => {
      if (typeof value !== 'string') {
        return;
      }
      const trimmed = value.trim();
      if (trimmed === '') {
        return;
      }
      params.set(`filter[${key}]`, trimmed);
    });
  }
  const queryString = params.toString();
  if (!queryString) {
    return BASE_URL;
  }
  return `${BASE_URL}?${queryString}`;
}

function getDefaultMeta(): AssetListMeta {
  return {
    storageConfigured: false,
    maxUploadSizeBytes: 0,
    maxUploadSizeMb: 0,
    page: 1,
    pageSize: 25,
    pageCount: 0,
    totalCount: 0,
    filters: {},
  };
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
