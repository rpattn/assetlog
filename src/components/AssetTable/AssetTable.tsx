import React, { useCallback, useMemo } from 'react';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { useStyles2, Button, InlineField, InlineFieldRow, Input, Pagination, Select } from '@grafana/ui';
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';

import type { AssetFile, AssetListFilters, AssetRecord } from '../../types/assets';

type AssetActionHandler = (asset: AssetRecord) => void;

type ColumnMeta = {
  headerClassName?: string;
  cellClassName?: string;
};

const columnHelper = createColumnHelper<AssetRecord>();

const DEFAULT_PAGE_SIZES = [10, 25, 50, 100];

type FilterKey = keyof AssetListFilters;

const FILTER_CONFIG: Array<{ key: FilterKey; label: string; placeholder?: string }> = [
  { key: 'title', label: 'Title' },
  { key: 'entry_date', label: 'Entry Date' },
  { key: 'commissioning_date', label: 'Commissioning' },
  { key: 'station_name', label: 'Station' },
  { key: 'technician', label: 'Technician' },
  { key: 'service', label: 'Service' },
];

export interface AssetTableProps {
  assets: AssetRecord[];
  onEdit?: AssetActionHandler;
  onDelete?: AssetActionHandler;
  className?: string;
  /** Optional test id applied to the table wrapper */
  testId?: string;
  page?: number;
  pageSize?: number;
  pageCount?: number;
  totalCount?: number;
  filters?: AssetListFilters;
  onFiltersChange?: (filters: AssetListFilters) => void;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
}

