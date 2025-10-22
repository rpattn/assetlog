import React from 'react';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2, Button } from '@grafana/ui';

import type { AssetFile, AssetRecord } from '../../types/assets';

type AssetActionHandler = (asset: AssetRecord) => void;

export interface AssetTableProps {
  assets: AssetRecord[];
  onEdit?: AssetActionHandler;
  onDelete?: AssetActionHandler;
  className?: string;
  /** Optional test id applied to the table wrapper */
  testId?: string;
}

export const AssetTable = ({ assets, onEdit, onDelete, className, testId }: AssetTableProps) => {
  const styles = useStyles2(getStyles);
  const showActions = Boolean(onEdit || onDelete);

  return (
    <div className={cx(styles.tableWrap, className)} data-testid={testId}>
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
            {showActions && <th className={styles.th}>Actions</th>}
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
                      <li key={file.id} className={styles.attachmentItem}>
                        {file.url ? (
                          <a href={file.url} target="_blank" rel="noreferrer" className={styles.attachmentLink}>
                            {isImageAttachment(file) && (
                              <span className={styles.attachmentThumbnail}>
                                <img src={file.url} alt={file.file_name} className={styles.attachmentImage} />
                              </span>
                            )}
                            <span className={styles.attachmentName}>{file.file_name}</span>
                          </a>
                        ) : (
                          <span className={styles.attachmentName}>{file.file_name}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
              {showActions && (
                <td className={styles.actionsCell}>
                  {onEdit && (
                    <Button size="sm" variant="secondary" fill="outline" onClick={() => onEdit(asset)}>
                      Edit
                    </Button>
                  )}
                  {onDelete && (
                    <Button size="sm" variant="destructive" fill="outline" onClick={() => onDelete(asset)}>
                      Delete
                    </Button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const IMAGE_EXTENSIONS = new Set([
  'avif',
  'bmp',
  'gif',
  'ico',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'tif',
  'tiff',
  'webp',
]);

function isImageAttachment(file: AssetFile): boolean {
  if (file.content_type?.startsWith('image/')) {
    return true;
  }

  const extensionMatch = file.file_name.match(/\.([^.]+)$/);
  if (!extensionMatch) {
    return false;
  }

  return IMAGE_EXTENSIONS.has(extensionMatch[1].toLowerCase());
}

const getStyles = (theme: GrafanaTheme2) => {
  const border = `1px solid ${theme.colors.border.weak}`;
  return {
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
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: ${theme.spacing(0.5)};
    `,
    attachmentItem: css`
      list-style: none;
    `,
    attachmentLink: css`
      display: inline-flex;
      align-items: center;
      gap: ${theme.spacing(1)};
      text-decoration: none;
      color: ${theme.colors.text.link};

      &:hover,
      &:focus {
        text-decoration: underline;
      }
    `,
    attachmentThumbnail: css`
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 64px;
      height: 48px;
      border-radius: 2px;
      overflow: hidden;
      background: ${theme.colors.background.secondary};
      border: ${border};
      flex-shrink: 0;
    `,
    attachmentImage: css`
      display: block;
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    `,
    attachmentName: css`
      overflow-wrap: anywhere;
    `,
    actionsCell: css`
      display: flex;
      gap: ${theme.spacing(1)};
      flex-wrap: wrap;
    `,
  };
};

export default AssetTable;
