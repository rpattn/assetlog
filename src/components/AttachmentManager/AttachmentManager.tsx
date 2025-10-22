import React, { useRef, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2, Button, Alert, Spinner } from '@grafana/ui';
import type { AssetFile, AssetRecord } from '../../types/assets';
import { testIds } from '../testIds';
import { toErrorMessage } from '../../utils/assetsApi';

export interface AttachmentManagerProps {
  asset: AssetRecord;
  onUpload(file: File): Promise<AssetFile>;
  onDelete(fileId: number): Promise<void>;
  storageConfigured: boolean;
  maxUploadSizeBytes: number;
}

export const AttachmentManager = ({
  asset,
  onUpload,
  onDelete,
  storageConfigured,
  maxUploadSizeBytes,
}: AttachmentManagerProps) => {
  const styles = useStyles2(getStyles);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleBrowseClick = () => {
    if (inputRef.current) {
      inputRef.current.click();
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files || event.target.files.length === 0) {
      return;
    }
    const file = event.target.files[0];
    event.target.value = '';

    if (maxUploadSizeBytes > 0 && file.size > maxUploadSizeBytes) {
      setError(`File exceeds the maximum size of ${formatBytes(maxUploadSizeBytes)}.`);
      return;
    }

    setUploading(true);
    setError(null);
    try {
      await onUpload(file);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (fileId: number) => {
    setDeletingId(fileId);
    setError(null);
    try {
      await onDelete(fileId);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setDeletingId(null);
    }
  };

  const maxSizeLabel = maxUploadSizeBytes > 0 ? formatBytes(maxUploadSizeBytes) : undefined;

  return (
    <section className={styles.container} data-testid={testIds.pageOne.attachments.container}>
      <div className={styles.header}>
        <h3 className={styles.heading}>Attachments</h3>
        {storageConfigured && (
          <Button
            variant="secondary"
            icon="upload"
            onClick={handleBrowseClick}
            disabled={uploading}
          >
            {uploading ? 'Uploading…' : 'Upload file'}
          </Button>
        )}
        <input
          ref={inputRef}
          type="file"
          className={styles.hiddenInput}
          onChange={handleFileChange}
          aria-label="Upload attachment"
          disabled={!storageConfigured || uploading}
          data-testid={testIds.pageOne.attachments.uploadInput}
        />
      </div>

      {!storageConfigured && (
        <Alert severity="info" title="Uploads disabled" className={styles.notice}>
          Configure the storage bucket in the plugin settings to enable attachment uploads.
        </Alert>
      )}

      {storageConfigured && maxSizeLabel && (
        <p className={styles.hint}>Maximum upload size: {maxSizeLabel}.</p>
      )}

      {error && (
        <Alert severity="error" title="Attachment error" onRemove={() => setError(null)} className={styles.notice}>
          {error}
        </Alert>
      )}

      {asset.attachments.length === 0 ? (
        <p className={styles.empty} data-testid={testIds.pageOne.attachments.empty}>
          No attachments uploaded yet.
        </p>
      ) : (
        <ul className={styles.list}>
          {asset.attachments.map((file) => (
            <li key={file.id} className={styles.listItem}>
              <div className={styles.fileInfo}>
                {file.url ? (
                  <a href={file.url} target="_blank" rel="noreferrer">
                    {file.file_name}
                  </a>
                ) : (
                  <span>{file.file_name}</span>
                )}
                <span className={styles.meta}>{new Date(file.created_at).toLocaleString()}</span>
              </div>
              <Button
                variant="destructive"
                size="sm"
                fill="outline"
                onClick={() => handleDelete(file.id)}
                disabled={deletingId === file.id || uploading}
              >
                {deletingId === file.id ? <Spinner size={14} /> : 'Delete'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  const base = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, base);
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[Math.min(base, units.length - 1)]}`;
}

const getStyles = (theme: GrafanaTheme2) => ({
  container: css`
    border: 1px solid ${theme.colors.border.weak};
    border-radius: 4px;
    padding: ${theme.spacing(2)};
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(1)};
    background: ${theme.colors.background.primary};
  `,
  header: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${theme.spacing(1)};
  `,
  heading: css`
    margin: 0;
    font-size: 1rem;
  `,
  hiddenInput: css`
    position: absolute;
    width: 0;
    height: 0;
    padding: 0;
    margin: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    border: 0;
  `,
  hint: css`
    margin: 0;
    color: ${theme.colors.text.secondary};
  `,
  notice: css`
    margin: 0;
  `,
  empty: css`
    margin: 0;
    color: ${theme.colors.text.secondary};
    font-style: italic;
  `,
  list: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(1)};
    margin: 0;
    padding: 0;
    list-style: none;
  `,
  listItem: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${theme.spacing(2)};
  `,
  fileInfo: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(0.5)};
  `,
  meta: css`
    color: ${theme.colors.text.secondary};
    font-size: 0.85rem;
  `,
});

export default AttachmentManager;
