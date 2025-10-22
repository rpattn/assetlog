import React, { useEffect, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, PanelProps } from '@grafana/data';
import { useStyles2, Alert, Spinner, Button } from '@grafana/ui';

import type {
  AssetFilterKey,
  AssetListFilters,
  AssetListSort,
  AssetRecord,
  AssetSortDirection,
  AssetSortKey,
} from '../../types/assets';
import { EMPTY_FILTER_VALUE } from '../../types/assets';
import { fetchAssets, toErrorMessage } from '../../utils/assetsApi';
import type { AssetListQuery } from '../../utils/assetsApi';
import { AssetTable } from '../../components/AssetTable';
import type { AssetLogTableOptions } from './types';

export const AssetLogTablePanel: React.FC<PanelProps<AssetLogTableOptions>> = ({ data, options }) => {
  const styles = useStyles2(getStyles);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [manualReload, setManualReload] = useState(0);

  const filters = useMemo(() => buildFilters(options.filters), [options.filters]);
  const sort = useMemo(() => buildSort(options.sortKey, options.sortDirection), [options.sortKey, options.sortDirection]);
  const maxItems = useMemo(() => sanitizeMaxItems(options.maxItems), [options.maxItems]);
  const requestId = data?.request?.requestId;

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);

    const query: AssetListQuery = {};
    if (filters && Object.keys(filters).length > 0) {
      query.filters = filters;
    }
    if (sort) {
      query.sort = sort;
    }
    if (maxItems) {
      query.page = 1;
      query.pageSize = maxItems;
    }

    fetchAssets(query)
      .then(({ assets: records }) => {
        if (!cancelled) {
          setAssets(records);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(toErrorMessage(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [filters, sort, maxItems, manualReload, requestId]);

  const visibleAssets = useMemo(() => {
    if (!maxItems) {
      return assets;
    }
    return assets.slice(0, maxItems);
  }, [assets, maxItems]);

  const handleRetry = () => {
    setManualReload((value) => value + 1);
  };

  const showTable = !loading && !error && visibleAssets.length > 0;
  const showEmpty = !loading && !error && visibleAssets.length === 0;
  const showError = !loading && Boolean(error);

  return (
    <div className={styles.container}>
      {loading && (
        <div className={styles.centered}>
          <Spinner size={16} />
          <span>Loading assets…</span>
        </div>
      )}

      {showError && (
        <Alert title="Failed to load assets" severity="error" className={styles.alert}>
          <div className={styles.alertBody}>
            <span>{error}</span>
            <Button variant="secondary" fill="outline" size="sm" onClick={handleRetry}>
              Retry
            </Button>
          </div>
        </Alert>
      )}

      {showEmpty && (
        <Alert title="No assets" severity="info" className={styles.alert}>
          No assets found for your organization.
        </Alert>
      )}

      {showTable && <AssetTable assets={visibleAssets} className={styles.table} />}
    </div>
  );
};

const sanitizeMaxItems = (value: number | undefined) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }

  const normalized = Math.floor(numeric);
  if (normalized <= 0) {
    return undefined;
  }

  return normalized;
};

function buildFilters(filters?: AssetLogTableOptions['filters']): AssetListFilters | undefined {
  if (!filters) {
    return undefined;
  }

  const normalized: AssetListFilters = {};
  (Object.entries(filters) as [AssetFilterKey, string | undefined][]).forEach(([key, raw]) => {
    const values = parseFilterValues(raw);
    if (!values || values.length === 0) {
      return;
    }
    normalized[key] = values;
  });

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function parseFilterValues(value?: string): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const parts = value
    .split(/[\n,]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '');

  if (parts.length === 0) {
    return undefined;
  }

  const seen = new Set<string>();
  const values: string[] = [];

  parts.forEach((part) => {
    const normalized = normalizeFilterToken(part);
    if (seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    values.push(normalized);
  });

  values.sort(compareFilterValue);
  return values;
}

function normalizeFilterToken(value: string): string {
  if (value === EMPTY_FILTER_VALUE) {
    return value;
  }

  const normalized = value.trim();
  if (normalized === '') {
    return normalized;
  }

  const lowered = normalized.toLowerCase();
  if (lowered === 'empty' || lowered === '(empty)' || lowered === '[empty]' || lowered === 'no value') {
    return EMPTY_FILTER_VALUE;
  }

  return normalized;
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

function buildSort(sortKey?: AssetSortKey | '', sortDirection?: AssetSortDirection): AssetListSort {
  let key: AssetSortKey = 'entry_date';
  if (sortKey) {
    key = sortKey;
  }

  return {
    key,
    direction: normalizeSortDirection(sortDirection),
  };
}

function normalizeSortDirection(direction?: AssetSortDirection): AssetSortDirection {
  return direction === 'asc' ? 'asc' : 'desc';
}

const getStyles = (theme: GrafanaTheme2) => {
  return {
    container: css`
      display: flex;
      flex-direction: column;
      gap: ${theme.spacing(1)};
      padding: ${theme.spacing(1)};
      height: 100%;
      width: 100%;
      box-sizing: border-box;
      overflow: hidden;
    `,
    centered: css`
      display: inline-flex;
      align-items: center;
      gap: ${theme.spacing(1)};
      color: ${theme.colors.text.secondary};
    `,
    alert: css`
      margin: 0;
    `,
    alertBody: css`
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: ${theme.spacing(1)};
      flex-wrap: wrap;
    `,
    table: css`
      flex: 1 1 auto;
      min-height: 0;
    `,
  };
};

export default AssetLogTablePanel;