export const AssetTable = ({
  assets,
  onEdit,
  onDelete,
  className,
  testId,
  page,
  pageSize,
  pageCount,
  totalCount,
  filters,
  onFiltersChange,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions,
}: AssetTableProps) => {
  const styles = useStyles2(getStyles);
  const showActions = Boolean(onEdit || onDelete);
  const filterValues = useMemo<AssetListFilters>(() => ({ ...(filters ?? {}) }), [filters]);

  const safePage = page && page > 0 ? page : 1;
  const safePageSize = pageSize && pageSize > 0 ? pageSize : Math.max(assets.length, 1);
  const totalRecords = typeof totalCount === 'number' ? totalCount : assets.length;
  const totalPages = pageCount && pageCount > 0 ? pageCount : Math.max(1, Math.ceil(totalRecords / safePageSize));
  const showFilters = Boolean(onFiltersChange);
  const showPageSizeSelect = Boolean(onPageSizeChange);
  const showPagination = Boolean(onPageChange);

  const pageSizeChoices = useMemo(() => {
    const sizes = pageSizeOptions && pageSizeOptions.length > 0 ? pageSizeOptions : DEFAULT_PAGE_SIZES;
    const unique = Array.from(new Set([...sizes, safePageSize])).filter((value) => value > 0);
    unique.sort((a, b) => a - b);
    return unique.map<SelectableValue<number>>((value) => ({ label: `${value} / page`, value }));
  }, [pageSizeOptions, safePageSize]);

  const pageSizeValue = useMemo<SelectableValue<number> | undefined>(() => {
    return pageSizeChoices.find((option) => option.value === safePageSize) ?? pageSizeChoices[0];
  }, [pageSizeChoices, safePageSize]);

  const handleFilterChange = useCallback(
    (key: FilterKey, value: string) => {
      if (!onFiltersChange) {
        return;
      }
      const trimmed = value.trim();
      const next: AssetListFilters = { ...filterValues };
      if (trimmed === '') {
        delete next[key];
      } else {
        next[key] = trimmed;
      }
      onFiltersChange(next);
    },
    [filterValues, onFiltersChange]
  );

  const handlePageSizeChangeInternal = useCallback(
    (option: SelectableValue<number>) => {
      if (!onPageSizeChange || !option?.value) {
        return;
      }
      onPageSizeChange(option.value);
    },
    [onPageSizeChange]
  );

  const handlePageChangeInternal = useCallback(
    (nextPage: number) => {
      if (!onPageChange) {
        return;
      }
      onPageChange(nextPage);
    },
    [onPageChange]
  );

  const rowCount = assets.length;
  let rangeStart = 0;
  let rangeEnd = 0;
  if (rowCount > 0) {
    rangeStart = (safePage - 1) * safePageSize + 1;
    rangeEnd = rangeStart + rowCount - 1;
  } else if (totalRecords > 0) {
    rangeStart = (safePage - 1) * safePageSize + 1;
    rangeEnd = Math.min(totalRecords, safePage * safePageSize);
  }

  const columns = useMemo(
    () =>
      [
        columnHelper.accessor('title', {
          header: 'Title',
          cell: (info) => info.getValue(),
        }),
        columnHelper.accessor('entry_date', {
          header: 'Entry Date',
          cell: (info) => info.getValue(),
        }),
        columnHelper.accessor('commissioning_date', {
          header: 'Commissioning',
          cell: (info) => info.getValue(),
        }),
        columnHelper.accessor('station_name', {
          header: 'Station',
          cell: (info) => info.getValue(),
        }),
        columnHelper.accessor('technician', {
          header: 'Technician',
          cell: (info) => info.getValue(),
        }),
        columnHelper.display({
          id: 'startEnd',
          header: 'Start / End',
          cell: (info) => {
            const asset = info.row.original;
            return (
              <>{asset.start_date} — {asset.end_date}</>
            );
          },
        }),
        columnHelper.accessor('service', {
          header: 'Service',
          cell: (info) => info.getValue() ?? '—',
        }),
        columnHelper.accessor('staff', {
          header: 'Staff',
          cell: (info) => {
            const staff = info.getValue();
            return staff.length > 0 ? staff.join(', ') : '—';
          },
        }),
        columnHelper.display({
          id: 'attachments',
          header: 'Attachments',
          cell: (info) => {
            const asset = info.row.original;

            if (asset.attachments.length === 0) {
              return <span className={styles.muted}>—</span>;
            }

            return (
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
            );
          },
        }),
        ...(showActions
          ? [
              columnHelper.display({
                id: 'actions',
                header: 'Actions',
                meta: { cellClassName: styles.actionsCell } satisfies ColumnMeta,
                cell: (info) => {
                  const asset = info.row.original;

                  return (
                    <>
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
                    </>
                  );
                },
              }),
            ]
          : []),
      ],
    [onDelete, onEdit, showActions, styles]
  );

  const table = useReactTable({
    data: assets,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (asset) => asset.id.toString(),
  });

  const summaryText = (() => {
    if (totalRecords === 0) {
      return 'Showing 0 of 0 assets';
    }
    if (rangeStart === 0 && rangeEnd === 0) {
      return `Showing 0 of ${totalRecords} assets`;
    }
    if (rangeStart === rangeEnd) {
      return `Showing ${rangeStart} of ${totalRecords} assets`;
    }
    return `Showing ${rangeStart}–${rangeEnd} of ${totalRecords} assets`;
  })();

  return (
    <div className={cx(styles.container, className)} data-testid={testId}>
      {showFilters && (
        <div className={styles.controls}>
          <InlineFieldRow className={styles.filterRow}>
            {FILTER_CONFIG.map(({ key, label, placeholder }) => (
              <InlineField label={label} key={key} grow={true} labelWidth={16} className={styles.filterField}>
                <Input
                  value={filterValues[key] ?? ''}
                  placeholder={placeholder ?? `Filter ${label.toLowerCase()}`}
                  onChange={(event) => handleFilterChange(key, event.currentTarget.value)}
                />
              </InlineField>
            ))}
          </InlineFieldRow>
        </div>
      )}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const meta = header.column.columnDef.meta as ColumnMeta | undefined;
                  return (
                    <th key={header.id} className={cx(styles.th, meta?.headerClassName)}>
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id}>
                {row.getVisibleCells().map((cell) => {
                  const meta = cell.column.columnDef.meta as ColumnMeta | undefined;
                  return (
                    <td key={cell.id} className={cx(styles.td, meta?.cellClassName)}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(showPagination || showPageSizeSelect) && (
        <div className={styles.paginationRow}>
          <div className={styles.paginationSummary}>{summaryText}</div>
          <div className={styles.paginationControls}>
            {showPageSizeSelect && pageSizeValue && (
              <Select
                options={pageSizeChoices}
                value={pageSizeValue}
                onChange={handlePageSizeChangeInternal}
                className={styles.pageSizeSelect}
                menuShouldPortal
              />
            )}
            {showPagination && (
              <Pagination
                currentPage={safePage}
                numberOfPages={totalPages}
                onNavigate={handlePageChangeInternal}
                hideWhenSinglePage
                showSmallVersion
              />
            )}
          </div>
        </div>
      )}
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
    container: css`
      display: flex;
      flex-direction: column;
      gap: ${theme.spacing(1)};
    `,
    controls: css`
      display: flex;
      flex-direction: column;
      gap: ${theme.spacing(1)};
    `,
    filterRow: css`
      gap: ${theme.spacing(1)};
      flex-wrap: wrap;
    `,
    filterField: css`
      min-width: 180px;
      flex: 1 1 200px;
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
    paginationRow: css`
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: ${theme.spacing(1)};
    `,
    paginationSummary: css`
      color: ${theme.colors.text.secondary};
    `,
    paginationControls: css`
      display: flex;
      align-items: center;
      gap: ${theme.spacing(1)};
    `,
    pageSizeSelect: css`
      min-width: 140px;
    `,
  };
};

export default AssetTable;
