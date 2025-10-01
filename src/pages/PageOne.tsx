// File: src/pages/pageOne.tsx
import React, { useEffect, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import { PluginPage } from '@grafana/runtime';
import { testIds } from '../components/testIds';

type AssetRecord = {
  id: string | number | null;
  title: string;
  entry_date: string;
  commissioning_date: string;
  station_name: string;
  technician: string;
  start_date: string;
  end_date: string;
  service: string;
  staff: string[]; // JSON array
  latitude?: number;
  longitude?: number;
  pitch?: number;
  roll?: number;
  images: string[];
};

function PageOne() {
  const s = useStyles2(getStyles);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const PLUGIN_ID = 'rpatt-assetlog-app';
  const endpoint = `/api/plugins/${PLUGIN_ID}/resources/assets`;

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setErr(null);

    fetch(endpoint, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`request failed: ${res.status} ${res.statusText} ${text}`);
        }
        return res.json();
      })
      .then((payload) => {
        const got = payload?.data ?? [];
        if (mounted) {
          setAssets(got);
          setLoading(false);
        }
      })
      .catch((e: any) => {
        if (mounted) {
          setErr(e?.message ?? String(e));
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [endpoint]);

  return (
    <PluginPage>
      <div data-testid={testIds.pageOne.container} className={s.container}>
        <h2 className={s.title}>Asset Log</h2>

        {loading && <div className={s.info}>Loading assets…</div>}
        {err && <div className={s.error}>Error: {err}</div>}

        {!loading && !err && (
          <>
            {assets.length === 0 ? (
              <div className={s.info}>No assets found for your organization.</div>
            ) : (
              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th className={s.th}>Title</th>
                      <th className={s.th}>Entry Date</th>
                      <th className={s.th}>Commissioning</th>
                      <th className={s.th}>Station</th>
                      <th className={s.th}>Technician</th>
                      <th className={s.th}>Start / End</th>
                      <th className={s.th}>Service</th>
                      <th className={s.th}>Staff</th>
                      <th className={s.th}>Images</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assets.map((a) => (
                      <tr key={String(a.id ?? `${a.title}-${Math.random()}`)}>
                        <td className={s.td}>{a.title}</td>
                        <td className={s.td}>{a.entry_date}</td>
                        <td className={s.td}>{a.commissioning_date}</td>
                        <td className={s.td}>{a.station_name}</td>
                        <td className={s.td}>{a.technician}</td>
                        <td className={s.td}>
                          {a.start_date} — {a.end_date}
                        </td>
                        <td className={s.td}>{a.service}</td>
                        <td className={s.td}>{a.staff.join(', ')}</td>
                        <td className={s.td}>
                          {a.images && a.images.length > 0 ? (
                            <div className={s.imagesCell}>
                              {a.images.map((u, i) => (
                                <div key={i} className={s.imageItem}>
                                  <a href={u} target="_blank" rel="noopener noreferrer" title={u}>
                                    <img src={u} alt={`img-${i}`} className={s.thumb} />
                                  </a>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className={s.noImages}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </PluginPage>
  );
}

export default PageOne;

// Styles unchanged except for minor adjustments if needed
const getStyles = (theme: GrafanaTheme2) => {
  const border = `1px solid ${theme.colors.border.weak}`;
  return {
    container: css`padding: ${theme.spacing(3)};`,
    title: css`margin: 0 0 ${theme.spacing(2)}; font-size: 1.25rem;`,
    info: css`color: ${theme.colors.text.secondary}; margin-bottom: ${theme.spacing(1)};`,
    error: css`color: ${theme.colors.error.text}; margin-bottom: ${theme.spacing(1)};`,
    tableWrap: css`overflow-x: auto; border: ${border}; border-radius: 4px;`,
    table: css`width: 100%; border-collapse: collapse; min-width: 1024px;`,
    th: css`text-align: left; padding: ${theme.spacing(1)}; background: ${theme.colors.background.secondary}; border-bottom: ${border}; font-weight: 600;`,
    td: css`padding: ${theme.spacing(1)}; border-bottom: ${border}; vertical-align: top;`,
    imagesCell: css`display: flex; flex-wrap: wrap; gap: ${theme.spacing(1)};`,
    imageItem: css`display: inline-block;`,
    thumb: css`width: 80px; height: 56px; object-fit: cover; border-radius: 4px; border: 1px solid ${theme.colors.border.weak}; display: block;`,
    noImages: css`color: ${theme.colors.text.secondary};`,
  };
};
