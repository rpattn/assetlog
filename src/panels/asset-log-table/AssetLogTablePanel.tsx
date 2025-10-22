import React, { useEffect, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, PanelProps } from '@grafana/data';
import { useStyles2, Alert, Spinner, Button } from '@grafana/ui';

import type { AssetRecord } from '../../types/assets';
import { fetchAssets, toErrorMessage } from '../../utils/assetsApi';
import { sortAssets } from '../../utils/assetSort';
import { AssetTable } from '../../components/AssetTable';
import type { AssetLogTableOptions } from './types';

export const AssetLogTablePanel: React.FC<PanelProps<AssetLogTableOptions>> = ({ data, options }) => {
  const styles = useStyles2(getStyles);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [manualReload, setManualReload] = useState(0);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);

    fetchAssets()
      .then(({ assets: records }) => {
        if (!cancelled) {
          setAssets(sortAssets(records));
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
  }, [data?.request?.requestId, manualReload]);

  const maxItems = useMemo(() => sanitizeMaxItems(options.maxItems), [options.maxItems]);
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
