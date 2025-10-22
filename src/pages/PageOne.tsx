import React, { useEffect, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2, Button, Alert, AlertVariant, Modal, ConfirmModal, Spinner } from '@grafana/ui';
import { PluginPage } from '@grafana/runtime';
import { AssetForm } from '../components/AssetForm';
import { AttachmentManager } from '../components/AttachmentManager';
import { testIds } from '../components/testIds';
import type { AssetFile, AssetPayload, AssetRecord } from '../types/assets';
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchAssets()
      .then(({ assets: records, meta }) => {
        if (!cancelled) {
          setAssets(sortAssets(records));
          setStorageConfigured(Boolean(meta?.storageConfigured));
          setMaxUploadSize(meta?.maxUploadSizeBytes ?? 0);
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
  }, []);

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
        setAssets((prev) => sortAssets(prev.map((item) => (item.id === updated.id ? updated : item))));
        setStatus({ severity: 'success', message: `Updated asset "${updated.title}".` });
      } else {
        const created = await createAsset(payload);
        setAssets((prev) => sortAssets([...prev, created]));
        setStatus({ severity: 'success', message: `Created asset "${created.title}".` });
      }
      setModalState(null);
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
      setAssets((prev) => prev.filter((item) => item.id !== deleteState.id));
      setStatus({ severity: 'success', message: `Deleted asset "${deleteState.title}".` });
      setDeleteState(null);
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

        {!loading && !error && assets.length === 0 && (
          <Alert title="No assets" severity="info" data-testid={testIds.pageOne.emptyState}>
            No assets found for your organization.
          </Alert>
        )}

        {!loading && !error && assets.length > 0 && (
          <div className={styles.tableWrap} data-testid={testIds.pageOne.table}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Title</th>
                  <th className={styles.th}>Entry Date</th>
                  <th className={styles.th}>Commissioning</th>
                  <th className={styles.th}>Station</th>
                  <th className={styles.th}>Technician</th>
                  <th className={styles.th}>Start / End</th>
                  <th className={styles.th}>Service</th>
                  <th className={styles.th}>Staff</th>
                  <th className={styles.th}>Attachments</th>
                  <th className={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((asset) => (
                  <tr key={asset.id}>
                    <td className={styles.td}>{asset.title}</td>
                    <td className={styles.td}>{asset.entry_date}</td>
                    <td className={styles.td}>{asset.commissioning_date}</td>
                    <td className={styles.td}>{asset.station_name}</td>
                    <td className={styles.td}>{asset.technician}</td>
                    <td className={styles.td}>
                      {asset.start_date} — {asset.end_date}
                    </td>
                    <td className={styles.td}>{asset.service ?? '—'}</td>
                    <td className={styles.td}>{asset.staff.length > 0 ? asset.staff.join(', ') : '—'}</td>
                    <td className={styles.td}>
                      {asset.attachments.length === 0 ? (
                        <span className={styles.muted}>—</span>
                      ) : (
                        <ul className={styles.attachmentList}>
                          {asset.attachments.map((file) => (
                            <li key={file.id}>
                              {file.url ? (
                                <a href={file.url} target="_blank" rel="noreferrer">
                                  {file.file_name}
                                </a>
                              ) : (
                                <span>{file.file_name}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className={styles.actionsCell}>
                      <Button size="sm" variant="secondary" fill="outline" onClick={() => openEdit(asset)}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        fill="outline"
                        onClick={() => requestDelete(asset)}
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

function sortAssets(records: AssetRecord[]): AssetRecord[] {
  return [...records].sort((a, b) => {
    const date = b.entry_date.localeCompare(a.entry_date);
    if (date !== 0) {
      return date;
    }
    return b.id - a.id;
  });
}

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

const getStyles = (theme: GrafanaTheme2) => {
  const border = `1px solid ${theme.colors.border.weak}`;
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
    tableWrap: css`
      overflow-x: auto;
      border: ${border};
      border-radius: 4px;
    `,
    table: css`
      width: 100%;
      border-collapse: collapse;
      min-width: 1120px;
    `,
    th: css`
      text-align: left;
      padding: ${theme.spacing(1)};
      background: ${theme.colors.background.secondary};
      border-bottom: ${border};
      font-weight: 600;
      white-space: nowrap;
    `,
    td: css`
      padding: ${theme.spacing(1)};
      border-bottom: ${border};
      vertical-align: top;
    `,
    muted: css`
      color: ${theme.colors.text.secondary};
    `,
    attachmentList: css`
      margin: 0;
      padding-left: ${theme.spacing(2)};
      display: flex;
      flex-direction: column;
      gap: ${theme.spacing(0.5)};
    `,
    actionsCell: css`
      display: flex;
      gap: ${theme.spacing(1)};
      flex-wrap: wrap;
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
