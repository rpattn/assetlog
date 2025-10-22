import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { useStyles2, Button, Input, Pagination, Select } from '@grafana/ui';
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';

import type { AssetFile, AssetFilterKey, AssetListFilters, AssetRecord } from '../../types/assets';
import { EMPTY_FILTER_VALUE } from '../../types/assets';

type AssetActionHandler = (asset: AssetRecord) => void;

type ColumnMeta = {
  headerClassName?: string;
  cellClassName?: string;
};

const columnHelper = createColumnHelper<AssetRecord>();

const DEFAULT_PAGE_SIZES = [10, 25, 50, 100];

type FilterKey = keyof AssetListFilters;

type ColumnFilterOption = {
  value: string;
  label: string;
  count: number;
};

type FilterColumnConfig = {
  key: FilterKey;
  label: string;
  accessor: (asset: AssetRecord) => string | undefined | null;
};

const FILTER_CONFIG: FilterColumnConfig[] = [
  { key: 'title', label: 'Title', accessor: (asset) => asset.title },
  { key: 'entry_date', label: 'Entry Date', accessor: (asset) => asset.entry_date },
  { key: 'commissioning_date', label: 'Commissioning', accessor: (asset) => asset.commissioning_date },
  { key: 'station_name', label: 'Station', accessor: (asset) => asset.station_name },
  { key: 'technician', label: 'Technician', accessor: (asset) => asset.technician },
  { key: 'service', label: 'Service', accessor: (asset) => asset.service },
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

  const [activeFilter, setActiveFilter] = useState<{ key: FilterKey; button: HTMLButtonElement | null } | null>(null);
  const [hoveredFilter, setHoveredFilter] = useState<FilterKey | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const filterOptions = useMemo(
    () => buildFilterOptions(assets, filterValues),
    [assets, filterValues]
  );

  const handleFilterButtonClick = useCallback(
    (key: FilterKey, button: HTMLButtonElement | null) => {
      if (!showFilters) {
        return;
      }
      setActiveFilter((current) => {
        if (current && current.key === key) {
          return null;
        }
        return { key, button };
      });
    },
    [showFilters]
  );

  const closeActiveFilter = useCallback(() => {
    popoverRef.current = null;
    setActiveFilter(null);
  }, []);

  const handleFilterApply = useCallback(
    (key: FilterKey, values: string[] | null) => {
      if (!onFiltersChange) {
        closeActiveFilter();
        return;
      }
      const next: AssetListFilters = { ...filterValues };
      if (!values || values.length === 0) {
        delete next[key];
      } else {
        next[key] = values;
      }
      onFiltersChange(next);
      closeActiveFilter();
    },
    [closeActiveFilter, filterValues, onFiltersChange]
  );

  useEffect(() => {
    if (!showFilters) {
      setHoveredFilter(null);
    }
  }, [showFilters]);

  useEffect(() => {
    if (!activeFilter) {
      return;
    }
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popoverRef.current && popoverRef.current.contains(target)) {
        return;
      }
      if (activeFilter.button && activeFilter.button.contains(target)) {
        return;
      }
      closeActiveFilter();
    };
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('mousedown', handleClick);
    };
  }, [activeFilter, closeActiveFilter]);

  useEffect(() => {
    if (!activeFilter) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeActiveFilter();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeFilter, closeActiveFilter]);

  const pageSizeChoices = useMemo(() => {
    const sizes = pageSizeOptions && pageSizeOptions.length > 0 ? pageSizeOptions : DEFAULT_PAGE_SIZES;
    const unique = Array.from(new Set([...sizes, safePageSize])).filter((value) => value > 0);
    unique.sort((a, b) => a - b);
    return unique.map<SelectableValue<number>>((value) => ({ label: `${value} / page`, value }));
  }, [pageSizeOptions, safePageSize]);

  const pageSizeValue = useMemo<SelectableValue<number> | undefined>(() => {
    return pageSizeChoices.find((option) => option.value === safePageSize) ?? pageSizeChoices[0];
  }, [pageSizeChoices, safePageSize]);

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

  const renderHeader = useCallback(
    (label: string, key?: FilterKey) => {
      if (!key || !showFilters) {
        return (
          <div className={styles.headerContent}>
            <span className={styles.headerLabel}>{label}</span>
          </div>
        );
      }
      const isActive = Boolean(filterValues[key]?.length);
      const isOpen = activeFilter?.key === key;
      const isHovered = hoveredFilter === key;
      return (
        <div
          className={styles.headerContent}
          onMouseEnter={() => setHoveredFilter(key)}
          onMouseLeave={() => {
            setHoveredFilter((current) => (current === key ? null : current));
          }}
        >
          <span className={styles.headerLabel}>{label}</span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon="filter"
            className={cx(
              styles.filterButton,
              (isActive || isOpen || isHovered) && styles.filterButtonVisible,
              isActive && styles.filterButtonActive
            )}
            title={`Filter ${label}`}
            aria-pressed={isOpen || isActive}
            aria-haspopup="dialog"
            onClick={(event) => handleFilterButtonClick(key, event.currentTarget)}
          />
          {isOpen && (
            <FilterMenu
              key={key}
              ref={(element) => {
                popoverRef.current = element;
              }}
              label={label}
              options={filterOptions[key] ?? []}
              selectedValues={filterValues[key]}
              onApply={(values) => handleFilterApply(key, values)}
              onClose={closeActiveFilter}
              styles={styles}
            />
          )}
        </div>
      );
    },
    [
      activeFilter,
      closeActiveFilter,
      filterOptions,
      filterValues,
      handleFilterApply,
      handleFilterButtonClick,
      hoveredFilter,
      setHoveredFilter,
      showFilters,
      styles,
    ]
  );

  const columns = useMemo(
    () =>
      [
        columnHelper.accessor('title', {
          header: () => renderHeader('Title', 'title'),
          cell: (info) => info.getValue(),
        }),
        columnHelper.accessor('entry_date', {
          header: () => renderHeader('Entry Date', 'entry_date'),
          cell: (info) => info.getValue(),
        }),
        columnHelper.accessor('commissioning_date', {
          header: () => renderHeader('Commissioning', 'commissioning_date'),
          cell: (info) => info.getValue(),
        }),
        columnHelper.accessor('station_name', {
          header: () => renderHeader('Station', 'station_name'),
          cell: (info) => info.getValue(),
        }),
        columnHelper.accessor('technician', {
          header: () => renderHeader('Technician', 'technician'),
          cell: (info) => info.getValue(),
        }),
        columnHelper.display({
          id: 'startEnd',
          header: () => renderHeader('Start / End'),
          cell: (info) => {
            const asset = info.row.original;
            return (
              <>{asset.start_date} — {asset.end_date}</>
            );
          },
        }),
        columnHelper.accessor('service', {
          header: () => renderHeader('Service', 'service'),
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
    [onDelete, onEdit, renderHeader, showActions, styles]
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

type Styles = ReturnType<typeof getStyles>;

type FilterMenuProps = {
  label: string;
  options: ColumnFilterOption[];
  selectedValues?: string[];
  onApply: (values: string[] | null) => void;
  onClose: () => void;
  styles: Styles;
};

const FilterMenu = React.forwardRef<HTMLDivElement, FilterMenuProps>(
  ({ label, options, selectedValues, onApply, onClose, styles }, ref) => {
    const [search, setSearch] = useState('');
    const [pending, setPending] = useState<string[] | null>(
      selectedValues ? [...selectedValues] : null
    );
    const searchRef = useRef<HTMLInputElement | null>(null);
    const selectAllRef = useRef<HTMLInputElement | null>(null);
    const debouncedSearch = useDebouncedValue(search, 200);

    useEffect(() => {
      setSearch('');
      setPending(selectedValues ? [...selectedValues] : null);
    }, [selectedValues, options]);

    useEffect(() => {
      searchRef.current?.focus();
    }, []);

    const optionValues = useMemo(() => options.map((option) => option.value), [options]);

    const selectedSet = useMemo(() => {
      if (pending === null) {
        return new Set(optionValues);
      }
      return new Set(pending);
    }, [optionValues, pending]);

    const totalOptions = optionValues.length;
    const allSelected =
      pending === null || (totalOptions > 0 && selectedSet.size === totalOptions);

    const visibleOptions = useMemo(() => {
      if (!debouncedSearch) {
        return options;
      }
      const term = debouncedSearch.toLowerCase();
      return options.filter((option) => option.label.toLowerCase().includes(term));
    }, [debouncedSearch, options]);

    useEffect(() => {
      if (!selectAllRef.current) {
        return;
      }
      const partial = selectedSet.size > 0 && selectedSet.size < totalOptions;
      selectAllRef.current.indeterminate = partial;
    }, [selectedSet, totalOptions]);

    const toggleSelectAll = () => {
      setPending((prev) => {
        if (prev === null || (Array.isArray(prev) && prev.length === totalOptions)) {
          return [];
        }
        return null;
      });
    };

    const toggleValue = (value: string) => {
      setPending((prev) => {
        if (prev === null) {
          return optionValues.filter((item) => item !== value);
        }
        const next = new Set(prev);
        if (next.has(value)) {
          next.delete(value);
        } else {
          next.add(value);
        }
        return Array.from(next);
      });
    };

    const handleSubmit = () => {
      if (pending === null || (totalOptions > 0 && selectedSet.size === totalOptions)) {
        onApply(null);
        return;
      }
      onApply(Array.from(selectedSet));
    };

    const handleClear = () => {
      setPending(null);
      setSearch('');
    };

    return (
      <div className={styles.filterPopover} ref={ref} role="dialog" aria-label={`Filter ${label}`}>
        <div className={styles.filterHeader}>
          <div className={styles.filterTitle}>Filter {label}</div>
        </div>
        <Input
          ref={searchRef}
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          placeholder={`Search ${label.toLowerCase()}`}
          className={styles.filterSearch}
        />
        <ul className={styles.filterList} role="listbox">
          <li className={styles.filterListItem} key="select-all">
            <label className={styles.filterCheckbox}>
              <input
                ref={selectAllRef}
                type="checkbox"
                className={styles.filterCheckboxInput}
                checked={allSelected}
                onChange={toggleSelectAll}
              />
              <span className={styles.filterCheckboxLabel}>Select all</span>
            </label>
          </li>
          {visibleOptions.length === 0 ? (
            <li className={cx(styles.filterListItem, styles.filterEmpty)} key="empty">
              No matching values
            </li>
          ) : (
            visibleOptions.map((option) => (
              <li className={styles.filterListItem} key={option.value}>
                <label className={styles.filterCheckbox}>
                  <input
                    type="checkbox"
                    className={styles.filterCheckboxInput}
                    checked={selectedSet.has(option.value)}
                    onChange={() => toggleValue(option.value)}
                  />
                  <span className={styles.filterCheckboxLabel}>{option.label}</span>
                </label>
                <span className={styles.filterCount}>{option.count}</span>
              </li>
            ))
          )}
        </ul>
        <div className={styles.filterActions}>
          <Button type="button" variant="secondary" fill="text" size="sm" onClick={handleClear}>
            Clear
          </Button>
          <div className={styles.filterActionGroup}>
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" variant="primary" size="sm" onClick={handleSubmit}>
              Apply
            </Button>
          </div>
        </div>
      </div>
    );
  }
);

FilterMenu.displayName = 'FilterMenu';

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(handle);
  }, [value, delay]);

  return debounced;
}

function buildFilterOptions(
  assets: AssetRecord[],
  filters: AssetListFilters
): Partial<Record<FilterKey, ColumnFilterOption[]>> {
  const maps = new Map<FilterKey, Map<string, number>>();
  FILTER_CONFIG.forEach(({ key }) => {
    maps.set(key, new Map());
  });

  assets.forEach((asset) => {
    FILTER_CONFIG.forEach(({ key, accessor }) => {
      const map = maps.get(key);
      if (!map) {
        return;
      }
      const value = normalizeFilterOptionValue(accessor(asset));
      map.set(value, (map.get(value) ?? 0) + 1);
    });
  });

  (Object.entries(filters) as [FilterKey, string[]][]).forEach(([key, values]) => {
    const map = maps.get(key);
    if (!map || !values) {
      return;
    }
    values.forEach((value) => {
      if (!map.has(value)) {
        map.set(value, 0);
      }
    });
  });

  const result: Partial<Record<FilterKey, ColumnFilterOption[]>> = {};
  maps.forEach((map, key) => {
    const optionsForColumn = Array.from(map.entries()).map(([value, count]) => ({
      value,
      count,
      label: formatFilterOptionLabel(value),
    }));
    optionsForColumn.sort((a, b) => compareFilterOptionValue(a.value, b.value));
    result[key] = optionsForColumn;
  });
  return result;
}

function normalizeFilterOptionValue(value: string | undefined | null): string {
  if (value === undefined || value === null) {
    return EMPTY_FILTER_VALUE;
  }
  const trimmed = value.trim();
  return trimmed === '' ? EMPTY_FILTER_VALUE : trimmed;
}

function formatFilterOptionLabel(value: string): string {
  if (value === EMPTY_FILTER_VALUE) {
    return 'No value';
  }
  return value;
}

function compareFilterOptionValue(a: string, b: string): number {
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
  const filterButton = css`
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease-in-out;
    min-width: 0;

    &:focus-visible {
      opacity: 1;
      pointer-events: auto;
    }
  `;

  const filterButtonVisible = css`
    opacity: 1 !important;
    pointer-events: auto !important;
  `;

  const filterButtonActive = css`
    background: ${theme.colors.action.hover};
    color: ${theme.colors.text.maxContrast};
  `;

  return {
    container: css`
      display: flex;
      flex-direction: column;
      gap: ${theme.spacing(1)};
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
      position: relative;

      &:hover .${filterButton} {
        opacity: 1;
        pointer-events: auto;
      }
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
    headerContent: css`
      display: flex;
      align-items: center;
      gap: ${theme.spacing(0.5)};

      &:hover .${filterButton},
      &:focus-within .${filterButton} {
        opacity: 1;
        pointer-events: auto;
      }
    `,
    headerLabel: css`
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    `,
    filterButton,
    filterButtonVisible,
    filterButtonActive,
    filterPopover: css`
      position: absolute;
      top: calc(100% - ${theme.spacing(0.5)});
      right: 0;
      min-width: 260px;
      max-width: 320px;
      background: ${theme.colors.background.primary};
      border: ${border};
      border-radius: 4px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
      padding: ${theme.spacing(1)};
      z-index: 10;
    `,
    filterHeader: css`
      margin-bottom: ${theme.spacing(0.5)};
    `,
    filterTitle: css`
      font-weight: 600;
      margin: 0;
    `,
    filterSearch: css`
      margin-bottom: ${theme.spacing(1)};
    `,
    filterList: css`
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: ${theme.spacing(0.5)};
      max-height: 220px;
      overflow-y: auto;
    `,
    filterListItem: css`
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: ${theme.spacing(0.5)};
      list-style: none;
    `,
    filterCheckbox: css`
      display: flex;
      align-items: center;
      gap: ${theme.spacing(0.5)};
      cursor: pointer;
      user-select: none;
      width: 100%;
    `,
    filterCheckboxInput: css`
      margin: 0;
    `,
    filterCheckboxLabel: css`
      flex: 1 1 auto;
      word-break: break-word;
    `,
    filterCount: css`
      color: ${theme.colors.text.secondary};
      font-size: ${theme.typography.bodySmall.fontSize};
    `,
    filterEmpty: css`
      color: ${theme.colors.text.secondary};
      font-style: italic;
    `,
    filterActions: css`
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: ${theme.spacing(1)};
      gap: ${theme.spacing(1)};
    `,
    filterActionGroup: css`
      display: flex;
      gap: ${theme.spacing(1)};
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
