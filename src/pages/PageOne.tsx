import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2, Button, Alert, AlertVariant, Modal, ConfirmModal, Spinner } from '@grafana/ui';
import { PluginPage } from '@grafana/runtime';
import { AssetForm } from '../components/AssetForm';
import { AttachmentManager } from '../components/AttachmentManager';
import { AssetTable } from '../components/AssetTable';
import { testIds } from '../components/testIds';
import type {
  AssetFile,
  AssetFilterKey,
  AssetListFilters,
  AssetListMeta,
  AssetListSort,
  AssetPayload,
  AssetRecord,
} from '../types/assets';
import { EMPTY_FILTER_VALUE } from '../types/assets';
import {
  createAsset,
  deleteAsset,
  deleteAttachment,
  fetchAssets,
  toErrorMessage,
  updateAsset,
  uploadAttachment,
} from '../utils/assetsApi';

type ModalState = {
  mode: 'create' | 'edit';
  asset?: AssetRecord;
} | null;

type StatusMessage = {
  severity: AlertVariant;
  message: string;
};

function PageOne() {
  const styles = useStyles2(getStyles);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalState, setModalState] = useState<ModalState>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteState, setDeleteState] = useState<AssetRecord | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [storageConfigured, setStorageConfigured] = useState(false);
  const [maxUploadSize, setMaxUploadSize] = useState(0);
  const [meta, setMeta] = useState<AssetListMeta | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [filters, setFilters] = useState<AssetListFilters>({});
  const [sort, setSort] = useState<AssetListSort | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const filterParams = useMemo<AssetListFilters>(() => normalizeFilterState(filters), [filters]);

  const filterKey = useMemo(() => JSON.stringify(filterParams), [filterParams]);

  const sortKey = useMemo(() => (sort ? `${sort.key}:${sort.direction}` : ''), [sort]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchAssets({ page, pageSize, filters: filterParams, sort })
      .then(({ assets: records, meta: listMeta }) => {
        if (!cancelled) {
          setAssets(records);
          setMeta(listMeta);
          setStorageConfigured(Boolean(listMeta?.storageConfigured));
          setMaxUploadSize(listMeta?.maxUploadSizeBytes ?? 0);
          if (listMeta?.page && listMeta.page !== page) {
            setPage(listMeta.page);
          }
          if (listMeta?.pageSize && listMeta.pageSize !== pageSize) {
            setPageSize(listMeta.pageSize);
          }
          const nextFilters = normalizeFilterState(listMeta?.filters);
          setFilters((prev) => (shallowEqualFilters(prev, nextFilters) ? prev : nextFilters));
          const nextSort = listMeta?.sort ?? null;
          setSort((prev) => (areSortsEqual(prev, nextSort) ? prev : nextSort));
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(toErrorMessage(err));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [page, pageSize, filterKey, sortKey, refreshToken]);

  const openCreate = () => {
    setModalState({ mode: 'create' });
    setFormError(null);
  };

  const openEdit = (asset: AssetRecord) => {
    setModalState({ mode: 'edit', asset });
    setFormError(null);
  };

  const closeModal = () => {
    setModalState(null);
    setFormError(null);
  };

  const handleSubmit = async (payload: AssetPayload) => {
    if (!modalState) {
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      if (modalState.mode === 'edit' && modalState.asset) {
        const updated = await updateAsset(modalState.asset.id, payload);
        setAssets((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        setStatus({ severity: 'success', message: `Updated asset "${updated.title}".` });
      } else {
        const created = await createAsset(payload);
        setStatus({ severity: 'success', message: `Created asset "${created.title}".` });
        setPage(1);
      }
      setModalState(null);
      setRefreshToken((token) => token + 1);
    } catch (err) {
      setFormError(toErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const requestDelete = (asset: AssetRecord) => {
    setDeleteState(asset);
    setDeleteError(null);
  };

  const closeDelete = () => {
    setDeleteState(null);
    setDeleteError(null);
    setDeleteLoading(false);
  };

  const confirmDelete = async () => {
    if (!deleteState) {
      return;
    }
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await deleteAsset(deleteState.id);
      const currentPage = page;
      if (assets.length === 1 && currentPage > 1) {
        setPage(currentPage - 1);
      }
      setAssets((prev) => prev.filter((item) => item.id !== deleteState.id));
      setStatus({ severity: 'success', message: `Deleted asset "${deleteState.title}".` });
      setDeleteState(null);
      setRefreshToken((token) => token + 1);
    } catch (err) {
      setDeleteError(toErrorMessage(err));
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleUploadAttachment = async (assetId: number, file: File) => {
    const uploaded = await uploadAttachment(assetId, file);
    const update = (records: AssetRecord[]) =>
      records.map((item) => {
        if (item.id !== assetId) {
          return item;
        }
        const attachments = sortAttachments([...item.attachments, uploaded]);
        return withAttachments(item, attachments);
      });
    setAssets((prev) => update(prev));
    setModalState((prev) => {
      if (!prev || !prev.asset || prev.asset.id !== assetId) {
        return prev;
      }
      const attachments = sortAttachments([...prev.asset.attachments, uploaded]);
      return { ...prev, asset: withAttachments(prev.asset, attachments) };
    });
    setStatus({ severity: 'success', message: `Uploaded attachment "${uploaded.file_name}".` });
    return uploaded;
  };

  const handleDeleteAttachment = async (assetId: number, fileId: number) => {
    const currentAsset = assets.find((item) => item.id === assetId);
    const fileName = currentAsset?.attachments.find((file) => file.id === fileId)?.file_name;
    await deleteAttachment(assetId, fileId);
    const update = (records: AssetRecord[]) =>
      records.map((item) => {
        if (item.id !== assetId) {
          return item;
        }
        const attachments = item.attachments.filter((file) => file.id !== fileId);
        return withAttachments(item, attachments);
      });
    setAssets((prev) => update(prev));
    setModalState((prev) => {
      if (!prev || !prev.asset || prev.asset.id !== assetId) {
        return prev;
      }
      const attachments = prev.asset.attachments.filter((file) => file.id !== fileId);
      return { ...prev, asset: withAttachments(prev.asset, attachments) };
    });
    setStatus({
      severity: 'success',
      message: fileName ? `Deleted attachment "${fileName}".` : 'Deleted attachment.',
    });
  };

  const handleFiltersChange = useCallback((next: AssetListFilters) => {
    const normalized = normalizeFilterState(next);
    setFilters((prev) => (shallowEqualFilters(prev, normalized) ? prev : normalized));
    setPage(1);
  }, []);

  const handleSortChange = useCallback((next: AssetListSort | null) => {
    setSort((prev) => (areSortsEqual(prev, next) ? prev : next));
    setPage(1);
  }, []);

  const handlePageChange = useCallback((nextPage: number) => {
    if (!Number.isFinite(nextPage) || nextPage < 1) {
      return;
    }
    setPage(nextPage);
  }, []);

  const handlePageSizeChange = useCallback((nextSize: number) => {
    if (!Number.isFinite(nextSize) || nextSize <= 0) {
      return;
    }
    setPageSize(nextSize);
    setPage(1);
  }, []);

  const totalCount = meta?.totalCount ?? assets.length;
  const activePageSize = meta?.pageSize ?? pageSize;
  const activePage = meta?.page ?? page;
  const pageCount = meta?.pageCount ?? (activePageSize > 0 ? Math.max(1, Math.ceil(totalCount / activePageSize)) : 1);
  const hasActiveFilters = Object.keys(filterParams).length > 0;

  return (
    <PluginPage>
      <div data-testid={testIds.pageOne.container} className={styles.container}>
        <div className={styles.header}>
          <h2 className={styles.title}>Asset Log</h2>
          <Button variant="primary" icon="plus" onClick={openCreate} data-testid={testIds.pageOne.addAsset}>
            Add asset
          </Button>
        </div>

        {status && (
          <Alert
            title={status.severity === 'success' ? 'Success' : 'Notice'}
            severity={status.severity}
            onRemove={() => setStatus(null)}
            className={styles.statusAlert}
          >
            {status.message}
          </Alert>
        )}

        {loading && (
          <div className={styles.loading}>
            <Spinner size={20} />
            <span>Loading assets…</span>
          </div>
        )}

        {error && !loading && (
          <Alert title="Failed to load assets" severity="error" onRemove={() => setError(null)}>
            {error}
          </Alert>
        )}

        {!loading && !error && (
          <>
          <AssetTable
            assets={assets}
            onEdit={openEdit}
            onDelete={requestDelete}
            testId={testIds.pageOne.table}
            page={activePage}
            pageSize={activePageSize}
            pageCount={pageCount}
            totalCount={totalCount}
            filters={filters}
            onFiltersChange={handleFiltersChange}
            sort={sort}
            onSortChange={handleSortChange}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
          />
            {assets.length === 0 && (
              <Alert title="No assets" severity="info" data-testid={testIds.pageOne.emptyState}>
                {hasActiveFilters ? 'No assets match the selected filters.' : 'No assets found for your organization.'}
              </Alert>
            )}
          </>
        )}
      </div>

      {modalState && (
        <Modal
          isOpen={true}
          title={modalState.mode === 'edit' ? 'Edit asset' : 'Add asset'}
          onDismiss={closeModal}
          className={styles.modal}
        >
          <div className={styles.modalContent}>
            <AssetForm
              asset={modalState.asset}
              onSubmit={handleSubmit}
              onCancel={closeModal}
              onClearError={() => setFormError(null)}
              submitLabel={modalState.mode === 'edit' ? 'Save changes' : 'Create asset'}
              isSubmitting={isSubmitting}
              errorMessage={formError}
            />
            {modalState.mode === 'edit' && modalState.asset && (
              <AttachmentManager
                asset={modalState.asset}
                onUpload={(file) => handleUploadAttachment(modalState.asset!.id, file)}
                onDelete={(fileId) => handleDeleteAttachment(modalState.asset!.id, fileId)}
                storageConfigured={storageConfigured}
                maxUploadSizeBytes={maxUploadSize}
              />
            )}
          </div>
        </Modal>
      )}

      {deleteState && (
        <ConfirmModal
          isOpen={true}
          title="Delete asset"
          body={
            <div className={styles.confirmBody}>
              <p>
                Are you sure you want to delete <strong>{deleteState.title}</strong>?
              </p>
              {deleteError && (
                <Alert title="Delete failed" severity="error" className={styles.inlineAlert}>
                  {deleteError}
                </Alert>
              )}
            </div>
          }
          confirmText={deleteLoading ? 'Deleting…' : 'Delete'}
          confirmVariant="destructive"
          dismissText="Cancel"
          onConfirm={confirmDelete}
          onDismiss={closeDelete}
          disabled={deleteLoading}
        />
      )}
    </PluginPage>
  );
}

export default PageOne;

function withAttachments(asset: AssetRecord, attachments: AssetFile[]): AssetRecord {
  return {
    ...asset,
    attachments,
    image_urls: attachments.map((file) => file.file_name),
  };
}

function sortAttachments(files: AssetFile[]): AssetFile[] {
  return [...files].sort((a, b) => a.id - b.id);
}

function shallowEqualFilters(a?: AssetListFilters, b?: AssetListFilters): boolean {
  const mapA = normalizeFilterState(a);
  const mapB = normalizeFilterState(b);
  const keysA = Object.keys(mapA).sort();
  const keysB = Object.keys(mapB).sort();
  if (keysA.length !== keysB.length) {
    return false;
  }
  for (let i = 0; i < keysA.length; i++) {
    const key = keysA[i] as AssetFilterKey;
    if (key !== (keysB[i] as AssetFilterKey)) {
      return false;
    }
    const valuesA = mapA[key] ?? [];
    const valuesB = mapB[key] ?? [];
    if (valuesA.length !== valuesB.length) {
      return false;
    }
    for (let j = 0; j < valuesA.length; j++) {
      if (valuesA[j] !== valuesB[j]) {
        return false;
      }
    }
  }
  return true;
}

function areSortsEqual(a?: AssetListSort | null, b?: AssetListSort | null): boolean {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return a.key === b.key && a.direction === b.direction;
}

function normalizeFilterState(filters?: AssetListFilters): AssetListFilters {
  if (!filters) {
    return {};
  }
  const normalized: AssetListFilters = {};
  (Object.entries(filters) as [AssetFilterKey, string[]][]).forEach(([key, values]) => {
    if (!Array.isArray(values) || values.length === 0) {
      return;
    }
    const cleaned = normalizeFilterValues(values);
    if (cleaned.length === 0) {
      return;
    }
    normalized[key] = cleaned;
  });
  return normalized;
}

function normalizeFilterValues(values: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of values) {
    const normalized = raw === EMPTY_FILTER_VALUE ? EMPTY_FILTER_VALUE : raw.trim();
    if (normalized === '' || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    cleaned.push(normalized);
  }
  return cleaned.sort((a, b) => compareFilterValue(a, b));
}

function compareFilterValue(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (a === EMPTY_FILTER_VALUE) {
    return 1;
  }
  if (b === EMPTY_FILTER_VALUE) {
    return -1;
  }
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

const getStyles = (theme: GrafanaTheme2) => {
  return {
    container: css`
      padding: ${theme.spacing(3)};
      display: flex;
      flex-direction: column;
      gap: ${theme.spacing(2)};
    `,
    header: css`
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: ${theme.spacing(1)};
    `,
    title: css`
      margin: 0;
      font-size: 1.25rem;
      font-weight: 600;
    `,
    statusAlert: css`
      margin-bottom: ${theme.spacing(1)};
    `,
    loading: css`
      display: inline-flex;
      align-items: center;
      gap: ${theme.spacing(1)};
      color: ${theme.colors.text.secondary};
    `,
    modal: css`
      width: min(760px, 90vw);
    `,
    modalContent: css`
      display: flex;
      flex-direction: column;
      gap: ${theme.spacing(2)};
    `,
    confirmBody: css`
      display: flex;
      flex-direction: column;
      gap: ${theme.spacing(1)};
    `,
    inlineAlert: css`
      margin: 0;
    `,
  };
};
